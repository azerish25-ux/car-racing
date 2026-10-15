/**
 * Canopy analysis for the vegetation bake: a leaf-area density volume and
 * its sky visibility (volumetric ambient occlusion), k-means leaf clusters
 * and the billboard-cloud cards fitted to them, and the card atlas packing.
 * Node only.
 */
import type { PlantPartMesh } from './plant.ts';
import { triangleArea } from './plant.ts';
import type { Vec3 } from './raster.ts';

/** Deterministic PRNG (mulberry32). */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Leaf-area density on a voxel grid and the sky visibility through it. */
export class CanopyVolume {
  readonly n: [number, number, number];
  readonly cell: number;
  readonly min: Vec3;
  readonly density: Float32Array;
  visibility: Float32Array;
  constructor(bounds: number[], cell: number) {
    this.cell = cell;
    this.min = [bounds[0] - cell, bounds[1] - cell, bounds[2] - cell];
    this.n = [0, 1, 2].map((c) => Math.ceil((bounds[c + 3] - bounds[c]) / cell) + 3) as [
      number,
      number,
      number,
    ];
    this.density = new Float32Array(this.n[0] * this.n[1] * this.n[2]);
    this.visibility = new Float32Array(this.density.length).fill(1);
  }
  private index(x: number, y: number, z: number) {
    return (z * this.n[1] + y) * this.n[0] + x;
  }
  /** Deposit every triangle's one-sided area at its centroid. */
  deposit(parts: readonly PlantPartMesh[]) {
    const volume = this.cell ** 3;
    for (const p of parts) {
      const P = p.positions,
        I = p.indices;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t],
          b = I[t + 1],
          c = I[t + 2];
        const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3,
          y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3,
          z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
        const i = Math.floor((x - this.min[0]) / this.cell),
          j = Math.floor((y - this.min[1]) / this.cell),
          k = Math.floor((z - this.min[2]) / this.cell);
        // Bark tubes count half (they block, but are not leaf layers).
        this.density[this.index(i, j, k)] +=
          (triangleArea(P, a, b, c) / volume) * (p.foliage ? 1 : 0.5);
      }
    }
  }
  /**
   * Cosine-weighted sky visibility through the canopy: transmittance
   * exp(-G·LAD·s) marched along `directions` upper-hemisphere rays from each
   * voxel (G = 0.5, random leaf orientation), averaged.
   */
  solve(directions = 48, extinction = 0.5, seed = 7) {
    const rnd = random(seed);
    const dirs: Vec3[] = [];
    for (let i = 0; i < directions; i++) {
      // Stratified cosine-weighted hemisphere (Fibonacci).
      const u = (i + rnd()) / directions,
        phi = i * 2.399963229728653;
      const r = Math.sqrt(u);
      dirs.push([r * Math.cos(phi), Math.sqrt(1 - u), r * Math.sin(phi)]);
    }
    const [nx, ny, nz] = this.n;
    const out = new Float32Array(this.density.length);
    const step = this.cell * 0.75;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          let sum = 0;
          for (const d of dirs) {
            let px = x + 0.5,
              py = y + 0.5,
              pz = z + 0.5,
              tau = 0;
            // Start half a step out so a voxel does not fully occlude itself.
            px += d[0] * 0.5;
            py += d[1] * 0.5;
            pz += d[2] * 0.5;
            while (px >= 0 && py >= 0 && pz >= 0 && px < nx && py < ny && pz < nz) {
              tau += this.density[this.index(px | 0, py | 0, pz | 0)] * step;
              if (tau > 12) break;
              px += d[0] * 0.75;
              py += d[1] * 0.75;
              pz += d[2] * 0.75;
            }
            sum += Math.exp(-extinction * tau);
          }
          out[this.index(x, y, z)] = sum / directions;
        }
    this.visibility = out;
  }
  /** Trilinear visibility at a plant-space point. */
  sample(x: number, y: number, z: number) {
    const fx = (x - this.min[0]) / this.cell - 0.5,
      fy = (y - this.min[1]) / this.cell - 0.5,
      fz = (z - this.min[2]) / this.cell - 0.5;
    const [nx, ny, nz] = this.n;
    const x0 = Math.max(0, Math.min(nx - 2, Math.floor(fx))),
      y0 = Math.max(0, Math.min(ny - 2, Math.floor(fy))),
      z0 = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - x0)),
      ty = Math.min(1, Math.max(0, fy - y0)),
      tz = Math.min(1, Math.max(0, fz - z0));
    let v = 0;
    for (let k = 0; k < 2; k++)
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++)
          v +=
            this.visibility[this.index(x0 + i, y0 + j, z0 + k)] *
            (i ? tx : 1 - tx) *
            (j ? ty : 1 - ty) *
            (k ? tz : 1 - tz);
    return v;
  }
  /** Fill every part's per-vertex visibility. */
  apply(parts: readonly PlantPartMesh[]) {
    for (const p of parts) {
      const P = p.positions;
      for (let v = 0; v < p.visibility.length; v++)
        p.visibility[v] = this.sample(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    }
  }
}

