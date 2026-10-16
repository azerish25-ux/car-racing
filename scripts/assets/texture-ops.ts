/**
 * Pixel operations for third-party texture sets (scripts/assets/build-third-party.ts):
 * raw RGB I/O through ImageMagick, seamless tile re-synthesis, normals from
 * relief, normal recentring and the linear means a shader normalises by.
 * Node only; images are float RGB in [0, 1] as stored (sRGB-encoded colour
 * stays encoded until `meanLinear`).
 */
import { execFileSync } from 'node:child_process';

export interface RgbImage {
  width: number;
  height: number;
  /** Interleaved RGB, 0..1. */
  data: Float32Array;
}

/** Decode any ImageMagick-readable file to RGB (no colour conversion, alpha dropped). */
export function readRgb(path: string, size?: number): RgbImage {
  const resize = size ? ['-filter', 'Triangle', '-resize', `${size}x${size}!`] : [];
  const header = execFileSync('identify', ['-format', '%w %h', `${path}[0]`], { encoding: 'utf8' });
  let [width, height] = header.trim().split(/\s+/).map(Number);
  if (size) width = height = size;
  const raw = execFileSync(
    'convert',
    [
      `${path}[0]`,
      '-strip',
      '-set',
      'colorspace',
      'sRGB',
      '-alpha',
      'off',
      ...resize,
      '-depth',
      '8',
      'rgb:-',
    ],
    { maxBuffer: 1 << 30 },
  );
  if (raw.length !== width * height * 3) throw new Error(`${path}: unexpected raw size`);
  const data = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) data[i] = raw[i] / 255;
  return { width, height, data };
}

export function writeRgb(image: RgbImage, path: string) {
  const bytes = Buffer.alloc(image.data.length);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Math.round(Math.min(Math.max(image.data[i], 0), 1) * 255);
  execFileSync(
    'convert',
    [
      '-size',
      `${image.width}x${image.height}`,
      '-depth',
      '8',
      'rgb:-',
      '-set',
      'colorspace',
      'sRGB',
      `PNG24:${path}`,
    ],
    { input: bytes, maxBuffer: 1 << 30 },
  );
}

