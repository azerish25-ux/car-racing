import * as T from 'three';
import type { LightingMode } from '../daylight.ts';
import {
  chainShaderHook,
  injectAfter,
  injectDeclarations,
  studioHookKeys,
} from './shader-hooks.ts';

/**
 * Lighting & IBL energy (D03): one diffuse/specular split for the sky light.
 *
 * Diffuse sky light stays art-directed: `scene.environmentIntensity` is the
 * share of the visible dome that fills shadows and recesses (0.42 + 0.08 cover
 * by day). Specular reflections of the same dome must not be dimmed by that
 * share: a mirror shows the sky at the radiance the camera sees. Three.js scales
 * both lobes of `scene.environment` by one intensity, which left paint, carbon
 * and glass reflecting a sky at 28 % of its on-screen brightness. The shared
 * uniform `apexSpecularIBL = clamp(1 / environment, 1, 3.5)` multiplies the
 * specular and clearcoat IBL radiance after `lights_fragment_maps`, so specular
 * sky = environment × gain = 1.0 × the dome (night skies cap at 3.5).
 *
 * A material that owns a local probe cubemap (High, `ReflectionSystem`) is
 * flagged through its own `apexOwnEnvMap` uniform (`setOwnEnvMap`, a value, so
 * probe hand-overs never recompile): the probe already holds the dome at
 * specular scale next to lit scenery at its own radiance, so the gain is not
 * applied twice; its probe irradiance is divided by the gain instead, which
 * keeps the diffuse sky at the authored environment level.
 *
 * Diffuse sky colour balance: the linear Preetham dome is far more saturated
 * than real skylight. Its cosine-weighted clear-day radiance is about
 * (0.21, 0.54, 1.07), B/R 5, where measured clear-sky diffuse irradiance
 * (10-15 kK) is B/R 1.6-2.5. At the authored environment share that turned
 * sunlit asphalt lavender (B/R 1.10 for a neutral albedo) and open shadows
 * navy. `apexSkyIrradianceSaturation` pulls the diffuse IBL irradiance toward
 * its own luminance (energy unchanged), by lighting (`SKY_IRRADIANCE_SATURATION`);
 * specular reflections keep the true dome colour.
 *
 * The PMREM also gets a ground hemisphere (`SKY_GROUND_GLSL`): below the horizon
 * the sky shader returns the diffuse radiance of a ground plane of albedo
 * `IBL_ENERGY.groundAlbedo` under the same sun and sky, instead of horizon sky
 * radiance. Car undersides, lower sidepods and the floor then reflect dark,
 * warm ground the way they do on a real circuit. It is active only inside
 * `SkyEnvironment.capture` (`groundAmount` is 0 for the visible dome).
 *
 * Determinism: the gain is a pure function of the presented lighting state;
 * no time source, no randomness, and no extra draw call.
 */
export const IBL_ENERGY = Object.freeze({
  /** Upper bound of the specular normalisation; a night environment (0.07)
   * keeps its sky reflections subordinate to the lamps. */
  maxSpecularGain: 3.5,
  /** Linear albedo of the ground seen below the PMREM horizon: dry asphalt
   * with verges, slightly warm (ART_BIBLE_A §4/§5: 0.10-0.18). */
  groundAlbedo: Object.freeze([0.15, 0.14, 0.12] as const),
  /** Width of the sky-to-ground blend below the horizon, degrees. */
  horizonBlendDegrees: 2,
});
/** Chroma kept in the diffuse IBL irradiance, by lighting. The physical clear
 * dome (atmosphere.ts) irradiates at about B/R 3 including its white horizon
 * and aureole; day 0.75 brings that to about 2.4, the blue end of measured
 * clear skylight (1.6-2.5): open shadows stay sky blue, sunlit asphalt warm
 * neutral. The sunset and night domes are not over-saturated. */
export const SKY_IRRADIANCE_SATURATION: Readonly<Record<LightingMode, number>> = Object.freeze({
  day: 0.75,
  sunset: 1,
  night: 1,
});

export interface IblUniforms {
  /** Specular IBL gain: specular sky = environmentIntensity × this. */
  apexSpecularIBL: T.IUniform<number>;
  /** Chroma kept in the diffuse IBL irradiance (1 = the dome's own colour). */
  apexSkyIrradianceSaturation: T.IUniform<number>;
}
export function createIblUniforms(): IblUniforms {
  return { apexSpecularIBL: { value: 1 }, apexSkyIrradianceSaturation: { value: 1 } };
}
/** The shared objects every installed material binds by identity. */
export const iblUniforms: IblUniforms = createIblUniforms();

