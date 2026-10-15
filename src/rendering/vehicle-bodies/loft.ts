import * as T from 'three';

/** Surface construction for procedural vehicle bodies (WP30). Bodies are
 * lofts of mirrored cross-sections: each section is a half profile (x >= 0,
 * bottom centre to top centre) of control points smoothed with a centripetal
 * Catmull-Rom spline, sampled with a FIXED number of points per control
 * segment so every vertex keeps its feature (sill, arch lip, belt, shoulder)
 * from one section to the next — no sliding or twisting. Sections are
 * evaluated densely from smooth, overshoot-free parameter tracks, so the
 * surface is smooth along the car too; normals come from the shared,
 * indexed vertices of the closed rings. */
export type Pt = readonly [number, number];

/** Monotone cubic interpolation (Fritsch-Carlson) of (t, value) keys: smooth,
 * and never overshoots between keys (no rippling bonnets). Clamped outside. */
export class Track {
  private readonly t: number[];
  private readonly v: number[];
  private readonly m: number[];
  constructor(keys: readonly (readonly [number, number])[]) {
    const sorted = [...keys].sort((a, b) => a[0] - b[0]);
    if (sorted.length < 2) throw new Error('A track needs two keys');
    this.t = sorted.map((k) => k[0]);
    this.v = sorted.map((k) => k[1]);
    const n = sorted.length,
      d: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const h = this.t[i + 1] - this.t[i];
      if (!(h > 0)) throw new Error('Track keys must be distinct');
      d.push((this.v[i + 1] - this.v[i]) / h);
    }
    const m = [d[0]];
    for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
    m.push(d[n - 2]);
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = m[i + 1] = 0;
        continue;
      }
      const a = m[i] / d[i],
        b = m[i + 1] / d[i],
        s = a * a + b * b;
      if (s > 9) {
        const k = 3 / Math.sqrt(s);
        m[i] = k * a * d[i];
        m[i + 1] = k * b * d[i];
      }
    }
    this.m = m;
  }
  at(x: number) {
    const { t, v, m } = this;
    if (x <= t[0]) return v[0];
    const n = t.length;
    if (x >= t[n - 1]) return v[n - 1];
    let i = 0;
    while (x > t[i + 1]) i++;
    const h = t[i + 1] - t[i],
      s = (x - t[i]) / h,
      s2 = s * s,
      s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * v[i] +
      (s3 - 2 * s2 + s) * h * m[i] +
      (-2 * s3 + 3 * s2) * v[i + 1] +
      (s3 - s2) * h * m[i + 1]
    );
  }
}
/** Centripetal Catmull-Rom through `ctrl` (end tangents mirrored), sampling
 * `counts[i]` points on segment i plus the last control point. */
