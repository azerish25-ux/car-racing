import * as T from 'three';

/**
 * Procedural colour LUTs (D09 post-lens, ART_BIBLE_A §3.4).
 *
 * The broadcast grade (contrast S-curve, split tone, vibrance, vignette) is
 * global. The F1 25 look also has hue-selective moves a global grade cannot
 * make: a deeper, cleaner sky blue, foliage pulled back toward olive instead of
 * the saturated lime a sRGB pipeline produces, and liveries that keep their hue.
 * Each profile is a 32³ display-referred LUT generated on the CPU (no image
 * assets), applied in the grade pass after the global grade (one trilinear
 * fetch, two while blending toward the wet LUT; 0 draw calls).
 *
 * Moves (all smooth in hue, saturation and value, so the lattice interpolates
 * without seams):
 *  - sky: hues 190-232°, saturation 0.08-0.7, value > 0.45 gain saturation and
 *    lean ≤ 3° toward 214°, a touch darker (a deeper blue overhead);
 *  - foliage: hues 62-150° lose `foliage` of their saturation;
 *  - saturated colours (liveries, kerbs, HUD-like paint) move ≤ 5° in hue
 *    (only the sky lean rotates hue at all).
 */
export type GradeLutProfile = 'day' | 'sunset' | 'night' | 'studio' | 'wet';
export const GRADE_LUT_SIZE = 32;

export interface GradeLutShape {
  /** Saturation gain in the sky band (1 = none). */
  sky: number;
  /** Value scale in the sky band. */
  skyValue: number;
  /** Fraction of saturation removed from foliage hues. */
  foliage: number;
  /** Global saturation scale applied last (wet and night desaturate). */
  saturation: number;
  /** Shadow cool lift: blue added below value 0.25, in display units. */
  shadowCool: number;
}
export const GRADE_LUT_SHAPES: Readonly<Record<GradeLutProfile, Readonly<GradeLutShape>>> =
  Object.freeze({
    // The physical sky (atmosphere.ts) is already as deep as a real one; the
    // former 1.1 rescue of the washed-out analytic dome now over-cooks it.
    day: { sky: 1.03, skyValue: 0.99, foliage: 0.08, saturation: 1, shadowCool: 0.006 },
    sunset: { sky: 1.03, skyValue: 0.99, foliage: 0.1, saturation: 1, shadowCool: 0.01 },
    night: { sky: 1.02, skyValue: 1, foliage: 0.12, saturation: 0.95, shadowCool: 0.008 },
    studio: { sky: 1, skyValue: 1, foliage: 0, saturation: 1, shadowCool: 0 },
    wet: { sky: 1.02, skyValue: 1, foliage: 0.12, saturation: 0.92, shadowCool: 0.008 },
  });
/** The largest hue rotation (degrees) the sky lean may apply. */
export const GRADE_LUT_MAX_HUE_SHIFT = 3;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Band weight for hue `h` (degrees) inside [lo, hi] with `soft` degree edges. */
const band = (h: number, lo: number, hi: number, soft: number) =>
  smooth(lo - soft, lo + soft, h) * (1 - smooth(hi - soft, hi + soft, h));

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max > 0 ? d / max : 0, max];
}
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s,
    hp = (((h % 360) + 360) % 360) / 60,
    x = c * (1 - Math.abs((hp % 2) - 1)),
    m = v - c;
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** CPU definition of a profile's LUT: display RGB (0..1) in, display RGB out. */
export function gradeLutColor(
  profile: GradeLutProfile,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const shape = GRADE_LUT_SHAPES[profile];
  if (!shape) throw new Error(`Unknown grade LUT profile "${profile}"`);
  if (![r, g, b].every(Number.isFinite)) throw new Error('Invalid grade LUT input');
  let [h, s, v] = rgbToHsv(r, g, b);
  // Sky band: muted to mid-saturation light blues.
  const sky =
    band(h, 190, 232, 10) * smooth(0.06, 0.16, s) * (1 - smooth(0.6, 0.8, s)) * smooth(0.4, 0.6, v);
  if (sky > 0) {
    s = Math.min(1, s * (1 + (shape.sky - 1) * sky));
    v *= 1 + (shape.skyValue - 1) * sky;
    const lean = Math.max(-1, Math.min(1, (214 - h) / 12));
    h += lean * GRADE_LUT_MAX_HUE_SHIFT * sky * (shape.sky > 1 ? 1 : 0);
  }
  // Foliage: greens and yellow-greens lose some saturation (olive, not lime).
  const foliage = band(h, 62, 150, 12) * smooth(0.05, 0.2, s);
  s *= 1 - shape.foliage * foliage;
  s *= shape.saturation;
  const rgb = hsvToRgb(h, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, v)));
  let [ro, , bo] = rgb;
  const go = rgb[1];
  // A slight cool lift in the deepest shadows (never on black itself).
  // Near-neutral shadows only: saturated darks (liveries) keep their hue.
  const cool =
    shape.shadowCool * smooth(0, 0.08, v) * (1 - smooth(0.12, 0.3, v)) * (1 - smooth(0.1, 0.4, s));
  bo += cool;
  ro -= cool * 0.25;
  return [Math.min(1, Math.max(0, ro)), Math.min(1, Math.max(0, go)), Math.min(1, Math.max(0, bo))];
}

/** Build a profile's 32³ RGBA half-float LUT texture (red fastest, then green, then blue). */
export function createGradeLut(profile: GradeLutProfile, size = GRADE_LUT_SIZE) {
  const data = new Uint16Array(size * size * size * 4);
  const one = T.DataUtils.toHalfFloat(1);
  for (let bz = 0; bz < size; bz++)
    for (let gy = 0; gy < size; gy++)
      for (let rx = 0; rx < size; rx++) {
        const out = gradeLutColor(profile, rx / (size - 1), gy / (size - 1), bz / (size - 1));
        const i = ((bz * size + gy) * size + rx) * 4;
        data[i] = T.DataUtils.toHalfFloat(out[0]);
        data[i + 1] = T.DataUtils.toHalfFloat(out[1]);
        data[i + 2] = T.DataUtils.toHalfFloat(out[2]);
        data[i + 3] = one;
      }
  const texture = new T.Data3DTexture(data, size, size, size);
  texture.type = T.HalfFloatType;
  texture.format = T.RGBAFormat;
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = T.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.colorSpace = T.NoColorSpace;
  texture.name = `Grade LUT ${profile}`;
  texture.needsUpdate = true;
  return texture;
}

/** Lazily built LUTs, one per profile, shared by every grade pass. */
const cache = new Map<GradeLutProfile, T.Data3DTexture>();
export function gradeLut(profile: GradeLutProfile) {
  let texture = cache.get(profile);
  if (!texture) cache.set(profile, (texture = createGradeLut(profile)));
  return texture;
}
