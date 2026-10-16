/**
 * Supersampled orthographic software rasteriser for the vegetation bake:
 * renders full-resolution plant geometry (alpha-tested leaves, bark) into
 * albedo, coverage, normal, sky-visibility and depth buffers. Used for leaf
 * card atlases, impostor views and the offline previews. Node only.
 */
import { sample, type Texture } from './image.ts';

export type Vec3 = [number, number, number];

/** Triangles of one material in plant space (metres, +Y up). */
export interface BakeMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Sky visibility per vertex (0..1), from the canopy volume. */
  visibility: Float32Array;
  texture: Texture | null;
  /** Linear colour when untextured (or a tint multiplied into the texture). */
  tint: Vec3;
  /** Coverage below this is a hole (alpha test). */
  cutoff: number;
  foliage: boolean;
}

/** An orthographic view: `origin` is the centre of the image rectangle,
 * `forward` points into the scene; samples nearer than `near` or farther
 * than `far` (along forward, from origin) are clipped. */
export interface OrthoView {
  origin: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  /** Metres covered by the image. */
  width: number;
  height: number;
  near: number;
  far: number;
}

export class RasterTarget {
  readonly sw: number;
  readonly sh: number;
  readonly depth: Float32Array;
  readonly albedo: Float32Array;
  readonly normal: Float32Array;
  readonly visibility: Float32Array;
  readonly foliage: Uint8Array;
  /** Triangle index and texture alpha of the nearest sample (previews). */
  readonly id: Int32Array;
  readonly alpha: Float32Array;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly ss: number,
  ) {
    this.sw = width * ss;
    this.sh = height * ss;
    const n = this.sw * this.sh;
    this.depth = new Float32Array(n).fill(Infinity);
    this.albedo = new Float32Array(n * 3);
    this.normal = new Float32Array(n * 3);
    this.visibility = new Float32Array(n);
    this.foliage = new Uint8Array(n);
    this.id = new Int32Array(n).fill(-1);
    this.alpha = new Float32Array(n);
  }
  clear() {
    this.depth.fill(Infinity);
    this.albedo.fill(0);
    this.normal.fill(0);
    this.visibility.fill(0);
    this.foliage.fill(0);
    this.id.fill(-1);
  }
}

const dot = (a: Vec3, x: number, y: number, z: number) => a[0] * x + a[1] * y + a[2] * z;

/**
 * Rasterise `mesh` (optionally only the listed triangles) into `target`.
 * Normals are flipped to face the viewer (two-sided leaves); albedo is the
 * mip-filtered texture times the tint; coverage is alpha-tested per sample.
 */