/** A crown triangle reference: part index and triangle index. */
export interface CrownTriangles {
  part: Uint16Array;
  triangle: Uint32Array;
  centroid: Float32Array;
  area: Float32Array;
}
export function crownTriangles(parts: readonly PlantPartMesh[]): CrownTriangles {
  let count = 0;
  for (const p of parts) if (p.role === 'crown') count += p.indices.length / 3;
  const out: CrownTriangles = {
    part: new Uint16Array(count),
    triangle: new Uint32Array(count),
    centroid: new Float32Array(count * 3),
    area: new Float32Array(count),
  };
  let k = 0;
  parts.forEach((p, index) => {
    if (p.role !== 'crown') return;
    const P = p.positions,
      I = p.indices;
    for (let t = 0; t < I.length / 3; t++, k++) {
      const a = I[t * 3],
        b = I[t * 3 + 1],
        c = I[t * 3 + 2];
      out.part[k] = index;
      out.triangle[k] = t;
      for (let d = 0; d < 3; d++)
        out.centroid[k * 3 + d] = (P[a * 3 + d] + P[b * 3 + d] + P[c * 3 + d]) / 3;
      out.area[k] = triangleArea(P, a, b, c);
    }
  });
  return out;
}

/**
 * Area-weighted k-means of crown triangle centroids (`k` clusters, seeded).
 * Iterates on an area-weighted sample, then assigns every triangle.
 */
export function clusterCrown(crown: CrownTriangles, k: number, seed: number, iterations = 12) {
  const rnd = random(seed);
  const n = crown.area.length;
  // Area-weighted sample (systematic resampling).
  const sampleSize = Math.min(n, 60000);
  const cumulative = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) cumulative[i] = total += crown.area[i];
  const sample = new Uint32Array(sampleSize);
  let j = 0;
  const offset = rnd();
  for (let s = 0; s < sampleSize; s++) {
    const target = ((s + offset) / sampleSize) * total;
    while (j < n - 1 && cumulative[j] < target) j++;
    sample[s] = j;
  }
  // k-means++ style seeding on the sample (farthest-of-few for speed).
  const centres = new Float32Array(k * 3);
  for (let c = 0; c < k; c++) {
    let best = sample[Math.floor(rnd() * sampleSize)],
      bestDistance = -1;
    for (let attempt = 0; attempt < (c ? 6 : 1); attempt++) {
      const candidate = sample[Math.floor(rnd() * sampleSize)];
      let nearest = Infinity;
      for (let q = 0; q < c; q++) {
        const dx = crown.centroid[candidate * 3] - centres[q * 3],
          dy = crown.centroid[candidate * 3 + 1] - centres[q * 3 + 1],
          dz = crown.centroid[candidate * 3 + 2] - centres[q * 3 + 2];
        nearest = Math.min(nearest, dx * dx + dy * dy + dz * dz);
      }
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = candidate;
      }
    }
    for (let d = 0; d < 3; d++) centres[c * 3 + d] = crown.centroid[best * 3 + d];
  }
  const assign = (points: Uint32Array | null, labels: Uint16Array) => {
    const m = points ? points.length : n;
    for (let s = 0; s < m; s++) {
      const i = points ? points[s] : s;
      const x = crown.centroid[i * 3],
        y = crown.centroid[i * 3 + 1],
        z = crown.centroid[i * 3 + 2];
      let best = 0,
        bestDistance = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = x - centres[c * 3],
          dy = y - centres[c * 3 + 1],
          dz = z - centres[c * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      labels[s] = best;
    }
  };
  const labels = new Uint16Array(sampleSize);
  for (let it = 0; it < iterations; it++) {
    assign(sample, labels);
    const sums = new Float64Array(k * 4);
    for (let s = 0; s < sampleSize; s++) {
      const i = sample[s],
        c = labels[s];
      for (let d = 0; d < 3; d++) sums[c * 4 + d] += crown.centroid[i * 3 + d];
      sums[c * 4 + 3]++;
    }
    for (let c = 0; c < k; c++)
      if (sums[c * 4 + 3] > 0)
        for (let d = 0; d < 3; d++) centres[c * 3 + d] = sums[c * 4 + d] / sums[c * 4 + 3];
  }
  const all = new Uint16Array(n);
  assign(null, all);
  return { centres, labels: all };
}

