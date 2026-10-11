import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { LightingMode } from '../daylight.ts';
import type { SkyLight } from '../sky-light.ts';

/**
 * Sky clouds (D07): a baked cumulus panorama per cloud-cover bin.
 *
 * The former cloud layer was four octaves of value noise in a flat projection,
 * evaluated twice per sky pixel; it read as grey smudges. Clouds are now a
 * small volumetric bake:
 *
 *  1. A tiling 2D cloud field (once per session): the cumulus footprint (R),
 *     the owning cell's size (G) and peak (B), and cirrus fibres (A). The
 *     footprint is the brightest of four weighted-Worley scales (every cell
 *     a random strength, so cells drop out and the rest come in all sizes:
 *     5 km clusters where a broad field gathers them, 2 km cumulus, 1 km and
 *     500 m fragments) over a domain-warped lattice, modulated by partial
 *     cloud streets and a weather map that clears whole regions, so the sky
 *     has no visible lattice or single cloud size. A 64^3 Worley volume
 *     carves each cloud's top into bulges scaled to its own radius plus a
 *     fixed 370 m cauliflower octave.
 *  2. Per (cover bin, sun direction), a 3072x768 HalfFloat panorama of the
 *     upper hemisphere, rows packed toward the horizon (elevation = v^1.5 x
 *     90 degrees): 0.07 degree rows at 5 degrees up, 0.18 overhead. Each
 *     texel marches its view ray through the layer out to 120 km, so clouds
 *     shrink and crowd through perspective into a hazy horizon bank, and
 *     overhead ones are large. Each texel marches its view ray through a cloud
 *     slab over a curved earth: every cloud is an ellipsoidal dome on a flat
 *     condensation level, 0.7-1.15 times as high as its real footprint radius
 *     (from the field's owner size and peak), its top carved into turrets; two samples toward
 *     the sun give the self-shadow (with a multiple-scattering floor), and a
 *     two-lobe phase function gives the silver lining near the sun, and a
 *     powder term (Schneider 2015) darkens the thin, sun-facing edges of
 *     the cauliflower when seen away from the sun. Above the cumulus, a thin
 *     cirrus sheet at 8.5 km (stretched fibrous noise in the field's alpha)
 *     catches the sun with a strong forward lobe. Distant clouds fade into
 *     the horizon haze.
 *
 * The panorama stores lighting terms, not colours: R = sun-scattered light
 * (phase and self-shadow included), G = skylight from above, B = light
 * bounced up from the sunlit ground (bases), A = opacity; all premultiplied. The
 * sky shader colours them with the sun at the cloud layer, the dome above and
 * the lit ground below, all read from the physical atmosphere (sky-light.ts), so the visible dome and every PMREM capture of a bin share one
 * bake and one colour model.
 *
 * Cost: one draw for the field (first use) and one per panorama bake, paid only
 * when a bin or lighting direction is first needed (load, weather bin change);
 * a frame that reuses cached panoramas draws nothing. The sky shader replaces
 * eight value-noise evaluations per pixel with at most two texture fetches.
 *
 * Determinism: the bake is a pure function of the bin and the sun direction
 * (integer-hash noise, fixed seeds, a per-texel interleaved-gradient offset);
 * no randomness. The dome drifts slowly about the zenith with presented
 * simulation time (`cloudDrift`), so pause, replay and photo hold it; the
 * bake itself never changes with time.
 */
export const SKY_CLOUDS = Object.freeze({
  panoramaWidth: 3072,
  panoramaHeight: 768,
  fieldSize: 2048,
  /** Edge of the tileable 3D detail volume, voxels. */
  detailSize: 64,
  /** Tiling period of the 3D detail (turrets of 100-300 m), metres. */
  detailPeriod: 1100,
  /** Tiling period of the cloud field, metres. */
  fieldPeriod: 24000,
  earthRadius: 6371000,
  /** Primary march steps per panorama texel (more on long, low rays). */
  minSteps: 24,
  maxSteps: 64,
  /** Rays end at this distance; clouds fade into haze before it. */
  maxDistance: 120000,
  /** Distance at which a cloud keeps 1/e of its contrast against the horizon. */
  hazeDistance: 60000,
  /** Wind drift of the cloud dome: one turn about the zenith per 3 hours of
   * presented simulation time (about 0.03 degrees a second: a cumulus 5 km
   * away drifts sideways at 3 m/s, a 30 km one at 17 m/s). */
  driftPerSecond: 1 / 10800,
  /** Cirrus sheet altitude, metres. */
  cirrusAltitude: 8500,
  /** Cached panoramas (19 MB each); two cover bins of the current lighting plus one spare. */
  cacheSize: 3,
});

/** Cloud slab and coverage for a weather cover in [0, 1]. Fair-weather
 * cumulus (cover <= 0.5) sit on a 1400 m base; toward overcast the base lowers
 * and the layer thickens into a closed deck. `threshold` is the field value a
 * column needs to exist at the base; it is calibrated on the baked field so
 * that the clear preset (cover 0.12) shows 15-30 % cloud in the lower 25 degrees
 * of sky. */
