/**
 * Image I/O for the vegetation bake through ImageMagick (`convert`,
 * `identify`): 8-bit RGBA in, linear float textures with a box-filtered mip
 * chain for sampling, PNG out. Node only.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Rgba8 {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, rows top to bottom. */
  data: Uint8Array;
}

export function readRgba(path: string, maxSize = 0): Rgba8 {
  const size = execFileSync('identify', ['-format', '%w %h %[channels]\n', path], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')[0]
    .split(' ');
  let width = +size[0],
    height = +size[1];
  if (maxSize > 0 && Math.max(width, height) > maxSize) {
    const k = maxSize / Math.max(width, height);
    width = Math.round(width * k);
    height = Math.round(height * k);
  }
  const resize = width !== +size[0] ? ['-filter', 'Box', '-resize', `${width}x${height}!`] : [];
  const raw = execFileSync('convert', [path, '-strip', ...resize, '-depth', '8', 'RGBA:-'], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  const data = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (data.length !== width * height * 4) throw new Error(`${path}: unexpected raw size`);
  return { width, height, data: new Uint8Array(data) };
}
export function hasAlphaChannel(path: string) {
  const channels = execFileSync('identify', ['-format', '%[channels]\n', path], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')[0];
  return /a/.test(channels);
}

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});
export const srgbToLinear = (byte: number) => SRGB_TO_LINEAR[byte];
export function linearToSrgbByte(v: number) {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** A sampled texture: linear RGB, alpha (coverage) and a mip chain. */
export interface Texture {
  width: number;
  height: number;
  levels: { width: number; height: number; rgba: Float32Array }[];
}

/**
 * Colour (sRGB -> linear) and an optional coverage source: `alpha` is a
 * separate image whose alpha channel (or grey value) is the coverage, or the
 * colour image's own alpha channel when `alpha` is the same path.
 */
export function loadTexture(colorPath: string, alphaPath: string | null, maxSize = 1024): Texture {
  const color = readRgba(colorPath, maxSize);
  let mask: Rgba8 | null = null;
  let maskChannel = 3;
  if (alphaPath && alphaPath !== colorPath) {
    mask = readRgba(alphaPath, maxSize);
    if (!hasAlphaChannel(alphaPath)) maskChannel = 0;
    if (mask.width !== color.width || mask.height !== color.height)
      mask = readRgba(alphaPath, Math.max(color.width, color.height));
  }
  const { width, height } = color;
  const rgba = new Float32Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = srgbToLinear(color.data[p * 4]);
    rgba[p * 4 + 1] = srgbToLinear(color.data[p * 4 + 1]);
    rgba[p * 4 + 2] = srgbToLinear(color.data[p * 4 + 2]);
    rgba[p * 4 + 3] = alphaPath
      ? (mask ? mask.data[p * 4 + maskChannel] : color.data[p * 4 + 3]) / 255
      : 1;
  }
  return withMips(width, height, rgba);
}

/** A texture from 8-bit RGBA (sRGB colour decoded to linear, or raw data). */
export function textureFromRgba8(image: Rgba8, srgb: boolean): Texture {
  const rgba = new Float32Array(image.width * image.height * 4);
  for (let i = 0; i < rgba.length; i++)
    rgba[i] = srgb && i % 4 !== 3 ? srgbToLinear(image.data[i]) : image.data[i] / 255;
  return withMips(image.width, image.height, rgba);
}

function withMips(width: number, height: number, rgba: Float32Array): Texture {
  const levels = [{ width, height, rgba }];
  // Box mip chain; colour averaged with coverage weights so transparent
  // texels never darken the leaf edge.
  while (levels.at(-1)!.width > 1 || levels.at(-1)!.height > 1) {
    const prev = levels.at(-1)!,
      w = Math.max(1, prev.width >> 1),
      h = Math.max(1, prev.height >> 1),
      out = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0,
          weight = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(prev.width - 1, x * 2 + dx),
              sy = Math.min(prev.height - 1, y * 2 + dy),
              i = (sy * prev.width + sx) * 4,
              k = prev.rgba[i + 3] + 1e-3;
            r += prev.rgba[i] * k;
            g += prev.rgba[i + 1] * k;
            b += prev.rgba[i + 2] * k;
            a += prev.rgba[i + 3];
            weight += k;
          }
        const o = (y * w + x) * 4;
        out[o] = r / weight;
        out[o + 1] = g / weight;
        out[o + 2] = b / weight;
        out[o + 3] = a / 4;
      }
    levels.push({ width: w, height: h, rgba: out });
  }
  return { width, height, levels };
}

/** A grey displacement image as a float height field (0..1). */
export function loadHeight(path: string, maxSize = 1024) {
  const image = readRgba(path, maxSize);
  const height = new Float32Array(image.width * image.height);
  for (let p = 0; p < height.length; p++)
    height[p] =
      (image.data[p * 4] * 0.299 + image.data[p * 4 + 1] * 0.587 + image.data[p * 4 + 2] * 0.114) /
      255;
  return { width: image.width, height: image.height, data: height };
}

/** Bilinear, repeat-wrapped sample of a mip level; v = 0 is the image bottom
 * (pbrt and glTF-style flip). Writes linear RGB + coverage into `out`. */
export function sample(texture: Texture, u: number, v: number, lod: number, out: Float32Array) {
  const level = texture.levels[Math.min(texture.levels.length - 1, Math.max(0, Math.round(lod)))];
  const w = level.width,
    h = level.height;
  const x = (u - Math.floor(u)) * w - 0.5,
    y = (1 - (v - Math.floor(v))) * h - 0.5;
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  const xa = ((x0 % w) + w) % w,
    xb = (xa + 1) % w,
    ya = ((y0 % h) + h) % h,
    yb = (ya + 1) % h;
  const d = level.rgba;
  for (let c = 0; c < 4; c++) {
    const top = d[(ya * w + xa) * 4 + c] * (1 - fx) + d[(ya * w + xb) * 4 + c] * fx;
    const bottom = d[(yb * w + xa) * 4 + c] * (1 - fx) + d[(yb * w + xb) * 4 + c] * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

/** Write 8-bit RGBA (rows top to bottom) as a PNG. */
export function writePng(path: string, width: number, height: number, rgba: Uint8Array) {
  const work = join(tmpdir(), `apex-veg-png-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const raw = join(work, 'image.rgba');
  writeFileSync(raw, rgba);
  execFileSync('convert', [
    '-size',
    `${width}x${height}`,
    '-depth',
    '8',
    `RGBA:${raw}`,
    '-strip',
    '-define',
    'png:compression-level=9',
    `PNG32:${path}`,
  ]);
  rmSync(work, { recursive: true, force: true });
}
