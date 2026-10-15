/**
 * Equirectangular HDRI analysis and Ultra HDR (gain map) preparation for the
 * third-party asset build (build-third-party.ts). Pure functions over linear
 * float pixels: no file system, no encoder, so tests can run them on synthetic
 * skies.
 *
 * Conventions (shared with src/rendering/assets/photo-sky.ts):
 *  - pixel (i, j), j from the TOP row, of a W x H image covers
 *      longitude lon = ((i + 0.5) / W - 0.5) * 2 pi   (atan2(z, x))
 *      latitude  lat = (0.5 - (j + 0.5) / H) * pi
 *  - direction  (cos lat cos lon, sin lat, cos lat sin lon), y up.
 *  This is three.js's equirectangular convention (u = atan(z, x) / 2 pi + 0.5,
 *  v = asin(y) / pi + 0.5 with the image's top row at v = 1).
 */

export type Rgb = [number, number, number];
export interface FloatImage {
  width: number;
  height: number;
  /** RGB or RGBA linear floats, row-major from the top row. */
  data: Float32Array;
  channels: 3 | 4;
}
export interface HdriAnalysis {
  /** Brightest region's direction: azimuth = atan2(z, x) and elevation, degrees. */
  sunAzimuth: number;
  sunElevation: number;
  /** Disc irradiance above the surrounding sky, normal to the sun, source units. */
  sunIrradiance: number;
  /** Sun colour, max channel 1. */
  sunColor: Rgb;
  /** Direct horizontal irradiance / diffuse sky horizontal irradiance. */
  sunToSky: number;
  /** Cosine-weighted mean radiance of the upper hemisphere, sun disc replaced by
   * its surroundings (diffuse sky light; horizontal irradiance / pi). */
  domeMean: Rgb;
  /** Horizon band (the 4.5 degrees above the skyline, at least 0.5 degrees up):
   * within 35 degrees of the sun azimuth, more
   * than 120 degrees from it, and all round. */
  horizonSunSide: Rgb;
  horizonAntiSun: Rgb;
  horizonMean: Rgb;
  /** Mean radiance above 60 degrees. */
  zenith: Rgb;
  /** Cosine-weighted mean radiance of the lower hemisphere. */
  groundMean: Rgb;
  /** Largest single-channel value in the source. */
  peak: number;
}

