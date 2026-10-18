import * as T from 'three';
import type { PhotoSky } from '../assets/photo-sky.ts';
import { SKY_RAMPS, skyBlend } from '../assets/sky-catalogue.ts';
import { skyCosineRadiance, type LightingMode, type PhotoSkyBinding } from '../daylight.ts';
import { SkyClouds, type SkyCloudUniforms } from '../studio/sky-clouds.ts';
import { festivalSkyline } from './festival-atmosphere.ts';

/**
 * The festival's sky (render only): the photographed dome with the baked
 * volumetric clouds of the procedural dome laid over it.
 *
 * The references' day skies are never empty (FH6 001, 002, 012, 018, 021,
 * 036, 039, 047, 049, 082, 094, 095): fair-weather cumulus with sunlit tops
 * and blue-grey bases cover about a quarter to a half of the visible sky,
 * cirrus streaks run above them (018, 036), and the blue between them is
 * deep (#699fda-#799dd9, linear B/R about 4). The region's clear-day photo
 * (kiara-5-noon) has that blue but not one cloud, and its desert skyline is
 * masked (festival-atmosphere.ts), which left a pale, empty gradient. Here:
 *
 *  - the cloud panoramas of sky-clouds.ts (ray-marched cumulus and a cirrus
 *    sheet, lit by this lighting's sun and sky, drifting with presented
 *    time) are composited over the cloud-free photos (`photoClouds`), in the
 *    visible dome and in every PMREM capture, so the clouds light the scene
 *    and stand in car paint and wet roads;
 *  - the clouds never fall below a fair-weather floor per lighting
 *    (`FESTIVAL_SKY.cloudFloor`); the key light, haze and deck keep the
 *    simulated cover, so a clear preset is fair weather with the sun out;
 *  - the photo's raised skyline and the band under it (festivalSkyline) also
 *    apply in the captures, so reflections no longer show desert mesas.
 *
 * LOW (no photographs) keeps the procedural dome, with the same cloud floor.
 */
export const FESTIVAL_SKY = Object.freeze({
  /** Least cover the baked clouds show, per lighting: day bin 3 (38 % of the
   * cosine-weighted dome; refs 021/039/082/095 about 30-55 % of the frame's
   * sky, 001/020/094 15-25 %), a broken golden-hour sky (bin 2, 24 %), and
   * moonlit cumulus by night (028). */
  cloudFloor: Object.freeze({ day: 0.375, sunset: 0.25, night: 0.25 } as const),
  /** Photographs without clouds of their own (the clear day and the moonlit
   * night): the baked clouds are laid over them. The others (broken golden
   * hour, overcast) keep only their own clouds. */
  clearPhotos: Object.freeze(['kiara-5-noon', 'kloppenheim-02'] as const),
  /** Share of the festival horizon colour in the band under a photo's
   * skyline, by lighting. */
  horizonAmount: Object.freeze({ day: 1, sunset: 1, night: 0.6 } as const),
  /** Chroma and luminance of the visible photograph above its skyline
   * (chroma gain, ramp in degrees, luminance gain). The references' blue
   * between the clouds is deeper than the clear-day photo's: #699fda-#799dd9
   * (linear B/R 3.7-4.9, Y 0.30-0.33) 25-35 degrees up where the photo showed
   * #92addf (B/R 2.6, Y 0.42); the horizon stays pale (036 #a6c1e6), so the
   * grade rises from the skyline over 25 degrees. By night the moonlit photo
   * deepens to the references' navy (072 #1b2644, 028 #24344e). Captures
   * (lighting, reflections) keep the photo's own colour. */
  tone: Object.freeze({
    day: Object.freeze([1.75, 25, 0.88] as const),
    sunset: Object.freeze([1.1, 15, 1] as const),
    night: Object.freeze([1.6, 15, 1] as const),
  }),
  /** Tint of the visible photograph above its skyline (rgb gain, unit
   * luminance). Golden hour: the sky away from the sun is lilac in the
   * references (032 #bdb6d2, R/G 1.09, B/G 1.38; 029 #e9e6f7; 061 #a29eda)
   * where the broken-cloud evening photo reads blue-grey (#9da9be, R/G 0.85),
   * in the hue of the golden-hour haze under it (FESTIVAL_AIR.hazeTint). */
  tint: Object.freeze({
    day: Object.freeze([1, 1, 1] as const),
    sunset: Object.freeze([1.2, 0.96, 1.02] as const),
    night: Object.freeze([1, 1, 1] as const),
  }),
});

