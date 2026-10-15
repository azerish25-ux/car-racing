import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  IBL_ENERGY,
  SKY_GROUND_GLSL,
  SKY_GROUND_UNIFORMS,
  SPECULAR_IBL_GLSL,
  SPECULAR_IBL_KEY,
  createIblUniforms,
  groundIrradiance,
  hasSpecularIBL,
  iblUniforms,
  installSpecularIBL,
  installSpecularIBLMaterial,
  ownEnvMapUniform,
  setOwnEnvMap,
  SKY_IRRADIANCE_SATURATION,
  setIblEnergy,
  specularIBLGain,
} from '../src/rendering/studio/ibl-energy.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import {
  SUN_OFFSET,
  SUNSET_OFFSET,
  circuitLightState,
  configureSky,
  daylightState,
  groundLightState,
  skyCosineRadiance,
} from '../src/rendering/daylight.ts';
import {
  applyCircuitLightPalette,
  circuitLightColors,
} from '../src/rendering/lighting-coherence.ts';
import { installWetRoad } from '../src/rendering/materials.ts';
import { skyLight } from '../src/rendering/sky-light.ts';
import { WET_REFLECTION_GLSL } from '../src/rendering/wet-reflection.ts';

function compile(material: T.Material, kind: 'physical' | 'standard' = 'physical') {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib[kind].vertexShader,
    fragmentShader: T.ShaderLib[kind].fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}
const count = (source: string, text: string) => source.split(text).length - 1;
const degrees = (radians: number) => (radians * 180) / Math.PI;
const elevation = (v: T.Vector3) => degrees(Math.atan2(v.y, Math.hypot(v.x, v.z)));
const azimuth = (v: T.Vector3) => degrees(Math.atan2(v.z, v.x));

