import * as T from 'three';
import {
  ATMOSPHERE,
  atmosphereSky,
  luminance,
  type AtmosphereSky,
  type Rgb,
} from './atmosphere.ts';

/** One world-space sun direction for the visible disk, illumination and shadows.
 * Day: about 52 degrees of elevation, the short shadows tucked under the car of
 * the midday references; azimuth as before, so far-shadow and probe bakes keep
 * their orientation. Sunset: about 10 degrees, a long raking golden-hour key. */
export const SUN_OFFSET = Object.freeze(new T.Vector3(-140, 235, -115));
export const SUNSET_OFFSET = Object.freeze(new T.Vector3(-215, 45, -150));
export type LightingMode = 'day' | 'sunset' | 'night';

/**
 * Scene light from the physical atmosphere (atmosphere.ts).
 *
 * Every term the renderer used to author separately is read from the same sky:
 *
 *  - the key's colour and clear-sky strength: top-of-atmosphere sun times the
 *    transmittance along the sun's path (5000 K-ish white at 52 degrees, a deep
 *    gold at the 10 degree golden-hour sun);
 *  - the diffuse sky: the cosine-weighted mean of the same sky view the dome
 *    shows (the PMREM captures the very texels the camera sees);
 *  - cloud lighting: the sun at the cloud layer, the dome above it and the lit
 *    ground below; an overcast deck's base is the light above the deck,
 *    diffusely transmitted;
 *  - the aerial-perspective haze: the sky's own horizon radiance, so distant
 *    hills dissolve into the horizon instead of into an unrelated fog colour.
 *
 * Aerosol haze rises with cloud cover (humid, hazy air under convective and
 * frontal cloud) and toward the golden hour. Three haze levels per lighting
 * (cover 0, 0.5 and 1) are baked and blended linearly, so cover changes never
 * re-bake the atmosphere.
 */
export const SKY_LIGHT = Object.freeze({
  /** Aerosol haze (multiples of ATMOSPHERE.mieScattering) at cover 0, 0.5, 1:
   * aerosol optical depth 0.04, 0.06 and 0.09 by day; a hazier 0.07-0.11 dusk. */
  haze: Object.freeze({
    day: Object.freeze([7, 11, 16] as const),
    sunset: Object.freeze([13, 16, 20] as const),
  }),
  /** Sky luminance factor (Unreal's SkyLuminanceFactor): measured clear-sky
   * diffuse fractions (15-20 % of global irradiance at a 50 degree sun) sit a
   * little above a single-plus-isotropic-multiple scattering model; 1.35 brings
   * the model's 13 % to 18 %. Applies to the dome, its IBL and the haze alike. */
  luminanceFactor: 1.35,
  /** Brightest sun-disc radiance, scene units. The physical disc (~6e4) would
   * overflow half-float targets; through ACES anything above ~30 is white and
   * the bloom pyramid limits each tap, so the clamp is invisible. */
  maxSunDisc: 6000,
  /** Cloud lighting calibration (sky-shader units of the baked terms): the key
   * is 0.42 of the sun at the cloud layer (sunlit tops display just under
   * clip at the day exposure), the in-cloud ambient is the dome above plus
   * multiply scattered sunlight, and a deck base transmits the light above it. */
  cloudKey: 0.5,
  cloudDome: 1.0,
  cloudMultiple: 0.032,
  cloudBounce: 0.12,
  groundTint: Object.freeze([1, 0.95, 0.82] as const),
  /** Share of the sun-side horizon radiance that lights golden-hour bases. */
  horizonGlow: 0.09,
  /** Deck base (the clouds' ambient term) and the dome behind a closing deck,
   * as fractions of the irradiance above the deck: a blue-grey, darker base. */
  deckAmbient: Object.freeze([0.4, 0.44, 0.5] as const),
  deckBackground: Object.freeze([0.116, 0.122, 0.132] as const),
});

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** LIVE sky: the real sun replaces the day and golden-hour presets' key
 * (sky-ephemeris.ts). Night keeps the floodlights' fixed aggregate. Every
 * change bumps `epoch`, which the sun-dependent caches carry in their keys. */
const live = { sun: null as T.Vector3 | null, epoch: 0 };
/** Aim the day/golden-hour sun (null restores the presets). Returns whether
 * the direction changed. */
