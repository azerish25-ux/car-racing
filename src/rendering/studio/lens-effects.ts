import * as T from 'three';
import type { LightingMode } from '../daylight.ts';
import { H } from '../../simulation/protocol.ts';
import { surfaceDampness } from '../weather-presentation.ts';
import type { BroadcastGradePass } from '../broadcast-grade.ts';
import type { LensBloomPass } from '../lens-bloom.ts';
import { studioUniforms } from './studio-frame.ts';

/**
 * Lens effects (D09 post-lens), behind the `lensEffects` graphics key.
 *
 *  - Sun flare: 4 chromatic ghosts of the bloom's above-threshold signal,
 *    mirrored through the frame centre, in the bloom's final composite. Only
 *    sources bright enough to bloom (the sun disc) can ghost, so an occluded
 *    sun flares nothing; the ghosts fade in as the sun comes within 25° of the
 *    view axis and peak at `flare` (≤ 4 % of the source).
 *  - Lens dirt: a procedural smudge-and-speck mask (no image asset) that
 *    scales the bloom where it lands, so dirt shows only around the sun and
 *    lamps.
 *  - Rain on the lens: for the chase, T-cam and trackside cameras in rain,
 *    20-60 refracting drops of 2-12 px, born and dried on cells by presented
 *    simulation time, smeared outward as speed rises (grade pass).
 *
 * All three are evaluated inside passes that already run (bloom composite,
 * broadcast grade): 0 draw calls. Deterministic: inputs are presented state
 * (H.TIME, H.RAIN, speed) and the camera; held frames are byte-identical.
 */
export const LENS = Object.freeze({
  /** Peak ghost strength relative to the bloom signal. */
  flare: 0.04,
  /** Sun-to-view-axis angles (degrees) where the flare fades in / peaks. */
  flareOuterDeg: 25,
  flareInnerDeg: 8,
  /** Bloom gain on the dirtiest texels (1 + dirt · mask). */
  dirt: 0.9,
  /** ULTRA (energy-conserving bloom): a clean broadcast lens. The dirt gain
   * multiplied the wide veil into the into-the-sun frames. */
  physicalDirt: 0.3,
  /** Rain (mm/h) where drops start / reach full density. */
  rainStart: 0.3,
  rainFull: 8,
  /** Share of drop cells holding a drop at full rain (two layers). */
  dropShare: 0.12,
  /** A drop's shading: a smooth dimming that peaks at its centre and is 0 at
   * its edge (a darker rim read as an outlined ring, shots/rain-review-v2). */
  dropRim: 0.05,
  /** Radius share where a drop's refraction and edge start to fade out, so
   * it melts into the frame instead of ending in a sharp ring. */
  dropSoft: 0.6,
  /** Speed (m/s) where drops are fully streaked. */
  streakSpeed: 60,
});

/** P11 bloom strength: day 0.45, golden hour 0.55, night and wet 0.8.
 * `wetness` is the surface dampness 0..1 (`surfaceDampness`). */
export function bloomStrength(mode: LightingMode, wetness: number) {
  const base = mode === 'night' ? 0.8 : mode === 'sunset' ? 0.55 : 0.45;
  const wet = Number.isFinite(wetness) ? Math.min(1, Math.max(0, wetness)) : 0;
  return base + (0.8 - base) * wet;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Flare weight for the angle between the view axis and the sun (radians). */
export function flareWeight(angle: number) {
  if (!Number.isFinite(angle)) return 0;
  const deg = (angle * 180) / Math.PI;
  return 1 - smooth(LENS.flareInnerDeg, LENS.flareOuterDeg, deg);
}

/** Rain-on-lens drop density for a rain rate (mm/h): 0 when dry. */
export function lensRainAmount(rain: number) {
  return Number.isFinite(rain) ? smooth(LENS.rainStart, LENS.rainFull, rain) : 0;
}

function hash(x: number, y: number, seed: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Procedural lens-dirt mask (R8): soft smudges, finger arcs and specks. */
export function createLensDirt(width = 256, height = 144) {
  const data = new Uint8Array(width * height);
  const field = new Float32Array(width * height);
  const blobs: [number, number, number, number][] = [];
  for (let i = 0; i < 26; i++)
    blobs.push([
      hash(i, 1, 7) * width,
      hash(i, 2, 7) * height,
      6 + 22 * hash(i, 3, 7),
      0.25 + 0.5 * hash(i, 4, 7),
    ]);
  for (let i = 0; i < 140; i++)
    blobs.push([
      hash(i, 5, 9) * width,
      hash(i, 6, 9) * height,
      0.8 + 1.8 * hash(i, 7, 9),
      0.5 + 0.5 * hash(i, 8, 9),
    ]);
  for (const [cx, cy, r, w] of blobs) {
    const x0 = Math.max(0, Math.floor(cx - 2 * r)),
      x1 = Math.min(width - 1, Math.ceil(cx + 2 * r)),
      y0 = Math.max(0, Math.floor(cy - 2 * r)),
      y1 = Math.min(height - 1, Math.ceil(cy + 2 * r));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
        field[y * width + x] += w * Math.exp(-2 * d2);
      }
  }
  // Two wiped arcs, darker inside (cleaner glass).
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / width - 0.5,
        v = y / height - 0.5;
      const ring = Math.abs(Math.hypot(u * 1.6, v + 0.9) - 1.05);
      field[y * width + x] += 0.18 * Math.exp(-((ring / 0.03) ** 2));
      // Corners collect more grime than the centre.
      field[y * width + x] *= 0.55 + 0.9 * (u * u + v * v);
    }
  // Normalised so the grimiest texel is 1 and clean glass stays near 0.
  let peak = 1e-6;
  for (const v of field) peak = Math.max(peak, v);
  for (let i = 0; i < field.length; i++) data[i] = Math.round(255 * (field[i] / peak) ** 1.4);
  const texture = new T.DataTexture(data, width, height, T.RedFormat, T.UnsignedByteType);
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
  texture.colorSpace = T.NoColorSpace;
  texture.name = 'Procedural lens dirt';
  texture.needsUpdate = true;
  return texture;
}