/** `clamp(1 / environment, 1, IBL_ENERGY.maxSpecularGain)`. */
export function specularIBLGain(environment: number) {
  if (!Number.isFinite(environment) || environment < 0)
    throw new Error('Invalid IBL environment intensity');
  return environment <= 1 / IBL_ENERGY.maxSpecularGain
    ? IBL_ENERGY.maxSpecularGain
    : Math.min(IBL_ENERGY.maxSpecularGain, Math.max(1, 1 / environment));
}
/** Write this frame's sky-light split into the shared uniforms: the specular
 * gain for `environment` (the scene's diffuse IBL intensity) and the diffuse
 * colour balance of `mode`. Returns the specular gain.
 *
 * `skyVisible` false is a photo showroom or workshop: the dome is hidden and the
 * environment only stands in for studio light at its authored level, so there
 * is no visible sky to normalise to. Gain 1 and the dome's own colour keep that
 * authored look (a dark showroom must not mirror a daylight sky at full
 * strength on paint, floor and podium). */
export function setIblEnergy(
  environment: number,
  mode: LightingMode = 'day',
  uniforms: IblUniforms = iblUniforms,
  skyVisible = true,
) {
  const gain = specularIBLGain(environment),
    saturation = SKY_IRRADIANCE_SATURATION[mode];
  if (saturation === undefined) throw new Error('Invalid circuit lighting mode');
  uniforms.apexSpecularIBL.value = skyVisible ? gain : 1;
  uniforms.apexSkyIrradianceSaturation.value = skyVisible ? saturation : 1;
  return uniforms.apexSpecularIBL.value;
}

export const SPECULAR_IBL_KEY = 'apex-specular-ibl-v2';
const ownEnvMaps = new WeakMap<T.Material, T.IUniform<number>>();
/** The per-material flag uniform (1 while a local probe owns its envMap). */
export function ownEnvMapUniform(material: T.Material) {
  let uniform = ownEnvMaps.get(material);
  if (!uniform) ownEnvMaps.set(material, (uniform = { value: 0 }));
  return uniform;
}
/** Whether the specular IBL normalisation is chained on `material` (a clone or
 * a material created after the installers is not). */
export function hasSpecularIBL(material: T.Material) {
  return studioHookKeys(material).includes(SPECULAR_IBL_KEY);
}
/** Mark `material` as lit by its own (local probe) cubemap, or by the scene's
 * sky PMREM again. A uniform value: no program change. */
export function setOwnEnvMap(material: T.Material, owned: boolean) {
  ownEnvMapUniform(material).value = owned ? 1 : 0;
}
const SPECULAR_IBL_DECLARATION = `#ifndef APEX_SPECULAR_IBL_DECLARED
#define APEX_SPECULAR_IBL_DECLARED
uniform float apexSpecularIBL;
uniform float apexSkyIrradianceSaturation;
uniform float apexOwnEnvMap;
#endif`;
/** Injected after `#include <lights_fragment_maps>` (IBL radiance gathered,
 * before any planar wet-road replacement and before lights_fragment_end). */
export const SPECULAR_IBL_GLSL = `#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
  {
    // Sky specular at the visible dome; a probe-owned map already is.
    float apexSpecularGain = mix(apexSpecularIBL, 1.0, apexOwnEnvMap);
    radiance *= apexSpecularGain;
    clearcoatRadiance *= apexSpecularGain;
    #if defined( RE_IndirectDiffuse )
      iblIrradiance /= mix(1.0, apexSpecularIBL, apexOwnEnvMap);
      // Diffuse sky colour balance (energy kept): see SKY_IRRADIANCE_SATURATION.
      iblIrradiance = mix(vec3(dot(iblIrradiance, vec3(0.2126, 0.7152, 0.0722))),
        iblIrradiance, apexSkyIrradianceSaturation);
    #endif
  }
#endif`;

const MAPS = '#include <lights_fragment_maps>',
  COMMON = '#include <common>';
function occurrences(source: string, text: string) {
  return source.split(text).length - 1;
}

/** Chain the specular IBL normalisation on one Standard/Physical material that
 * has no envMap of its own. Returns false when it does not apply or is already
 * installed. `material.userData.apexSpecularIBL === false` opts a material out. */