export function setSkySun(direction: T.Vector3 | null) {
  if (direction && ![direction.x, direction.y, direction.z].every(Number.isFinite))
    throw new Error('Invalid live sun direction');
  if (direction === null ? live.sun === null : live.sun?.equals(direction)) return false;
  live.sun = direction ? Object.freeze(direction.clone()) : null;
  live.epoch++;
  lightCache.clear();
  return true;
}
/** Identity of the current day/golden-hour sun: '' for the presets. */
export function skySunKey() {
  return live.sun ? `@${live.epoch}` : '';
}
/** The sun direction of a lighting (night keeps the day sun as its moon). */
export function skyLightDirection(mode: LightingMode) {
  if (live.sun && mode !== 'night') return live.sun;
  return mode === 'sunset' ? SUNSET_OFFSET : SUN_OFFSET;
}
/** Haze of a lighting at a cover level index (0, 1, 2 = cover 0, 0.5, 1). */
export function skyHaze(mode: LightingMode, level: number) {
  const table = mode === 'sunset' ? SKY_LIGHT.haze.sunset : SKY_LIGHT.haze.day;
  return table[Math.min(2, Math.max(0, Math.round(level)))];
}
/** The two baked atmospheres a cover blends between, and the weight. */
export function skyAtmospheres(cover: number, mode: LightingMode) {
  if (!Number.isFinite(cover)) throw new Error('Non-finite cloud cover');
  const x = Math.min(1, Math.max(0, cover)) * 2,
    lowLevel = Math.min(1, Math.floor(x)),
    weight = x - lowLevel,
    sun = skyLightDirection(mode);
  const low = atmosphereSky(skyHaze(mode, lowLevel), sun);
  // A whole level needs (and bakes) only that level.
  return { low, high: weight > 0 ? atmosphereSky(skyHaze(mode, lowLevel + 1), sun) : low, weight };
}
/** Bake (and cache) every haze level of a lighting: a loading-screen task. */
export function prewarmSky(mode: LightingMode) {
  for (const level of [0, 1, 2]) atmosphereSky(skyHaze(mode, level), skyLightDirection(mode));
}

