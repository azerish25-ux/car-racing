import * as T from 'three';
import { ATMOSPHERE } from '../atmosphere.ts';
import type { LightingMode } from '../daylight.ts';
import { studioGlsl, studioUniforms } from './studio-frame.ts';

/**
 * Aerial perspective (D07, producer decision P12; photoreal pass).
 *
 * three's FogExp2 fades every fragment toward one colour by view depth alone.
 * The fog chunk of every material that carries the local atmosphere
 * (LocalAtmosphere.installMaterial: the circuit, terrain, forest, cars and
 * weather particles) now replaces that term with the same air the sky dome
 * is baked from:
 *
 *  - Extinction (Beer-Lambert): amount = 1 - exp(-tau) per channel, with
 *    tau = sigma * distance * (mean of exp(-(y - y0) / 1200 m) along the
 *    sightline, in closed form). sigma is the atmosphere's own extinction at
 *    the datum: Rayleigh plus Mie aerosols at the sky's haze level
 *    (`aerialExtinction`, ~0.7/0.9/1.4e-4 per metre on a clear day, a 40 km
 *    visibility), plus rain. The old squared response (FogExp2's) put ridges
 *    2-5 km out at 50-95 % haze, flattening them into pale cut-outs; now they
 *    keep 60-75 % of their contrast and blue a little more than they redden,
 *    while the near field stays crisp. Valley floors haze more than ridges.
 *  - In-scatter colour by view direction: the scene fog colour is the sky's
 *    own horizon away from the sun; toward the sun it gains the forward-
 *    scattering glow, `mix(antiSun, sunSide, pow(max(dot(v, sun), 0), 24))`
 *    (a tight Mie aureole), faded out as the cloud deck closes.
 *
 * Materials without the local atmosphere (unlit signs, screens) keep three's
 * FogExp2 at the scene density and anti-sun colour; a linear `T.Fog` (tests,
 * fixtures) is untouched. No draw calls, no time source: a pure function of
 * the presented weather, the lighting and the camera.
 */
export const AERIAL_PERSPECTIVE = Object.freeze({
  /** Height of the circuit datum the extinction refers to, metres. */
  referenceHeight: 0,
  /** Scale height of the haze, metres (the atmosphere's aerosol scale height). */
  scaleHeight: ATMOSPHERE.mieScaleHeight,
  /** Exponent of the sun-side lobe: a tight Mie aureole (half width ~14
   * degrees), not a 23 degree veil over the into-the-sun view. */
  sunPower: 24,
  /** Rain's extra (grey) extinction per mm/h of rain rate, 1/m: about
   * 1.5e-3 at the 24 mm/h preset (a ~2.6 km visibility). */
  rainExtinction: 6.25e-5,
  /** Fog colours (linear scene radiance) chosen so a fully hazed sightline
   * displays the ART_BIBLE_A section 2.3 / P12 colour through ACES at the
   * lighting's exposure and the broadcast grade. Display targets in comments. */
  colors: Object.freeze({
    /** Clear day: anti-sun #9db8d3, sun side #c9d3dc. */
    dayAntiSun: Object.freeze([0.2595, 0.4063, 0.6947] as const),
    daySunSide: Object.freeze([0.4874, 0.6475, 0.9308] as const),
    /** Overcast #c4cacd. */
    overcast: Object.freeze([0.4204, 0.5007, 0.6015] as const),
    /** Rain (24 mm/h preset) #aeb5b8, darkening to #8c9396 in a 60 mm/h storm. */
    rain: Object.freeze([0.3098, 0.3584, 0.4083] as const),
    storm: Object.freeze([0.2062, 0.2292, 0.247] as const),
    /** Golden hour: anti-sun #7d84a0, sun side #d9a27c. */
    sunsetAntiSun: Object.freeze([0.1668, 0.1842, 0.2607] as const),
    sunsetSunSide: Object.freeze([0.5286, 0.2636, 0.169] as const),
    /** Night #0e141c. */
    night: Object.freeze([0.0153, 0.0196, 0.0254] as const),
  }),
});

/** Relative aerosol extinction at 680, 550 and 440 nm (atmosphere.ts). */
const MIE_SPECTRUM = [680, 550, 440].map((nm) => (nm / 550) ** -ATMOSPHERE.mieAngstrom);
/** Extinction (1/m, at 680/550/440 nm) of the air at the circuit datum: the
 * atmosphere's Rayleigh scattering plus its Mie aerosols at `haze` (multiples
 * of the reference aerosols, the sky's own level), plus grey rain extinction
 * for a rain rate in mm/h. */