const DEG = Math.PI / 180;
export const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function pixelLongitude(i: number, width: number) {
  return ((i + 0.5) / width - 0.5) * 2 * Math.PI;
}
export function pixelLatitude(j: number, height: number) {
  return (0.5 - (j + 0.5) / height) * Math.PI;
}
export function direction(lon: number, lat: number): Rgb {
  const c = Math.cos(lat);
  return [c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon)];
}
/** Wrap an angle (radians) into (-pi, pi]. */
export function wrapAngle(a: number) {
  const t = (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return t - Math.PI;
}

function channel(image: FloatImage, index: number, c: number) {
  return image.data[index * image.channels + c];
}

/** Measure the sun, the diffuse dome and the horizon of an equirectangular HDRI. */
/** `skylineDeg`: elevation below which the sky shader replaces the photo with
 * haze (recipe `skyline`); the horizon colours are measured just above it. */
export function analyseHdri(image: FloatImage, skylineDeg = 0): HdriAnalysis {
  const { width: W, height: H } = image;
  if (W !== 2 * H || W < 16) throw new Error(`Not a 2:1 equirectangular image (${W}x${H})`);
  const Y = new Float32Array(W * H);
  let peak = 0;
  for (let p = 0; p < W * H; p++) {
    const r = channel(image, p, 0),
      g = channel(image, p, 1),
      b = channel(image, p, 2);
    if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0))
      throw new Error(`Invalid HDR pixel ${p}`);
    Y[p] = luminance(r, g, b);
    peak = Math.max(peak, r, g, b);
  }
  const dLon = (2 * Math.PI) / W,
    dLat = Math.PI / H;
  const solid = (j: number) => dLon * dLat * Math.cos(pixelLatitude(j, H));
  // 1. Sun candidate: brightest block of a coarse grid above -3 degrees, so a
  //    single hot pixel (a glint) cannot win over the sun's disc and aureole.
  const block = Math.max(1, Math.floor(W / 512));
  let best = -1,
    bi = 0,
    bj = 0;
  for (let j0 = 0; j0 < H; j0 += block) {
    if (pixelLatitude(j0, H) < -3 * DEG) break;
    for (let i0 = 0; i0 < W; i0 += block) {
      let sum = 0;
      for (let j = j0; j < Math.min(H, j0 + block); j++)
        for (let i = i0; i < Math.min(W, i0 + block); i++) sum += Y[j * W + i];
      if (sum > best) {
        best = sum;
        bi = i0;
        bj = j0;
      }
    }
  }
  // 2. Refine: the brightest pixel near the candidate, then the luminance
  //    centroid of the pixels above a quarter of it within 3 degrees.
  const near = (
    lon: number,
    lat: number,
    radius: number,
    visit: (p: number, j: number, cos: number) => void,
  ) => {
    const centre = direction(lon, lat),
      cosR = Math.cos(radius),
      jMin = Math.max(0, Math.floor((0.5 - (lat + radius) / Math.PI) * H) - 1),
      jMax = Math.min(H - 1, Math.ceil((0.5 - (lat - radius) / Math.PI) * H) + 1);
    const iMid = Math.floor((lon / (2 * Math.PI) + 0.5) * W);
    for (let j = jMin; j <= jMax; j++) {
      const latJ = pixelLatitude(j, H),
        cosLat = Math.cos(latJ),
        span = cosLat < 1e-6 ? Math.PI : Math.min(Math.PI, radius / cosLat + dLon * 2),
        half = Math.ceil((span / (2 * Math.PI)) * W) + 1,
        whole = 2 * half + 1 >= W;
      for (let k = whole ? 0 : -half; k <= (whole ? W - 1 : half); k++) {
        const i = whole ? k : (((iMid + k) % W) + W) % W;
        const d = direction(pixelLongitude(i, W), latJ);
        const cos = d[0] * centre[0] + d[1] * centre[1] + d[2] * centre[2];
        if (cos >= cosR) visit(j * W + i, j, cos);
      }
    }
  };
  const candidateLon = pixelLongitude(bi + block / 2 - 0.5, W),
    candidateLat = pixelLatitude(bj + block / 2 - 0.5, H);
  let maxY = 0,
    maxP = bj * W + bi;
  near(candidateLon, candidateLat, 4 * DEG, (p) => {
    if (Y[p] > maxY) {
      maxY = Y[p];
      maxP = p;
    }
  });
  const peakLon = pixelLongitude(maxP % W, W),
    peakLat = pixelLatitude(Math.floor(maxP / W), H);
  const centroid: Rgb = [0, 0, 0];
  near(peakLon, peakLat, 3 * DEG, (p, j) => {
    if (Y[p] < maxY * 0.25) return;
    const d = direction(pixelLongitude(p % W, W), pixelLatitude(j, H));
    const w = Y[p] * solid(j);
    centroid[0] += d[0] * w;
    centroid[1] += d[1] * w;
    centroid[2] += d[2] * w;
  });
  const length = Math.hypot(...centroid) || 1;
  const sun = centroid.map((c) => c / length) as Rgb;
  const sunLon = Math.atan2(sun[2], sun[0]),
    sunLat = Math.asin(Math.max(-1, Math.min(1, sun[1])));
  // 3. Sky just outside the disc and aureole, and the disc's excess irradiance.
  const ring: Rgb = [0, 0, 0];
  let ringWeight = 0;
  near(sunLon, sunLat, 10 * DEG, (p, j, cos) => {
    if (cos > Math.cos(6 * DEG)) return;
    const w = solid(j);
    for (let c = 0; c < 3; c++) ring[c] += channel(image, p, c) * w;
    ringWeight += w;
  });
  for (let c = 0; c < 3; c++) ring[c] /= Math.max(ringWeight, 1e-12);
  const disc: Rgb = [0, 0, 0];
  near(sunLon, sunLat, 5 * DEG, (p, j) => {
    const w = solid(j);
    for (let c = 0; c < 3; c++) disc[c] += Math.max(0, channel(image, p, c) - ring[c]) * w;
  });
  const discPeak = Math.max(...disc, 1e-12);
  // 4. Dome, horizon, zenith and ground.
  const excluded = new Uint8Array(W * H);
  near(sunLon, sunLat, 5 * DEG, (p) => {
    excluded[p] = 1;
  });
  const dome: Rgb = [0, 0, 0],
    ground: Rgb = [0, 0, 0],
    zenith: Rgb = [0, 0, 0],
    sunSide: Rgb = [0, 0, 0],
    antiSun: Rgb = [0, 0, 0],
    horizon: Rgb = [0, 0, 0];
  let domeW = 0,
    groundW = 0,
    zenithW = 0,
    sunSideW = 0,
    antiSunW = 0,
    horizonW = 0;
  const bandLow = Math.max(0.5, skylineDeg + 0.5) * DEG;
  for (let j = 0; j < H; j++) {
    const lat = pixelLatitude(j, H),
      dOmega = solid(j),
      sin = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const p = j * W + i;
      const rgb: Rgb = excluded[p]
        ? [ring[0], ring[1], ring[2]]
        : [channel(image, p, 0), channel(image, p, 1), channel(image, p, 2)];
      if (lat > 0) {
        const w = sin * dOmega;
        for (let c = 0; c < 3; c++) dome[c] += rgb[c] * w;
        domeW += w;
        if (lat > 60 * DEG) {
          for (let c = 0; c < 3; c++) zenith[c] += rgb[c] * dOmega;
          zenithW += dOmega;
        }
        if (lat >= bandLow && lat <= bandLow + 4.5 * DEG) {
          const delta = Math.abs(wrapAngle(pixelLongitude(i, W) - sunLon));
          for (let c = 0; c < 3; c++) horizon[c] += rgb[c] * dOmega;
          horizonW += dOmega;
          if (delta < 35 * DEG) {
            for (let c = 0; c < 3; c++) sunSide[c] += rgb[c] * dOmega;
            sunSideW += dOmega;
          } else if (delta > 120 * DEG) {
            for (let c = 0; c < 3; c++) antiSun[c] += rgb[c] * dOmega;
            antiSunW += dOmega;
          }
        }
      } else {
        const w = -sin * dOmega;
        for (let c = 0; c < 3; c++) ground[c] += rgb[c] * w;
        groundW += w;
      }
    }
  }
  const mean = (v: Rgb, w: number) => v.map((c) => c / Math.max(w, 1e-12)) as Rgb;
  const domeMean = mean(dome, domeW);
  const sunIrradiance = luminance(...disc);
  const diffuse = Math.PI * luminance(...domeMean);
  return {
    sunAzimuth: sunLon / DEG,
    sunElevation: sunLat / DEG,
    sunIrradiance,
    sunColor: disc.map((c) => c / discPeak) as Rgb,
    sunToSky: (sunIrradiance * Math.max(0, Math.sin(sunLat))) / Math.max(diffuse, 1e-12),
    domeMean,
    horizonSunSide: mean(sunSide, sunSideW),
    horizonAntiSun: mean(antiSun, antiSunW),
    horizonMean: mean(horizon, horizonW),
    zenith: mean(zenith, zenithW),
    groundMean: mean(ground, groundW),
    peak,
  };
}