/** Symmetric 3x3 eigen decomposition (Jacobi). Returns eigenvalues
 * ascending and matching unit eigenvectors. */
export function eigenSymmetric(m: number[][]) {
  const a = m.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p],
            akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k],
            aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p],
            vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = [0, 1, 2].sort((x, y) => a[x][x] - a[y][y]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]] as Vec3),
  };
}

export interface Card {
  /** Centre of the card rectangle (plant space). */
  centre: Vec3;
  /** Unit axes: right, up (texture u, v) and normal (front). */
  right: Vec3;
  up: Vec3;
  normal: Vec3;
  /** Half extents along right and up (m). */
  halfWidth: number;
  halfHeight: number;
  /** Crown triangles drawn on this card (indices into CrownTriangles). */
  members: Uint32Array;
  /** Atlas rectangle in pixels: x, y (top-left), w, h. */
  atlas: [number, number, number, number];
  /** Mean sky visibility of the card's leaves (for sorting/diagnostics). */
  area: number;
}

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export interface CardOptions {
  /** 'outward': vertical cards facing away from the trunk axis (conifer
   * sprays); 'fit': the cluster's thinnest axis, turned outward. */
  orientation: 'outward' | 'fit';
  /** Share of the outward direction mixed into a fitted normal. */
  outwardBias: number;
  /** Crown centre height (m), for outward directions. */
  crownCentreY: number;
}

/** Fit one card per cluster: plane through the area-weighted centroid,
 * upright texture axes, extent holding 98 % of the members' vertices. */