export function rasterize(
  target: RasterTarget,
  view: OrthoView,
  mesh: BakeMesh,
  triangles?: Uint32Array | number[],
) {
  const { sw, sh } = target;
  const sx = sw / view.width,
    sy = sh / view.height;
  const ox = view.origin[0],
    oy = view.origin[1],
    oz = view.origin[2];
  const P = mesh.positions,
    N = mesh.normals,
    UV = mesh.uvs,
    I = mesh.indices,
    V = mesh.visibility;
  const tex = mesh.texture;
  const texArea = tex ? tex.width * tex.height : 0;
  const texel = new Float32Array(4);
  const count = triangles ? triangles.length : I.length / 3;
  const R = view.right,
    U = view.up,
    F = view.forward;
  for (let t = 0; t < count; t++) {
    const tri = triangles ? triangles[t] : t;
    const a = I[tri * 3],
      b = I[tri * 3 + 1],
      c = I[tri * 3 + 2];
    // Screen coordinates (samples), y down; depth along forward.
    const ax = P[a * 3] - ox,
      ay = P[a * 3 + 1] - oy,
      az = P[a * 3 + 2] - oz;
    const bx = P[b * 3] - ox,
      by = P[b * 3 + 1] - oy,
      bz = P[b * 3 + 2] - oz;
    const cx = P[c * 3] - ox,
      cy = P[c * 3 + 1] - oy,
      cz = P[c * 3 + 2] - oz;
    const x0 = dot(R, ax, ay, az) * sx + sw / 2,
      y0 = sh / 2 - dot(U, ax, ay, az) * sy,
      z0 = dot(F, ax, ay, az);
    const x1 = dot(R, bx, by, bz) * sx + sw / 2,
      y1 = sh / 2 - dot(U, bx, by, bz) * sy,
      z1 = dot(F, bx, by, bz);
    const x2 = dot(R, cx, cy, cz) * sx + sw / 2,
      y2 = sh / 2 - dot(U, cx, cy, cz) * sy,
      z2 = dot(F, cx, cy, cz);
    if (
      (z0 < view.near && z1 < view.near && z2 < view.near) ||
      (z0 > view.far && z1 > view.far && z2 > view.far)
    )
      continue;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))),
      maxX = Math.min(sw - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))),
      maxY = Math.min(sh - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) continue;
    // Mip level: texels per sample.
    let lod = 0;
    if (tex) {
      const du1 = UV[b * 2] - UV[a * 2],
        dv1 = UV[b * 2 + 1] - UV[a * 2 + 1],
        du2 = UV[c * 2] - UV[a * 2],
        dv2 = UV[c * 2 + 1] - UV[a * 2 + 1];
      const uvArea = Math.abs(du1 * dv2 - du2 * dv1) * texArea;
      lod = Math.max(0, 0.5 * Math.log2(uvArea / Math.abs(area) + 1e-12));
    }
    const inv = 1 / area;
    for (let py = minY; py <= maxY; py++) {
      const y = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const x = px + 0.5;
        let w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) * inv;
        let w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) * inv;
        let w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) {
          // Thin slivers: accept samples within a hair of the edge.
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          w0 = Math.max(0, w0);
          w1 = Math.max(0, w1);
          w2 = Math.max(0, w2);
        }
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        if (z < view.near || z > view.far) continue;
        const s = py * sw + px;
        if (z >= target.depth[s]) continue;
        let r = mesh.tint[0],
          g = mesh.tint[1],
          bl = mesh.tint[2];
        if (tex) {
          const u = w0 * UV[a * 2] + w1 * UV[b * 2] + w2 * UV[c * 2],
            v = w0 * UV[a * 2 + 1] + w1 * UV[b * 2 + 1] + w2 * UV[c * 2 + 1];
          sample(tex, u, v, lod, texel);
          if (texel[3] < mesh.cutoff) continue;
          r *= texel[0];
          g *= texel[1];
          bl *= texel[2];
        }
        let nx = w0 * N[a * 3] + w1 * N[b * 3] + w2 * N[c * 3],
          ny = w0 * N[a * 3 + 1] + w1 * N[b * 3 + 1] + w2 * N[c * 3 + 1],
          nz = w0 * N[a * 3 + 2] + w1 * N[b * 3 + 2] + w2 * N[c * 3 + 2];
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length;
        ny /= length;
        nz /= length;
        // Face the viewer (two-sided leaves, or the inside of a bark tube).
        if (nx * F[0] + ny * F[1] + nz * F[2] > 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        target.depth[s] = z;
        target.albedo[s * 3] = r;
        target.albedo[s * 3 + 1] = g;
        target.albedo[s * 3 + 2] = bl;
        target.normal[s * 3] = nx;
        target.normal[s * 3 + 1] = ny;
        target.normal[s * 3 + 2] = nz;
        target.visibility[s] = w0 * V[a] + w1 * V[b] + w2 * V[c];
        target.foliage[s] = mesh.foliage ? 1 : 2;
        target.id[s] = tri;
        target.alpha[s] = tex ? texel[3] : 1;
      }
    }
  }
}

export interface Resolved {
  width: number;
  height: number;
  /** Linear albedo RGB + coverage per pixel. */
  albedo: Float32Array;
  /** Unit normal (plant space) + sky visibility per pixel. */
  normal: Float32Array;
  /** Nearest depth along forward (Infinity where empty). */
  depth: Float32Array;
}