/** Linear RGB image scaled so the dome's mean luminance is 1, with every pixel
 * whose largest channel exceeds `clamp` scaled down to it (hue kept). */
export function normaliseHdri(image: FloatImage, analysis: HdriAnalysis, clamp: number) {
  const scale = 1 / Math.max(luminance(...analysis.domeMean), 1e-12);
  const out = new Float32Array(image.width * image.height * 3);
  let clipped = 0;
  for (let p = 0; p < image.width * image.height; p++) {
    let r = channel(image, p, 0) * scale,
      g = channel(image, p, 1) * scale,
      b = channel(image, p, 2) * scale;
    const m = Math.max(r, g, b);
    if (m > clamp) {
      const k = clamp / m;
      r *= k;
      g *= k;
      b *= k;
      clipped++;
    }
    out[p * 3] = r;
    out[p * 3 + 1] = g;
    out[p * 3 + 2] = b;
  }
  return {
    image: { width: image.width, height: image.height, data: out, channels: 3 } as FloatImage,
    scale,
    clipped,
  };
}

/**
 * Replace everything below `skylineDeg` (the photographer's ground, and land
 * close to the camera) with the sky just above it, blurred across azimuth
 * (a box of +-`blurDeg`): the sky shader never shows those pixels (it draws
 * the same haze there), so they are not shipped, the mip chain the haze is
 * read from stays clean, and the JPEG is smaller. In place on RGB data.
 */
