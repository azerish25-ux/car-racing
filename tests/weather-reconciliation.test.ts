import assert from 'node:assert/strict';
import { it as add } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Track } from '../src/simulation/track.ts';
import { WeatherPresentation, tagWeatherSurface } from '../src/rendering/weather-presentation.ts';
import { driverMaterials } from '../src/rendering/driver-materials.ts';
import { LocalAtmosphere } from '../src/rendering/local-atmosphere.ts';
import { CrowdCluster } from '../src/rendering/crowd.ts';
import { Effects } from '../src/rendering/effects.ts';
import { ExposureAdaptation, readExposureMeter } from '../src/rendering/exposure-meter.ts';
import {
  configureSky,
  skyBlendPlan,
  skyBlendMaterial,
  SkyEnvironment,
} from '../src/rendering/daylight.ts';
import { ReflectionSystem } from '../src/rendering/reflections.ts';
import { skyRendererDouble } from './sky-renderer-double.ts';

// Transaction/state regressions recovered from the saved candidate. Ownership
// doubles are not GPU validation; browser contracts remain separate.
const close = (a: number, b: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const shaderFor = (material: T.Material) => {
  const source = material instanceof T.ShaderMaterial ? material : T.ShaderLib.physical;
  const shader = {
    uniforms: {},
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};
add('sky interpolation preserves HDR sampler precision and avoids an extra tone map', () => {
  const material = skyBlendMaterial();
  assert.equal(material.glslVersion, T.GLSL3);
  assert.equal(material.toneMapped, false);
  assert.equal(material.depthWrite, false);
  assert.equal(material.blending, T.NoBlending);
  assert.match(material.fragmentShader, /precision highp sampler2D/);
  assert.doesNotMatch(material.fragmentShader, /tonemapping_fragment|colorspace_fragment/);
  material.dispose();
});
add('sky interpolation is continuous at all eight coverage-bin boundaries', () => {
  const value = (cover: number) => {
    const p = skyBlendPlan(cover);
    return (p.lower * (1 - p.weight) + p.upper * p.weight) / 8;
  };
  for (let i = 0; i <= 800; i++) close(value(i / 800), i / 800);
  for (let bin = 1; bin < 8; bin++) close(value(bin / 8 - 1e-8), value(bin / 8 + 1e-8), 3e-8);
  assert.deepEqual(skyBlendPlan(-1), skyBlendPlan(0));
  assert.deepEqual(skyBlendPlan(2), skyBlendPlan(1));
  assert.throws(() => skyBlendPlan(NaN));
});

function skyCase(
  run: (
    env: SkyEnvironment,
    scene: T.Scene,
    double: ReturnType<typeof skyRendererDouble>,
    captures: T.WebGLRenderTarget[],
    sky: Sky,
  ) => void,
) {
  const original = T.PMREMGenerator.prototype.fromScene,
    originalDispose = T.PMREMGenerator.prototype.dispose;
  const sky = new Sky();
  configureSky(sky);
  sky.material.uniforms.cloudCover.value = 0.391;
  sky.material.uniforms.sunPosition.value.set(2, 3, 4);
  const env = new SkyEnvironment(sky),
    scene = new T.Scene(),
    double = skyRendererDouble(),
    captures: T.WebGLRenderTarget[] = [];
  T.PMREMGenerator.prototype.fromScene = () => {
    const target = new T.WebGLRenderTarget(16, 16, { type: T.HalfFloatType });
    target.texture.mapping = T.CubeUVReflectionMapping;
    captures.push(target);
    return target;
  };
  T.PMREMGenerator.prototype.dispose = () => {};
  try {
    run(env, scene, double, captures, sky);
  } finally {
    env.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    T.PMREMGenerator.prototype.fromScene = original;
    T.PMREMGenerator.prototype.dispose = originalDispose;
  }
}
add('fractional sky changes blend without repeated PMREM work or paused GPU updates', () =>
  skyCase((env, scene, { renderer, state }, captures, sky) => {
    assert.equal(env.update(renderer, scene, 0.36), true);
    assert.equal(captures.length, 2);
    assert.equal(env.blends, 1);
    const previous = scene.environment;
    for (let i = 0; i < 120; i++) assert.equal(env.update(renderer, scene, 0.36), false);
    assert.equal(env.blends, 1);
    assert.equal(captures.length, 2);
    assert.equal(env.update(renderer, scene, 0.37), true);
    assert.equal(captures.length, 2);
    assert.equal(env.blends, 2);
    assert.notEqual(scene.environment, previous);
    assert.equal(env.probeRefreshNeeded, false);
    assert.equal(env.diagnostics().retainedTargets, 4);
    close(state.blends[1].weight, 0.96);
    assert.equal(sky.material.uniforms.cloudCover.value, 0.391);
    assert.deepEqual(sky.material.uniforms.sunPosition.value.toArray(), [2, 3, 4]);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(renderer.autoClear, false);
    assert.equal(state.target, null);
    assert.equal(state.face, 2);
    assert.equal(state.mip, 1);
    assert.equal(state.scissorTest, true);
  }),
);
add('sky work restores physical target viewports after logical canvas settings', () =>
  skyCase((env, scene, { renderer, state }) => {
    const target = new T.WebGLRenderTarget(24, 18);
    target.viewport.set(2, 3, 16, 12);
    target.scissor.set(4, 5, 8, 6);
    target.scissorTest = true;
    state.target = target;
    let actualViewport = target.viewport.clone();
    let actualScissor = target.scissor.clone();
    let actualScissorTest = true;
    const setTarget = renderer.setRenderTarget.bind(renderer);
    const setViewport = renderer.setViewport.bind(renderer);
    const setScissor = renderer.setScissor.bind(renderer);
    const setTest = renderer.setScissorTest.bind(renderer);
    // A DPR=2 ownership double follows Three's target-pixel vs canvas-logical
    // semantics. This is not a claim of a physical high-DPI browser run.
    renderer.setRenderTarget = (value, face, mip) => {
      setTarget(value, face, mip);
      actualViewport = value ? value.viewport.clone() : state.viewport.clone().multiplyScalar(2);
      actualScissor = value ? value.scissor.clone() : state.scissor.clone().multiplyScalar(2);
      actualScissorTest = value ? value.scissorTest : state.scissorTest;
    };
    renderer.setViewport = ((value: T.Vector4) => {
      setViewport(value);
      actualViewport = value.clone().multiplyScalar(2);
    }) as T.WebGLRenderer['setViewport'];
    renderer.setScissor = ((value: T.Vector4) => {
      setScissor(value);
      actualScissor = value.clone().multiplyScalar(2);
    }) as T.WebGLRenderer['setScissor'];
    renderer.setScissorTest = (value) => {
      setTest(value);
      actualScissorTest = value;
    };
    env.update(renderer, scene, 0.36);
    assert.equal(state.target, target);
    assert.deepEqual(actualViewport.toArray(), target.viewport.toArray());
    assert.deepEqual(actualScissor.toArray(), target.scissor.toArray());
    assert.equal(actualScissorTest, true);
    target.dispose();
  }),
);
add('sky capture failure keeps the last complete texture/cache and restores caller state', () =>
  skyCase((env, scene, { renderer, state }, captures) => {
    env.update(renderer, scene, 0);
    const texture = scene.environment,
      before = env.diagnostics();
    const capture = T.PMREMGenerator.prototype.fromScene;
    let calls = 0,
      disposed = 0;
    T.PMREMGenerator.prototype.fromScene = function (...args) {
      if (++calls === 2) {
        renderer.autoClear = true;
        renderer.xr.enabled = false;
        state.target = null;
        renderer.toneMapping = T.NoToneMapping;
        throw new Error('Injected capture failure');
      }
      const out = capture.apply(this, args);
      out.addEventListener('dispose', () => disposed++);
      return out;
    };
    assert.throws(() => env.update(renderer, scene, 0.36), /Injected/);
    assert.equal(scene.environment, texture);
    assert.deepEqual(env.diagnostics().cachedBins, before.cachedBins);
    assert.equal(env.diagnostics().cover, 0);
    assert.equal(disposed, 1);
    assert.equal(captures.length, 2);
    assert.equal(renderer.autoClear, false);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(renderer.toneMapping, T.ACESFilmicToneMapping);
    assert.equal(env.update(renderer, scene, 0), false);
  }),
);
add('failed sky blend only touches the spare target and does not publish a partial frame', () =>
  skyCase((env, scene, { renderer, state }, captures) => {
    env.update(renderer, scene, 0.36);
    const texture = scene.environment,
      before = env.diagnostics();
    state.failBlend = true;
    assert.throws(() => env.update(renderer, scene, 0.37), /Injected sky blend/);
    assert.equal(scene.environment, texture);
    assert.equal(env.diagnostics().cover, before.cover);
    assert.notEqual(state.blends[1].target?.texture, texture);
    assert.equal(captures.length, 2);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(renderer.autoClear, false);
    assert.equal(state.scissorTest, true);
    assert.equal(state.face, 2);
    assert.equal(state.mip, 1);
    state.failBlend = false;
    env.update(renderer, scene, 0.37);
    assert.notEqual(scene.environment, texture);
    assert.equal(env.blends, 2);
    assert.equal(state.blends[1].target, state.blends[2].target);
  }),
);
add('retired-sky disposal errors cannot dispose an already published replacement', () =>
  skyCase((env, scene, { renderer }, captures) => {
    env.update(renderer, scene, 0);
    const retired = captures[0];
    const listener = () => {
      throw new Error('Injected retired disposal listener');
    };
    retired.addEventListener('dispose', listener);
    assert.throws(() => env.update(renderer, scene, 0.5), /retired disposal/);
    retired.removeEventListener('dispose', listener);
    assert.equal(scene.environment, captures[1].texture);
    assert.equal(env.diagnostics().cover, 0.5);
    assert.deepEqual(env.diagnostics().cachedBins, [4]);
    assert.equal(env.update(renderer, scene, 0.5), false);
  }),
);
add('sky replay and day/sunset/night switches reconstruct coverage with bounded ownership', () =>
  skyCase((env, scene, { renderer }, captures) => {
    let disposals = 0;
    const original = T.PMREMGenerator.prototype.fromScene;
    T.PMREMGenerator.prototype.fromScene = function (...args) {
      const target = original.apply(this, args);
      target.addEventListener('dispose', () => disposals++);
      return target;
    };
    for (const mode of ['day', 'night', 'sunset', 'day'] as const) {
      for (const cover of [0.125, 0.37, 0.86, 0.37]) {
        env.update(renderer, scene, cover, mode);
        assert.ok(env.diagnostics().retainedTargets <= 4);
        assert.equal(env.diagnostics().mode, mode);
        assert.equal(env.diagnostics().cover, cover);
      }
    }
    env.dispose();
    assert.equal(disposals, captures.length);
    assert.equal(scene.environment, null);
    env.dispose();
    assert.equal(disposals, captures.length);
  }),
);
add('broad highlights limit exposure while isolated glints do not drive the meter', () => {
  const meter = (bright: number) => {
    const bytes = new Uint8Array(100 * 4);
    for (let i = 0; i < 100; i++) {
      bytes[i * 4] = i < bright ? 210 : 90;
      bytes[i * 4 + 3] = 255;
    }
    return readExposureMeter(bytes)!;
  };
  const glints = meter(5),
    broad = meter(20);
  assert.ok(glints.highlightLogLuminance < 0);
  assert.ok(broad.highlightLogLuminance > 0);
  const state = new ExposureAdaptation();
  state.observe(-6, 1, state.generation, glints.highlightLogLuminance);
  assert.ok(state.targetEV > 0);
  state.observe(-6, 1, state.generation, broad.highlightLogLuminance);
  assert.equal(state.targetEV, -0.7);
  assert.throws(() => state.observe(0, 1, state.generation, NaN));
  assert.equal(readExposureMeter(new Uint8Array(192 * 4)), null);
});
add('reflection scheduling holds when paused and immediately refreshes after a rewind', () => {
  const original = T.CubeCamera.prototype.update,
    reflections = new ReflectionSystem();
  let captures = 0;
  T.CubeCamera.prototype.update = () => {
    captures++;
  };
  const { renderer } = skyRendererDouble();
  renderer.shadowMap = { autoUpdate: true } as T.WebGLRenderer['shadowMap'];
  const scene = new T.Scene(),
    car = new T.Group(),
    material = new T.MeshStandardMaterial();
  scene.add(car);
  try {
    const draw = (time: number) => {
      reflections.beginFrame(time, false);
      reflections.updateProbe(renderer, scene, car, [material], true, 0.55);
    };
    draw(10);
    assert.equal(captures, 1);
    for (let i = 0; i < 100; i++) draw(10);
    assert.equal(captures, 1);
    draw(10.2);
    assert.equal(captures, 1);
    draw(10.6);
    assert.equal(captures, 2);
    draw(2);
    assert.equal(captures, 3);
    assert.equal(car.visible, true);
    assert.equal(renderer.shadowMap.autoUpdate, true);
  } finally {
    reflections.dispose();
    material.dispose();
    T.CubeCamera.prototype.update = original;
  }
});
add(
  'driver fabric retains its authored normal/roughness maps and bounded cockpit shelter factor',
  () => {
    const materials = driverMaterials();
    for (const material of [materials.suit, materials.glove, materials.panel]) {
      assert.equal(material.userData.weatherSurface, 'fabric');
      assert.equal(material.userData.weatherExposure, 0.32);
      assert.ok(material.normalMap && material.roughnessMap);
      assert.equal(material.normalMap.colorSpace, T.NoColorSpace);
    }
    assert.equal(materials.grip.userData.weatherSurface, undefined);
    materials.suit.normalMap!.dispose();
    materials.suit.roughnessMap!.dispose();
    Object.values(materials).forEach((m) => m.dispose());
  },
);
add('crowd clothing wetness keeps skin masks and shelter coherent through every LOD', () => {
  const base = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const crowd = new CrowdCluster([new T.Matrix4()], [new T.Color(0.3, 0.1, 0.05)], 7, base);
  const field = new WeatherPresentation();
  field.install(crowd.root);
  assert.equal(field.diagnostics().materialRoles.fabric, 4);
  crowd.levels.forEach((mesh, level) => {
    const material = mesh.material as T.MeshStandardMaterial;
    assert.equal(material.userData.weatherExposure, 0.25);
    const shader = shaderFor(material);
    assert.equal(shader.uniforms.aurelSurfaceWeather, field.surface);
    assert.match(shader.fragmentShader, /aurelSurfaceWeather.x \* 0.137500/);
    if (level < 3) {
      assert.match(shader.vertexShader, /vCrowdCloth = 1\. - step\(\.5, skinMask\)/);
      assert.match(shader.fragmentShader, /clamp\(vCrowdCloth,0\.,1\.\)/);
      // No extra vertex attribute: the retained packed skin mask is reused.
      assert.doesNotMatch(shader.vertexShader, /attribute float.*[Cc]loth/);
    } else assert.match(shader.fragmentShader, /1\.-headMask/);
    mesh.dispose();
    mesh.geometry.dispose();
    material.dispose();
    mesh.customDepthMaterial?.dispose();
    mesh.customDistanceMaterial?.dispose();
  });
  base.dispose();
});
add(
  'rain, spray and contact particles share scene lighting and regional haze without new pools',
  () => {
    const effects = new Effects(),
      atmosphere = new LocalAtmosphere(new Track());
    assert.equal(effects.group.children.length, 3);
    atmosphere.install(effects.group);
    assert.equal(atmosphere.materialCount, 3);
    for (const object of effects.group.children as T.Mesh<T.BufferGeometry, T.ShaderMaterial>[]) {
      const shader = shaderFor(object.material);
      assert.equal(object.material.lights, true);
      assert.match(shader.vertexShader, /particleEnergy/);
      assert.match(shader.vertexShader, /getDistanceAttenuation/);
      assert.match(shader.fragmentShader, /apexLocalDensity/);
      assert.equal(shader.uniforms.apexLocalSigma, atmosphere.sigma);
      assert.equal(object.material.depthWrite, false);
    }
    const pointShader = shaderFor((effects.group.children[0] as T.Points).material as T.Material);
    assert.match(pointShader.vertexShader, /kind>1\.5&&kind<2\.5/);
    effects.group.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Points) {
        o.geometry.dispose();
        for (const material of Array.isArray(o.material) ? o.material : [o.material])
          material.dispose();
      }
    });
  },
);

