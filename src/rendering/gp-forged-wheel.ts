import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RiderDetail } from './rider.ts';

/** Original forged wheel, informed by reference 018's branching spokes and
 * recessed rim. Axle is local X. The barrel, bead lips and hollow hub have
 * thickness; the five split spokes leave genuine openings in every LOD.
 * All parts share one existing wheel material and one owned geometry. */
export function gpForgedWheel(rim: number, halfWidth: number, detail: RiderDetail) {
  if (!Number.isFinite(rim) || rim < 0.15 || rim > 0.3)
    throw new RangeError('Invalid GP wheel rim radius');
  if (!Number.isFinite(halfWidth) || halfWidth < 0.04 || halfWidth > 0.12)
    throw new RangeError('Invalid GP wheel half-width');
  const close = detail === 'high',
    segments = close ? 48 : 28,
    width = halfWidth * 0.76;
  const pieces: T.BufferGeometry[] = [];
  const lathe = (profile: readonly (readonly [number, number])[], sides = segments) => {
    const g = new T.LatheGeometry(
      profile.map(([r, x]) => new T.Vector2(r, x)),
      sides,
    );
    g.rotateZ(Math.PI / 2);
    pieces.push(g);
  };
  // Closed rim section: rolled bead edge, bead seat and a recessed central
  // channel. The old open cylinder had no thickness or machined highlight.
  const outer: [number, number][] = [
    [rim - 0.01, -width],
    [rim - 0.002, -width],
    [rim + 0.0015, -width + 0.002],
    [rim + 0.002, -width + 0.005],
    [rim - 0.005, -width + 0.012],
    [rim - 0.015, -width + 0.022],
    [rim - 0.021, -width * 0.4],
  ];
  lathe([
    ...outer,
    ...[...outer].reverse().map(([r, x]) => [r, -x] as const),
    [rim - 0.026, width * 0.4],
    [rim - 0.026, -width * 0.4],
    outer[0],
  ]);
  const hubWidth = halfWidth * 0.61;
  lathe(
    [
      [0.014, -hubWidth],
      [0.031, -hubWidth],
      [0.043, -hubWidth + 0.01],
      [0.048, -0.015],
      [0.048, 0.015],
      [0.043, hubWidth - 0.01],
      [0.031, hubWidth],
      [0.014, hubWidth],
      [0.014, -hubWidth],
    ],
    close ? 32 : 20,
  );

  // Each ring is a chamfered rectangular forging. The crown and gradual
  // dish follow the wheel's width, without turning the spokes into tubes.
  type Station = readonly [number, number, number, number, number];
  const spoke = (stations: readonly Station[], rotation: number) => {
    const p: number[] = [],
      uv: number[] = [],
      index: number[] = [];
    const section = [
      [1, 0.6],
      [0.65, 1],
      [-0.65, 1],
      [-1, 0.6],
      [-1, -0.6],
      [-0.65, -1],
      [0.65, -1],
      [1, -0.6],
    ];
    for (const [i, [r, sweep, dish, depth, breadth]] of stations.entries())
      for (const [j, [x, z]] of section.entries()) {
        p.push(dish + x * depth, r, sweep + z * breadth);
        uv.push(j / section.length, i / (stations.length - 1));
      }
    for (let i = 0; i < stations.length - 1; i++)
      for (let j = 0; j < section.length; j++) {
        const a = i * section.length + j,
          b = i * section.length + ((j + 1) % section.length),
          c = a + section.length,
          d = b + section.length;
        index.push(a, c, b, b, c, d);
      }
    // End faces are inside the hub/rim or overlapping forged branch root.
    for (let j = 1; j < section.length - 1; j++) {
      index.push(0, j, j + 1);
      const end = (stations.length - 1) * section.length;
      index.push(end, end + j + 1, end + j);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    g.rotateX(rotation);
    pieces.push(g);
  };
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2,
      dish = halfWidth * 0.14;
    spoke(
      [
        [0.042, 0, 0, 0.023, 0.014],
        [0.069, 0.003, dish * 0.4, 0.019, 0.012],
        [0.107, 0.005, dish, 0.013, 0.01],
      ],
      angle,
    );
    for (const side of [-1, 1])
      spoke(
        [
          [0.084, 0.004, dish * 0.6, 0.016, 0.01],
          [0.126, 0.006 + side * 0.012, dish, 0.013, 0.007],
          [rim - 0.05, 0.006 + side * 0.026, dish * 0.8, 0.011, 0.0055],
          [rim - 0.014, side * 0.042, dish * 0.45, 0.016, 0.008],
        ],
        angle,
      );
  }
  const geometry = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  if (!geometry) throw new Error('Could not merge GP forged wheel');
  geometry.name = 'GP hollow forged split-spoke wheel';
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Two opposing painted compound arcs per side, fitted to the actual tyre
 * facets. Sampling its source vertices (including angular interpolation)
 * prevents floating rings or stripes buried in the wider rear sidewall.
 * The 0.35 mm offset is a decal film, with no axial bridge through the wheel.
 * All four arcs use the existing compound material and cost one draw. */
export function gpTyreCompoundMarkings(tyre: T.LatheGeometry) {
  const positions = tyre.getAttribute('position'),
    normals = tyre.getAttribute('normal'),
    points = tyre.parameters.points,
    segments = tyre.parameters.segments,
    rowCount = points.length,
    step = (Math.PI * 2) / segments;
  const p: number[] = [],
    n: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const normal = new T.Vector3(),
    location = new T.Vector3(),
    scratch = new T.Vector3();
  for (const sign of [-1, 1]) {
    const rows = Array.from({ length: 5 }, (_, i) => (sign < 0 ? i : rowCount - 1 - i)),
      min = points[rows[0]].x,
      max = points[rows[4]].x,
      radii = [min + (max - min) * 0.52, min + (max - min) * 0.52 + 0.0035];
    const at = (radius: number, angle: number) => {
      let row = 0;
      while (row < rows.length - 2 && points[rows[row + 1]].x < radius) row++;
      const radial =
        (radius - points[rows[row]].x) / (points[rows[row + 1]].x - points[rows[row]].x);
      const a = angle / step,
        segment = Math.min(segments - 1, Math.floor(a)),
        fraction = a - segment;
      location.set(0, 0, 0);
      normal.set(0, 0, 0);
      for (let r = 0; r < 2; r++)
        for (let s = 0; s < 2; s++) {
          const vertex = (segment + s) * rowCount + rows[row + r],
            weight = (r ? radial : 1 - radial) * (s ? fraction : 1 - fraction);
          location.addScaledVector(scratch.fromBufferAttribute(positions, vertex), weight);
          normal.addScaledVector(scratch.fromBufferAttribute(normals, vertex), weight);
        }
      normal.normalize();
      location.addScaledVector(normal, 0.00035);
      p.push(...location.toArray());
      n.push(...normal.toArray());
    };
    for (const start of [0.2, Math.PI + 0.2]) {
      const end = start + 1.15,
        angles = [start];
      for (let angle = Math.ceil(start / step) * step; angle < end; angle += step)
        angles.push(angle);
      angles.push(end);
      const first = p.length / 3;
      for (const [i, angle] of angles.entries())
        for (const [j, radius] of radii.entries()) {
          at(radius, angle);
          uv.push(j, i / (angles.length - 1));
        }
      for (let i = 0; i < angles.length - 1; i++) {
        const a = first + i * 2;
        if (sign < 0) index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        else index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(n, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.name = 'Conformal GP compound paint arcs';
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
