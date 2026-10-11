import { skyRendererDouble } from './sky-renderer-double.ts';
import { afterEach, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  SKY_PMREM_SIZE,
  SkyEnvironment,
  configureSky,
  groundLightState,
} from '../src/rendering/daylight.ts';
import { groundIrradiance } from '../src/rendering/studio/ibl-energy.ts';
import { skyLight } from '../src/rendering/sky-light.ts';
import { installWetRoad, installStableSurfaceBump } from '../src/rendering/materials.ts';

afterEach(() => vi.restoreAllMocks());
it('interpolates bounded sky bins, restores live uniforms and disposes replaced outputs exactly once', () => {
  const sky = new Sky();
  configureSky(sky);
  sky.material.uniforms.cloudCover.value = 0.37;
  sky.material.uniforms.turbidity.value = 4.65;
  sky.material.uniforms.skyRadiance.value = 0.394;
  const samples: number[] = [],
    outputs: T.WebGLRenderTarget[] = [];
  const render = vi.spyOn(T.PMREMGenerator.prototype, 'fromScene').mockImplementation((scene) => {
    const material = (scene.children[0] as Sky).material;
    samples.push(material.uniforms.cloudCover.value);
    // Each capture binds its own bin's physical sky (sky view and scale).
    expect(material.uniforms.skyRadiance.value).toBeCloseTo(
      skyLight(material.uniforms.cloudCover.value, 'day').skyScale,
      8,
    );
    expect(material.uniforms.sunDiscAmount.value).toBe(0);
    const target = new T.WebGLRenderTarget(8, 8);
    outputs.push(target);
    return target;
  });
  const generatorDispose = vi.spyOn(T.PMREMGenerator.prototype, 'dispose');
  // Capture/rasterization are mocked here; retained targets, blend calls and
  // restoration are real production logic. Browser GPU evidence is separate.
  const renderer = skyRendererDouble().renderer;
  const scene = new T.Scene(),
    environment = new SkyEnvironment(sky);
  expect(environment.update(renderer, scene, 0.36)).toBe(true);
  const disposeFirst = vi.spyOn(outputs[0], 'dispose');
  expect(environment.update(renderer, scene, 0.36)).toBe(false);
  expect(environment.update(renderer, scene, 0.37)).toBe(true);
  expect(render).toHaveBeenCalledTimes(2);
  expect(environment.update(renderer, scene, 0.8)).toBe(true);
  expect(disposeFirst).toHaveBeenCalledTimes(1);
  expect(environment.update(renderer, scene, 0.36)).toBe(true);
  expect(samples).toEqual([0.25, 0.375, 0.75, 0.875, 0.25, 0.375]);
  expect(render).toHaveBeenCalledTimes(6);
  expect(scene.environment?.mapping).toBe(T.CubeUVReflectionMapping);
  expect(environment.diagnostics().retainedTargets).toBe(4);
  expect(sky.material.uniforms.cloudCover.value).toBe(0.37);
  expect(sky.material.uniforms.turbidity.value).toBe(4.65);
  // The visible dome is bound to the last presented cover, not to a capture.
  expect(sky.material.uniforms.skyRadiance.value).toBe(skyLight(0.36, 'day').skyScale);
  expect(sky.material.uniforms.sunDiscAmount.value).toBe(1);
  expect(generatorDispose).toHaveBeenCalledTimes(6);
  const lastDispose = vi.spyOn(outputs[5], 'dispose');
  environment.dispose();
  environment.dispose();
  expect(lastDispose).toHaveBeenCalledTimes(1);
  sky.geometry.dispose();
  sky.material.dispose();
});
it('does not publish a failed sky capture, lose the previous texture or poison its bin', () => {
  const sky = new Sky();
  configureSky(sky);
  const output = new T.WebGLRenderTarget(8, 8),
    dispose = vi.spyOn(output, 'dispose');
  const capture = vi.spyOn(T.PMREMGenerator.prototype, 'fromScene').mockReturnValue(output);
  const generatorDispose = vi.spyOn(T.PMREMGenerator.prototype, 'dispose');
  const renderer = skyRendererDouble().renderer;
  const scene = new T.Scene(),
    environment = new SkyEnvironment(sky);
  environment.update(renderer, scene, 0);
  capture.mockImplementationOnce(() => {
    throw new Error('Injected GPU capture failure');
  });
  expect(() => environment.update(renderer, scene, 1)).toThrow('Injected GPU');
  expect(scene.environment).toBe(output.texture);
  expect(dispose).not.toHaveBeenCalled();
  expect(environment.captures).toBe(1);
  expect(sky.material.uniforms.cloudCover.value).toBe(0);
  expect(sky.material.uniforms.skyRadiance.value).toBe(skyLight(0, 'day').skyScale);
  expect(environment.update(renderer, scene, 0)).toBe(false);
  expect(generatorDispose).toHaveBeenCalledTimes(2);
  expect(() => environment.update(renderer, scene, NaN)).toThrow('Non-finite');
  environment.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
});
it('captures a tiered PMREM with a lit ground hemisphere only inside the capture', () => {
  const sky = new Sky();
  configureSky(sky);
  const uniforms = sky.material.uniforms;
  uniforms.groundIrradiance.value.set(7, 8, 9);
  const seen: { ground: number; irradiance: number[]; size?: number }[] = [];
  const capture = vi
    .spyOn(T.PMREMGenerator.prototype, 'fromScene')
    .mockImplementation((scene, _sigma, _near, _far, options) => {
      const material = (scene.children[0] as Sky).material;
      // The capture's sky clone shares the live material.
      expect(material).toBe(sky.material);
      seen.push({
        ground: material.uniforms.groundAmount.value,
        irradiance: material.uniforms.groundIrradiance.value.toArray(),
        size: options?.size,
      });
      return new T.WebGLRenderTarget(8, 8);
    });
  vi.spyOn(T.PMREMGenerator.prototype, 'dispose');
  const renderer = skyRendererDouble().renderer;
  const scene = new T.Scene(),
    environment = new SkyEnvironment(sky);
  environment.update(renderer, scene, 0.25, 'sunset');
  expect(seen).toEqual([
    {
      ground: 1,
      irradiance: groundIrradiance(groundLightState(0.25, 'sunset')).toArray(),
      size: SKY_PMREM_SIZE.standard,
    },
  ]);
  expect(SKY_PMREM_SIZE).toEqual({ standard: 128, high: 256 });
  // High detail recaptures the same bin at 256 px (a hard change for probes).
  environment.highDetail = true;
  expect(environment.update(renderer, scene, 0.25, 'sunset')).toBe(true);
  expect(seen.at(-1)!.size).toBe(SKY_PMREM_SIZE.high);
  expect(environment.diagnostics().size).toBe(SKY_PMREM_SIZE.high);
  expect(environment.probeRefreshNeeded).toBe(true);
  expect(environment.update(renderer, scene, 0.25, 'sunset')).toBe(false);
  expect(() => environment.update(renderer, scene, 0.25, 'sunset', 100)).toThrow(
    'Invalid sky PMREM size',
  );
  // The visible dome never shows the ground branch.
  expect(uniforms.groundAmount.value).toBe(0);
  expect(uniforms.groundIrradiance.value.toArray()).toEqual([7, 8, 9]);
  capture.mockImplementationOnce(() => {
    throw new Error('Injected GPU capture failure');
  });
  expect(() => environment.update(renderer, scene, 1, 'day')).toThrow('Injected GPU');
  expect(uniforms.groundAmount.value).toBe(0);
  expect(uniforms.groundIrradiance.value.toArray()).toEqual([7, 8, 9]);
  environment.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
});
it('shares actual water channels and normal flattening without inventing pit rubber', () => {
  const state = new T.DataTexture(new Uint8Array(16), 2, 2);
  for (const deposits of [true, false]) {
    const material = new T.MeshStandardMaterial();
    installWetRoad(material, state, deposits);
    const shader = {
      uniforms: {},
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.trackState.value).toBe(state);
    expect(shader.uniforms.surfaceDeposits.value).toBe(deposits ? 1 : 0);
    expect(shader.fragmentShader).toContain('roadState.gb *= surfaceDeposits');
    expect(shader.fragmentShader).toContain(
      'mix(normal, dryRoadNormal, wet * mix(0.35, 0.9, puddle))',
    );
    expect(shader.fragmentShader).toContain('#include <normal_fragment_maps>');
    material.dispose();
  }
  state.dispose();
});

