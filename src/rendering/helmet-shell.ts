import * as T from 'three';

// Vehicle-local metres, centred on the head rather than the neck pivot.
// [height, half-width, forward reach, rearward reach]. The chin, cheeks, brow
// and crown have independent contours: neither the visor nor its gasket is a
// second sphere hovering above an unrelated spherical head.
export const HELMET_PROFILE = Object.freeze([
  [-0.135, 0.058, 0.058, 0.063],
  [-0.119, 0.086, 0.117, 0.086],
  [-0.09, 0.107, 0.153, 0.111],
  [-0.05, 0.127, 0.153, 0.134],
  [-0.009, 0.137, 0.142, 0.143],
  [0.041, 0.137, 0.136, 0.141],
  [0.083, 0.118, 0.117, 0.122],
  [0.117, 0.0888107107, 0.0880580776, 0.0918212433],
  [0.138, 0.0543372005, 0.0538767157, 0.0561791395],
  [0.149, 0, 0, 0],
] as const);

function profile(y: number, axis: 1 | 2 | 3) {
  const p = HELMET_PROFILE;
  if (y >= 0.083)
    return (
      (p[6][axis] * Math.sqrt(Math.max(0, 1 - ((y - 0.015) / 0.134) ** 2))) /
      Math.sqrt(1 - ((0.083 - 0.015) / 0.134) ** 2)
    );
  let i = 0;
  while (i < p.length - 2 && y > p[i + 1][0]) i++;
  const a = p[i],
    b = p[i + 1],
    before = p[Math.max(0, i - 1)],
    after = p[Math.min(p.length - 1, i + 2)];
  const d = b[0] - a[0],
    t = T.MathUtils.clamp((y - a[0]) / d, 0, 1);
  const m0 = (b[axis] - before[axis]) / (b[0] - before[0]);
  const m1 = (after[axis] - a[axis]) / (after[0] - a[0]);
  return T.MathUtils.clamp(
    (2 * t * t * t - 3 * t * t + 1) * a[axis] +
      (t * t * t - 2 * t * t + t) * d * m0 +
      (-2 * t * t * t + 3 * t * t) * b[axis] +
      (t * t * t - t * t) * d * m1,
    Math.min(a[axis], b[axis]),
    Math.max(a[axis], b[axis]),
  );
}

/** phi=PI/2 faces forward (+Z). Offset is radial shell separation in metres;
 * the visor domain deliberately avoids the pole and neck cap. */
export function helmetPoint(y: number, phi: number, offset = 0, out = new T.Vector3()) {
  if (
    ![y, phi, offset].every(Number.isFinite) ||
    y < -0.135 ||
    y > 0.149 ||
    Math.abs(offset) > 0.01
  )
    throw new Error('Invalid helmet surface coordinate');
  const c = Math.cos(phi),
    s = Math.sin(phi),
    forward = Math.max(0, s);
  const cheek = T.MathUtils.smoothstep(-y, 0.025, 0.105);
  return out.set(
    -c * (profile(y, 1) + offset) * (1 - 0.035 * cheek * forward ** 4),
    y,
    s * (profile(y, s >= 0 ? 2 : 3) + offset),
  );
}

/** Single-sided, outward-wound conformal patch; its boundaries may be reused
 * for gasket and tear-off details without inventing another shell transform. */