/** Cover the festival's baked clouds show for a simulated cover. */
export function festivalCloudCover(cover: number, mode: LightingMode) {
  if (!Number.isFinite(cover)) throw new Error('Non-finite cloud cover');
  return Math.max(Math.min(1, Math.max(0, cover)), FESTIVAL_SKY.cloudFloor[mode]);
}

const clearPhoto = (id: string) => (FESTIVAL_SKY.clearPhotos as readonly string[]).includes(id);
/** Share of the baked clouds over a photographed pair (a crossfade toward a
 * cloudy photo fades them out with it). */
export function festivalPhotoClouds(pair: { a: string; b: string } | null, weight: number) {
  if (!pair) return 0;
  const w = pair.a === pair.b ? 0 : Math.min(1, Math.max(0, weight));
  return (clearPhoto(pair.a) ? 1 - w : 0) + (clearPhoto(pair.b) ? w : 0);
}

/** The dome's cloud panoramas, never below the festival's cloud floor (the
 * visible dome and each PMREM bin alike). */
export class FestivalSkyClouds extends SkyClouds {
  static forFestival(material: T.ShaderMaterial, sunDirection: (mode: LightingMode) => T.Vector3) {
    const u = material.uniforms as Record<string, T.IUniform>;
    if (!u.cloudLow || !u.cloudHigh || !u.cloudWeight || !u.cloudReady)
      throw new Error('Sky material has no cloud panorama uniforms');
    return new FestivalSkyClouds(u as unknown as SkyCloudUniforms, sunDirection);
  }
  override prepare(renderer: T.WebGLRenderer, cover: number, mode: LightingMode) {
    return super.prepare(renderer, festivalCloudCover(cover, mode), mode);
  }
  override bind(renderer: T.WebGLRenderer, bin: number, mode: LightingMode) {
    return super.bind(renderer, Math.round(festivalCloudCover(bin / 8, mode) * 8), mode);
  }
}

/**
 * The festival's binding of its photographed sky (SkyEnvironment and the
 * visible dome): the photo, its raised skyline and horizon band, and the
 * baked clouds over a cloud-free photo.
 */
export class FestivalSky implements PhotoSkyBinding {
  /** Festival horizon (linear, scene units): the aerial in-scatter. */
  readonly horizon = new T.Color();
  /** Share of the baked clouds in the dome of the last visible bind: the
   * photo's `photoClouds`, or 1 for the procedural dome (no photograph). */
  capturedClouds = 1;
  constructor(readonly photo: PhotoSky) {}
  get key() {
    return this.photo.key;
  }
  fogPalette(cover: number, mode: LightingMode) {
    return this.photo.fogPalette(cover, mode);
  }
  bind(material: T.ShaderMaterial, cover: number, mode: LightingMode, capture: boolean) {
    const bound = this.photo.bind(material, cover, mode, capture);
    const u = material.uniforms;
    if (!bound) {
      if (u.photoClouds) u.photoClouds.value = 0;
      if (!capture) this.capturedClouds = 1;
      return false;
    }
    // The visible bind reports its pair; a capture binds this bin's ramp pair.
    const pair = capture
        ? skyBlend(SKY_RAMPS[this.photo.palette][mode], cover)
        : this.photo.shownPair,
      weight = (u.photoWeight?.value as number | undefined) ?? 0;
    festivalSkyline(material, pair, this.horizon, FESTIVAL_SKY.horizonAmount[mode]);
    const clouds = festivalPhotoClouds(pair, weight);
    if (u.photoClouds) u.photoClouds.value = clouds;
    if (!capture) this.capturedClouds = clouds;
    const [chroma, ramp, luminance] = FESTIVAL_SKY.tone[mode];
    (u.photoTone?.value as T.Vector4 | undefined)?.set(
      chroma,
      (ramp * Math.PI) / 180,
      luminance,
      0,
    );
    const [r, g, b] = FESTIVAL_SKY.tint[mode];
    (u.photoTint?.value as T.Vector3 | undefined)?.set(r, g, b);
    return true;
  }
}