describe('D03 producer lighting decisions (P1-P3)', () => {
  it('raises the day sun to ~52 deg and the sunset sun to ~10 deg on the same azimuth', () => {
    expect(SUN_OFFSET.toArray()).toEqual([-140, 235, -115]);
    expect(SUNSET_OFFSET.toArray()).toEqual([-215, 45, -150]);
    expect(elevation(SUN_OFFSET)).toBeGreaterThan(50);
    expect(elevation(SUN_OFFSET)).toBeLessThan(55);
    expect(elevation(SUNSET_OFFSET)).toBeGreaterThan(9);
    expect(elevation(SUNSET_OFFSET)).toBeLessThan(11);
    // The far-shadow and probe bakes keep their orientation.
    expect(Math.abs(azimuth(SUN_OFFSET) - azimuth(new T.Vector3(-160, 190, -130)))).toBeLessThan(
      0.5,
    );
  });
  it('splits the day light into sun, sky IBL and a minor hemisphere term', () => {
    for (const cover of [0, 0.12, 0.5, 1]) {
      const day = daylightState(cover, 0);
      // The key is the sun through this cover's atmosphere, dimmed by cloud.
      expect(day.sun).toBeCloseTo(
        skyLight(cover, 'day').sunIrradiance * (1 - 0.94 * cover ** 1.45),
        12,
      );
      expect(day.fill).toBeCloseTo(0.06 + 0.2 * cover, 12);
      // The PMREM is the physical dome: diffuse sky light at its true share.
      expect(day.environment).toBe(1);
      // Overcast is all sky light: the wrap-around fill rises with cover.
      expect(day.fill).toBeGreaterThanOrEqual(daylightState(0, 0).fill);
      // Specular IBL is normalised to the visible dome.
      expect(day.environment * specularIBLGain(day.environment)).toBeCloseTo(1, 12);
      const sunset = circuitLightState(cover, 0, 'sunset');
      expect(sunset.environment * specularIBLGain(sunset.environment)).toBeCloseTo(1, 12);
    }
    // Night skies stay subordinate to the lamps.
    const night = circuitLightState(0.12, 0, 'night');
    expect(specularIBLGain(night.environment)).toBe(IBL_ENERGY.maxSpecularGain);
    expect(night.environment * specularIBLGain(night.environment)).toBeLessThan(0.3);
  });
  it('takes the key and hemisphere colours from the physical sky, #4a4237 ground', () => {
    const clear = circuitLightColors(0, 'day');
    // Midday key: a warm white (~5000 K) straight from the transmittance.
    expect(clear.sun.r).toBe(1);
    expect(clear.sun.b / clear.sun.r).toBeGreaterThan(0.7);
    expect(clear.sun.b / clear.sun.r).toBeLessThan(0.85);
    expect(clear.sun.toArray()).toEqual(skyLight(0, 'day').sunColor);
    expect(clear.sky.b).toBeGreaterThan(clear.sky.r);
    expect(clear.ground.getHex()).toBe(0x4a4237);
    // Golden hour: a deep gold key, a neutral-cool dusk fill (never magenta).
    const gold = circuitLightColors(0, 'sunset').sun;
    expect(gold.b / gold.r).toBeLessThan(0.35);
    expect(gold.g / gold.r).toBeGreaterThan(0.5);
    expect(gold.g / gold.r).toBeLessThan(0.75);
    const dusk = circuitLightColors(0, 'sunset').sky;
    expect(dusk.b).toBeGreaterThanOrEqual(dusk.r * 0.95);
    expect(dusk.g).toBeGreaterThan(0.9 * dusk.r);
    for (const cover of [0, 0.5, 1]) {
      const dusk = circuitLightState(cover, 0, 'sunset');
      expect(dusk.fill).toBeCloseTo(0.09 + 0.12 * cover, 12);
      // The ~10 degree key dominates what faces it: key / fill >= 6 when clear.
      if (cover === 0) expect(dusk.sun / dusk.fill).toBeGreaterThanOrEqual(6);
    }
    const sun = new T.DirectionalLight(),
      fill = new T.HemisphereLight();
    for (const mode of ['day', 'sunset', 'night'] as const) {
      applyCircuitLightPalette(sun, fill, 0.37, mode);
      const colors = circuitLightColors(0.37, mode);
      expect(sun.color.equals(colors.sun)).toBe(true);
      expect(fill.color.equals(colors.sky)).toBe(true);
      expect(fill.groundColor.equals(colors.ground)).toBe(true);
    }
    expect(() => circuitLightColors(NaN, 'day')).toThrow('Invalid lighting coverage');
    expect(() => circuitLightColors(0, 'dawn' as 'day')).toThrow('Invalid circuit lighting mode');
  });
});

