/** Signed-distance sculpting and a surface-nets polygoniser.
 *
 * Characters are sculpted as smooth unions of anatomical volumes (round cones,
 * ellipsoids, tori) instead of boxes and lathes. The polygoniser places one
 * vertex per surface cell, relaxes it onto the zero set and takes its normal
 * from the field gradient, so even a moderate triangle budget shades as an
 * organic, continuously curved surface. Pure functions, no DOM or GPU use. */

export type Field = (x: number, y: number, z: number) => number;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Polynomial smooth minimum (blend radius k, metres). */
export function smin(a: number, b: number, k: number) {
  if (k <= 0) return a < b ? a : b;
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
}
/** Smooth subtraction of b from a. */
export function ssub(a: number, b: number, k: number) {
  return -smin(-a, b, k);
}
export function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}
export function sphere(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
) {
  const dx = x - cx,
    dy = y - cy,
    dz = z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}
/** Exact round cone (capsule with different end radii), after I. Quilez. */
export function roundCone(
  x: number,
  y: number,
  z: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r1: number,
  r2: number,
) {
  const bax = bx - ax,
    bay = by - ay,
    baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-12) return sphere(x, y, z, ax, ay, az, Math.max(r1, r2));
  const rr = r1 - r2,
    a2 = l2 - rr * rr,
    il2 = 1 / l2;
  const pax = x - ax,
    pay = y - ay,
    paz = z - az;
  const yy = pax * bax + pay * bay + paz * baz;
  const z0 = yy - l2;
  const cx = pax * l2 - bax * yy,
    cy = pay * l2 - bay * yy,
    cz = paz * l2 - baz * yy;
  const x2 = cx * cx + cy * cy + cz * cz;
  const y2 = yy * yy * l2;
  const z2 = z0 * z0 * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z0) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
}
/** Bound-preserving ellipsoid approximation (I. Quilez). */
export function ellipsoid(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
) {
  const px = (x - cx) / rx,
    py = (y - cy) / ry,
    pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const qx = px / rx,
    qy = py / ry,
    qz = pz / rz;
  const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  if (k1 < 1e-9) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}
