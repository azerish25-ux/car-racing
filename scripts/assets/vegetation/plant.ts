/**
 * Loads one landscape plant (an `ObjectBegin` block of the pbrt scene and its
 * PLY meshes and PNG textures) into plant space: metres, +Y up, the trunk
 * base at the origin. Each part becomes a BakeMesh tagged trunk (kept as a
 * decimated mesh), crown (leaves, needles, twigs and fine branches: baked
 * into cards and impostors) or excluded. Node only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasAlphaChannel, loadTexture, type Texture } from './image.ts';
import { plantParts, type PlantPart } from './pbrt.ts';
import { parsePly } from './ply.ts';
import type { BakeMesh, Vec3 } from './raster.ts';

export interface PlantRecipeSpec {
  /** pbrt `ObjectBegin` name. */
  object: string;
  /** Up axis of the source object. */
  up: 'y' | 'z';
  /** Mesh files (geometry/mesh_NNNNN.ply) kept as the trunk mesh. */
  trunk: string[];
  /** Mesh files left out entirely (ground litter, helpers). */
  exclude?: string[];
  /** Linear colour multiplier per texture name substring (leaf colour balance). */
  tints?: Record<string, Vec3>;
}

export interface PlantPartMesh extends BakeMesh {
  part: PlantPart;
  role: 'trunk' | 'crown';
  /** Total surface area (m²). */
  area: number;
}

export interface Plant {
  parts: PlantPartMesh[];
  /** Plant-space bounds: [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds: number[];
  /** Height of the plant (m). */
  height: number;
  /** Horizontal radius from the trunk axis that holds 99 % of the crown area. */
  radius: number;
}

function normalMatrix(m: number[]) {
  // Inverse transpose of the upper 3x3 (column-major input).
  const a = m[0],
    b = m[1],
    c = m[2],
    d = m[4],
    e = m[5],
    f = m[6],
    g = m[8],
    h = m[9],
    i = m[10];
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const D = -(b * i - c * h),
    E = a * i - c * g,
    F = -(a * h - b * g);
  const G = b * f - c * e,
    H = -(a * f - c * d),
    I = a * e - b * d;
  const det = a * A + d * D + g * G;
  // Rows of the inverse are (A, D, G), (B, E, H), (C, F, I) / det; the
  // transpose of the inverse maps normals.
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
}

