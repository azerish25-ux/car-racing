import * as T from 'three';
import { SUNSET_OFFSET } from '../sky-light.ts';
import { SKY_GROUND_GLSL } from '../studio/ibl-energy.ts';

/**
 * The festival's blue hour (render only; session/festival-lighting.ts 'dusk').
 *
 * The references' dusk frames (FH6 043, 061, 075, 081, 083) have no direct
 * sun: it has set a few degrees below the golden-hour sun's azimuth (WSW).
 * The sky is the light. Measured (sRGB of 9 x 9 patches, scene radiance at
 * this exposure through three's ACES in brackets):
 *
 *  - zenith deep blue-violet: 083 #433e8e (0.065/0.057/0.21), 043 #638ad1
 *    (0.088/0.18/0.59) over the touge's hazy valley;
 *  - 25-35 degrees up: 083 #655cb2 (0.11/0.095/0.35), 061 #9d9cda;
 *  - a lilac-pink band low on the sky away from the afterglow: 083 #c396d7
 *    (0.42/0.21/0.67), 061 #dab8d8 (0.67/0.34/0.68);
 *  - toward the set sun a salmon afterglow over an orange band on the
 *    horizon: 081 #f3c390 (1.2/0.40/0.15), 075 #dfa99e, clouds lit pink from
 *    below there (075, 081), slate-violet elsewhere;
 *  - sky-lit ground takes the sky's hue: asphalt 061 #363463-#3a315e
 *    (0.05/0.045/0.11, B/R 2.3), 043 road #25354d, forest near black #04090e;
 *    street lamps, lit windows, signs and headlights on (083, 081).
 *
 * Dusk runs on the shared night state (lamps, windows, the night PMREM key
 * and grade base) with these overrides: the festival's own blue-hour dome
 * (the sky shader patch below, in the visible dome and every PMREM capture),
 * a dim lilac key from the bright western sky, the dome's own diffuse light,
 * blue-violet air and a cool, slightly richer grade. Circuits never see it.
 */
export const FESTIVAL_DUSK = Object.freeze({
  /** Depression of the set sun below the horizon (degrees), at the golden-hour
   * sun's azimuth. */
  sunDepression: 5,
  /** Elevation of the key standing in for the bright western sky (degrees). */
  keyElevation: 24,
  /** Dome radiance (linear scene units at `light.exposure`). */
  sky: Object.freeze({
    zenith: Object.freeze([0.045, 0.055, 0.21] as const),
    /** About 20 degrees up. */
    high: Object.freeze([0.085, 0.09, 0.33] as const),
    /** Low sky away from the afterglow (lilac-pink). */
    horizon: Object.freeze([0.36, 0.21, 0.56] as const),
    /** Low sky toward the set sun (salmon). */
    sunSide: Object.freeze([0.66, 0.3, 0.34] as const),
    /** Orange band hugging the horizon at the sun's azimuth (added). */
    glow: Object.freeze([0.9, 0.36, 0.1] as const),
    /** Pink band ~8 degrees up opposite the sun, over the earth's shadow
     * (added). */
    belt: Object.freeze([0.12, 0.035, 0.06] as const),
    /** Cloud bodies: the sky behind them, dimmed and a little bluer (gain),
     * and their undersides lit by the afterglow. */
    cloud: Object.freeze([0.55, 0.55, 0.7] as const),
    cloudLit: Object.freeze([0.62, 0.25, 0.26] as const),
  }),
  light: Object.freeze({
    /** Key (scene `sun`): the bright western sky, lilac-pink, soft. */
    key: 0.26,
    keyColour: Object.freeze([1, 0.72, 0.8] as const),
    /** Hemisphere fill (a little sky/ground bias; the dome IBL carries the
     * sky light). */
    fill: 0.12,
    fillSky: Object.freeze([0.5, 0.48, 1] as const),
    fillGround: Object.freeze([0.06, 0.05, 0.06] as const),
    /** Diffuse/specular IBL gain over the captured dusk dome. */
    environment: 1.25,
    /** Chroma kept in the diffuse sky light: the dome is strongly violet;
     * sky-lit asphalt reads B/R 2-2.5 in 061/043, not the dome's 4. */
    irradianceSaturation: 0.65,
    exposure: 1.15,
    /** Shaded side of the drift smoke (stands in for the dome light). */
    smokeFill: Object.freeze([0.16, 0.14, 0.3] as const),
  }),
  /** Festival air at dusk: aerosol (clear, + overcast), the blue-violet
   * in-scatter of the far ridges (043 #4a6aa0-#5a73b0 layers, 083 violet)
   * and the glow toward the afterglow. */
  air: Object.freeze({
    haze: Object.freeze([3.2, 6] as const),
    inscatter: Object.freeze([0.13, 0.12, 0.34] as const),
    glow: Object.freeze([0.42, 0.14, 0.06] as const),
    /** In-scatter under a closing deck (blue-grey). */
    deck: Object.freeze([0.07, 0.075, 0.11] as const),
  }),
});