/**
 * The festival camera and sky light over the shared lighting state
 * (circuitLightState), from the references' luminance histograms.
 *
 * Exposure per lighting, with the eye adaptation of the golden hour: the low
 * sun makes the frame's brightness depend on where the camera looks. Away
 * from the sun the shared 1.62 left the spawn street at a linear mean of 0.15
 * and a median luma of 0.26 (refs 032/063 and the sunlit sides of 017/098:
 * 0.27-0.34, 0.35-0.46), x1.6 brings it to 0.20-0.21 / 0.32-0.37; into the
 * sun the hazy glow already read 0.58 / 0.85 (017: 0.31 / 0.41, 098 0.28 /
 * 0.35), so the camera closes to x0.75 as it turns toward the sun
 * (`intoSun`, by the horizontal facing, `festivalLight`).
 *
 * Diffuse sky share. The fair-weather clouds the festival shows over the
 * simulated cover brighten the captured dome (white cumulus outshine the blue
 * sky): at the clear preset the open shadow on the spawn street rose 2.4x and
 * sunlit/shaded asphalt fell from 4.7:1 to 2.9:1, where the references keep
 * the crisp midday key of 4-6:1 (shade 012 #44423d vs #1b1d20, 020, 094).
 * Where the baked clouds are in the captured dome (the clear-day photo, the
 * procedural dome) the diffuse IBL is scaled back to the dome of the
 * simulated cover (`festivalEnvironment`); always times `diffuse`. The CPU
 * dome model under-reads the bright cloud sides of the capture (it predicts
 * x1.6 where shade rose x2.4), so `diffuse` by day is set on the fixed street
 * view: 0.9 left lit/shaded asphalt at 0.072/0.017 (4.3:1), 0.75 restores
 * the pre-cloud 5:1. The specular gain (ibl-energy.ts) keeps reflections at
 * the dome's full radiance, clouds included.
 */
export const FESTIVAL_LIGHT = Object.freeze({
  exposure: Object.freeze({ day: 1, sunset: 1.6, night: 1 } as const),
  intoSun: Object.freeze({ day: 1, sunset: 0.75, night: 1 } as const),
  diffuse: Object.freeze({ day: 0.75, sunset: 0.9, night: 1 } as const),
});
const Y = (c: T.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/** Diffuse sky share for a simulated cover when the dome carries the
 * festival's baked clouds (`clouds` 0-1): the cosine-weighted radiance of the
 * dome at that cover over the one the festival shows (CPU dome model). */
export function festivalEnvironment(cover: number, mode: LightingMode, clouds = 1) {
  if (mode === 'night') return FESTIVAL_LIGHT.diffuse.night;
  const shown = Y(skyCosineRadiance(festivalCloudCover(cover, mode), mode)),
    ratio = Y(skyCosineRadiance(cover, mode)) / Math.max(shown, 1e-6),
    share = Math.min(1, Math.max(0, clouds));
  return (1 + (ratio - 1) * share) * FESTIVAL_LIGHT.diffuse[mode];
}
/** Exposure multiplier for a lighting and the camera's horizontal facing
 * toward the sun (cosine, -1 away .. 1 into it). */
export function festivalExposure(mode: LightingMode, facing = -1) {
  const t = Math.min(1, Math.max(0, (facing + 0.1) / 1)),
    k = t * t * (3 - 2 * t);
  return (
    FESTIVAL_LIGHT.exposure[mode] +
    (FESTIVAL_LIGHT.intoSun[mode] - FESTIVAL_LIGHT.exposure[mode]) * k
  );
}
/** Apply the festival camera and sky light to a frame's lighting state (in
 * place; night keeps its own authored fill). `clouds`: share of the baked
 * clouds in the captured dome (FestivalSky.capturedClouds); `facing`: the
 * camera's horizontal facing toward the sun. */
export function festivalLight<L extends { exposure: number; environment: number; cover: number }>(
  light: L,
  mode: LightingMode,
  clouds = 1,
  facing = -1,
) {
  light.exposure *= festivalExposure(mode, facing);
  if (mode !== 'night') light.environment *= festivalEnvironment(light.cover, mode, clouds);
  return light;
}
/** Horizontal facing of a view direction toward a sun direction (cosine). */
export function sunFacing(view: T.Vector3, sun: T.Vector3) {
  const v = Math.hypot(view.x, view.z),
    s = Math.hypot(sun.x, sun.z);
  return v > 1e-6 && s > 1e-6 ? (view.x * sun.x + view.z * sun.z) / (v * s) : 0;
}