export function sampleProfile(ctrl: readonly Pt[], counts: readonly number[]): Pt[] {
  if (counts.length !== ctrl.length - 1) throw new Error('One sample count per segment');
  const n = ctrl.length,
    get = (i: number): Pt => {
      if (i >= 0 && i < n) return ctrl[i];
      // Reflect the neighbour: a natural end without a fabricated bulge.
      const [a, b] = i < 0 ? [ctrl[0], ctrl[1]] : [ctrl[n - 1], ctrl[n - 2]];
      return [2 * a[0] - b[0], 2 * a[1] - b[1]];
    };
  const out: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = get(i - 1),
      p1 = get(i),
      p2 = get(i + 1),
      p3 = get(i + 2);
    const knot = (a: Pt, b: Pt) => Math.max(1e-5, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
    const t1 = knot(p0, p1),
      t2 = t1 + knot(p1, p2),
      t3 = t2 + knot(p2, p3);
    for (let k = 0; k < counts[i]; k++) {
      const t = t1 + ((t2 - t1) * k) / counts[i];
      const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
        const w = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
      };
      const a1 = lerp(p0, p1, 0, t1),
        a2 = lerp(p1, p2, t1, t2),
        a3 = lerp(p2, p3, t2, t3),
        b1 = lerp(a1, a2, 0, t2),
        b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  out.push(ctrl[n - 1]);
  return out;
}
export interface Ring {
  z: number;
  /** Half profile from the lower centre (x = 0) to the upper centre (x = 0),
   * or, for an open ring, from the left edge to the top centre. */
  half: readonly Pt[];
}
export interface LoftOptions {
  /** Closed rings wrap through the bottom centre; open rings (a greenhouse
   * standing on the body) run edge to edge over the top. */
  closed?: boolean;
  capStart?: boolean;
  capEnd?: boolean;
  /** Material index of the end caps (default: the face material at j = 0). */
  capMaterial?: number;
  /** Material index for the quad between rings i, i+1 and ring samples j, j+1
   * of the LEFT half (mirrored faces share it). Groups are emitted in index order. */
  material?: (zMid: number, j: number, i: number) => number;
}
/** Loft mirrored rings into one indexed, smooth-shaded geometry. Faces are
 * wound outward (+normal away from the profile's inside). */
export function loftRings(rings: readonly Ring[], options: LoftOptions = {}) {
  const closed = options.closed ?? true,
    M = rings[0].half.length;
  if (rings.length < 2) throw new Error('A loft needs two rings');
  for (const r of rings) if (r.half.length !== M) throw new Error('Rings must share topology');
  // Full ring: left half then the mirrored right half without duplicates.
  const ringLength = closed ? 2 * M - 2 : 2 * M - 1;
  const leftIndex = (k: number) => {
    // Map ring sample k to (left-half index, side).
    if (k < M) return [k, 1] as const;
    return [closed ? 2 * M - 2 - k : 2 * M - 2 - k, -1] as const;
  };
  const positions = new Float32Array(rings.length * ringLength * 3);
  const uvs = new Float32Array(rings.length * ringLength * 2);
  const z0 = rings[0].z,
    z1 = rings[rings.length - 1].z;
  rings.forEach((ring, i) => {
    for (let k = 0; k < ringLength; k++) {
      const [j, side] = leftIndex(k);
      const [x, y] = ring.half[j];
      const o = (i * ringLength + k) * 3;
      positions[o] = x * side;
      positions[o + 1] = y;
      positions[o + 2] = ring.z;
      uvs[(i * ringLength + k) * 2] = k / ringLength;
      uvs[(i * ringLength + k) * 2 + 1] = (ring.z - z0) / (z1 - z0 || 1);
    }
  });
  const groups = new Map<number, number[]>();
  const push = (material: number, ...v: number[]) => {
    let list = groups.get(material);
    if (!list) groups.set(material, (list = []));
    list.push(...v);
  };
  const segments = closed ? ringLength : ringLength - 1;
  for (let i = 0; i < rings.length - 1; i++) {
    const zMid = (rings[i].z + rings[i + 1].z) / 2;
    for (let k = 0; k < segments; k++) {
      const k2 = (k + 1) % ringLength;
      const a = i * ringLength + k,
        b = (i + 1) * ringLength + k,
        c = i * ringLength + k2,
        d = (i + 1) * ringLength + k2;
      // Left-half segment index (mirrored faces share the left segment).
      const j = k < M - 1 ? k : 2 * M - 3 - k;
      const material = options.material?.(zMid, Math.max(0, Math.min(M - 2, j)), i) ?? 0;
      push(material, a, c, b, c, d, b);
    }
  }
  const capVertices: number[] = [];
  const cap = (ringIndex: number, forward: boolean) => {
    const ring = rings[ringIndex];
    let cy = 0;
    for (const [, y] of ring.half) cy += y;
    cy /= ring.half.length;
    const centre = positions.length / 3 + capVertices.length / 3;
    capVertices.push(0, cy, ring.z);
    for (let k = 0; k < segments; k++) {
      const a = ringIndex * ringLength + k,
        b = ringIndex * ringLength + ((k + 1) % ringLength);
      const m = options.capMaterial ?? options.material?.(ring.z, 0, ringIndex) ?? 0;
      if (forward) push(m, centre, a, b);
      else push(m, centre, b, a);
    }
  };
  if (options.capStart) cap(0, false);
  if (options.capEnd) cap(rings.length - 1, true);
  const allPositions = new Float32Array(positions.length + capVertices.length);
  allPositions.set(positions);
  allPositions.set(capVertices, positions.length);
  const allUvs = new Float32Array((allPositions.length / 3) * 2);
  allUvs.set(uvs);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(allPositions, 3));
  geometry.setAttribute('uv', new T.BufferAttribute(allUvs, 2));
  const index: number[] = [];
  for (const material of [...groups.keys()].sort((x, y) => x - y)) {
    const list = groups.get(material)!;
    geometry.addGroup(index.length, list.length, material);
    for (const v of list) index.push(v);
  }
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
/** A surface of revolution about +X (wheels, hubs, mirrors' stalks...). */
export function revolveX(profile: readonly Pt[], segments: number, phase = 0) {
  // LatheGeometry revolves (x = radius, y = axial) about +Y; rotate to +X.
  const g = new T.LatheGeometry(
    profile.map(([r, a]) => new T.Vector2(Math.max(0, r), a)),
    segments,
    phase,
  );
  g.rotateZ(-Math.PI / 2);
  return g;
}
/** Extrude a closed 2-D section (in the X-Y plane) along +Z between z0, z1. */
export function prism(section: readonly Pt[], z0: number, z1: number) {
  const shape = new T.Shape(section.map(([x, y]) => new T.Vector2(x, y)));
  const g = new T.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, z0);
  return g;
}
/** A rod between two points (suspension links, tubes, frames). */
export function rodGeometry(a: T.Vector3, b: T.Vector3, radius: number, sides = 8) {
  const g = new T.CylinderGeometry(radius, radius, a.distanceTo(b), sides, 1, true);
  const q = new T.Quaternion().setFromUnitVectors(
    new T.Vector3(0, 1, 0),
    b.clone().sub(a).normalize(),
  );
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
/** A swept tube through points (centripetal Catmull-Rom). */
export function tubeGeometry(
  points: readonly (readonly [number, number, number])[],
  radius: number,
  segments = 24,
  sides = 8,
) {
  const curve = new T.CatmullRomCurve3(
    points.map((p) => new T.Vector3(p[0], p[1], p[2])),
    false,
    'centripetal',
  );
  return new T.TubeGeometry(curve, segments, radius, sides, false);
}
/** A rounded box (bevelled) for lamps, mirrors, boards and pods. */
export function roundedBox(w: number, h: number, d: number, r: number, segments = 3) {
  // The bevel grows the outline by 0.6 r on every side: shrink the profile so
  // the finished part measures exactly w x h x d.
  const grow = r * 0.6,
    pw = Math.max(0.002, w - 2 * grow),
    ph = Math.max(0.002, h - 2 * grow),
    rr = Math.min(r, pw / 2 - 0.0005, ph / 2 - 0.0005);
  const x = pw / 2 - rr,
    y = ph / 2 - rr;
  const shape = new T.Shape();
  shape.moveTo(-x, -ph / 2);
  shape.lineTo(x, -ph / 2);
  shape.absarc(x, -y, rr, -Math.PI / 2, 0, false);
  shape.lineTo(pw / 2, y);
  shape.absarc(x, y, rr, 0, Math.PI / 2, false);
  shape.lineTo(-x, ph / 2);
  shape.absarc(-x, y, rr, Math.PI / 2, Math.PI, false);
  shape.lineTo(-pw / 2, -y);
  shape.absarc(-x, -y, rr, Math.PI, Math.PI * 1.5, false);
  const depth = Math.max(0.001, d - 2 * r);
  const g = new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: Math.min(r, d / 2),
    bevelSize: grow,
    bevelSegments: segments,
    curveSegments: segments * 2,
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}
/** Wing element: a cambered aerofoil section extruded across the span (X). */
export function aerofoil(
  chord: number,
  thickness: number,
  camber: number,
  span: number,
  steps = 12,
) {
  const upper: Pt[] = [],
    lower: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps,
      // Cosine spacing resolves the leading edge.
      x = (1 - Math.cos(s * Math.PI)) / 2,
      t =
        5 *
        thickness *
        (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4),
      c = camber * 4 * x * (1 - x);
    // Shape X is the chord (car -Z after rotation): leading edge at z = 0.
    upper.push([x * chord, c + t * chord]);
    lower.push([x * chord, c - t * chord]);
  }
  const outline = [...upper, ...lower.reverse().slice(1, -1)];
  const shape = new T.Shape(outline.map(([z, y]) => new T.Vector2(z, y)));
  const g = new T.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, steps: 1 });
  // Shape X -> car Z, shape Y -> car Y, extrusion -> car X (span).
  g.rotateY(Math.PI / 2);
  g.translate(-span / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}