const horizontal = new T.Vector2(SUNSET_OFFSET.x, SUNSET_OFFSET.z).normalize();
function atElevation(degrees: number, out: T.Vector3) {
  const e = (degrees * Math.PI) / 180;
  return out.set(horizontal.x * Math.cos(e), Math.sin(e), horizontal.y * Math.cos(e));
}
/** Unit direction toward the set sun (below the horizon). */
export const DUSK_SUN = Object.freeze(atElevation(-FESTIVAL_DUSK.sunDepression, new T.Vector3()));
/** Unit direction toward the dusk key (the western sky). */
export const DUSK_KEY = Object.freeze(atElevation(FESTIVAL_DUSK.keyElevation, new T.Vector3()));

const forward = DUSK_KEY.clone(),
  right = new T.Vector3(0, 1, 0).cross(forward).normalize(),
  up = forward.clone().cross(right).normalize();
/** The dusk key's shadow anchor: snapped in the key's fixed light space, as
 * the shared shadowAnchor does for the day and golden-hour suns. */
export function duskShadowAnchor(
  target: T.Vector3,
  size: number,
  halfExtent: number,
  out: T.Vector3,
) {
  if (
    ![target.x, target.y, target.z, size, halfExtent].every(Number.isFinite) ||
    size < 1 ||
    halfExtent <= 0
  )
    throw new Error('Invalid shadow grid');
  const texel = (2 * halfExtent) / size;
  return out
    .copy(right)
    .multiplyScalar(Math.round(target.dot(right) / texel) * texel)
    .addScaledVector(up, Math.round(target.dot(up) / texel) * texel)
    .addScaledVector(forward, target.dot(forward));
}

/** The dusk camera and lights over a frame's lighting state (in place). */
export function festivalDuskLight<
  L extends { sun: number; fill: number; environment: number; exposure: number; cover: number },
>(light: L, rain = 0) {
  const k = FESTIVAL_DUSK.light,
    cover = Math.min(1, Math.max(0, Number.isFinite(light.cover) ? light.cover : 0));
  // The western sky dims and greys behind a deck; the dome light stays.
  light.sun = k.key * (1 - 0.7 * cover);
  light.fill = k.fill * (1 + 0.5 * cover);
  light.environment = k.environment;
  light.exposure = k.exposure * (1 + 0.15 * cover) - Math.min(60, Math.max(0, rain)) * 0.0005;
  return light;
}
/** Key, hemisphere sky and ground colours of the dusk (linear). */
export function duskLightColours(cover: number, sun: T.Color, sky: T.Color, ground: T.Color) {
  const k = FESTIVAL_DUSK.light,
    c = Math.min(1, Math.max(0, Number.isFinite(cover) ? cover : 0));
  sun.setRGB(...k.keyColour).lerp(GREY, c * 0.7);
  sky.setRGB(...k.fillSky).lerp(GREY, c * 0.5);
  ground.setRGB(...k.fillGround);
}
const GREY = new T.Color(0.78, 0.8, 0.86);

/** Uniforms of the dusk dome (added to the festival's sky material). */
export interface DuskSkyUniforms {
  duskAmount: T.IUniform<number>;
  duskSun: T.IUniform<T.Vector3>;
  duskZenith: T.IUniform<T.Vector3>;
  duskHigh: T.IUniform<T.Vector3>;
  duskHorizon: T.IUniform<T.Vector3>;
  duskSunSide: T.IUniform<T.Vector3>;
  duskGlow: T.IUniform<T.Vector3>;
  duskBelt: T.IUniform<T.Vector3>;
  duskCloud: T.IUniform<T.Vector3>;
  duskCloudLit: T.IUniform<T.Vector3>;
}
const DUSK_UNIFORMS = /* glsl */ `
uniform float duskAmount;
uniform vec3 duskSun;
uniform vec3 duskZenith;
uniform vec3 duskHigh;
uniform vec3 duskHorizon;
uniform vec3 duskSunSide;
uniform vec3 duskGlow;
uniform vec3 duskBelt;
uniform vec3 duskCloud;
uniform vec3 duskCloudLit;
`;
/** The blue-hour dome: a gradient from the horizon (lilac away from the set
 * sun, salmon toward it, an orange band on the horizon at its azimuth) up to
 * the deep blue-violet zenith, the pink belt over the earth's shadow, and the
 * baked clouds (sky-clouds.ts: their opacity and sun-facing share) as
 * bodies a little darker and bluer than the sky behind them, whose undersides
 * catch the afterglow. Below the horizon the horizon colour continues
 * (terrain covers it). */
