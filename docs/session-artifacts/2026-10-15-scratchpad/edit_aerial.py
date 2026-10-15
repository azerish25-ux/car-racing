p='src/rendering/studio/aerial-perspective.ts'
s=open(p).read()

old=s[s.index("/**\n * Aerial perspective (D07, producer decision P12)."):s.index("function lerp(a: number, b: number, t: number)")]
new="""/**
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

"""
s=s.replace(old,new)
s=s.replace("""import * as T from 'three';
import type { LightingMode } from '../daylight.ts';""","""import * as T from 'three';
import { ATMOSPHERE } from '../atmosphere.ts';
import type { LightingMode } from '../daylight.ts';""")

old="""export interface AerialUniforms {
  /** Sun-side glow (linear radiance) added toward the sun. */
  apexAerialSunGlow: T.IUniform<T.Vector3>;
  /** (reference height y0, 1 / scale height). */
  apexAerialFalloff: T.IUniform<T.Vector2>;
}
export function createAerialUniforms(): AerialUniforms {
  return {
    apexAerialSunGlow: { value: aerialSunGlow(0, 'day') },
    apexAerialFalloff: {
      value: new T.Vector2(AERIAL_PERSPECTIVE.referenceHeight, 1 / AERIAL_PERSPECTIVE.scaleHeight),
    },
  };
}"""
new="""export interface AerialUniforms {
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
const SKY_CLEAR_HAZE = 18;"""
assert old in s; s=s.replace(old,new)

old="""/** Write this frame's lighting into the shared uniforms (SkyEnvironment.update). */"""
new="""/** Write this frame's air into the shared uniforms (renderer, with the fog):
 * the sky's haze level for the cover and lighting, and the rain rate. */
export function setAerialExtinction(
  haze: number,
  rain: number,
  uniforms: AerialUniforms = aerialUniforms,
) {
  aerialExtinction(haze, rain, uniforms.apexAerialExtinction.value);
}

/** Write this frame's lighting into the shared uniforms (SkyEnvironment.update). */"""
assert old in s; s=s.replace(old,new)

old="""/** CPU reference of the shader's haze amount (0..1) for a camera and a point. */
export function aerialAmount(
  camera: T.Vector3,
  point: T.Vector3,
  density: number,
  falloff = createAerialUniforms(),
) {
  if (![camera.x, camera.y, camera.z, point.x, point.y, point.z, density].every(Number.isFinite))
    throw new Error('Invalid aerial perspective ray');
  const distance = camera.distanceTo(point);
  const depth = density * distance * aerialHeightMean(camera.y, point.y - camera.y, falloff);
  return 1 - Math.exp(-depth * depth);
}"""
new="""/** CPU reference of the shader's haze amount (0..1) for a camera and a point,
 * for one channel's extinction at the datum (1/m). */
export function aerialAmount(
  camera: T.Vector3,
  point: T.Vector3,
  extinction: number,
  falloff = createAerialUniforms(),
) {
  if (
    ![camera.x, camera.y, camera.z, point.x, point.y, point.z, extinction].every(Number.isFinite)
  )
    throw new Error('Invalid aerial perspective ray');
  const distance = camera.distanceTo(point);
  const tau = extinction * distance * aerialHeightMean(camera.y, point.y - camera.y, falloff);
  return -Math.expm1(-tau);
}"""
assert old in s; s=s.replace(old,new)

old="""uniform vec3 apexAerialSunGlow;
uniform vec2 apexAerialFalloff;
// Aerial perspective: FogExp2 extinction at the datum, thinning with altitude
// along the sightline, in-scatter coloured by the view's angle to the sun.
vec3 apexAerialPerspective(vec3 color, vec3 world) {
  vec3 ray = world - cameraPosition;
  float rayLength = length(ray);
  float h0 = max(-2.0, (cameraPosition.y - apexAerialFalloff.x) * apexAerialFalloff.y);
  float dh = ray.y * apexAerialFalloff.y;
  float shape = abs(dh) > 1e-4 ? (1.0 - exp(-dh)) / dh : 1.0 - 0.5 * dh;
  float depth = fogDensity * rayLength * exp(-h0) * shape;
  float amount = 1.0 - exp(-depth * depth);"""
new="""uniform vec3 apexAerialSunGlow;
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
  vec3 amount = 1.0 - exp(-apexAerialExtinction * (rayLength * exp(-h0) * shape));"""
assert old in s; s=s.replace(old,new)

old="""  shader.uniforms.apexAerialSunGlow = uniforms.apexAerialSunGlow;
  shader.uniforms.apexAerialFalloff = uniforms.apexAerialFalloff;"""
new="""  shader.uniforms.apexAerialSunGlow = uniforms.apexAerialSunGlow;
  shader.uniforms.apexAerialFalloff = uniforms.apexAerialFalloff;
  shader.uniforms.apexAerialExtinction = uniforms.apexAerialExtinction;"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/sky-light.ts'
s=open(p).read()
old="""  /** Aerosol haze (multiples of ATMOSPHERE.mieScattering) at cover 0, 0.5, 1:
   * aerosol optical depth 0.04, 0.06 and 0.09 by day; a hazier 0.07-0.11 dusk. */
  haze: Object.freeze({
    day: Object.freeze([7, 11, 16] as const),
    sunset: Object.freeze([13, 16, 20] as const),
  }),"""
new="""  /** Aerosol haze (multiples of ATMOSPHERE.mieScattering) at cover 0, 0.5, 1:
   * aerosol optical depth (550 nm) about 0.09, 0.12 and 0.18 by day, a typical
   * summer 0.1-0.2 (the old 0.03-0.08 was alpine-clean, saturated blue to the
   * horizon); a hazier 0.11-0.17 dusk. The aerial perspective's extinction
   * reads the same level, so distant ridges dissolve into this horizon. */
  haze: Object.freeze({
    day: Object.freeze([18, 26, 38] as const),
    sunset: Object.freeze([22, 28, 36] as const),
  }),"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/rendering/renderer.ts'
s=open(p).read()
old="""    fog.density = daylight.fogDensity;"""
new="""    fog.density = daylight.fogDensity;
    // The local atmosphere's extinction: the sky's own air plus rain.
    setAerialExtinction(daylight.haze, presented[H.RAIN]);"""
assert old in s; s=s.replace(old,new)
s=s.replace("import { setBrandLedLighting } from './studio/trackside-branding.ts';","import { setBrandLedLighting } from './studio/trackside-branding.ts';\nimport { setAerialExtinction } from './studio/aerial-perspective.ts';")
open(p,'w').write(s)

p='src/rendering/daylight.ts'
s=open(p).read()
old="""    // P12 aerial perspective (studio/aerial-perspective.ts): FogExp2 density
    // at the circuit datum, thinning with altitude in the fog chunk. Clear
    // 0.00055 (26 % contrast loss at 1 km), overcast 0.0008, the 24 mm/h rain
    // preset about 0.0017. The colour is the sky's own horizon radiance away
    // from the sun (greying to the deck and rain); the sun side adds its glow."""
new="""    // FogExp2 density for materials without the local atmosphere (unlit signs
    // and screens near the track): clear 0.00055, overcast 0.0008, the 24 mm/h
    // rain preset about 0.0017. The local atmosphere's aerial perspective uses
    // the sky's own extinction instead (studio/aerial-perspective.ts, from
    // `haze` and the rain). The colour is the sky's own horizon radiance away
    // from the sun (greying to the deck and rain); the sun side adds its glow."""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