/** Deterministic 32-bit generator (mulberry32). */
function generator(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SynthOptions {
  size: number;
  patch: number;
  regions: [number, number, number, number][];
  seed: number;
}
/**
 * A seamless `size`² tile re-synthesised from source regions: a periodic grid
 * of half-overlapping patches (stride patch/2), each copied from a random
 * position inside one of `regions` with a random one of the eight square
 * symmetries, blended with a sin² partition of unity and a variance-preserving
 * weight (Heitz and Neyret 2018), so overlaps keep the source's contrast
 * instead of washing out. The same patches are applied to every map in
 * `images` (colour, roughness, ...; all the same size); `normals` lists the
 * indices whose RGB is a tangent-space normal (rotated with the patch and
 * renormalised). Features outside the regions (cracks) never appear and the
 * tile wraps without a seam.
 */
export function synthesizeTile(images: RgbImage[], options: SynthOptions, normals: number[] = []) {
  const { size, patch } = options;
  const stride = patch / 2;
  if (size % stride) throw new Error('synth size must be a multiple of half the patch');
  const random = generator(options.seed);
  const cells = size / stride;
  const source = images[0];
  for (const image of images)
    if (image.width !== source.width || image.height !== source.height)
      throw new Error('synth maps differ in size');
  // Per patch: source origin and symmetry.
  const plan: { x: number; y: number; flip: number }[] = [];
  for (let i = 0; i < cells * cells; i++) {
    const region = options.regions[Math.floor(random() * options.regions.length)];
    plan.push({
      x: region[0] + Math.floor(random() * (region[2] - patch + 1)),
      y: region[1] + Math.floor(random() * (region[3] - patch + 1)),
      flip: Math.floor(random() * 8),
    });
  }
  const outputs = images.map(() => new Float32Array(size * size * 3));
  // Each patch contributes its deviation from its own mean: tone differences
  // between source regions would otherwise print the patch grid as blotches.
  // (Broad variation is the shader's job: it is never in a tile.)
  const patchMeans = plan.map((p) =>
    images.map((image) => {
      const m = [0, 0, 0];
      for (let b = 0; b < patch; b++)
        for (let a = 0; a < patch; a++) {
          const at = ((p.y + b) * image.width + p.x + a) * 3;
          for (let c = 0; c < 3; c++) m[c] += image.data[at + c];
        }
      return m.map((v) => v / (patch * patch));
    }),
  );
  const means = images.map((image) => {
    const m = [0, 0, 0];
    for (let p = 0; p < image.width * image.height; p++)
      for (let c = 0; c < 3; c++) m[c] += image.data[p * 3 + c];
    return m.map((v) => v / (image.width * image.height));
  });
  // Patch-local coordinates (u, v in [0, patch)) under symmetry `flip`,
  // and the matching transform of a normal's (x, y) (image rows run down).
  const map = (u: number, v: number, flip: number): [number, number] => {
    let a = u,
      b = v;
    if (flip & 1) a = patch - 1 - a;
    if (flip & 2) b = patch - 1 - b;
    if (flip & 4) [a, b] = [b, a];
    return [a, b];
  };
  const rotateNormal = (nx: number, ny: number, flip: number): [number, number] => {
    // Output (u right, v down) -> source (a, b); a normal's x follows +a, y
    // follows -b (up). Push the source slope back through the transform.
    let sx = nx,
      sy = -ny; // slope in (a, b) image axes
    // Inverse order of `map`.
    if (flip & 4) [sx, sy] = [sy, sx];
    if (flip & 2) sy = -sy;
    if (flip & 1) sx = -sx;
    return [sx, -sy];
  };
  const window = (t: number) => Math.sin((Math.PI * (t + 0.5)) / patch) ** 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // The four patches covering (x, y): grid cells cx, cx-1 and cy, cy-1.
      const cx = Math.floor(x / stride),
        cy = Math.floor(y / stride);
      const sums = images.map(() => [0, 0, 0]);
      let weightSquares = 0;
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) {
          const gx = (cx - i + cells) % cells,
            gy = (cy - j + cells) % cells;
          // Local coordinate inside this patch (wrapping across the tile edge).
          const u = (x - gx * stride + size) % size,
            v = (y - gy * stride + size) % size;
          if (u >= patch || v >= patch) continue;
          const w = window(u) * window(v);
          weightSquares += w * w;
          const p = plan[gy * cells + gx];
          const [a, b] = map(u, v, p.flip);
          const at = ((p.y + b) * source.width + p.x + a) * 3;
          images.forEach((image, k) => {
            let r = image.data[at],
              g = image.data[at + 1];
            const bl = image.data[at + 2];
            if (normals.includes(k)) {
              [r, g] = rotateNormal(r * 2 - 1, g * 2 - 1, p.flip).map((s) => s * 0.5 + 0.5) as [
                number,
                number,
              ];
            }
            // Normals keep their slope about flat; data maps their local mean.
            const local = normals.includes(k)
              ? [0.5, 0.5, means[k][2]]
              : patchMeans[gy * cells + gx][k];
            sums[k][0] += w * (r - local[0]);
            sums[k][1] += w * (g - local[1]);
            sums[k][2] += w * (bl - local[2]);
          });
        }
      // sin² windows sum to one; the variance-preserving divisor restores
      // the contrast a plain average of independent patches would lose.
      const norm = 1 / Math.sqrt(Math.max(weightSquares, 1e-6));
      const at = (y * size + x) * 3;
      images.forEach((_, k) => {
        const centre = normals.includes(k) ? [0.5, 0.5, means[k][2]] : means[k];
        for (let c = 0; c < 3; c++) outputs[k][at + c] = centre[c] + sums[k][c] * norm;
      });
    }
  return outputs.map((data, k) => {
    const image = { width: size, height: size, data };
    if (normals.includes(k)) renormalise(image);
    return image;
  });
}

function renormalise(image: RgbImage) {
  for (let p = 0; p < image.width * image.height; p++) {
    const x = image.data[p * 3] * 2 - 1,
      y = image.data[p * 3 + 1] * 2 - 1,
      z = Math.max(image.data[p * 3 + 2] * 2 - 1, 0.05);
    const k = 1 / Math.hypot(x, y, z);
    image.data[p * 3] = x * k * 0.5 + 0.5;
    image.data[p * 3 + 1] = y * k * 0.5 + 0.5;
    image.data[p * 3 + 2] = z * k * 0.5 + 0.5;
  }
}