export function bakeBelowSkyline(image: FloatImage, skylineDeg: number, blurDeg = 3) {
  const W = image.width,
    H = image.height,
    c = image.channels,
    d = image.data;
  const source = Math.min(H - 1, Math.max(0, Math.floor((0.5 - (skylineDeg + 0.75) / 180) * H))),
    first = Math.max(0, Math.ceil((0.5 - skylineDeg / 180) * H)),
    radius = Math.max(1, Math.round((blurDeg / 360) * W));
  const row = new Float32Array(W * 3);
  for (let i = 0; i < W; i++)
    for (let k = -radius; k <= radius; k++) {
      const q = (source * W + ((i + k + W) % W)) * c;
      for (let ch = 0; ch < 3; ch++) row[i * 3 + ch] += d[q + ch] / (2 * radius + 1);
    }
  for (let j = first; j < H; j++)
    for (let i = 0; i < W; i++)
      for (let ch = 0; ch < 3; ch++) d[(j * W + i) * c + ch] = row[i * 3 + ch];
  return { rows: H - first };
}

/** 2 x 2 box downsample (linear light). */
export function halveImage(image: FloatImage): FloatImage {
  const W = image.width >> 1,
    H = image.height >> 1,
    out = new Float32Array(W * H * 3);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dj = 0; dj < 2; dj++)
          for (let di = 0; di < 2; di++)
            s += channel(image, (2 * j + dj) * image.width + 2 * i + di, c);
        out[(j * W + i) * 3 + c] = s / 4;
      }
  return { width: W, height: H, data: out, channels: 3 };
}

export const linearToSrgb = (x: number) =>
  x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
export const srgbToLinear = (x: number) =>
  x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);

/**
 * Half-resolution scalar gain map, in 8-bit log2 units over [0, gainMax].
 *
 * The SDR base of a pixel is its HDR colour divided by the (bilinearly
 * upsampled) gain, so the gain must be at least 1 + max channel for the base
 * to stay in [0, 1]. Each half-resolution texel is used by the full-resolution
 * pixels 2k-1 .. 2k+2 along each axis (bilinear taps of a 2x upsample), so it
 * takes the largest requirement over that 4 x 4 block: every interpolated gain
 * is then at least the pixel's own requirement. Longitude wraps, latitude
 * clamps. `margin` extra levels absorb the gain JPEG's compression error.
 */
export function gainMapLevels(image: FloatImage, gainMax: number, margin = 2) {
  const W = image.width,
    H = image.height,
    w = W >> 1,
    h = H >> 1;
  const need = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const m = Math.max(channel(image, p, 0), channel(image, p, 1), channel(image, p, 2));
    need[p] = Math.log2(1 + m);
  }
  const levels = new Uint8Array(w * h);
  for (let b = 0; b < h; b++)
    for (let a = 0; a < w; a++) {
      let g = 0;
      for (let dj = -1; dj <= 2; dj++) {
        const j = Math.min(H - 1, Math.max(0, 2 * b + dj));
        for (let di = -1; di <= 2; di++) {
          const i = (((2 * a + di) % W) + W) % W;
          g = Math.max(g, need[j * W + i]);
        }
      }
      levels[b * w + a] = Math.min(255, Math.ceil((g / gainMax) * 255) + margin);
    }
  return { width: w, height: h, levels };
}

/** The GPU's bilinear 2x upsample of a half-resolution level map at full-
 * resolution pixel (i, j): longitude wraps, latitude clamps to the edge. */