export const DUSK_SKY_GLSL = /* glsl */ `
${DUSK_UNIFORMS}
vec3 festivalDuskSky(vec3 direction) {
  float e = asin(clamp(direction.y, 0.0, 1.0));
  vec2 h = direction.xz, s = duskSun.xz;
  float hs = length(h) * length(s);
  float sunSide = 0.5 + 0.5 * (hs > 1e-6 ? dot(h, s) / hs : 0.0);
  vec3 low = mix(duskHorizon, duskSunSide, pow(sunSide, 2.5));
  vec3 sky = mix(low, duskHigh, smoothstep(0.0, 0.32, e));
  sky = mix(sky, duskZenith, smoothstep(0.3, 1.25, e));
  float away = pow(1.0 - sunSide, 2.0);
  sky += duskBelt * exp(-pow((e - 0.14) / 0.075, 2.0)) * away;
  sky *= 1.0 - 0.35 * exp(-e / 0.035) * away;
  sky += duskGlow * exp(-e / 0.055) * pow(sunSide, 8.0);
  vec4 clouds = skyCloudTerms(direction);
  if (clouds.a > 0.0) {
    float lit = clamp(clouds.r / max(clouds.a, 0.02), 0.0, 1.0);
    float warm = pow(sunSide, 3.0) * exp(-e / 0.4) + 0.25 * away * exp(-e / 0.2);
    vec3 cloud = mix(sky * duskCloud, duskCloudLit, clamp(warm * (0.45 + 0.55 * lit), 0.0, 1.0));
    sky = mix(sky, cloud, clouds.a * 0.92);
  }
  return sky;
}
`;
const ANCHORS = Object.freeze({
  procedural: 'vec3 radiance = photoAmount < 1.0 ? proceduralSky(direction) : vec3(0.0);',
  photo: 'if (photoAmount > 0.0) {',
  main: 'void main() {',
});
/**
 * Give a configured sky material (daylight.ts configureSky) the dusk dome:
 * `duskAmount` 0 leaves it untouched; 1 replaces the photographed and
 * procedural sky (neither is evaluated) before the PMREM ground blend. The
 * festival's own Sky instance only (its captures share the material).
 */
export function installDuskSky(material: T.ShaderMaterial) {
  const u = material.uniforms as Record<string, T.IUniform>;
  if (u.duskAmount) return u as unknown as DuskSkyUniforms;
  let shader = material.fragmentShader;
  for (const anchor of [...Object.values(ANCHORS), SKY_GROUND_GLSL])
    if (shader.split(anchor).length !== 2) throw new Error('Sky shader has no dusk anchor');
  shader = shader
    .replace(ANCHORS.main, `${DUSK_SKY_GLSL}\n${ANCHORS.main}`)
    .replace(
      ANCHORS.procedural,
      'vec3 radiance = duskAmount < 1.0 && photoAmount < 1.0 ? proceduralSky(direction) : vec3(0.0);',
    )
    .replace(ANCHORS.photo, 'if (photoAmount > 0.0 && duskAmount < 1.0) {')
    .replace(
      SKY_GROUND_GLSL,
      `if (duskAmount > 0.0) radiance = mix(radiance, festivalDuskSky(direction), duskAmount);\n${SKY_GROUND_GLSL}`,
    );
  material.fragmentShader = shader;
  const v = (c: readonly number[]) => ({ value: new T.Vector3(c[0], c[1], c[2]) });
  const s = FESTIVAL_DUSK.sky;
  Object.assign(u, {
    duskAmount: { value: 0 },
    duskSun: { value: DUSK_SUN.clone() },
    duskZenith: v(s.zenith),
    duskHigh: v(s.high),
    duskHorizon: v(s.horizon),
    duskSunSide: v(s.sunSide),
    duskGlow: v(s.glow),
    duskBelt: v(s.belt),
    duskCloud: v(s.cloud),
    duskCloudLit: v(s.cloudLit),
  });
  material.needsUpdate = true;
  return u as unknown as DuskSkyUniforms;
}
/** Show (1) or hide (0) the dusk dome on an installed sky material. */
export function bindDuskSky(material: T.ShaderMaterial, amount: number) {
  const u = material.uniforms as Partial<Record<keyof DuskSkyUniforms, T.IUniform>>;
  if (!u.duskAmount) return false;
  u.duskAmount.value = Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 0));
  return true;
}