const luminance = (data: Float32Array, p: number) =>
  0.2126 * data[p * 3] + 0.7152 * data[p * 3 + 1] + 0.0722 * data[p * 3 + 2];

/** OpenGL (+Y up) tangent-space normals from the colour's luminance read as
 * relief: a wrapped 3x3 Sobel, `gain` slope per unit luminance per texel at
 * 1024 px. Lighter aggregate stands proud of darker binder and cavities. */
export function normalFromColor(color: RgbImage, gain: number): RgbImage {
  const { width, height } = color;
  const h = (x: number, y: number) =>
    luminance(color.data, ((y + height) % height) * width + ((x + width) % width));
  const data = new Float32Array(width * height * 3);
  const k = (gain * (width / 1024)) / 8;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const gx =
        h(x + 1, y - 1) +
        2 * h(x + 1, y) +
        h(x + 1, y + 1) -
        h(x - 1, y - 1) -
        2 * h(x - 1, y) -
        h(x - 1, y + 1);
      // Rows run down the image; +Y of the normal is up the image.
      const gy =
        h(x - 1, y - 1) +
        2 * h(x, y - 1) +
        h(x + 1, y - 1) -
        h(x - 1, y + 1) -
        2 * h(x, y + 1) -
        h(x + 1, y + 1);
      const nx = -gx * k,
        ny = -gy * k,
        inv = 1 / Math.hypot(nx, ny, 1);
      const at = (y * width + x) * 3;
      data[at] = nx * inv * 0.5 + 0.5;
      data[at + 1] = ny * inv * 0.5 + 0.5;
      data[at + 2] = inv * 0.5 + 0.5;
    }
  return { width, height, data };
}

/** Roughness (grey) from luminance: base - gain * (luminance - mean). */
export function roughnessFromColor(color: RgbImage, base: number, gain: number): RgbImage {
  const n = color.width * color.height;
  let mean = 0;
  for (let p = 0; p < n; p++) mean += luminance(color.data, p);
  mean /= n;
  const data = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    const r = Math.min(Math.max(base - gain * (luminance(color.data, p) - mean), 0.05), 1);
    data[p * 3] = data[p * 3 + 1] = data[p * 3 + 2] = r;
  }
  return { width: color.width, height: color.height, data };
}

/** Remove the mean slope of a tangent-space normal map (a periodic height
 * field has none) and renormalise. */
export function recentreNormal(image: RgbImage) {
  const n = image.width * image.height;
  let mx = 0,
    my = 0;
  for (let p = 0; p < n; p++) {
    const x = image.data[p * 3] * 2 - 1,
      y = image.data[p * 3 + 1] * 2 - 1,
      z = Math.max(image.data[p * 3 + 2] * 2 - 1, 0.05);
    mx += x / z;
    my += y / z;
  }
  mx /= n;
  my /= n;
  for (let p = 0; p < n; p++) {
    const z = Math.max(image.data[p * 3 + 2] * 2 - 1, 0.05);
    const sx = (image.data[p * 3] * 2 - 1) / z - mx,
      sy = (image.data[p * 3 + 1] * 2 - 1) / z - my;
    const k = 1 / Math.hypot(sx, sy, 1);
    image.data[p * 3] = sx * k * 0.5 + 0.5;
    image.data[p * 3 + 1] = sy * k * 0.5 + 0.5;
    image.data[p * 3 + 2] = k * 0.5 + 0.5;
  }
  return { slope: [mx, my] as [number, number] };
}

const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** Linear-light mean of an sRGB colour image. */
export function meanLinear(image: RgbImage): [number, number, number] {
  const sum = [0, 0, 0];
  const n = image.width * image.height;
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) sum[c] += decode(image.data[p * 3 + c]);
  return sum.map((v) => Number((v / n).toFixed(5))) as [number, number, number];
}
/** Mean of one channel (data maps). */
export function meanChannel(image: RgbImage, channel: number) {
  let sum = 0;
  const n = image.width * image.height;
  for (let p = 0; p < n; p++) sum += image.data[p * 3 + channel];
  return Number((sum / n).toFixed(5));
}