function blend(
  low: AtmosphereSky,
  high: AtmosphereSky,
  weight: number,
  read: (s: AtmosphereSky) => readonly number[],
): Rgb {
  const a = read(low),
    b = read(high);
  return [lerp(a[0], b[0], weight), lerp(a[1], b[1], weight), lerp(a[2], b[2], weight)];
}
const scale = (c: readonly number[], k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** Unresolved thin cloud: as cover grows, the clear dome whitens toward a
 * slightly blue grey of its own luminance (CPU mirror of the shader). */
export function skyVeil(c: readonly number[], cover: number): Rgb {
  const amount = Math.min(1, Math.max(0, cover)) * 0.3,
    y = luminance(c) * 1.12;
  return [lerp(c[0], y * 0.94, amount), lerp(c[1], y, amount), lerp(c[2], y * 1.1, amount)];
}
/** Share of the dome hidden behind a closing deck (shader: deckAmount). */
export function skyDeckAmount(cover: number) {
  return smooth(0.55, 0.95, cover) * 0.9;
}
/** Share of the sun's key that a cloud layer still receives through gaps. */
export function skySunVisibility(cover: number) {
  return 1 - 0.9 * smooth(0.35, 0.95, cover);
}

export interface SkyLight {
  cover: number;
  mode: LightingMode;
  /** Sun colour at the ground (max channel 1) and its clear-sky irradiance. */
  sunColor: Rgb;
  sunIrradiance: number;
  /** Sky-view radiance scale (ATMOSPHERE.sceneIrradiance x luminance factor). */
  skyScale: number;
  /** Clear-dome cosine-weighted mean radiance, scene units. */
  skyMean: Rgb;
  /** Sun-disc radiance at the disc centre (limb darkening in the shader). */
  sunDisc: Rgb;
  /** Cloud term colours (SKY_CLOUD_LIGHTING) and the dome behind the deck. */
  cloudKey: Rgb;
  cloudAmbient: Rgb;
  cloudBounce: Rgb;
  deck: Rgb;
  /** Clear-sky horizon radiance 3 degrees up, away from and toward the sun. */
  horizonAntiSun: Rgb;
  horizonSunSide: Rgb;
}

const lightCache = new Map<string, SkyLight>();
/** The scene light implied by the sky of a cover and lighting (cached). */
export function skyLight(cloud: number, mode: LightingMode): SkyLight {
  if (!Number.isFinite(cloud)) throw new Error('Non-finite cloud cover');
  if (mode !== 'day' && mode !== 'sunset' && mode !== 'night')
    throw new Error('Invalid circuit lighting mode');
  const cover = Math.min(1, Math.max(0, cloud));
  const key = `${mode}${skySunKey()}:${cover}`;
  const cached = lightCache.get(key);
  if (cached) return cached;
  const { low, high, weight } = skyAtmospheres(cover, mode);
  const irradiance = ATMOSPHERE.sceneIrradiance,
    skyScale = irradiance * SKY_LIGHT.luminanceFactor,
    sun = skyLightDirection(mode).clone().normalize(),
    elevation = Math.max(0.05, sun.y);
  const sunT = blend(low, high, weight, (s) => s.sunTransmittance),
    cloudT = blend(low, high, weight, (s) => s.cloudSunTransmittance),
    skyMean = scale(
      blend(low, high, weight, (s) => s.meanRadiance),
      skyScale,
    ),
    dome = scale(
      blend(low, high, weight, (s) => s.domeRadiance),
      skyScale,
    );
  const peak = Math.max(...sunT, 1e-6);
  const visible = skySunVisibility(cover),
    deck = smooth(0.45, 1, cover),
    // A full deck is a thick nimbostratus: it passes less of the light above.
    thick = 1 - 0.35 * smooth(0.8, 1, cover);
  const sunAtCloud = scale(cloudT, irradiance);
  // Irradiance on top of the cloud layer: the sun plus the dome above it.
  const above = sunAtCloud.map((c, k) => c * elevation + Math.PI * dome[k]);
  const aboveLuma = luminance(above);
  const groundSun = sunT.map((c) => c * irradiance * elevation);
  const cloudAmbient = [0, 1, 2].map((k) =>
    lerp(
      dome[k] * SKY_LIGHT.cloudDome + sunAtCloud[k] * SKY_LIGHT.cloudMultiple,
      aboveLuma * SKY_LIGHT.deckAmbient[k] * lerp(1, above[k] / aboveLuma, 0.5) * thick,
      deck,
    ),
  ) as Rgb;
  const horizon = (azimuth: number) => {
    const r = (3 * Math.PI) / 180,
      sunAz = Math.atan2(sun.z, sun.x),
      a = sunAz + azimuth,
      d = new T.Vector3(Math.cos(r) * Math.cos(a), Math.sin(r), Math.cos(r) * Math.sin(a));
    return scale(
      blend(low, high, weight, (s) => s.radiance(d)),
      skyScale,
    );
  };
  const horizonSun = horizon(0);
  const disc = (Math.PI * ATMOSPHERE.sunAngularRadius ** 2) ** -1 * irradiance;
  const sunDisc = scale(sunT, disc);
  const discPeak = Math.max(...sunDisc);
  const light: SkyLight = {
    cover,
    mode,
    sunColor: sunT.map((c) => c / peak) as Rgb,
    sunIrradiance: luminance(sunT) * irradiance,
    skyScale,
    skyMean,
    sunDisc:
      discPeak > SKY_LIGHT.maxSunDisc ? scale(sunDisc, SKY_LIGHT.maxSunDisc / discPeak) : sunDisc,
    cloudKey: scale(sunAtCloud, SKY_LIGHT.cloudKey * visible),
    cloudAmbient,
    // Bases see the lit ground; at the golden hour those toward the sun also
    // see the glowing horizon beneath them (the bake weights the bounce term
    // toward the sun's azimuth for sunset panoramas).
    cloudBounce: [0, 1, 2].map(
      (k) =>
        (groundSun[k] * visible + Math.PI * skyMean[k]) *
          SKY_LIGHT.cloudBounce *
          SKY_LIGHT.groundTint[k] +
        (mode === 'sunset' ? horizonSun[k] * SKY_LIGHT.horizonGlow * visible : 0),
    ) as Rgb,
    deck: [0, 1, 2].map(
      (k) => aboveLuma * SKY_LIGHT.deckBackground[k] * lerp(1, above[k] / aboveLuma, 0.5) * thick,
    ) as Rgb,
    horizonAntiSun: horizon((115 * Math.PI) / 180),
    horizonSunSide: horizonSun,
  };
  if (lightCache.size > 256) lightCache.clear();
  lightCache.set(key, light);
  return light;
}