it('retains singular-derivative normal guards through wet-road shader composition', () => {
  const material = new T.MeshStandardMaterial();
  const state = new T.DataTexture(new Uint8Array(16), 2, 2);
  installStableSurfaceBump(material);
  installWetRoad(material, state, true);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  expect(shader.fragmentShader).toContain('if (min(dx2, dy2) < 1e-16) return surf_norm;');
  expect(shader.fragmentShader).toContain('if (abs(fDet) < 1e-7) return surf_norm;');
  expect(shader.fragmentShader).toContain(
    'normal2 > 1e-16 ? perturbed * inversesqrt(normal2) : surf_norm;',
  );
  expect(shader.fragmentShader).not.toContain('normalize( dFdx( surf_pos.xyz ) )');
  expect(shader.fragmentShader).not.toContain('#include <bumpmap_pars_fragment>');
  expect(shader.fragmentShader).toContain('roadState.gb *= surfaceDeposits');
  material.dispose();
  state.dispose();
});
it('retires blend outputs of the old atlas size only after publishing the resized sky', () => {
  const sky = new Sky();
  configureSky(sky);
  vi.spyOn(T.PMREMGenerator.prototype, 'fromScene').mockImplementation(
    (_scene, _sigma, _near, _far, options) => {
      const size = options?.size ?? 0;
      const target = new T.WebGLRenderTarget(size * 3, size * 4);
      target.texture.mapping = T.CubeUVReflectionMapping;
      return target;
    },
  );
  vi.spyOn(T.PMREMGenerator.prototype, 'dispose');
  const disposed: T.Texture[] = [];
  const dispose = T.WebGLRenderTarget.prototype.dispose;
  vi.spyOn(T.WebGLRenderTarget.prototype, 'dispose').mockImplementation(function (
    this: T.WebGLRenderTarget,
  ) {
    disposed.push(this.texture);
    dispose.call(this);
  });
  const double = skyRendererDouble();
  const scene = new T.Scene(),
    environment = new SkyEnvironment(sky);
  // Fractional cover: a blended output atlas is published.
  environment.update(double.renderer, scene, 0.3, 'day');
  const small = scene.environment!;
  expect(double.state.blends).toHaveLength(1);
  environment.highDetail = true;
  const blend = double.renderer.render;
  vi.spyOn(double.renderer, 'render').mockImplementation((quad, camera) => {
    // The published 128 px atlas stays alive while the 256 px one is blended.
    expect(disposed).not.toContain(small);
    expect(double.state.target?.width).toBe(256 * 3);
    return blend.call(double.renderer, quad, camera);
  });
  expect(environment.update(double.renderer, scene, 0.3, 'day')).toBe(true);
  expect(double.state.blends).toHaveLength(2);
  expect(scene.environment).not.toBe(small);
  expect(disposed).toContain(small);
  expect(environment.diagnostics().retainedTargets).toBe(4);
  environment.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
});