export function upsampledLevel(levels: Uint8Array, w: number, h: number, i: number, j: number) {
  const x = i / 2 - 0.25,
    y = j / 2 - 0.25;
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  const at = (a: number, b: number) =>
    levels[Math.min(h - 1, Math.max(0, b)) * w + (((a % w) + w) % w)];
  return (
    (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
    (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  );
}

/** 8-bit sRGB SDR base (RGBA) for `image` given the gain levels the decoder
 * will actually read (`decoded`, e.g. the gain JPEG decoded again). */
export function sdrBase(
  image: FloatImage,
  decoded: Uint8Array,
  w: number,
  h: number,
  gainMax: number,
) {
  const W = image.width,
    H = image.height,
    out = new Uint8Array(W * H * 4);
  let clipped = 0;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const p = j * W + i,
        gain = 2 ** ((upsampledLevel(decoded, w, h, i, j) / 255) * gainMax);
      for (let c = 0; c < 3; c++) {
        const s = channel(image, p, c) / gain;
        if (s > 1.0001) clipped++;
        out[p * 4 + c] = Math.round(linearToSrgb(Math.min(1, Math.max(0, s))) * 255);
      }
      out[p * 4 + 3] = 255;
    }
  return { data: out, clipped };
}

/** Reconstruct linear HDR exactly as the runtime shader does (for verification). */
export function reconstruct(
  sdr: Uint8Array,
  W: number,
  H: number,
  decoded: Uint8Array,
  w: number,
  h: number,
  gainMax: number,
): FloatImage {
  const out = new Float32Array(W * H * 3);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const p = j * W + i,
        gain = 2 ** ((upsampledLevel(decoded, w, h, i, j) / 255) * gainMax);
      for (let c = 0; c < 3; c++) out[p * 3 + c] = srgbToLinear(sdr[p * 4 + c] / 255) * gain;
    }
  return { width: W, height: H, data: out, channels: 3 };
}

/** Relative error statistics of a reconstruction against its source. */
export function compareHdr(a: FloatImage, b: FloatImage) {
  let sum = 0,
    worst = 0,
    n = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    const ya = luminance(channel(a, p, 0), channel(a, p, 1), channel(a, p, 2)),
      yb = luminance(channel(b, p, 0), channel(b, p, 1), channel(b, p, 2));
    if (ya < 0.02) continue;
    const e = Math.abs(Math.log2((yb + 1e-4) / (ya + 1e-4)));
    sum += e * e;
    worst = Math.max(worst, e);
    n++;
  }
  return { rmsStops: Math.sqrt(sum / Math.max(n, 1)), worstStops: worst };
}

/** Byte offsets of the concatenated JPEG images in a file (an Ultra HDR JPEG is
 * the primary image followed by the gain map image). Walks the marker segments
 * of each image and its entropy-coded data to the EOI. */
export function jpegImageSpans(bytes: Uint8Array) {
  const spans: { start: number; end: number }[] = [];
  let p = 0;
  while (p + 1 < bytes.length) {
    if (bytes[p] !== 0xff || bytes[p + 1] !== 0xd8) {
      p++;
      continue;
    }
    const start = p;
    p += 2;
    let end = -1;
    while (p + 1 < bytes.length && end < 0) {
      if (bytes[p] !== 0xff) throw new Error(`Malformed JPEG marker at ${p}`);
      const marker = bytes[p + 1];
      if (marker === 0xd9) {
        end = p + 2;
        break;
      }
      if (marker === 0xff) {
        p++;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2;
        continue;
      }
      if (p + 3 >= bytes.length) break;
      const length = (bytes[p + 2] << 8) | bytes[p + 3];
      p += 2 + length;
      if (marker === 0xda) {
        // Entropy-coded data: skip stuffed bytes and restart markers.
        while (p + 1 < bytes.length) {
          if (
            bytes[p] === 0xff &&
            bytes[p + 1] !== 0x00 &&
            !(bytes[p + 1] >= 0xd0 && bytes[p + 1] <= 0xd7)
          )
            break;
          p++;
        }
      }
    }
    if (end < 0) throw new Error('JPEG image without EOI');
    spans.push({ start, end });
    p = end;
  }
  return spans;
}