export function loadPlant(root: string, spec: PlantRecipeSpec, textureSize = 1024): Plant {
  const scene = readFileSync(join(root, 'geometry/geometry.pbrt'), 'utf8');
  const parts = plantParts(scene, spec.object).filter((p) => !spec.exclude?.includes(p.mesh));
  const textures = new Map<string, Texture>();
  const texture = (color: string | null, alpha: string | null) => {
    if (!color) return null;
    const key = `${color}|${alpha}`;
    let t = textures.get(key);
    if (!t)
      textures.set(
        key,
        (t = loadTexture(join(root, color), alpha ? join(root, alpha) : null, textureSize)),
      );
    return t;
  };
  const out: PlantPartMesh[] = [];
  for (const part of parts) {
    const mesh = parsePly(new Uint8Array(readFileSync(join(root, part.mesh))));
    const m = part.transform,
      nm = normalMatrix(m);
    const n = mesh.positions.length / 3;
    const positions = new Float32Array(n * 3),
      normals = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const x = mesh.positions[v * 3],
        y = mesh.positions[v * 3 + 1],
        z = mesh.positions[v * 3 + 2];
      const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / 100;
      let py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / 100,
        pz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / 100;
      const ax = mesh.normals[v * 3],
        ay = mesh.normals[v * 3 + 1],
        az = mesh.normals[v * 3 + 2];
      const nx = nm[0] * ax + nm[3] * ay + nm[6] * az;
      let ny = nm[1] * ax + nm[4] * ay + nm[7] * az,
        nz = nm[2] * ax + nm[5] * ay + nm[8] * az;
      if (spec.up === 'z') {
        const y = py,
          ny0 = ny;
        py = pz;
        pz = -y;
        ny = nz;
        nz = -ny0;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      positions.set([px, py, pz], v * 3);
      normals.set([nx / l, ny / l, nz / l], v * 3);
    }
    const alphaSource =
      part.alpha ?? (part.color && hasAlphaChannel(join(root, part.color)) ? part.color : null);
    const trunk = spec.trunk.includes(part.mesh);
    const tint: Vec3 = part.reflectance
      ? [part.reflectance[0], part.reflectance[1], part.reflectance[2]]
      : [1, 1, 1];
    for (const [key, value] of Object.entries(spec.tints ?? {}))
      if (part.color?.includes(key)) for (let c = 0; c < 3; c++) tint[c] *= value[c];
    let area = 0;
    const I = mesh.indices;
    for (let t = 0; t < I.length; t += 3) area += triangleArea(positions, I[t], I[t + 1], I[t + 2]);
    out.push({
      part,
      role: trunk ? 'trunk' : 'crown',
      positions,
      normals,
      uvs: mesh.uvs,
      indices: mesh.indices,
      visibility: new Float32Array(n).fill(1),
      texture: texture(part.color, alphaSource),
      tint,
      cutoff: alphaSource ? 0.5 : -1,
      foliage: !!alphaSource,
      area,
    });
  }
  // Trunk base: the mean of the lowest 20 cm of trunk vertices.
  let minY = Infinity;
  for (const p of out.filter((p) => p.role === 'trunk'))
    for (let v = 1; v < p.positions.length; v += 3) minY = Math.min(minY, p.positions[v]);
  let bx = 0,
    bz = 0,
    k = 0;
  for (const p of out.filter((p) => p.role === 'trunk'))
    for (let v = 0; v < p.positions.length; v += 3)
      if (p.positions[v + 1] < minY + 0.2) {
        bx += p.positions[v];
        bz += p.positions[v + 2];
        k++;
      }
  if (!Number.isFinite(minY)) {
    // No trunk (meadow patches): ground at the lowest point, centred box.
    minY = Infinity;
    for (const p of out)
      for (let v = 1; v < p.positions.length; v += 3)
        minY = Math.max(-1e9, Math.min(minY, p.positions[v]));
    const b = boundsOf(out);
    bx = (b[0] + b[3]) / 2;
    bz = (b[2] + b[5]) / 2;
    k = 1;
  }
  bx /= k;
  bz /= k;
  for (const p of out)
    for (let v = 0; v < p.positions.length; v += 3) {
      p.positions[v] -= bx;
      p.positions[v + 1] -= minY;
      p.positions[v + 2] -= bz;
    }
  const bounds = boundsOf(out);
  // Crown radius: 99th percentile of crown area by distance from the axis.
  const radii: [number, number][] = [];
  for (const p of out) {
    if (p.role !== 'crown') continue;
    const P = p.positions,
      I = p.indices;
    for (let t = 0; t < I.length; t += 3 * 7) {
      const a = I[t];
      radii.push([Math.hypot(P[a * 3], P[a * 3 + 2]), triangleArea(P, I[t], I[t + 1], I[t + 2])]);
    }
  }
  radii.sort((a, b) => a[0] - b[0]);
  const total = radii.reduce((s, r) => s + r[1], 0);
  let acc = 0,
    radius = 0;
  for (const [r, a] of radii) {
    acc += a;
    radius = r;
    if (acc >= total * 0.99) break;
  }
  return { parts: out, bounds, height: bounds[4], radius };
}

export function triangleArea(P: Float32Array, a: number, b: number, c: number) {
  const ux = P[b * 3] - P[a * 3],
    uy = P[b * 3 + 1] - P[a * 3 + 1],
    uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[c * 3] - P[a * 3],
    vy = P[c * 3 + 1] - P[a * 3 + 1],
    vz = P[c * 3 + 2] - P[a * 3 + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

export function boundsOf(parts: { positions: Float32Array }[]) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let v = 0; v < p.positions.length; v += 3)
      for (let c = 0; c < 3; c++) {
        b[c] = Math.min(b[c], p.positions[v + c]);
        b[c + 3] = Math.max(b[c + 3], p.positions[v + c]);
      }
  return b;
}