export function cloudLayer(cover: number) {
  if (!Number.isFinite(cover)) throw new Error('Non-finite cloud cover');
  const c = Math.min(1, Math.max(0, cover));
  const deck = smooth01((c - 0.45) / 0.55);
  return {
    cover: c,
    threshold: c <= 0 ? 2 : tableAt(CLOUD_THRESHOLDS, c),
    baseAltitude: lerp(1400, 900, deck),
    thickness: lerp(1150, 1800, smooth01(c / 0.9)),
    /** Extinction per metre at density 1. */
    extinction: lerp(0.018, 0.026, deck),
    /** Peak optical depth of the cirrus sheet: fair-weather and broken skies
     * carry high ice cloud; a closing deck hides it. */
    cirrus: c <= 0 ? 0 : 0.26 * smooth01(c / 0.25) * (1 - smooth01((c - 0.55) / 0.35)),
  };
}
/** Field threshold per eighth of cover (index = bin), calibrated on the baked
 * panoramas so the cosine-weighted dome cover grows evenly: 0.15, 0.25, 0.38,
 * 0.52, 0.67, 0.89, 0.98 and 0.98 for bins 1-8 (CLOUD_DOME_MEANS). Bin 0 has none. */
const CLOUD_THRESHOLDS = [0.574, 0.519, 0.48, 0.438, 0.402, 0.372, 0.312, 0.228, 0.083] as const;
function tableAt(table: readonly number[], c: number) {
  const x = c * (table.length - 1),
    i = Math.min(table.length - 2, Math.floor(x));
  return lerp(table[i], table[i + 1], x - i);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function smooth01(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

const QUAD_VERTEX = `precision highp float;
in vec3 position; in vec2 uv; out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`;

const NOISE_GLSL = `
uint cloudHash(uvec3 p) {
  uint h = p.x * 0x8da6b343u ^ p.y * 0xd8163841u ^ p.z * 0xcb1ab31fu;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return h;
}
// Floor-based wrap: GLSL ES leaves % undefined for negative operands.
ivec2 cloudWrap(ivec2 c, int period) {
  return c - period * ivec2(floor(vec2(c) / float(period)));
}
vec2 cloudRandom2(ivec2 c, int period, uint seed) {
  uvec2 w = uvec2(cloudWrap(c, period));
  uint h = cloudHash(uvec3(w, seed));
  return vec2(float(h & 0xffffu), float(h >> 16u)) / 65536.0;
}
// Periodic gradient noise in about [0, 1].
float cloudPerlin(vec2 p, int period, uint seed) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a00 = 6.2831853 * cloudRandom2(i, period, seed).x,
    a10 = 6.2831853 * cloudRandom2(i + ivec2(1, 0), period, seed).x,
    a01 = 6.2831853 * cloudRandom2(i + ivec2(0, 1), period, seed).x,
    a11 = 6.2831853 * cloudRandom2(i + ivec2(1, 1), period, seed).x;
  vec2 g00 = vec2(cos(a00), sin(a00)), g10 = vec2(cos(a10), sin(a10)),
    g01 = vec2(cos(a01), sin(a01)), g11 = vec2(cos(a11), sin(a11));
  float n = mix(mix(dot(g00, f), dot(g10, f - vec2(1.0, 0.0)), u.x),
    mix(dot(g01, f - vec2(0.0, 1.0)), dot(g11, f - vec2(1.0, 1.0)), u.x), u.y);
  return clamp(n * 0.75 + 0.5, 0.0, 1.0);
}
// Periodic inverted Worley (1 - F1): 1 at each cell's feature point.
float cloudWorley(vec2 p, int period, uint seed) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  float d = 4.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      ivec2 c = i + ivec2(x, y);
      vec2 r = vec2(x, y) + cloudRandom2(c, period, seed) - f;
      d = min(d, dot(r, r));
    }
  return 1.0 - clamp(sqrt(d), 0.0, 1.0);
}
// Weighted inverted Worley: the brightest cell of amp * (1 - distance), with
// a random amplitude per cell in [lo, 1]. Unlike plain Worley (exactly one
// equal blob per cell, a regular lattice) many cells fall below any
// threshold and the rest come in every size, irregularly spaced.
// Returns (value, amplitude of the winning cell).
vec2 cloudCells(vec2 p, int period, uint seed, float lo) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 best = vec2(0.0, lo);
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      ivec2 c = i + ivec2(x, y);
      vec2 r = vec2(x, y) + cloudRandom2(c, period, seed) - f;
      float amp = mix(lo, 1.0, cloudRandom2(c, period, seed + 97u).x);
      float value = amp * (1.0 - min(1.0, length(r)));
      if (value > best.x) best = vec2(value, amp);
    }
  return best;
}
`;

/** Tileable 3D detail for the cumulus turrets: inverted Worley F1 at 4, 8 and
 * 16 cells per tile (weights 0.55, 0.3, 0.15), one R8 channel. Built once on
 * the CPU (deterministic integer hash) the first time a panorama is baked. */
export function cloudDetailVolume(size: number = SKY_CLOUDS.detailSize) {
  if (!Number.isInteger(size) || size < 4) throw new Error('Invalid cloud detail size');
  const data = new Uint8Array(size ** 3),
    values = new Float32Array(size ** 3);
  const hash = (x: number, y: number, z: number, seed: number) => {
    let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ seed;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };
  for (const [cells, weight, seed] of [
    [4, 0.55, 11],
    [8, 0.3, 23],
    [16, 0.15, 37],
  ] as const) {
    // One feature point per cell, wrapped so the volume tiles.
    const points = new Float32Array(cells ** 3 * 3);
    for (let z = 0; z < cells; z++)
      for (let y = 0; y < cells; y++)
        for (let x = 0; x < cells; x++) {
          const i = ((z * cells + y) * cells + x) * 3;
          points[i] = x + hash(x, y, z, seed);
          points[i + 1] = y + hash(x, y, z, seed + 1);
          points[i + 2] = z + hash(x, y, z, seed + 2);
        }
    const scale = cells / size;
    for (let z = 0; z < size; z++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const px = (x + 0.5) * scale,
            py = (y + 0.5) * scale,
            pz = (z + 0.5) * scale,
            cx = Math.floor(px),
            cy = Math.floor(py),
            cz = Math.floor(pz);
          let best = 9;
          for (let dz = -1; dz <= 1; dz++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const gx = cx + dx,
                  gy = cy + dy,
                  gz = cz + dz,
                  wx = ((gx % cells) + cells) % cells,
                  wy = ((gy % cells) + cells) % cells,
                  wz = ((gz % cells) + cells) % cells,
                  i = ((wz * cells + wy) * cells + wx) * 3;
                const ex = points[i] + (gx - wx) - px,
                  ey = points[i + 1] + (gy - wy) - py,
                  ez = points[i + 2] + (gz - wz) - pz,
                  d = ex * ex + ey * ey + ez * ez;
                if (d < best) best = d;
              }
          values[(z * size + y) * size + x] += weight * (1 - Math.min(1, Math.sqrt(best)));
        }
  }
  for (let i = 0; i < values.length; i++) data[i] = Math.round(Math.min(1, values[i]) * 255);
  const texture = new T.Data3DTexture(data, size, size, size);
  texture.format = T.RedFormat;
  texture.type = T.UnsignedByteType;
  texture.minFilter = T.LinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = T.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.name = 'Sky cloud 3D detail';
  texture.needsUpdate = true;
  return texture;
}

/** Tiling cloud field. One period of the field spans SKY_CLOUDS.fieldPeriod
 * metres; R holds the footprint, G and B the owning cell's size (relative to
 * the 4.8 km cluster cell) and peak value, A the cirrus fibres. */
const FIELD_FRAGMENT = `precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fieldColor;
${NOISE_GLSL}
void main() {
  vec2 p = vUv;
  float clusters = 0.65 * cloudPerlin(p * 3.0, 3, 21u) + 0.35 * cloudPerlin(p * 7.0, 7, 22u);
  // Cloud streets: rolls along the wind (field x), 3 km apart, wandering, and
  // only where the broad pattern organises them.
  float wander = cloudPerlin(p * 4.0 + 0.7, 4, 23u);
  float streets = mix(1.0, 0.82 + 0.3 * (0.5 + 0.5 * sin(6.2831853 * (p.y * 8.0 + 0.6 * wander))),
    smoothstep(0.45, 0.7, cloudPerlin(p * 2.0 + 0.3, 2, 24u)));
  // A size distribution, not one cell size: the brightest of four Worley
  // scales wins, so 5 km clusters (only where the broad field is high),
  // 2 km cumulus, 1 km and 500 m fragments each keep their own footprint; the
  // smaller scales also texture and merge the larger ones.
  // A periodic domain warp (1.4 km and 360 m) bends the cell lattice.
  vec2 q = p + 0.06 * (vec2(cloudPerlin(p * 3.0 + 0.13, 3, 61u), cloudPerlin(p * 3.0 + 0.71, 3, 62u)) - 0.5) +
    0.015 * (vec2(cloudPerlin(p * 9.0, 9, 63u), cloudPerlin(p * 9.0 + 0.37, 9, 64u)) - 0.5);
  vec2 bigCell = cloudCells(q * 5.0, 5, 14u, 0.6), medCell = cloudCells(q * 11.0, 11, 11u, 0.55),
    smallCell = cloudCells(q * 23.0, 23, 12u, 0.5), tinyCell = cloudCells(q * 47.0, 47, 13u, 0.5);
  float big = bigCell.x, med = medCell.x, small = smallCell.x, tiny = tinyCell.x;
  vec4 gain = vec4(mix(0.5, 0.95, smoothstep(0.42, 0.78, clusters)), mix(0.72, 0.92, clusters), 0.85, 0.78);
  vec4 v = vec4(big, med, small, tiny) * gain;
  float cells = max(max(v.x, v.y), max(v.z, v.w));
  // Weather-map variation: whole regions clear out while others crowd.
  float weather = 0.6 * cloudPerlin(p * 2.0 + 0.5, 2, 65u) + 0.4 * cloudPerlin(p * 5.0, 5, 66u);
  float base = clamp((cells + 0.06 * (small - 0.5) + 0.04 * (tiny - 0.5)) * streets *
    mix(0.86, 1.07, smoothstep(0.3, 0.72, weather)), 0.0, 1.0);
  // The cell that owns this point (blended softly where cells meet): its
  // size (G, relative to the 4.8 km cluster cell) and its peak value (B),
  // from which the bake knows each cloud's real footprint radius.
  vec4 own = exp((v - cells) * 30.0);
  float ownSize = dot(own, vec4(1.0, 5.0 / 11.0, 5.0 / 23.0, 5.0 / 47.0)) / dot(own, vec4(1.0));
  float ownPeak = dot(own, gain * vec4(bigCell.y, medCell.y, smallCell.y, tinyCell.y)) / dot(own, vec4(1.0));
  // Cirrus: fibrous streaks, gradient noise stretched 8:1 along the wind and
  // sheared by a broad warp, gathered into patches by a slow envelope.
  vec2 w = p + 0.06 * vec2(cloudPerlin(p * 4.0, 4, 51u), cloudPerlin(p * 4.0 + 0.5, 4, 52u));
  float fibres = 0.6 * cloudPerlin(vec2(w.x * 5.0, w.y * 30.0), 5, 53u) +
    0.4 * cloudPerlin(vec2(w.x * 10.0, w.y * 60.0), 10, 54u);
  float patches = cloudPerlin(p * 2.0 + 0.25, 2, 56u);
  float cirrus = smoothstep(0.5, 0.85, fibres) * smoothstep(0.5, 0.8, patches);
  fieldColor = vec4(base, ownSize, ownPeak, cirrus);
}`;

/** Equirect upper hemisphere: u = atan(z, x) / 2pi + 0.5, v = elevation / 90 deg. */
const PANORAMA_FRAGMENT = `precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
uniform sampler2D cloudField;
uniform sampler3D cloudDetail;
uniform vec3 sunDirection;
uniform float threshold;
uniform float baseAltitude;
uniform float thickness;
uniform float extinction;
uniform float cirrus;
uniform float horizonGlow;
uniform vec2 resolution;
in vec2 vUv;
out vec4 cloudTerms;
const float PI = 3.141592653589793;
const float EARTH = ${SKY_CLOUDS.earthRadius.toFixed(1)};
const float PERIOD = ${SKY_CLOUDS.fieldPeriod.toFixed(1)};
const float MAX_DISTANCE = ${SKY_CLOUDS.maxDistance.toFixed(1)};
const float HAZE = ${SKY_CLOUDS.hazeDistance.toFixed(1)};
const float CIRRUS = ${SKY_CLOUDS.cirrusAltitude.toFixed(1)};
float shellDistance(float dy, float h) {
  float b = EARTH * dy;
  return -b + sqrt(b * b + 2.0 * EARTH * h + h * h);
}
float altitude(vec3 p) { return length(p + vec3(0.0, EARTH, 0.0)) - EARTH; }
// Cloud density at world point p (camera at the origin), 0..1; column is the
// local column height (0..1) for the skylight that reaches the base.
float density(vec3 p, bool detailed, out float column) {
  column = 0.0;
  float hf = (altitude(p) - baseAltitude) / thickness;
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec2 xz = p.xz / PERIOD;
  vec4 field = texture(cloudField, xz);
  // An independent, rotated and rescaled view breaks the 24 km tiling.
  float broad = texture(cloudField, mat2(0.8, -0.6, 0.6, 0.8) * xz * 0.37 + vec2(0.31, 0.67)).r;
  float base = field.r * mix(0.97, 1.03, broad);
  // Real geometry from the owning cell: footprint radius R and the inset x
  // of this point from the footprint's edge, in metres. A cumulus rises as
  // an ellipsoidal dome 0.7-1.15 R high (humilis to mediocris; clusters cap
  // at the slab), flat on the condensation level.
  float cell = field.g * ${(SKY_CLOUDS.fieldPeriod / 5).toFixed(1)};
  float peak = max(field.b, threshold + 0.02);
  float radius = max((1.0 - threshold / peak) * cell, 1.0);
  float inset = clamp((base - threshold) / peak * cell, 0.0, radius);
  float u = 1.0 - inset / radius;
  float dome = sqrt(max(0.0, 1.0 - u * u));
  float height = min(mix(0.7, 1.15, broad) * radius, 0.95 * thickness) / thickness;
  column = dome * height / 0.95;
  float top = base < threshold ? (base - threshold) * 4.0 - hf : dome * height - hf;
  if (detailed) {
    // The fine 3D octaves fade out with distance before a texel outgrows
    // them (no aliased fringe).
    float fine = 1.0 - smoothstep(8000.0, 20000.0, length(p.xz));
    // True 3D cauliflower: tileable Worley turrets (${SKY_CLOUDS.detailPeriod} m and a third
    // of that), eroding the dome most toward its top and edges.
    // None at the condensation level: the base stays flat.
    // Bulges scaled to the cloud itself (about a third of its radius, so
    // every cumulus has a few towers of differing height whatever its size),
    // then the fixed ${(SKY_CLOUDS.detailPeriod / 3).toFixed(0)} m cauliflower octave.
    float far = 1.0 - smoothstep(30000.0, 60000.0, length(p.xz));
    float bulges = mix(0.58, texture(cloudDetail, p / (radius * 2.4) + vec3(0.21, 0.0, 0.57)).r, far);
    float cauliflower = mix(0.58, texture(cloudDetail, p / ${(SKY_CLOUDS.detailPeriod / 3).toFixed(1)} + 0.37).r, fine);
    float own = hf / max(height, 0.04);
    float rising = smoothstep(0.0, 0.3, own) * (0.3 + 0.7 * min(own, 1.0));
    top -= ((0.58 - bulges) * 2.4 + (0.58 - cauliflower) * 0.7) * height * rising;
  }
  // Crisp cauliflower edges (a soft skin scaled to the cloud, 25-115 m) on
  // a flat condensation level.
  return smoothstep(0.0, 0.02 + 0.08 * height, top) * smoothstep(0.0, 0.03, hf);
}
float phaseHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5);
}
void main() {
  float az = (vUv.x - 0.5) * 2.0 * PI;
  float el = pow(vUv.y, 1.5) * 0.5 * PI;
  vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  float mu = dot(dir, sunDirection);
  // Cirrus sheet: a thin ice layer far above the cumulus, sampled once where
  // the view ray crosses it. Ice crystals scatter strongly forward (g 0.75)
  // with a weak back lobe; the sheet is optically thin, so it is lit almost
  // only by the key and the dome, and fades into the haze toward the horizon.
  vec4 high = vec4(0.0);
  if (cirrus > 0.0) {
    float tc = shellDistance(dir.y, CIRRUS);
    vec2 cp = (dir.xz * tc) / (PERIOD * 2.5) + vec2(0.17, 0.41);
    float fibre = texture(cloudField, mat2(0.93, -0.37, 0.37, 0.93) * cp).a;
    float depth = cirrus * fibre;
    // Fades out well above the horizon, where the sheet's texels would alias.
    float a = (1.0 - exp(-depth)) * smoothstep(0.05, 0.3, dir.y);
    float ice = mix(phaseHG(mu, 0.75), phaseHG(mu, -0.2), 0.25);
    high = vec4(a * min(ice, 6.0) * 0.9, a * 0.85, a * 0.2, a);
  }
  float enter = shellDistance(dir.y, baseAltitude);
  float leave = min(shellDistance(dir.y, baseAltitude + thickness), MAX_DISTANCE);
  if (enter >= leave) { cloudTerms = high; return; }
  float span = leave - enter;
  float dt = span / clamp(span / 160.0, ${SKY_CLOUDS.minSteps}.0, ${SKY_CLOUDS.maxSteps}.0);
  // Interleaved gradient noise: a fixed per-texel offset hides step banding.
  vec2 pixel = floor(vUv * resolution);
  float jitter = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  // Droplet phase function as three lobes relative to isotropic: a sharp
  // forward peak (the silver lining of edges in front of the sun), a broad
  // forward lobe and a weak back lobe; capped so the core never blows out.
  float phase = min(0.45 * phaseHG(mu, 0.85) + 0.3 * phaseHG(mu, 0.45) + 0.25 * phaseHG(mu, -0.2), 9.0);
  // Golden hour: bases toward the sun see the glowing horizon beneath them.
  vec2 hs = normalize(sunDirection.xz + 1e-6), hd = normalize(dir.xz + 1e-6);
  float glow = 1.0 + horizonGlow * 3.0 * pow(max(0.0, dot(hs, hd)), 3.0);
  float transmittance = 1.0, sun = 0.0, sky = 0.0, ground = 0.0, meanT = 0.0, weight = 0.0;
  // Coarse steps through empty air. On reaching cloud, step back and march at
  // a quarter step for as long as the ray stays in cloud (plus a short margin),
  // so silhouettes are crisp and the lighting shows no step contours.
  float t = enter + jitter * dt * 0.35, stepLength = dt;
  int outside = 0;
  for (int i = 0; i < ${SKY_CLOUDS.maxSteps + 64}; i++) {
    if (t >= leave || transmittance < 0.015) break;
    vec3 p = dir * t;
    float column;
    float d = density(p, true, column);
    if (d > 0.001 && stepLength == dt) {
      stepLength = dt * 0.25;
      t = max(enter, t - dt * 0.875);
      outside = 0;
      continue;
    }
    float advance = stepLength;
    t += advance;
    if (stepLength < dt) {
      outside = d > 0.001 ? 0 : outside + 1;
      if (outside >= 6) stepLength = dt;
    }
    if (d <= 0.001) continue;
    float hf = (altitude(p) - baseAltitude) / thickness;
    // Three-step self-shadow toward the sun, out to a kilometre: the shaded
    // flank and the base of a tall cumulus see the sun through its whole body.
    float unused;
    // The nearest sample sees the turrets: crisp light and shade on them.
    float near = density(p + sunDirection * 90.0, true, unused);
    float far = density(p + sunDirection * 380.0, false, unused);
    float farther = density(p + sunDirection * 950.0, false, unused);
    float depth = extinction * (near * 180.0 + far * 520.0 + farther * 650.0);
    // Beer-Lambert with a multiple-scattering floor (no black cores).
    float lit = max(exp(-depth), 0.24 * exp(-depth * 0.25));
    // Powder (Schneider 2015): thin, sun-facing edges have had little depth
    // to build up in-scattered light, so they read darker than the cloud's
    // body when seen away from the sun; toward the sun the silver lining wins.
    lit *= mix(1.0, 1.0 - exp(-2.0 * depth - 0.6), 0.35 * (0.5 - 0.5 * mu));
    // Skylight: tops see the whole dome, a base mostly the sunlit ground below;
    // a taller column above darkens its base (the low-contrast overcast rolls).
    float shade = 1.0 - 0.42 * column * (1.0 - hf);
    // Bases: dim, blue-grey (sky from the side, a little ground from below).
    float ambient = (0.1 + 0.9 * pow(hf, 0.7)) * shade;
    float bounce = 0.22 * pow(1.0 - hf, 2.0) * shade * glow;
    float stepOpacity = 1.0 - exp(-extinction * d * advance);
    float w = transmittance * stepOpacity;
    sun += w * lit * phase;
    sky += w * ambient;
    ground += w * bounce;
    meanT += w * (t - advance * 0.5);
    weight += w;
    transmittance *= 1.0 - stepOpacity;
  }
  float opacity = 1.0 - transmittance;
  if (weight <= 0.0) { cloudTerms = high; return; }
  meanT /= weight;
  // Aerial perspective: distant clouds lose contrast against the horizon haze.
  float haze = exp(-pow(meanT / HAZE, 1.6));
  // The cirrus shows through whatever the cumulus leaves.
  cloudTerms = vec4(sun, sky, ground, opacity) * haze + high * (1.0 - opacity * haze);
}`;

/** Sky-shader declarations (configureSky). The three term colours are the
 * scene-unit light of the bound weather and lighting (sky-light.ts): the key
 * at the cloud layer, the in-cloud ambient (dome and multiple scattering, or
 * a deck's transmitted light) and the bounce from the lit ground. */
export const SKY_CLOUD_UNIFORMS = `
uniform sampler2D cloudLow;
uniform sampler2D cloudHigh;
uniform float cloudWeight;
uniform float cloudReady;
uniform float cloudDrift;
uniform vec3 cloudKey;
uniform vec3 cloudAmbient;
uniform vec3 cloudBounce;
`;
/** Lights the baked terms with the bound colours. */
export const SKY_CLOUD_LIGHTING = `
vec3 skyCloudLight(vec4 terms) {
  return terms.r * cloudKey + terms.g * cloudAmbient + terms.b * cloudBounce;
}
`;
/** Sky-shader sampling of the bound panoramas (premultiplied terms, opacity);
 * rows are packed toward the horizon (v = (elevation / 90 degrees)^(2/3)). */
export const SKY_CLOUD_SAMPLE = `
vec4 skyCloudTerms(vec3 direction) {
  if (cloudReady < 0.5 || direction.y <= 0.0) return vec4(0.0);
  vec2 uv = vec2(atan(direction.z, direction.x) * 0.15915494 + 0.5 + cloudDrift,
    pow(asin(clamp(direction.y, 0.0, 1.0)) * 0.63661977, 0.6666667));
  return mix(texture2D(cloudLow, uv), texture2D(cloudHigh, uv), cloudWeight);
}
`;

/** Cosine-weighted means of the baked terms over the upper hemisphere, per
 * cover bin (index): [opacity, sun (day sun), sun (sunset sun), sky, ground].
 * Measured on the GPU bakes (every second row, every fourth azimuth); the CPU
 * dome model (`skyCosineRadiance`) uses them for the PMREM ground's skylight. */
export const CLOUD_DOME_MEANS: readonly (readonly [number, number, number, number, number])[] =
  Object.freeze([
    [0, 0, 0, 0, 0],
    [0.1479, 0.0913, 0.0407, 0.031, 0.0256],
    [0.2475, 0.1577, 0.0518, 0.0507, 0.0429],
    [0.3825, 0.2132, 0.0587, 0.0737, 0.0669],
    [0.5244, 0.2564, 0.0572, 0.0953, 0.093],
    [0.6685, 0.2714, 0.0452, 0.1161, 0.1196],
    [0.8904, 0.1542, 0.0155, 0.1415, 0.1584],
    [0.9832, 0.0171, 0.0003, 0.138, 0.1673],
    [0.9847, 0.002, 0, 0.1231, 0.1506],
  ] as const);
/** Mean baked terms (premultiplied) of the dome at a cover, blended between
 * neighbouring bins exactly as the dome blends their panoramas. */
export function cloudDomeTerms(cover: number, mode: LightingMode) {
  if (!Number.isFinite(cover)) throw new Error('Non-finite cloud cover');
  const x = Math.min(1, Math.max(0, cover)) * 8,
    i = Math.min(7, Math.floor(x)),
    w = x - i;
  const a = CLOUD_DOME_MEANS[i],
    b = CLOUD_DOME_MEANS[i + 1];
  const at = (k: number) => lerp(a[k], b[k], w);
  return { opacity: at(0), sun: at(mode === 'sunset' ? 2 : 1), sky: at(3), ground: at(4) };
}
/** CPU mirror of SKY_CLOUD_LIGHTING: the scene radiance of premultiplied
 * terms under a sky light (sky-light.ts `skyLight`). */
export function skyCloudLight(
  terms: { sun: number; sky: number; ground: number },
  light: Pick<SkyLight, 'cloudKey' | 'cloudAmbient' | 'cloudBounce'>,
  out: number[] = [0, 0, 0],
) {
  for (let k = 0; k < 3; k++)
    out[k] =
      terms.sun * light.cloudKey[k] +
      terms.sky * light.cloudAmbient[k] +
      terms.ground * light.cloudBounce[k];
  return out;
}

export interface SkyCloudUniforms {
  cloudLow: T.IUniform<T.Texture | null>;
  cloudHigh: T.IUniform<T.Texture | null>;
  cloudWeight: T.IUniform<number>;
  cloudReady: T.IUniform<number>;
  /** Azimuthal drift of the panoramas in turns (presented time, not wall clock). */
  cloudDrift: T.IUniform<number>;
  cloudKey: T.IUniform<T.Vector3>;
  cloudAmbient: T.IUniform<T.Vector3>;
  cloudBounce: T.IUniform<T.Vector3>;
}
/** Fresh, unbound uniforms (no panorama: the dome shows no baked clouds). */
export function createSkyCloudUniforms(): SkyCloudUniforms {
  return {
    cloudLow: { value: null },
    cloudHigh: { value: null },
    cloudWeight: { value: 0 },
    cloudReady: { value: 0 },
    cloudDrift: { value: 0 },
    cloudKey: { value: new T.Vector3() },
    cloudAmbient: { value: new T.Vector3() },
    cloudBounce: { value: new T.Vector3() },
  };
}

/** Panoramas are shared by lightings with one sun direction (day and night). */
export function cloudLightKey(mode: LightingMode) {
  return mode === 'sunset' ? 'sunset' : 'day';
}

type Uniforms = Record<string, T.IUniform>;
function preserve(renderer: T.WebGLRenderer) {
  const target = renderer.getRenderTarget(),
    face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel(),
    viewport = renderer.getViewport(new T.Vector4()),
    scissor = renderer.getScissor(new T.Vector4()),
    scissorTest = renderer.getScissorTest(),
    xr = renderer.xr.enabled,
    autoClear = renderer.autoClear;
  return () => {
    renderer.xr.enabled = xr;
    renderer.autoClear = autoClear;
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
    renderer.setRenderTarget(target, face, mip);
  };
}

/** The cloud panoramas of one sky. `prepare` binds the visible dome's two
 * neighbouring bins (baking any that are missing); `bind` temporarily binds one
 * bin for a PMREM capture of that bin. */
export class SkyClouds {
  private field: T.WebGLRenderTarget | null = null;
  private detail: T.Data3DTexture | null = null;
  private readonly panoramas = new Map<string, T.WebGLRenderTarget>();
  private readonly empty: T.DataTexture;
  private readonly fieldMaterial = new T.RawShaderMaterial({
    name: 'Sky cloud field bake',
    glslVersion: T.GLSL3,
    vertexShader: QUAD_VERTEX,
    fragmentShader: FIELD_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    toneMapped: false,
  });
  private readonly panoramaMaterial = new T.RawShaderMaterial({
    name: 'Sky cloud panorama bake',
    glslVersion: T.GLSL3,
    vertexShader: QUAD_VERTEX,
    fragmentShader: PANORAMA_FRAGMENT,
    uniforms: {
      cloudField: { value: null },
      cloudDetail: { value: null },
      sunDirection: { value: new T.Vector3(0, 1, 0) },
      threshold: { value: 1 },
      baseAltitude: { value: 1400 },
      thickness: { value: 800 },
      extinction: { value: 0.02 },
      cirrus: { value: 0 },
      horizonGlow: { value: 0 },
      resolution: {
        value: new T.Vector2(SKY_CLOUDS.panoramaWidth, SKY_CLOUDS.panoramaHeight),
      },
    },
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    toneMapped: false,
  });
  private readonly quad = new FullScreenQuad(this.fieldMaterial);
  private readonly order: string[] = [];
  bakes = 0;
  fieldBakes = 0;
  private visible = { low: -1, high: -1, weight: 0, light: '' };
  constructor(
    readonly uniforms: SkyCloudUniforms = createSkyCloudUniforms(),
    private readonly sunDirection: (mode: LightingMode) => T.Vector3 = () => new T.Vector3(0, 1, 0),
  ) {
    this.empty = new T.DataTexture(new Uint16Array(4), 1, 1, T.RGBAFormat, T.HalfFloatType);
    this.empty.needsUpdate = true;
  }
  /** Use the uniforms of a configured sky material (configureSky declares them). */
  static forSky(material: T.ShaderMaterial, sunDirection: (mode: LightingMode) => T.Vector3) {
    const u = material.uniforms as Uniforms;
    if (!u.cloudLow || !u.cloudHigh || !u.cloudWeight || !u.cloudReady)
      throw new Error('Sky material has no cloud panorama uniforms');
    return new SkyClouds(u as unknown as SkyCloudUniforms, sunDirection);
  }
  private bakeField(renderer: T.WebGLRenderer) {
    const size = SKY_CLOUDS.fieldSize;
    const target = new T.WebGLRenderTarget(size, size, {
      type: T.UnsignedByteType,
      format: T.RGBAFormat,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      wrapS: T.RepeatWrapping,
      wrapT: T.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    target.texture.name = 'Sky cloud field';
    this.draw(renderer, target, this.fieldMaterial);
    this.fieldBakes++;
    return target;
  }
  private draw(renderer: T.WebGLRenderer, target: T.WebGLRenderTarget, material: T.Material) {
    const restore = preserve(renderer);
    try {
      renderer.xr.enabled = false;
      renderer.autoClear = true;
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      this.quad.material = material;
      this.quad.render(renderer);
    } finally {
      restore();
    }
  }
  /** The panorama of `bin` (0..8) for a lighting, baked on first use. Bin 0
   * (no cover) is the empty texture. */
  panorama(renderer: T.WebGLRenderer, bin: number, mode: LightingMode): T.Texture {
    if (!Number.isInteger(bin) || bin < 0 || bin > 8) throw new Error('Invalid cloud bin');
    const layer = cloudLayer(bin / 8);
    if (layer.threshold >= 1) return this.empty;
    const key = `${cloudLightKey(mode)}:${bin}`;
    const cached = this.panoramas.get(key);
    if (cached) {
      this.touch(key);
      return cached.texture;
    }
    if (!this.field) this.field = this.bakeField(renderer);
    const target = new T.WebGLRenderTarget(SKY_CLOUDS.panoramaWidth, SKY_CLOUDS.panoramaHeight, {
      type: T.HalfFloatType,
      format: T.RGBAFormat,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      wrapS: T.RepeatWrapping,
      wrapT: T.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    target.texture.name = `Sky cloud panorama ${key}`;
    const u = this.panoramaMaterial.uniforms;
    u.cloudField.value = this.field.texture;
    u.cloudDetail.value = this.detail ??= cloudDetailVolume();
    (u.sunDirection.value as T.Vector3).copy(this.sunDirection(mode)).normalize();
    u.threshold.value = layer.threshold;
    u.baseAltitude.value = layer.baseAltitude;
    u.thickness.value = layer.thickness;
    u.extinction.value = layer.extinction;
    u.cirrus.value = layer.cirrus;
    u.horizonGlow.value = cloudLightKey(mode) === 'sunset' ? 1 : 0;
    try {
      this.draw(renderer, target, this.panoramaMaterial);
    } catch (error) {
      target.dispose();
      throw error;
    } finally {
      u.cloudField.value = null;
      u.cloudDetail.value = null;
    }
    this.bakes++;
    this.panoramas.set(key, target);
    this.touch(key);
    return target.texture;
  }
  private touch(key: string) {
    const i = this.order.indexOf(key);
    if (i >= 0) this.order.splice(i, 1);
    this.order.push(key);
  }
  /** Drop the least recently used panoramas beyond the cache size, never one
   * in `keep` (bound to the dome or to a capture). */
  private evict(keep: ReadonlySet<T.Texture | null>) {
    while (this.order.length > SKY_CLOUDS.cacheSize) {
      const index = this.order.findIndex((k) => !keep.has(this.panoramas.get(k)!.texture));
      if (index < 0) break;
      const [key] = this.order.splice(index, 1);
      this.panoramas.get(key)!.dispose();
      this.panoramas.delete(key);
    }
  }
  /** Bind the visible dome's clouds for a cover and lighting. Returns true
   * when a binding changed. Bakes only missing panoramas. */
  prepare(renderer: T.WebGLRenderer, cover: number, mode: LightingMode) {
    if (!Number.isFinite(cover)) throw new Error('Non-finite cloud cover');
    const position = Math.min(1, Math.max(0, cover)) * 8,
      low = Math.floor(position),
      high = Math.ceil(position),
      weight = position - low,
      light = cloudLightKey(mode);
    const v = this.visible;
    if (v.low === low && v.high === high && v.weight === weight && v.light === light) return false;
    const lowTexture = this.panorama(renderer, low, mode),
      highTexture = high === low ? lowTexture : this.panorama(renderer, high, mode);
    this.uniforms.cloudLow.value = lowTexture;
    this.uniforms.cloudHigh.value = highTexture;
    this.uniforms.cloudWeight.value = weight;
    this.uniforms.cloudReady.value = 1;
    this.visible = { low, high, weight, light };
    this.evict(new Set([lowTexture, highTexture]));
    return true;
  }
  /** Bind one bin (PMREM capture of that bin). Returns the restore function. */
  bind(renderer: T.WebGLRenderer, bin: number, mode: LightingMode) {
    const u = this.uniforms;
    const previous = {
      low: u.cloudLow.value,
      high: u.cloudHigh.value,
      weight: u.cloudWeight.value,
      ready: u.cloudReady.value,
    };
    const texture = this.panorama(renderer, bin, mode);
    this.evict(new Set([texture, previous.low, previous.high]));
    u.cloudLow.value = u.cloudHigh.value = texture;
    u.cloudWeight.value = 0;
    u.cloudReady.value = 1;
    return () => {
      u.cloudLow.value = previous.low;
      u.cloudHigh.value = previous.high;
      u.cloudWeight.value = previous.weight;
      u.cloudReady.value = previous.ready;
    };
  }
  /** The baked cloud field (null before the first panorama bake): the
   * footprint the scene's cloud shadows sample (cloud-shadow.ts). */
  get fieldTexture() {
    return this.field?.texture ?? null;
  }
  /** The baked panorama texture of a bin if cached (diagnostics, lookdev). */
  cached(bin: number, mode: LightingMode) {
    return this.panoramas.get(`${cloudLightKey(mode)}:${bin}`)?.texture ?? null;
  }
  diagnostics() {
    return {
      bakes: this.bakes,
      fieldBakes: this.fieldBakes,
      cached: [...this.order],
      visible: { ...this.visible },
      bytes:
        this.panoramas.size * SKY_CLOUDS.panoramaWidth * SKY_CLOUDS.panoramaHeight * 8 +
        (this.field ? SKY_CLOUDS.fieldSize ** 2 * 4 : 0) +
        (this.detail ? SKY_CLOUDS.detailSize ** 3 : 0),
      stationary: false,
      drift: 'presented-time',
    };
  }
  dispose() {
    for (const target of this.panoramas.values()) target.dispose();
    this.panoramas.clear();
    this.order.length = 0;
    this.field?.dispose();
    this.field = null;
    this.empty.dispose();
    this.fieldMaterial.dispose();
    this.detail?.dispose();
    this.detail = null;
    this.panoramaMaterial.dispose();
    this.quad.dispose();
    const u = this.uniforms;
    u.cloudLow.value = u.cloudHigh.value = null;
    u.cloudReady.value = 0;
    u.cloudWeight.value = 0;
    this.visible = { low: -1, high: -1, weight: 0, light: '' };
  }
}