describe('specular IBL normalisation', () => {
  it('clamps 1 / environment into [1, 3.5] and rejects invalid intensities', () => {
    expect(specularIBLGain(0.42)).toBeCloseTo(1 / 0.42, 12);
    expect(specularIBLGain(0.5)).toBe(2);
    expect(specularIBLGain(1.4)).toBe(1);
    expect(specularIBLGain(0.07)).toBe(3.5);
    expect(specularIBLGain(0)).toBe(3.5);
    for (const bad of [-0.1, NaN, Infinity])
      expect(() => specularIBLGain(bad)).toThrow('Invalid IBL environment intensity');
    const uniforms = createIblUniforms();
    expect(setIblEnergy(0.5, 'day', uniforms)).toBe(2);
    expect(uniforms.apexSpecularIBL.value).toBe(2);
    expect(uniforms.apexSkyIrradianceSaturation.value).toBe(SKY_IRRADIANCE_SATURATION.day);
    expect(setIblEnergy(0.07, 'night', uniforms)).toBe(3.5);
    expect(uniforms.apexSkyIrradianceSaturation.value).toBe(1);
    expect(() => setIblEnergy(0.5, 'dawn' as 'day', uniforms)).toThrow('Invalid circuit lighting');
    // Photo showroom/workshop: no visible dome to normalise to, so the authored
    // studio environment keeps gain 1 and the dome's own colour.
    expect(setIblEnergy(0.3, 'day', uniforms, false)).toBe(1);
    expect(uniforms.apexSpecularIBL.value).toBe(1);
    expect(uniforms.apexSkyIrradianceSaturation.value).toBe(1);
    expect(() => setIblEnergy(NaN, 'day', uniforms, false)).toThrow('Invalid IBL environment');
    expect(setIblEnergy(0.3, 'day', uniforms)).toBeCloseTo(1 / 0.3, 12);
    expect(uniforms.apexSkyIrradianceSaturation.value).toBe(SKY_IRRADIANCE_SATURATION.day);
    expect(uniforms).not.toBe(iblUniforms);
  });
  it('chains once on Standard/Physical materials without their own envMap', () => {
    const uniforms = createIblUniforms();
    const physical = new T.MeshPhysicalMaterial({ clearcoat: 1 }),
      standard = new T.MeshStandardMaterial(),
      owned = new T.MeshStandardMaterial({ envMap: new T.Texture() }),
      optedOut = new T.MeshStandardMaterial(),
      lambert = new T.MeshLambertMaterial();
    optedOut.userData.apexSpecularIBL = false;
    let previousCalls = 0;
    physical.onBeforeCompile = () => void previousCalls++;
    expect(installSpecularIBLMaterial(physical, uniforms)).toBe(true);
    expect(installSpecularIBLMaterial(physical, uniforms)).toBe(false);
    expect(installSpecularIBLMaterial(standard, uniforms)).toBe(true);
    expect(installSpecularIBLMaterial(owned, uniforms)).toBe(false);
    expect(installSpecularIBLMaterial(optedOut, uniforms)).toBe(false);
    expect(installSpecularIBLMaterial(lambert, uniforms)).toBe(false);
    expect(studioHookKeys(physical)).toEqual([SPECULAR_IBL_KEY]);
    expect(physical.customProgramCacheKey()).toContain(`|${SPECULAR_IBL_KEY}`);
    const shader = compile(physical);
    expect(previousCalls).toBe(1);
    // Shared by identity: one write per frame reaches every program.
    expect(shader.uniforms.apexSpecularIBL).toBe(uniforms.apexSpecularIBL);
    expect(shader.uniforms.apexOwnEnvMap).toBe(ownEnvMapUniform(physical));
    expect(count(shader.fragmentShader, 'uniform float apexSpecularIBL;')).toBe(1);
    const maps = shader.fragmentShader.indexOf('#include <lights_fragment_maps>');
    const gain = shader.fragmentShader.indexOf(SPECULAR_IBL_GLSL);
    expect(gain).toBeGreaterThan(maps);
    expect(gain).toBeLessThan(shader.fragmentShader.indexOf('#include <lights_fragment_end>'));
    expect(shader.fragmentShader.indexOf('uniform float apexSpecularIBL;')).toBeLessThan(maps);
    expect(SPECULAR_IBL_GLSL).toContain('radiance *= apexSpecularGain;');
    expect(SPECULAR_IBL_GLSL).toContain('clearcoatRadiance *= apexSpecularGain;');
    // Diffuse colour balance on the IBL irradiance only, luminance preserved.
    expect(SPECULAR_IBL_GLSL).toContain(
      'iblIrradiance = mix(vec3(dot(iblIrradiance, vec3(0.2126, 0.7152, 0.0722))),',
    );
    expect(shader.uniforms.apexSkyIrradianceSaturation).toBe(uniforms.apexSkyIrradianceSaturation);
    expect(count(compile(standard, 'standard').fragmentShader, SPECULAR_IBL_GLSL)).toBe(1);
    for (const m of [physical, standard, owned, optedOut, lambert]) m.dispose();
  });
  it('keeps the planar wet-road reflection out of the gain and counts scene installs', () => {
    const road = new T.MeshPhysicalMaterial({ clearcoat: 1 });
    const state = new T.DataTexture(new Uint8Array(16), 2, 2);
    installWetRoad(road, state, true, 0, {
      wetReflection: { value: new T.Texture() },
      wetReflectionMatrix: { value: new T.Matrix4() },
      wetReflectionState: { value: new T.Vector4() },
    });
    const root = new T.Group();
    root.add(
      new T.Mesh(new T.BufferGeometry(), road),
      new T.Mesh(new T.BufferGeometry(), [new T.MeshStandardMaterial(), road]),
      new T.Points(new T.BufferGeometry(), new T.PointsMaterial()),
    );
    expect(installSpecularIBL(root, createIblUniforms())).toBe(2);
    expect(installSpecularIBL(root, createIblUniforms())).toBe(0);
    const fragment = compile(road).fragmentShader;
    // The planar mirror is real scene radiance: it replaces the film lobe after the gain.
    expect(fragment.indexOf(SPECULAR_IBL_GLSL)).toBeLessThan(
      fragment.indexOf(WET_REFLECTION_GLSL.trim().slice(0, 40)),
    );
    expect(fragment).toContain('roadState.gb *= surfaceDeposits');
    state.dispose();
    road.dispose();
  });
  it('flags probe-owned materials by value, without a program change', () => {
    const material = new T.MeshPhysicalMaterial();
    installSpecularIBLMaterial(material, createIblUniforms());
    const version = material.version,
      key = material.customProgramCacheKey();
    setOwnEnvMap(material, true);
    expect(ownEnvMapUniform(material).value).toBe(1);
    setOwnEnvMap(material, false);
    expect(ownEnvMapUniform(material).value).toBe(0);
    expect(material.version).toBe(version);
    expect(material.customProgramCacheKey()).toBe(key);
    // A clone (Material.copy drops the hook) is installed and flagged on its own.
    const clone = material.clone();
    expect(hasSpecularIBL(material)).toBe(true);
    expect(hasSpecularIBL(clone)).toBe(false);
    expect(installSpecularIBLMaterial(clone, createIblUniforms())).toBe(true);
    expect(hasSpecularIBL(clone)).toBe(true);
    expect(compile(clone).uniforms.apexOwnEnvMap).toBe(ownEnvMapUniform(clone));
    expect(ownEnvMapUniform(clone)).not.toBe(ownEnvMapUniform(material));
    material.dispose();
    clone.dispose();
  });
});

