/** Deterministic lattice noise for the festival region (no Math.random, no
 * platform RNG). Every value is a pure function of integer-hashed lattice
 * points, a 32-bit seed and the query coordinates, so the physics worker, the
 * terrain streaming worker and the main thread evaluate identical heights from
 * the same seed. Cross-engine float equality is not claimed (masterplan §6.5);
 * within one JavaScript engine the results are bit-identical. */

/** 32-bit integer hash of a lattice point (x, z) and a seed. */
export function hash2(x: number, z: number, seed: number) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Lattice value in [0, 1). */
export const hash01 = (x: number, z: number, seed: number) => hash2(x, z, seed) / 4294967296;
/** Mix a seed with a small salt (stable sub-streams per feature). */
export const subSeed = (seed: number, salt: number) => hash2(salt, 0x5eed, seed) | 0;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 16 evenly spaced unit gradients. */
const GX = new Float64Array(16),
  GZ = new Float64Array(16);
for (let i = 0; i < 16; i++) {
  GX[i] = Math.cos((i * Math.PI) / 8);
  GZ[i] = Math.sin((i * Math.PI) / 8);
}
/** Gradient (Perlin-style) noise in about [-1, 1]: hashed unit gradients at
 * lattice points with quintic interpolation. Unlike value noise it has no
 * blocky lattice-aligned plateaus, which matters under raking light. */
export function valueNoise(x: number, z: number, seed: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz,
    u = fade(fx),
    v = fade(fz);
  const h00 = hash2(ix, iz, seed) & 15,
    h10 = hash2(ix + 1, iz, seed) & 15,
    h01 = hash2(ix, iz + 1, seed) & 15,
    h11 = hash2(ix + 1, iz + 1, seed) & 15;
  const a = GX[h00] * fx + GZ[h00] * fz,
    b = GX[h10] * (fx - 1) + GZ[h10] * fz,
    c = GX[h01] * fx + GZ[h01] * (fz - 1),
    d = GX[h11] * (fx - 1) + GZ[h11] * (fz - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.414;
}
/** Fractal sum normalised to about [-1, 1]. `minWavelength` (in the caller's
 * units of 1/frequency) drops octaves finer than the sampling can represent,
 * which is both an anti-aliasing filter for coarse terrain LODs and a cost
 * bound; physics and the near LOD always pass the same value. */
export function fbm(
  x: number,
  z: number,
  seed: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
) {
  let sum = 0,
    amplitude = 1,
    norm = 0,
    frequency = 1;
  for (let i = 0; i < octaves; i++) {
    // Rotate each octave a little so lattice axes do not line up.
    const c = 0.8, s = 0.6;
    const rx = x * frequency,
      rz = z * frequency;
    sum += amplitude * valueNoise(rx * c - rz * s + i * 17.3, rx * s + rz * c - i * 11.1, seed + i * 977);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}
/** Ridged multifractal in [0, 1]: sharp crests for mountain ranges. */
export function ridged(x: number, z: number, seed: number, octaves: number) {
  let sum = 0,
    amplitude = 0.5,
    frequency = 1,
    weight = 1,
    norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(valueNoise(x * frequency + i * 5.7, z * frequency - i * 3.1, seed + i * 613));
    n *= n * weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}
/** Hermite smoothstep (scalar, clamped). */
export function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