add('weather masks validate bounded shelter and never silently shade a missing crowd mask', () => {
  const material = new T.MeshStandardMaterial();
  assert.throws(() => tagWeatherSurface(material, 'fabric', NaN));
  assert.throws(() => tagWeatherSurface(material, 'fabric', 1.1));
  assert.throws(() => tagWeatherSurface(material, '__proto__' as 'fabric'));
  const field = new WeatherPresentation();
  tagWeatherSurface(material, 'fabric', 0.25, 'impostor');
  field.installMaterial(material);
  assert.throws(() => shaderFor(material), /Missing authored crowd weather mask/);
  material.dispose();
  field.dispose();
});

add(
  'fractional sky atlas changes preserve probe cadence; hard paused changes invalidate once',
  () =>
    skyCase((env, scene, { renderer }) => {
      const reflections = new ReflectionSystem(),
        car = new T.Group(),
        material = new T.MeshStandardMaterial();
      renderer.shadowMap = { autoUpdate: true } as T.WebGLRenderer['shadowMap'];
      const original = T.CubeCamera.prototype.update;
      let count = 0;
      T.CubeCamera.prototype.update = () => {
        count++;
      };
      const draw = (time: number, cover: number, mode: 'day' | 'night' = 'day') => {
        env.update(renderer, scene, cover, mode);
        reflections.beginFrame(time, false);
        reflections.updateProbe(renderer, scene, car, [material], true, 0.55);
      };
      try {
        draw(10, 0.36);
        const epoch = scene.environment!.userData.aurelSkyEpoch;
        draw(10.1, 0.37);
        assert.equal(count, 1);
        assert.equal(scene.environment!.userData.aurelSkyEpoch, epoch);
        draw(10.2, 0.38);
        assert.equal(count, 1); // Crossing a PMREM bin is still a smooth change.
        draw(10.6, 0.39);
        assert.equal(count, 2);
        draw(10.6, 0.39, 'night');
        assert.equal(count, 3);
        assert.notEqual(scene.environment!.userData.aurelSkyEpoch, epoch);
        for (let i = 0; i < 30; i++) draw(10.6, 0.39, 'night');
        assert.equal(count, 3);
        draw(2, 0.39, 'night');
        assert.equal(count, 4);
        scene.environment = new T.Texture();
        reflections.updateProbe(renderer, scene, car, [material], true, 0.55);
        assert.equal(count, 5);
        scene.environment.dispose();
        scene.environment = null;
      } finally {
        reflections.dispose();
        material.dispose();
        T.CubeCamera.prototype.update = original;
      }
    }),
);