export function installSpecularIBLMaterial(
  material: T.Material,
  uniforms: IblUniforms = iblUniforms,
): boolean {
  if (
    !(material instanceof T.MeshStandardMaterial) ||
    material.envMap ||
    material.userData.apexSpecularIBL === false
  )
    return false;
  return chainShaderHook(material, SPECULAR_IBL_KEY, (shader, _renderer, compiled) => {
    // A previous hook that inlined either chunk keeps its own lighting: skip
    // rather than throw, so the material still compiles.
    if (
      occurrences(shader.fragmentShader, MAPS) !== 1 ||
      occurrences(shader.fragmentShader, COMMON) !== 1
    )
      return;
    shader.uniforms.apexSpecularIBL = uniforms.apexSpecularIBL;
    shader.uniforms.apexSkyIrradianceSaturation = uniforms.apexSkyIrradianceSaturation;
    shader.uniforms.apexOwnEnvMap = ownEnvMapUniform(compiled);
    injectDeclarations(shader, 'common', SPECULAR_IBL_DECLARATION, 'fragment');
    injectAfter(shader, 'lights_fragment_maps', SPECULAR_IBL_GLSL, 'fragment');
  });
}

/** Install on every mesh material under `root`; returns the number newly installed. */
export function installSpecularIBL(root: T.Object3D, uniforms: IblUniforms = iblUniforms) {
  let installed = 0;
  root.traverse((object) => {
    const material = (object as Partial<T.Mesh>).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material])
      if (installSpecularIBLMaterial(m, uniforms)) installed++;
  });
  return installed;
}

/** Declarations added to the sky fragment shader (configureSky). */
export const SKY_GROUND_UNIFORMS = `
uniform float groundAmount;
uniform vec3 groundAlbedo;
uniform vec3 groundIrradiance;
`;
/** Applied to the sky's final `radiance`, before probeSkyIntensity. The blend is
 * `1 - smoothstep(-sin(2 deg), 0, y)`: GLSL ES leaves smoothstep undefined for
 * edge0 >= edge1, so the edges stay ascending. */
export const SKY_GROUND_GLSL = `
      // Ground hemisphere for the PMREM only (groundAmount is 0 for the visible
      // dome): Lambertian ground radiance under the same sun and sky, blended
      // in over ${IBL_ENERGY.horizonBlendDegrees} degrees below the horizon.
      radiance=mix(radiance,groundAlbedo*groundIrradiance*0.3183098862,
        groundAmount*(1.0-smoothstep(-${Math.sin((IBL_ENERGY.horizonBlendDegrees * Math.PI) / 180).toFixed(6)},0.0,direction.y)));
`;

export interface GroundLight {
  /** Direct key colour (linear) and intensity, and the direction toward it. */
  sunColor: T.Color;
  sun: number;
  sunDirection: T.Vector3;
  /** Hemisphere sky colour (linear) and intensity. */
  skyColor: T.Color;
  fill: number;
  /** Diffuse IBL intensity (scene.environmentIntensity). */
  environment: number;
  /** Cosine-weighted mean radiance of the upper dome (linear, as rendered). */
  skyCosineRadiance: T.Color;
  /** Diffuse sky colour balance applied to the IBL term (default 1). */
  skySaturation?: number;
}
/** Irradiance on horizontal open ground in scene units: sun × cos + hemisphere
 * sky + π × environment × mean dome radiance (three's IBL irradiance). The sky
 * shader turns it into radiance with groundAlbedo / π. */
export function groundIrradiance(light: GroundLight, out = new T.Vector3()) {
  const saturation = light.skySaturation ?? 1;
  const values = [
    saturation,
    light.sun,
    light.fill,
    light.environment,
    light.sunDirection.x,
    light.sunDirection.y,
    light.sunDirection.z,
  ];
  if (!values.every(Number.isFinite) || light.sunDirection.lengthSq() === 0)
    throw new Error('Invalid ground light');
  const cosine = Math.max(0, light.sunDirection.y / light.sunDirection.length());
  const direct = light.sun * cosine,
    ibl = Math.PI * light.environment,
    dome = light.skyCosineRadiance,
    luma = 0.2126 * dome.r + 0.7152 * dome.g + 0.0722 * dome.b;
  const sky = (c: number) => (luma + (c - luma) * saturation) * ibl;
  return out.set(
    light.sunColor.r * direct + light.skyColor.r * light.fill + sky(dome.r),
    light.sunColor.g * direct + light.skyColor.g * light.fill + sky(dome.g),
    light.sunColor.b * direct + light.skyColor.b * light.fill + sky(dome.b),
  );
}