export function fitCards(
  parts: readonly PlantPartMesh[],
  crown: CrownTriangles,
  labels: Uint16Array,
  k: number,
  options: CardOptions,
): Card[] {
  const groups: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < labels.length; i++) groups[labels[i]].push(i);
  const cards: Card[] = [];
  for (const members of groups) {
    if (members.length < 2) continue;
    let w = 0;
    const mu: Vec3 = [0, 0, 0];
    for (const i of members) {
      const a = crown.area[i] + 1e-9;
      w += a;
      for (let d = 0; d < 3; d++) mu[d] += crown.centroid[i * 3 + d] * a;
    }
    for (let d = 0; d < 3; d++) mu[d] /= w;
    if (w < 1e-4) continue;
    const cov = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (const i of members) {
      const a = crown.area[i] + 1e-9;
      const p = [0, 1, 2].map((d) => crown.centroid[i * 3 + d] - mu[d]);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r][c] += (p[r] * p[c] * a) / w;
    }
    const outward = normalize([mu[0], (mu[1] - options.crownCentreY) * 0.35, mu[2]]);
    const horizontal = normalize([mu[0] || 1e-3, 0, mu[2]]);
    let normal: Vec3;
    if (options.orientation === 'outward') normal = horizontal;
    else {
      let e = eigenSymmetric(cov).vectors[0];
      if (dot3(e, outward) < 0) e = [-e[0], -e[1], -e[2]];
      normal = normalize([
        e[0] + outward[0] * options.outwardBias,
        e[1] + outward[1] * options.outwardBias,
        e[2] + outward[2] * options.outwardBias,
      ]);
    }
    // Texture up follows world up projected on the card (upright cards).
    let up: Vec3 = [-normal[0] * normal[1], 1 - normal[1] * normal[1], -normal[2] * normal[1]];
    if (Math.hypot(...up) < 0.2) up = cross(normal, normalize([normal[2], 0, -normal[0]]));
    up = normalize(up);
    const right = normalize(cross(up, normal));
    // Extent: every leaf vertex (a leaf is never cut by the card edge);
    // twigs and fine branches may be trimmed at their 2nd-98th percentile.
    const leafU: number[] = [],
      leafV: number[] = [],
      twigU: number[] = [],
      twigV: number[] = [];
    for (const i of members) {
      const part = parts[crown.part[i]],
        P = part.positions,
        I = part.indices,
        t = crown.triangle[i];
      for (let c = 0; c < 3; c++) {
        const v = I[t * 3 + c];
        const d: Vec3 = [P[v * 3] - mu[0], P[v * 3 + 1] - mu[1], P[v * 3 + 2] - mu[2]];
        (part.foliage ? leafU : twigU).push(dot3(d, right));
        (part.foliage ? leafV : twigV).push(dot3(d, up));
      }
    }
    for (const list of [leafU, leafV, twigU, twigV]) list.sort((a, b) => a - b);
    const q = (list: number[], f: number, fallback: number) =>
      list.length ? list[Math.min(list.length - 1, Math.floor(f * list.length))] : fallback;
    const u0 = Math.min(q(leafU, 0, Infinity), q(twigU, 0.02, Infinity)),
      u1 = Math.max(q(leafU, 0.9999, -Infinity), q(twigU, 0.98, -Infinity)),
      v0 = Math.min(q(leafV, 0, Infinity), q(twigV, 0.02, Infinity)),
      v1 = Math.max(q(leafV, 0.9999, -Infinity), q(twigV, 0.98, -Infinity));
    const pad = 0.03 * Math.max(u1 - u0, v1 - v0);
    const cu = (u0 + u1) / 2,
      cv = (v0 + v1) / 2;
    cards.push({
      centre: [
        mu[0] + right[0] * cu + up[0] * cv,
        mu[1] + right[1] * cu + up[1] * cv,
        mu[2] + right[2] * cu + up[2] * cv,
      ],
      right,
      up,
      normal,
      halfWidth: (u1 - u0) / 2 + pad,
      halfHeight: (v1 - v0) / 2 + pad,
      members: Uint32Array.from(members),
      atlas: [0, 0, 0, 0],
      area: w,
    });
  }
  return cards;
}

/**
 * Shelf-pack the cards into a `width` x `height` atlas at one texel density
 * (the largest that fits), with a `gutter` of pixels around every card.
 * Returns the density (pixels per metre).
 */
export function packCards(cards: Card[], width: number, height: number, gutter = 3) {
  const fits = (density: number) => {
    const order = [...cards].sort((a, b) => b.halfHeight - a.halfHeight);
    let x = 0,
      y = 0,
      shelf = 0;
    for (const card of order) {
      const w = Math.max(4, Math.round(card.halfWidth * 2 * density)),
        h = Math.max(4, Math.round(card.halfHeight * 2 * density));
      if (x + w + gutter * 2 > width) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      if (y + h + gutter * 2 > height) return false;
      card.atlas = [x + gutter, y + gutter, w, h];
      x += w + gutter * 2;
      shelf = Math.max(shelf, h + gutter * 2);
    }
    return true;
  };
  let lo = 1,
    hi = 4096;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  fits(lo);
  return lo;
}
