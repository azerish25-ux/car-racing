import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sampleProfile } from '../profile-sampling.ts';
import type { RiderDetail } from '../rider.ts';
import { mouldedPanel } from './motocross-detail.ts';

function part(parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0) {
  const mesh = new T.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Small authored folds interrupt the perfect tubes at the waist and elbows.
 * They are baked once and inherit the existing contact-preserving rider IK. */
export function drapeMotocrossFabric(g: T.BufferGeometry, amplitude = 0.003) {
  const p = g.getAttribute('position');
  g.computeBoundingBox();
  const box = g.boundingBox!,
    height = Math.max(0.01, box.max.y - box.min.y);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      r = Math.hypot(x, z);
    if (r < 0.012) continue;
    const t = (y - box.min.y) / height,
      angle = Math.atan2(z, x);
    const folds =
      amplitude * (0.35 + 0.65 * Math.sin(t * Math.PI) ** 2) * Math.sin(t * 31 + angle * 3.5);
    p.setXYZ(i, x * (1 + folds / r), y, z * (1 + folds / r));
  }
  g.computeVertexNormals();
  return g;
}

// Neck-centred assembly uses the same 150 mm shell offset as the road rig, but
// an MX shell has its own projected chin, lower cheek rail and taller eye port.
// Columns are [height, half-width, forward extent, rearward extent], in metres.
const MX_HELMET_PROFILE = [
  [-0.135, 0.062, 0.113, 0.062],
  [-0.118, 0.085, 0.185, 0.084],
  [-0.089, 0.108, 0.216, 0.11],
  [-0.063, 0.122, 0.207, 0.13],
  [-0.038, 0.132, 0.184, 0.14],
  [0.005, 0.136, 0.179, 0.142],
  [0.038, 0.134, 0.174, 0.138],
  [0.065, 0.124, 0.162, 0.128],
  [0.094, 0.103, 0.122, 0.105],
  [0.123, 0.074, 0.086, 0.077],
  [0.141, 0.037, 0.043, 0.039],
  [0.15, 0, 0, 0],
] as const;
const MX_HEIGHTS = MX_HELMET_PROFILE.map((p) => p[0]);
const MX_RADII = [1, 2, 3].map((axis) => MX_HELMET_PROFILE.map((p) => p[axis]));

function motocrossHelmetPoint(y: number, phi: number, offset = 0) {
  const front = Math.max(0, Math.sin(phi)),
    jaw = 1 - T.MathUtils.smoothstep(y, -0.07, -0.025);
  return new T.Vector3(
    -Math.cos(phi) *
      (sampleProfile(MX_HEIGHTS, MX_RADII[0], y) + offset) *
      (1 - 0.075 * jaw * front ** 4),
    y,
    Math.sin(phi) * (sampleProfile(MX_HEIGHTS, MX_RADII[front > 0 ? 1 : 2], y) + offset),
  );
}