export function helmetPatch(
  y0: number,
  y1: number,
  phi0: number,
  phi1: number,
  offset = 0.003,
  rows = 8,
  columns = 32,
) {
  if (
    !(y0 < y1 && phi0 < phi1) ||
    phi1 - phi0 > Math.PI * 2 + 1e-8 ||
    ![rows, columns].every((n) => Number.isInteger(n) && n >= 1 && n <= 64)
  )
    throw new Error('Invalid helmet patch');
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    point = new T.Vector3();
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= columns; j++) {
      helmetPoint(
        T.MathUtils.lerp(y0, y1, i / rows),
        T.MathUtils.lerp(phi0, phi1, j / columns),
        offset,
        point,
      );
      positions.push(point.x, point.y, point.z);
      uvs.push(j / columns, i / rows);
      if (i < rows && j < columns) {
        const a = i * (columns + 1) + j,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function helmetShell() {
  // Keep every authored contour row at all circumferential angles. The top is
  // one pole, and the separate bottom cap keeps its edge from shading like skin.
  const ys: number[] = [];
  for (let i = 0; i < HELMET_PROFILE.length - 1; i++)
    for (let j = 0; j < 5; j++)
      ys.push(T.MathUtils.lerp(HELMET_PROFILE[i][0], HELMET_PROFILE[i + 1][0], j / 5));
  const columns = 64,
    stride = columns + 1,
    pos: number[] = [],
    uv: number[] = [],
    ix: number[] = [],
    v = new T.Vector3();
  for (let i = 0; i < ys.length; i++)
    for (let j = 0; j <= columns; j++) {
      helmetPoint(ys[i], (j / columns) * Math.PI * 2, 0, v);
      pos.push(v.x, v.y, v.z);
      uv.push(j / columns, (ys[i] + 0.135) / 0.284);
      if (i < ys.length - 1 && j < columns) {
        const a = i * stride + j,
          b = a + stride;
        ix.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const top = pos.length / 3;
  pos.push(0, 0.149, 0);
  uv.push(0.5, 1);
  for (let j = 0; j < columns; j++)
    ix.push((ys.length - 1) * stride + j, (ys.length - 1) * stride + j + 1, top);
  const bottom = pos.length / 3;
  pos.push(0, ys[0], 0);
  uv.push(0.5, 0.5);
  for (let j = 0; j <= columns; j++) {
    pos.push(...pos.slice(j * 3, j * 3 + 3));
    uv.push(
      0.5 + Math.cos((j / columns) * Math.PI * 2) * 0.5,
      0.5 + Math.sin((j / columns) * Math.PI * 2) * 0.5,
    );
  }
  for (let j = 0; j < columns; j++) ix.push(bottom, bottom + j + 2, bottom + j + 1);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  const n = g.getAttribute('normal'),
    avg = new T.Vector3();
  for (let i = 0; i < ys.length; i++) {
    const a = i * stride,
      b = a + columns;
    avg.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, avg.x, avg.y, avg.z);
    n.setXYZ(b, avg.x, avg.y, avg.z);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Eye-port visor outline at a shield angle: full height across the front,
 * narrowing to the pivot arms at the sides (not a constant-height band). */
export const VISOR_PHI = Object.freeze([0.095, Math.PI - 0.095] as const);
export function visorBounds(phi: number) {
  const a = Math.min(1, Math.abs(phi - Math.PI / 2) / (Math.PI / 2 - VISOR_PHI[0]));
  const half = T.MathUtils.lerp(0.038, 0.0105, T.MathUtils.smoothstep(a, 0.5, 0.96));
  // Slightly lower brow at the temples, as a real eye port is.
  const centre = 0.005 - 0.004 * T.MathUtils.smoothstep(a, 0.3, 0.7);
  return [centre - half, centre + half] as const;
}

/** Conformal visor shield following `visorBounds`; UV u across, v up. */
export function visorGeometry(offset = 0.003, rows = 8, columns = 32) {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    point = new T.Vector3();
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= columns; j++) {
      const phi = T.MathUtils.lerp(VISOR_PHI[0], VISOR_PHI[1], j / columns);
      const [y0, y1] = visorBounds(phi);
      helmetPoint(T.MathUtils.lerp(y0, y1, i / rows), phi, offset, point);
      positions.push(point.x, point.y, point.z);
      uvs.push(j / columns, i / rows);
      if (i < rows && j < columns) {
        const a = i * (columns + 1) + j,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Rear crown spoiler: a ramp rising off the shell toward a trailing lip,
 * closed by end plates. Each thin panel is a smooth grid present on both
 * faces (separate vertices per face). */
export function helmetSpoilerGeometry(columns = 12, rows = 4) {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const p = new T.Vector3();
  const half = 0.5,
    yLead = 0.122,
    yTrail = 0.094,
    lift = 0.0095;
  const rear = (Math.PI * 3) / 2;
  const sheet = (nu: number, nv: number, at: (u: number, v: number) => T.Vector3) => {
    for (const flip of [false, true]) {
      const base = positions.length / 3;
      for (let i = 0; i <= nv; i++)
        for (let j = 0; j <= nu; j++) {
          at(j / nu, i / nv);
          positions.push(p.x, p.y, p.z);
          uvs.push(j / nu, i / nv);
        }
      for (let i = 0; i < nv; i++)
        for (let j = 0; j < nu; j++) {
          const a = base + i * (nu + 1) + j,
            b = a + nu + 1;
          if (flip) indices.push(a, b, a + 1, a + 1, b, b + 1);
          else indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
  };
  const ramp = (v: number) => lift * v ** 1.3;
  const y = (v: number) => T.MathUtils.lerp(yLead, yTrail, v);
  sheet(columns, rows, (u, v) => helmetPoint(y(v), rear - half + 2 * half * u, ramp(v), p));
  sheet(columns, 1, (u, v) => helmetPoint(yTrail, rear - half + 2 * half * u, lift * (1 - v), p));
  for (const f of [rear - half, rear + half])
    sheet(rows, 1, (u, v) => helmetPoint(y(u), f, ramp(u) * (1 - v), p));
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