/** Axis-aligned rounded box. */
export function roundBox(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  r: number,
) {
  const qx = Math.abs(x - cx) - hx + r,
    qy = Math.abs(y - cy) - hy + r,
    qz = Math.abs(z - cz) - hz + r;
  const ox = Math.max(qx, 0),
    oy = Math.max(qy, 0),
    oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
/** Torus around the Y axis through (cx, cy, cz). */
export function torusY(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  major: number,
  minor: number,
  sx = 1,
  sz = 1,
) {
  const dx = (x - cx) / sx,
    dz = (z - cz) / sz;
  const q = Math.sqrt(dx * dx + dz * dz) - major;
  const dy = y - cy;
  return Math.sqrt(q * q + dy * dy) - minor;
}

export interface NetMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** Surface nets over [min, max] at `cell` metres. Empty blocks are skipped by
 * a conservative Lipschitz test, so sculpts with many volumes stay cheap. */
export function surfaceNets(
  field: Field,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  cell: number,
  relax = 2,
): NetMesh {
  if (!(cell > 0) || ![...min, ...max].every(Number.isFinite)) throw new Error('Invalid SDF grid');
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1,
    ny = Math.ceil((max[1] - min[1]) / cell) + 1,
    nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  if (nx * ny * nz > 6e6) throw new Error('SDF grid too large');
  const values = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  // Block skipping: one centre sample decides whether a 4^3 block can hold
  // the surface. Fields are at most ~1.4-Lipschitz (ellipsoid estimate).
  const B = 4,
    reach = Math.sqrt(3) * (B / 2) * cell * 1.5 + cell;
  for (let bk = 0; bk < nz; bk += B)
    for (let bj = 0; bj < ny; bj += B)
      for (let bi = 0; bi < nx; bi += B) {
        const ei = Math.min(nx, bi + B + 1),
          ej = Math.min(ny, bj + B + 1),
          ek = Math.min(nz, bk + B + 1);
        const centre = field(
          min[0] + ((bi + ei - 1) / 2) * cell,
          min[1] + ((bj + ej - 1) / 2) * cell,
          min[2] + ((bk + ek - 1) / 2) * cell,
        );
        const far = Math.abs(centre) > reach;
        for (let k = bk; k < ek; k++)
          for (let j = bj; j < ej; j++)
            for (let i = bi; i < ei; i++)
              values[at(i, j, k)] = far
                ? centre
                : field(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
      }
  const cellIndex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cat = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const positions: number[] = [];
  const corner = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const v = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = values[at(i + corner[c][0], j + corner[c][1], k + corner[c][2])];
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0,
          sy = 0,
          sz = 0,
          n = 0;
        for (const [a, b] of edges) {
          if (v[a] < 0 === v[b] < 0) continue;
          const t = v[a] / (v[a] - v[b]);
          sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t;
          sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t;
          sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t;
          n++;
        }
        cellIndex[cat(i, j, k)] = positions.length / 3;
        positions.push(
          min[0] + (i + sx / n) * cell,
          min[1] + (j + sy / n) * cell,
          min[2] + (k + sz / n) * cell,
        );
      }
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) [b, d] = [d, b];
    // Split along the shorter diagonal for better-shaped triangles.
    const dac =
      (positions[a * 3] - positions[c * 3]) ** 2 +
      (positions[a * 3 + 1] - positions[c * 3 + 1]) ** 2 +
      (positions[a * 3 + 2] - positions[c * 3 + 2]) ** 2;
    const dbd =
      (positions[b * 3] - positions[d * 3]) ** 2 +
      (positions[b * 3 + 1] - positions[d * 3 + 1]) ** 2 +
      (positions[b * 3 + 2] - positions[d * 3 + 2]) ** 2;
    if (dac <= dbd) indices.push(a, b, c, a, c, d);
    else indices.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const inside = values[at(i, j, k)] < 0;
        // +X edge: cells sharing it vary in j, k.
        if (i < nx - 1 && inside !== values[at(i + 1, j, k)] < 0)
          quad(
            cellIndex[cat(i, j - 1, k - 1)],
            cellIndex[cat(i, j, k - 1)],
            cellIndex[cat(i, j, k)],
            cellIndex[cat(i, j - 1, k)],
            !inside,
          );
        if (j < ny - 1 && inside !== values[at(i, j + 1, k)] < 0)
          quad(
            cellIndex[cat(i - 1, j, k - 1)],
            cellIndex[cat(i - 1, j, k)],
            cellIndex[cat(i, j, k)],
            cellIndex[cat(i, j, k - 1)],
            !inside,
          );
        if (k < nz - 1 && inside !== values[at(i, j, k + 1)] < 0)
          quad(
            cellIndex[cat(i - 1, j - 1, k)],
            cellIndex[cat(i, j - 1, k)],
            cellIndex[cat(i, j, k)],
            cellIndex[cat(i - 1, j, k)],
            !inside,
          );
      }
  // Project every vertex onto the zero set and use the field gradient for
  // normals: the shading follows the sculpt, not the facet orientation.
  const count = positions.length / 3;
  const out = new Float32Array(positions);
  const normals = new Float32Array(count * 3);
  const e = cell * 0.25;
  for (let i = 0; i < count; i++) {
    let x = out[i * 3],
      y = out[i * 3 + 1],
      z = out[i * 3 + 2];
    let gx = 0,
      gy = 0,
      gz = 1;
    for (let it = 0; it <= relax; it++) {
      const d = field(x, y, z);
      gx = field(x + e, y, z) - field(x - e, y, z);
      gy = field(x, y + e, z) - field(x, y - e, z);
      gz = field(x, y, z + e) - field(x, y, z - e);
      const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e);
      if (it === relax || g2 < 1e-8) break;
      // Bounded Newton step keeps creased vertices inside their cell.
      const s = Math.max(-cell * 0.6, Math.min(cell * 0.6, d / g2));
      x -= (s * gx) / (2 * e);
      y -= (s * gy) / (2 * e);
      z -= (s * gz) / (2 * e);
    }
    const l = Math.hypot(gx, gy, gz) || 1;
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
    normals[i * 3] = gx / l;
    normals[i * 3 + 1] = gy / l;
    normals[i * 3 + 2] = gz / l;
  }
  return { positions: out, normals, indices: Uint32Array.from(indices) };
}