function motocrossHelmetPatch(
  y0: number,
  y1: number,
  phi0: number,
  phi1: number,
  offset: number,
  rows = 4,
  columns = 24,
) {
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      const p = motocrossHelmetPoint(
        T.MathUtils.lerp(y0, y1, row / rows),
        T.MathUtils.lerp(phi0, phi1, column / columns),
        offset,
      );
      positions.push(p.x, p.y, p.z);
      uv.push(column / columns, row / rows);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** The black return closes the shell thickness around the eye opening. A
 * recessed backing alone leaves a see-through slit at the exposed cut edge. */
function motocrossEyePortReturn(detail: RiderDetail) {
  const steps = detail === 'far' ? 8 : 24,
    outline: [number, number][] = [],
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < steps; i++)
    outline.push([0.065, T.MathUtils.lerp(Math.PI / 8, (Math.PI * 7) / 8, i / steps)]);
  for (let i = 0; i < steps; i++)
    outline.push([T.MathUtils.lerp(0.065, -0.038, i / steps), (Math.PI * 7) / 8]);
  for (let i = 0; i < steps; i++)
    outline.push([-0.038, T.MathUtils.lerp((Math.PI * 7) / 8, Math.PI / 8, i / steps)]);
  for (let i = 0; i < steps; i++)
    outline.push([T.MathUtils.lerp(-0.038, 0.065, i / steps), Math.PI / 8]);
  for (const [y, phi] of outline)
    for (const offset of [0, -0.013]) {
      const p = motocrossHelmetPoint(y, phi, offset);
      positions.push(p.x, p.y, p.z);
      uv.push(phi / (Math.PI * 2), (y + 0.135) / 0.285);
    }
  for (let i = 0; i < outline.length; i++) {
    const a = i * 2,
      b = ((i + 1) % outline.length) * 2;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Dedicated MX silhouette at all LODs. The eye port is an actual opening in
 * the outer shell, backed by a recessed dark liner in addMotocrossHelmet;
 * race graphics therefore cannot show through the gap around the goggles. */
export function motocrossHelmetShell(detail: RiderDetail = 'high') {
  const columns = detail === 'high' ? 48 : detail === 'mid' ? 32 : 16,
    subdivisions = detail === 'high' ? 4 : detail === 'mid' ? 2 : 1,
    ys: number[] = [],
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < MX_HEIGHTS.length - 1; i++)
    for (let step = 0; step < subdivisions; step++)
      ys.push(T.MathUtils.lerp(MX_HEIGHTS[i], MX_HEIGHTS[i + 1], step / subdivisions));
  for (let row = 0; row < ys.length; row++)
    for (let column = 0; column <= columns; column++) {
      const p = motocrossHelmetPoint(ys[row], (column / columns) * Math.PI * 2);
      positions.push(p.x, p.y, p.z);
      uv.push(column / columns, (ys[row] + 0.135) / 0.285);
      if (row < ys.length - 1 && column < columns) {
        const inEyePort =
          ys[row] >= -0.038 - 1e-9 &&
          ys[row + 1] <= 0.065 + 1e-9 &&
          column >= columns / 16 &&
          column < (columns * 7) / 16;
        if (inEyePort) continue;
        const a = row * (columns + 1) + column,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const top = positions.length / 3;
  positions.push(0, 0.15, 0);
  uv.push(0.5, 1);
  for (let i = 0; i < columns; i++)
    indices.push((ys.length - 1) * (columns + 1) + i, (ys.length - 1) * (columns + 1) + i + 1, top);
  const bottom = positions.length / 3;
  positions.push(0, ys[0], 0);
  uv.push(0.5, 0);
  for (let i = 0; i < columns; i++) indices.push(bottom, i + 1, i);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const normal = g.getAttribute('normal'),
    average = new T.Vector3();
  for (let row = 0; row < ys.length; row++) {
    const a = row * (columns + 1),
      b = a + columns;
    average
      .fromBufferAttribute(normal, a)
      .add(new T.Vector3().fromBufferAttribute(normal, b))
      .normalize();
    normal.setXYZ(a, average.x, average.y, average.z);
    normal.setXYZ(b, average.x, average.y, average.z);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function peakGeometry(detail: RiderDetail) {
  const rows = detail === 'high' ? 9 : 5,
    columns = detail === 'high' ? 14 : 8;
  const pos: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (const under of [false, true]) {
    const base = pos.length / 3;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= columns; i++) {
        const v = j / rows,
          u = (i / columns) * 2 - 1;
        const width = 0.096 + Math.sin(v * Math.PI) * 0.024;
        const y = 0.26 - v * v * 0.027 + 0.008 * (1 - u * u) - (under ? 0.0045 : 0);
        pos.push(u * width, y, 0.038 + v * (0.225 - 0.015 * Math.abs(u)));
        uv.push(i / columns, 1 - v);
        if (j < rows && i < columns) {
          const a = base + j * (columns + 1) + i,
            b = a + columns + 1;
          if (under) index.push(a, a + 1, b, a + 1, b + 1, b);
          else index.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
  }
  // Close the front and side lips so the peak remains a thin moulding in
  // backlit and underside views, rather than a pair of unrelated sheets.
  const stride = (rows + 1) * (columns + 1);
  for (let i = 0; i < columns; i++) {
    const a = rows * (columns + 1) + i,
      b = a + stride;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  for (let row = 0; row < rows; row++)
    for (const column of [0, columns]) {
      const a = row * (columns + 1) + column,
        b = a + columns + 1;
      if (column === 0) index.push(a, a + stride, b, b, a + stride, b + stride);
      else index.push(a, b, a + stride, b, b + stride, a + stride);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function gogglePoint(u: number, v: number) {
  const x = (u * 2 - 1) * 0.106 * (1 - 0.04 * Math.abs(v * 2 - 1)),
    edge = Math.abs(u * 2 - 1);
  const bottom = 0.132 + Math.exp(-(((u - 0.5) * 12) ** 2)) * 0.012 + edge ** 4 * 0.007;
  const top = 0.205 - edge ** 2 * 0.012;
  return new T.Vector3(
    x,
    T.MathUtils.lerp(bottom, top, v),
    0.198 - edge * edge * 0.037 - (v - 0.5) ** 2 * 0.01,
  );
}

/** Peaked shell, curved mirrored goggles, foam gasket, real ribbon strap and
 * vented chin protector. All meshes are merged by the caller per material. */
export function addMotocrossHelmet(
  head: T.Group,
  detail: RiderDetail,
  shell: T.Material,
  lens: T.Material,
  trim: T.Material,
  accent: T.Material,
) {
  part(head, peakGeometry(detail), shell).name = 'Motocross swept helmet peak';
  part(
    head,
    motocrossHelmetPatch(-0.038, 0.065, Math.PI / 8, (Math.PI * 7) / 8, -0.013),
    trim,
    0,
    0.15,
    0.02,
  ).name = 'Motocross recessed eye-port liner';
  part(head, motocrossEyePortReturn(detail), trim, 0, 0.15, 0.02).name =
    'Motocross eye-port shell return';
  if (detail === 'far') {
    // Preserve the two defining off-road helmet features at distance without
    // retaining the close curved gasket, vents and fasteners.
    part(head, new T.BoxGeometry(0.198, 0.067, 0.024), trim, 0, 0.167, 0.186);
    part(head, new T.PlaneGeometry(0.17, 0.046), lens, 0, 0.171, 0.199);
    return;
  }
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    columns = detail === 'high' ? 24 : 12,
    rows = 5;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= columns; i++) {
      const p = gogglePoint(i / columns, j / rows);
      positions.push(p.x, p.y, p.z);
      uv.push(i / columns, j / rows);
      if (j < rows && i < columns) {
        const a = j * (columns + 1) + i,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const lensGeometry = new T.BufferGeometry();
  lensGeometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  lensGeometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  lensGeometry.setIndex(indices);
  lensGeometry.computeVertexNormals();
  part(head, lensGeometry, lens).name = 'Motocross curved goggle lens';
  const outline: T.Vector3[] = [];
  for (const edge of [1, 0])
    for (let i = 0; i <= 24; i++) outline.push(gogglePoint(edge ? i / 24 : 1 - i / 24, edge));
  part(
    head,
    new T.TubeGeometry(new T.CatmullRomCurve3(outline, true), 60, 0.008, 6, true),
    trim,
  ).name = 'Motocross goggle foam gasket';
  const rim = part(
    head,
    new T.TubeGeometry(
      new T.CatmullRomCurve3(
        outline.map((p) => p.clone().add(new T.Vector3(0, 0, 0.003))),
        true,
      ),
      60,
      0.0034,
      5,
      true,
    ),
    accent,
  );
  rim.name = 'Motocross goggle frame';
  const strap = part(
    head,
    motocrossHelmetPatch(0.002, 0.034, Math.PI - 0.11, Math.PI * 2 + 0.11, 0.006, 2, 32),
    trim,
    0,
    0.15,
    0.02,
  );
  strap.name = 'Motocross woven goggle strap';
  const vent = part(
    head,
    motocrossHelmetPatch(-0.112, -0.066, 1.12, Math.PI - 1.12, 0.0015),
    trim,
    0,
    0.15,
    0.02,
  );
  vent.name = 'Motocross integrated chin intake';
  for (let i = 0; i < 3; i++) {
    const y = -0.105 + i * 0.012;
    part(
      head,
      motocrossHelmetPatch(y, y + 0.0035, 1.12, Math.PI - 1.12, 0.004, 1, 16),
      accent,
      0,
      0.15,
      0.02,
    );
  }
  for (const side of [-1, 1]) {
    const fastener = part(
      head,
      new T.CylinderGeometry(0.007, 0.007, 0.006, 8),
      accent,
      side * 0.12,
      0.24,
      0.065,
    );
    fastener.rotation.z = Math.PI / 2;
    const phi = side > 0 ? 0.64 : Math.PI - 0.96;
    part(
      head,
      motocrossHelmetPatch(0.095, 0.118, phi, phi + 0.32, 0.0018, 2, 8),
      trim,
      0,
      0.15,
      0.02,
    );
    part(
      head,
      motocrossHelmetPatch(-0.096, -0.07, phi, phi + 0.32, 0.0018, 2, 8),
      trim,
      0,
      0.15,
      0.02,
    );
  }
}

/** Off-road boots have a distinct calf, shin protector, ankle hinge, toe box,
 * rubber sole and four buckles. Coordinates match the existing ankle group. */
export function addMotocrossBoot(
  foot: T.Group,
  detail: RiderDetail,
  side: number,
  boot: T.Material,
  flex: T.Material,
  metal: T.Material,
) {
  const sides = detail === 'high' ? 16 : detail === 'mid' ? 10 : 6;
  const shaft = new T.LatheGeometry(
    [
      new T.Vector2(0.045, -0.325),
      new T.Vector2(0.057, -0.3),
      new T.Vector2(0.061, -0.23),
      new T.Vector2(0.054, -0.14),
      new T.Vector2(0.043, -0.052),
      new T.Vector2(0.044, -0.004),
    ],
    sides,
  );
  part(foot, shaft, boot).scale.set(0.93, 1, 0.9);
  part(
    foot,
    new RoundedBoxGeometry(0.089, 0.074, 0.234, detail === 'far' ? 1 : 3, 0.026),
    boot,
    0,
    -0.016,
    0.045,
  );
  part(foot, new RoundedBoxGeometry(0.096, 0.017, 0.251, 2, 0.007), flex, 0, 0.025, 0.052);
  if (detail === 'far') return;
  const protector = part(
    foot,
    mouldedPanel(
      [
        [-0.035, 0.1],
        [-0.043, 0.062],
        [-0.031, -0.084],
        [0.03, -0.084],
        [0.043, 0.062],
        [0.035, 0.1],
      ],
      0.007,
      0.003,
    ),
    boot,
    0,
    -0.204,
    0.052,
  );
  protector.name = 'Motocross moulded shin protector';
  const inset = part(
    foot,
    new RoundedBoxGeometry(0.044, 0.09, 0.008, 2, 0.006),
    flex,
    0,
    -0.208,
    0.059,
  );
  inset.rotation.z = side * 0.13;
  for (let i = 0; i < 4; i++) {
    const y = -0.061 - i * 0.064;
    const strap = part(foot, new T.TorusGeometry(0.052, 0.004, 5, sides), flex, 0, y, 0);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1, 0.91, 1);
    const buckle = part(
      foot,
      new RoundedBoxGeometry(0.019, 0.014, 0.03, 2, 0.004),
      metal,
      side * 0.052,
      y,
      0.018,
    );
    buckle.name = 'Motocross boot buckle';
  }
  const hinge = part(
    foot,
    new T.CylinderGeometry(0.018, 0.018, 0.008, 12),
    flex,
    side * 0.046,
    -0.059,
    -0.004,
  );
  hinge.rotation.z = Math.PI / 2;
  part(foot, new RoundedBoxGeometry(0.073, 0.02, 0.055, 2, 0.005), flex, 0, -0.054, 0.07);
  if (detail === 'high')
    for (let rib = 0; rib < 4; rib++)
      part(
        foot,
        new RoundedBoxGeometry(0.068, 0.005, 0.01, 2, 0.002),
        boot,
        0,
        -0.066,
        0.033 + rib * 0.021,
      );
}