export function aerialExtinction(haze: number, rain = 0, out = new T.Vector3()) {
  if (!Number.isFinite(haze) || haze < 0 || !Number.isFinite(rain))
    throw new Error('Invalid aerial extinction');
  const mie = (ATMOSPHERE.mieScattering + ATMOSPHERE.mieAbsorption) * haze;
  const wet = AERIAL_PERSPECTIVE.rainExtinction * Math.min(60, Math.max(0, rain));
  return out.set(
    ATMOSPHERE.rayleighScattering[0] + mie * MIE_SPECTRUM[0] + wet,
    ATMOSPHERE.rayleighScattering[1] + mie * MIE_SPECTRUM[1] + wet,
    ATMOSPHERE.rayleighScattering[2] + mie * MIE_SPECTRUM[2] + wet,
  );
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Share of the sun-side glow left under a cloud deck. */
export function aerialSunVisibility(cover: number) {
  if (!Number.isFinite(cover)) throw new Error('Non-finite cloud cover');
  return 1 - smooth(0.35, 0.9, cover);
}

/** The sky's own haze colours (linear) that replace the authored constants:
 * the clear horizon away from and toward the sun, and the overcast deck. The
 * renderer passes the physical sky's (daylight.ts skyFogPalette), so distant
 * terrain dissolves into exactly the horizon the dome shows. */
export interface AerialPalette {
  antiSun: readonly number[];
  sunSide: readonly number[];
  overcast: readonly number[];
}
/** Anti-sun fog colour (linear) for a weather and lighting: the scene fog
 * colour (`daylightState` fogRed/Green/Blue). Rain darkens the overcast grey
 * by the authored rain/overcast and storm/overcast ratios. */
export function aerialFogColor(
  cover: number,
  rain: number,
  mode: LightingMode,
  palette?: AerialPalette,
) {
  if (![cover, rain].every(Number.isFinite)) throw new Error('Invalid aerial perspective state');
  const c = AERIAL_PERSPECTIVE.colors,
    deck = smooth(0.3, 1, cover),
    wet = Math.min(1, Math.max(0, rain) / 24),
    storm = smooth(24, 60, rain);
  const base =
    mode === 'night'
      ? c.night
      : (palette?.antiSun ?? (mode === 'sunset' ? c.sunsetAntiSun : c.dayAntiSun));
  const grey = palette?.overcast ?? c.overcast;
  return [0, 1, 2].map((k) => {
    if (mode === 'night') return lerp(base[k], base[k] * 1.25, deck);
    const overcastK = palette ? grey[k] : mode === 'sunset' ? base[k] * 1.1 : grey[k];
    const overcast = lerp(base[k], overcastK, deck);
    if (mode === 'sunset' && !palette) return overcast;
    const rainK = grey[k] * (c.rain[k] / c.overcast[k]),
      stormK = grey[k] * (c.storm[k] / c.overcast[k]);
    return lerp(lerp(overcast, rainK, wet), stormK, storm);
  }) as [number, number, number];
}

/** Sun-side glow added to the fog colour (linear): sun side minus anti-sun,
 * faded with cover; none at night. */
export function aerialSunGlow(
  cover: number,
  mode: LightingMode,
  out = new T.Vector3(),
  palette?: AerialPalette,
) {
  const c = AERIAL_PERSPECTIVE.colors,
    visible = aerialSunVisibility(cover);
  if (mode === 'night') return out.set(0, 0, 0);
  const sun = palette?.sunSide ?? (mode === 'sunset' ? c.sunsetSunSide : c.daySunSide),
    anti = palette?.antiSun ?? (mode === 'sunset' ? c.sunsetAntiSun : c.dayAntiSun);
  return out.set(
    Math.max(0, sun[0] - anti[0]) * visible,
    Math.max(0, sun[1] - anti[1]) * visible,
    Math.max(0, sun[2] - anti[2]) * visible,
  );
}

export interface AerialUniforms {
  /** Sun-side glow (linear radiance) added toward the sun. */
  apexAerialSunGlow: T.IUniform<T.Vector3>;
  /** (reference height y0, 1 / scale height). */
  apexAerialFalloff: T.IUniform<T.Vector2>;
  /** Extinction at the datum (1/m per channel): `aerialExtinction`. */
  apexAerialExtinction: T.IUniform<T.Vector3>;
}
export function createAerialUniforms(): AerialUniforms {
  return {
    apexAerialSunGlow: { value: aerialSunGlow(0, 'day') },
    apexAerialFalloff: {
      value: new T.Vector2(AERIAL_PERSPECTIVE.referenceHeight, 1 / AERIAL_PERSPECTIVE.scaleHeight),
    },
    apexAerialExtinction: { value: aerialExtinction(SKY_CLEAR_HAZE) },
  };
}
/** Clear-day haze level of the sky (sky-light.ts SKY_LIGHT.haze.day[0]); the
 * renderer writes the presented level every frame (`setAerialExtinction`). */
const SKY_CLEAR_HAZE = 18;
/** Shared by every installed material, bound by identity. */
export const aerialUniforms: AerialUniforms = createAerialUniforms();

/** Write this frame's air into the shared uniforms (renderer, with the fog):
 * the sky's haze level for the cover and lighting, and the rain rate. */
export function setAerialExtinction(
  haze: number,
  rain: number,
  uniforms: AerialUniforms = aerialUniforms,
) {
  aerialExtinction(haze, rain, uniforms.apexAerialExtinction.value);
}

/** Write this frame's lighting into the shared uniforms (SkyEnvironment.update). */
export function setAerialPerspective(
  cover: number,
  mode: LightingMode,
  uniforms: AerialUniforms = aerialUniforms,
  palette?: AerialPalette,
) {
  aerialSunGlow(cover, mode, uniforms.apexAerialSunGlow.value, palette);
}

/** Mean of exp(-(y - y0) / H) along a sightline from height `from` rising by
 * `rise`, in closed form (a series near zero rise). */
export function aerialHeightMean(from: number, rise: number, falloff = createAerialUniforms()) {
  const [y0, inverseHeight] = falloff.apexAerialFalloff.value.toArray();
  const h0 = Math.max(-2, (from - y0) * inverseHeight),
    dh = rise * inverseHeight;
  const shape = Math.abs(dh) > 1e-4 ? -Math.expm1(-dh) / dh : 1 - 0.5 * dh;
  return Math.exp(-h0) * shape;
}
/** CPU reference of the shader's haze amount (0..1) for a camera and a point,
 * for one channel's extinction at the datum (1/m). */
export function aerialAmount(
  camera: T.Vector3,
  point: T.Vector3,
  extinction: number,
  falloff = createAerialUniforms(),
) {
  if (![camera.x, camera.y, camera.z, point.x, point.y, point.z, extinction].every(Number.isFinite))
    throw new Error('Invalid aerial perspective ray');
  const distance = camera.distanceTo(point);
  const tau = extinction * distance * aerialHeightMean(camera.y, point.y - camera.y, falloff);
  return -Math.expm1(-tau);
}

/** Declarations for the fog_pars_fragment region (guarded; `studioSunDir` is
 * render-core's shared sun direction). */
export const AERIAL_PERSPECTIVE_PARS = `
#if defined( USE_FOG ) && defined( FOG_EXP2 )
${studioGlsl(['studioSunDir'])}
#ifndef APEX_AERIAL_DECLARED
#define APEX_AERIAL_DECLARED
uniform vec3 apexAerialSunGlow;
uniform vec2 apexAerialFalloff;
uniform vec3 apexAerialExtinction;
// Aerial perspective: Beer-Lambert extinction of the sky's own air at the
// datum, thinning with altitude along the sightline, per channel; in-scatter
// coloured by the view's angle to the sun.
vec3 apexAerialPerspective(vec3 color, vec3 world) {
  vec3 ray = world - cameraPosition;
  float rayLength = length(ray);
  float h0 = max(-2.0, (cameraPosition.y - apexAerialFalloff.x) * apexAerialFalloff.y);
  float dh = ray.y * apexAerialFalloff.y;
  float shape = abs(dh) > 1e-4 ? (1.0 - exp(-dh)) / dh : 1.0 - 0.5 * dh;
  vec3 amount = 1.0 - exp(-apexAerialExtinction * (rayLength * exp(-h0) * shape));
  float toSun = max(dot(ray / max(rayLength, 1e-4), studioSunDir), 0.0);
  vec3 inscatter = fogColor + apexAerialSunGlow * pow(toSun, ${AERIAL_PERSPECTIVE.sunPower.toFixed(1)});
  return mix(color, inscatter, amount);
}
#endif
#endif
`;
/** Replaces `#include <fog_fragment>`: the aerial term for FogExp2 scenes,
 * three's own fog otherwise. Expects `vApexFogWorld` (LocalAtmosphere). */
export const AERIAL_PERSPECTIVE_FRAGMENT = `
#if defined( USE_FOG ) && defined( FOG_EXP2 )
  gl_FragColor.rgb = apexAerialPerspective(gl_FragColor.rgb, vApexFogWorld);
#else
  #include <fog_fragment>
#endif
`;
/** Bind the shared uniforms into a compiling shader. */
export function useAerialUniforms(
  shader: { uniforms: Record<string, T.IUniform> },
  uniforms: AerialUniforms = aerialUniforms,
) {
  shader.uniforms.apexAerialSunGlow = uniforms.apexAerialSunGlow;
  shader.uniforms.apexAerialFalloff = uniforms.apexAerialFalloff;
  shader.uniforms.apexAerialExtinction = uniforms.apexAerialExtinction;
  shader.uniforms.studioSunDir = studioUniforms.studioSunDir;
}