export interface LensUniforms {
  /** Ghost strength (0 = off). */
  lensFlare: T.IUniform<number>;
  /** Dirt gain on the bloom (0 = off). */
  lensDirt: T.IUniform<number>;
  lensDirtMap: T.IUniform<T.Texture | null>;
  /** Rain-on-lens drop density 0..1 (0 = off). */
  lensRain: T.IUniform<number>;
  /** Presented simulation time, seconds. */
  lensTime: T.IUniform<number>;
  /** Streak amount 0..1 from speed. */
  lensStreak: T.IUniform<number>;
}
export function createLensUniforms(): LensUniforms {
  return {
    lensFlare: { value: 0 },
    lensDirt: { value: 0 },
    lensDirtMap: { value: null },
    lensRain: { value: 0 },
    lensTime: { value: 0 },
    lensStreak: { value: 0 },
  };
}

/** The application's shared lens uniforms, bound by identity by the bloom
 * composite and the grade pass. */
export const lensUniforms: LensUniforms = createLensUniforms();

export type LensCamera = 'chase' | 'cockpit' | 'pod' | 'trackside';

/** Per-frame lens state, shared (by identity) with the bloom and grade passes. */
export class LensEffects {
  constructor(readonly uniforms: LensUniforms = lensUniforms) {}
  private dirt: T.DataTexture | null = null;
  private readonly forward = new T.Vector3();
  update(
    enabled: boolean,
    camera: T.Camera,
    view: LensCamera,
    presented: Float32Array,
    speed: number,
    sunDirection: T.Vector3,
    night: boolean,
    physical = false,
  ) {
    const u = this.uniforms;
    u.lensTime.value = Number.isFinite(presented[H.TIME]) ? presented[H.TIME] : 0;
    if (!enabled) {
      u.lensFlare.value = u.lensDirt.value = u.lensRain.value = u.lensStreak.value = 0;
      return;
    }
    if (!this.dirt) u.lensDirtMap.value = this.dirt = createLensDirt();
    camera.getWorldDirection(this.forward);
    const exterior = view !== 'cockpit';
    const angle = this.forward.angleTo(sunDirection);
    u.lensFlare.value = night ? 0 : LENS.flare * flareWeight(angle);
    const dirt = physical ? LENS.physicalDirt : LENS.dirt;
    u.lensDirt.value = exterior ? dirt : dirt * 0.35;
    u.lensRain.value = exterior ? lensRainAmount(presented[H.RAIN]) : 0;
    u.lensStreak.value = smooth(8, LENS.streakSpeed, Math.abs(speed));
  }
  dispose() {
    this.dirt?.dispose();
    this.dirt = null;
    this.uniforms.lensDirtMap.value = null;
  }
}

/** Ghost and dirt terms for the bloom composite (`tGhost` is a coarse bloom level). */
export const LENS_BLOOM_GLSL = /* glsl */ `
uniform sampler2D tGhost;
uniform sampler2D lensDirtMap;
uniform float lensFlare;
uniform float lensDirt;
vec3 lensGhosts(vec2 uv) {
  if (lensFlare <= 0.0) return vec3(0.0);
  vec2 toCentre = vec2(0.5) - uv;
  vec3 sum = vec3(0.0);
  // Four ghosts mirrored through the centre at different scales, each tinted
  // and weighted toward the frame centre (a smaller, rounder ghost far out).
  const vec4 scale = vec4(0.62, 1.18, 1.62, 2.35);
  const vec3 tint0 = vec3(0.55, 0.75, 1.0), tint1 = vec3(1.0, 0.72, 0.42);
  const vec3 tint2 = vec3(0.6, 1.0, 0.7), tint3 = vec3(0.9, 0.6, 1.0);
  for (int i = 0; i < 4; i++) {
    float k = i == 0 ? scale.x : i == 1 ? scale.y : i == 2 ? scale.z : scale.w;
    vec2 g = uv + toCentre * k;
    if (g.x < 0.0 || g.x > 1.0 || g.y < 0.0 || g.y > 1.0) continue;
    float edge = 1.0 - smoothstep(0.1, 0.72, length(g - 0.5) * 1.4142);
    vec3 tint = i == 0 ? tint0 : i == 1 ? tint1 : i == 2 ? tint2 : tint3;
    sum += texture2D(tGhost, g).rgb * tint * edge;
  }
  return sum * lensFlare;
}
float lensDirtGain(vec2 uv) {
  return lensDirt > 0.0 ? 1.0 + lensDirt * texture2D(lensDirtMap, uv).r : 1.0;
}
`;