/** Average the samples of each pixel: coverage, covered-sample mean albedo,
 * normal and visibility; then bleed colours into empty pixels so filtering
 * and mips never pull in black. */
export function resolve(target: RasterTarget, dilate = 8): Resolved {
  const { width, height, ss, sw } = target;
  const albedo = new Float32Array(width * height * 4);
  const normal = new Float32Array(width * height * 4);
  const depth = new Float32Array(width * height).fill(Infinity);
  const n = ss * ss;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let covered = 0,
        r = 0,
        g = 0,
        b = 0,
        nx = 0,
        ny = 0,
        nz = 0,
        vis = 0,
        d = Infinity;
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const s = (y * ss + j) * sw + x * ss + i;
          if (target.depth[s] === Infinity) continue;
          covered++;
          r += target.albedo[s * 3];
          g += target.albedo[s * 3 + 1];
          b += target.albedo[s * 3 + 2];
          nx += target.normal[s * 3];
          ny += target.normal[s * 3 + 1];
          nz += target.normal[s * 3 + 2];
          vis += target.visibility[s];
          d = Math.min(d, target.depth[s]);
        }
      const p = y * width + x;
      if (!covered) continue;
      const l = Math.hypot(nx, ny, nz) || 1;
      albedo[p * 4] = r / covered;
      albedo[p * 4 + 1] = g / covered;
      albedo[p * 4 + 2] = b / covered;
      albedo[p * 4 + 3] = covered / n;
      normal[p * 4] = nx / l;
      normal[p * 4 + 1] = ny / l;
      normal[p * 4 + 2] = nz / l;
      normal[p * 4 + 3] = vis / covered;
      depth[p] = d;
    }
  bleed(albedo, normal, width, height, dilate);
  return { width, height, albedo, normal, depth };
}

/** Fill empty pixels (coverage 0) from covered neighbours, `passes` rings
 * deep, then the remaining empties with the mean (alpha stays 0). */
export function bleed(
  albedo: Float32Array,
  normal: Float32Array,
  width: number,
  height: number,
  passes: number,
) {
  const filled = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) filled[p] = albedo[p * 4 + 3] > 0 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = filled.slice();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (filled[p]) continue;
        let k = 0;
        const acc = [0, 0, 0, 0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const q = yy * width + xx;
            if (!filled[q]) continue;
            for (let c = 0; c < 3; c++) acc[c] += albedo[q * 4 + c];
            for (let c = 0; c < 4; c++) acc[3 + c] += normal[q * 4 + c];
            k++;
          }
        if (!k) continue;
        for (let c = 0; c < 3; c++) albedo[p * 4 + c] = acc[c] / k;
        const l = Math.hypot(acc[3], acc[4], acc[5]) || 1;
        normal[p * 4] = acc[3] / l;
        normal[p * 4 + 1] = acc[4] / l;
        normal[p * 4 + 2] = acc[5] / l;
        normal[p * 4 + 3] = acc[6] / k;
        next[p] = 1;
      }
    filled.set(next);
  }
  // Remaining empties: the mean colour.
  const mean = [0, 0, 0, 0, 0, 0, 0];
  let k = 0;
  for (let p = 0; p < width * height; p++)
    if (albedo[p * 4 + 3] > 0) {
      for (let c = 0; c < 3; c++) mean[c] += albedo[p * 4 + c];
      for (let c = 0; c < 4; c++) mean[3 + c] += normal[p * 4 + c];
      k++;
    }
  if (!k) return;
  for (let p = 0; p < width * height; p++)
    if (!filled[p]) {
      for (let c = 0; c < 3; c++) albedo[p * 4 + c] = mean[c] / k;
      const l = Math.hypot(mean[3], mean[4], mean[5]) || 1;
      normal[p * 4] = mean[3] / l;
      normal[p * 4 + 1] = mean[4] / l;
      normal[p * 4 + 2] = mean[5] / l;
      normal[p * 4 + 3] = mean[6] / k;
    }
}