describe('PMREM ground hemisphere', () => {
  it('adds a capture-only ground branch to the sky shader', () => {
    const sky = new Sky();
    configureSky(sky);
    const { uniforms, fragmentShader } = sky.material;
    expect(uniforms.groundAmount.value).toBe(0);
    expect(uniforms.groundAlbedo.value.toArray()).toEqual([...IBL_ENERGY.groundAlbedo]);
    expect(fragmentShader).toContain(SKY_GROUND_UNIFORMS);
    expect(fragmentShader).toContain(SKY_GROUND_GLSL);
    // Below the horizon only, blended over 2 degrees, with ascending smoothstep
    // edges (GLSL ES leaves edge0 >= edge1 undefined).
    expect(SKY_GROUND_GLSL).toContain('(1.0-smoothstep(-0.034899,0.0,direction.y))');
    for (const [, edge0, edge1] of SKY_GROUND_GLSL.matchAll(
      /smoothstep\(\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*,/g,
    ))
      expect(Number(edge0)).toBeLessThan(Number(edge1));
    expect(fragmentShader.indexOf(SKY_GROUND_GLSL)).toBeLessThan(
      fragmentShader.indexOf('gl_FragColor=vec4(radiance * probeSkyIntensity,1.0);'),
    );
    sky.geometry.dispose();
    sky.material.dispose();
  });
  it('lights the ground with the same sun, hemisphere and sky IBL as the scene', () => {
    const light = {
      sunColor: new T.Color(1, 0.5, 0.25),
      sun: 2,
      sunDirection: new T.Vector3(0, 3, 4),
      skyColor: new T.Color(0.2, 0.4, 0.8),
      fill: 0.5,
      environment: 0.4,
      skyCosineRadiance: new T.Color(0.1, 0.2, 0.3),
    };
    const e = groundIrradiance(light);
    const ibl = Math.PI * 0.4;
    expect(e.x).toBeCloseTo(1 * 2 * 0.6 + 0.2 * 0.5 + 0.1 * ibl, 12);
    expect(e.y).toBeCloseTo(0.5 * 2 * 0.6 + 0.4 * 0.5 + 0.2 * ibl, 12);
    expect(e.z).toBeCloseTo(0.25 * 2 * 0.6 + 0.8 * 0.5 + 0.3 * ibl, 12);
    light.sunDirection.set(0, -1, 0);
    expect(groundIrradiance(light).x).toBeCloseTo(0.1 + 0.1 * ibl, 12);
    // The diffuse sky colour balance keeps the sky term's luminance.
    const luma = 0.2126 * 0.1 + 0.7152 * 0.2 + 0.0722 * 0.3;
    const grey = groundIrradiance({ ...light, skySaturation: 0 });
    expect(grey.x).toBeCloseTo(0.1 + luma * ibl, 12);
    expect(grey.z).toBeCloseTo(0.4 + luma * ibl, 12);
    light.sun = NaN;
    expect(() => groundIrradiance(light)).toThrow('Invalid ground light');
  });
  it('keeps the clear-day ground darker than the sky and dimming with cover and dusk', () => {
    const radiance = (cover: number, mode: 'day' | 'sunset' | 'night') => {
      const e = groundIrradiance(groundLightState(cover, mode));
      const a = IBL_ENERGY.groundAlbedo;
      return [(e.x * a[0]) / Math.PI, (e.y * a[1]) / Math.PI, (e.z * a[2]) / Math.PI];
    };
    const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const clear = radiance(0.12, 'day');
    const sky = skyCosineRadiance(0.12, 'day');
    expect(luma(clear)).toBeLessThan(0.6 * luma(sky.toArray()));
    expect(luma(clear)).toBeGreaterThan(0.1);
    // Neutral-warm asphalt, not a blue sky continuation.
    expect(clear[2] / clear[0]).toBeLessThan(1);
    // Clear-day diffuse sky irradiance: measured skylight chroma, not the
    // single-scattering dome's B/R of about 5.
    const s = SKY_IRRADIANCE_SATURATION.day,
      l = 0.2126 * sky.r + 0.7152 * sky.g + 0.0722 * sky.b;
    const balanced = (l + (sky.b - l) * s) / (l + (sky.r - l) * s);
    // The cloud-free physical dome is about B/R 2.3 under summer aerosols
    // (bright, whitish horizon and aureole included); the clear preset's
    // sunlit cumulus whiten it further. TEST-UPDATE (photoreal pass): AOD 0.09.
    const cloudless = skyCosineRadiance(0, 'day');
    expect(cloudless.b / cloudless.r).toBeGreaterThan(2.0);
    expect(cloudless.b / cloudless.r).toBeLessThan(3.6);
    expect(sky.b / sky.r).toBeGreaterThan(1.3);
    expect(balanced).toBeGreaterThan(1.2);
    expect(balanced).toBeLessThan(2.6);
    expect(sky.b).toBeGreaterThan(sky.r);
    // A closed deck passes 20-50 % of the clear-day global light.
    expect(luma(radiance(1, 'day'))).toBeLessThan(0.5 * luma(clear));
    expect(luma(radiance(0.12, 'sunset'))).toBeLessThan(luma(clear));
    expect(luma(radiance(0.12, 'night'))).toBeLessThan(luma(radiance(0.12, 'sunset')));
    for (const c of [0, 0.5, 1]) expect(radiance(c, 'day').every(Number.isFinite)).toBe(true);
    // Cached per bin, returned as a copy.
    const a = skyCosineRadiance(0.5, 'day');
    a.setRGB(9, 9, 9);
    expect(skyCosineRadiance(0.5, 'day').r).toBeLessThan(1);
  });
});