/** Rain-on-lens refraction for the grade pass: returns the UV to sample and
 * a darkening factor for the drop rims. Expects `resolution`, `tDiffuse`. */
export const LENS_RAIN_GLSL = /* glsl */ `
uniform float lensRain;
uniform float lensTime;
uniform float lensStreak;
float lensHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
// One layer of drops on a grid of cells; returns (uv offset, rim shade).
vec3 lensDropLayer(vec2 px, float cell, float layer) {
  vec2 id = floor(px / cell);
  vec2 local = px - (id + 0.5) * cell;
  // Each cell's drop lives ~5-11 s, at its own phase.
  float phase = lensHash(vec3(id, layer * 13.0 + 1.0));
  float life = 5.0 + 6.0 * lensHash(vec3(id, layer * 13.0 + 2.0));
  float age = fract(lensTime / life + phase);
  float epoch = floor(lensTime / life + phase);
  float seed = lensHash(vec3(id + epoch * 17.0, layer * 13.0 + 3.0));
  if (seed > ${LENS.dropShare.toFixed(3)} * lensRain * (0.35 + 0.65 * lensRain)) return vec3(0.0, 0.0, 1.0);
  float pxScale = resolution.y / 720.0;
  float radius = (2.0 + 10.0 * lensHash(vec3(id + epoch, layer + 4.0))) * pxScale;
  vec2 centre = (vec2(lensHash(vec3(id + epoch, layer + 5.0)), lensHash(vec3(id + epoch, layer + 6.0))) - 0.5)
    * (cell - 2.0 * radius - 4.0);
  // At speed the airflow drags drops outward and down the glass.
  vec2 screen = (id + 0.5) * cell / resolution - 0.5;
  vec2 flow = normalize(screen * vec2(1.0, 0.6) + vec2(0.0, -0.35));
  centre += flow * lensStreak * age * cell * 0.35;
  vec2 d = local - centre;
  float along = dot(d, flow), across = dot(d, vec2(-flow.y, flow.x));
  along /= 1.0 + 2.5 * lensStreak;
  float r = length(vec2(along, across)) / radius;
  // Dry out over the last fifth of the life.
  float wet = 1.0 - smoothstep(0.8, 1.0, age);
  if (r >= 1.0 || wet <= 0.0) return vec3(0.0, 0.0, 1.0);
  float h = sqrt(1.0 - r * r);
  vec2 n = normalize(d + 1e-4) * (1.0 - h);
  // A drop is a small lens: it shows a magnified, inverted patch of the frame.
  // Its thin edge bends less: the refraction fades to 0 at the rim, so the
  // drop meets the frame continuously (no sharp outlined ring; review of
  // shots/rain-review-v1).
  float soft = 1.0 - smoothstep(${LENS.dropSoft.toFixed(3)}, 1.0, r);
  vec2 offset = -n * radius * 1.6 * wet * soft;
  float rim = 1.0 - ${LENS.dropRim.toFixed(3)} * h * soft * wet;
  return vec3(offset, rim);
}
vec3 lensRainSample(vec2 uv) {
  vec2 px = uv * resolution;
  float cell = 46.0 * resolution.y / 720.0;
  vec3 a = lensDropLayer(px, cell, 0.0);
  vec3 b = lensDropLayer(px + cell * 0.5, cell * 1.37, 1.0);
  vec2 offset = (a.xy + b.xy) / resolution;
  vec3 color = texture2D(tDiffuse, uv + offset).rgb;
  return color * a.z * b.z;
}
`;

/** The application's lens state, written once per rendered frame. */
export const lensEffects = new LensEffects();

/**
 * One call per frame before the composer (renderer.draw): the grade profile
 * and its LUT (blended toward the wet LUT by surface dampness), the P11 bloom
 * strength and the lens effects. `profile` is the lighting or 'studio'.
 */
export function postLensFrame(
  grade: BroadcastGradePass,
  bloom: LensBloomPass,
  presented: Float32Array,
  profile: LightingMode | 'studio',
  lensOn: boolean,
  camera: T.Camera,
  view: LensCamera,
  speed: number,
  lens: LensEffects = lensEffects,
) {
  const rain = presented[H.RAIN],
    water = presented[H.WATER];
  const wetness =
    Number.isFinite(rain) && Number.isFinite(water) ? surfaceDampness(rain, water) : 0;
  grade.apply(profile, presented[H.TIME], wetness);
  bloom.strength = bloomStrength(
    profile === 'studio' ? 'day' : profile,
    profile === 'studio' ? 0 : wetness,
  );
  lens.update(
    lensOn,
    camera,
    view,
    presented,
    speed,
    studioUniforms.studioSunDir.value,
    profile === 'night',
    bloom.energyConserving,
  );
}
