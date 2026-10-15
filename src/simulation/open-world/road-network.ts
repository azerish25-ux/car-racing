import { clamp, G } from '../../core/math.ts';
import type { RouteEdgeSpec, RouteSpec } from '../route-graph.ts';
import type { TrackPoint } from '../track.ts';
import {
  ROAD_CLASSES,
  type RegionDefinition,
  type RoadClass,
  type RoadClassSpec,
  type RoadSpec,
  type SpeedClass,
} from './region-data.ts';
import type { TerrainField } from './terrain-field.ts';

/** Sample flags. */
export const ROAD_FLAG = Object.freeze({
  BRIDGE: 1,
  /** Guardrail on the left (negative lateral) / right (positive lateral). */
  BARRIER_LEFT: 2,
  BARRIER_RIGHT: 4,
  /** Within a junction mouth (no barrier, shared surface). */
  JUNCTION: 8,
});
/** Gap between consecutive edges in the global station space (m). */
const EDGE_GAP = 50;
/** Spatial index cell (m). */
export const ROAD_CELL = 32;
/** Vertical separation (m) beyond which a centreline is another road layer;
 * the same value as track.ts ROUTE_LAYER_GAP (asserted by the unit tests),
 * duplicated so this module does not load the circuit catalogue. */
export const ROAD_LAYER_GAP = 4;
/** Vertical clearance of a grade-separated crossing (m). */
const OVERPASS_CLEARANCE = 7.2;

export interface RoadNode {
  index: number;
  x: number;
  z: number;
  y: number;
  /** Incident edge indices. */
  edges: number[];
  kind: 'junction' | 'end';
}
export interface RoadEdge {
  index: number;
  id: string;
  road: RoadSpec;
  roadClass: RoadClass;
  spec: RoadClassSpec;
  from: number;
  to: number;
  /** Sample range [first, last] in the network arrays (inclusive). */
  first: number;
  last: number;
  /** Global station of the first sample. */
  offset: number;
  length: number;
}
interface CrossingPin {
  road: number;
  arc: number;
  height: number;
}

/** Centripetal Catmull-Rom through control points, resampled by arc length. */
export function sampleSpline(points: readonly (readonly [number, number])[], closed: boolean, step: number) {
  const n = points.length;
  const at = (i: number): readonly [number, number] => {
    if (closed) return points[((i % n) + n) % n];
    if (i < 0) return [2 * points[0][0] - points[1][0], 2 * points[0][1] - points[1][1]];
    if (i >= n)
      return [2 * points[n - 1][0] - points[n - 2][0], 2 * points[n - 1][1] - points[n - 2][1]];
    return points[i];
  };
  const dense: number[] = [];
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1),
      p1 = at(i),
      p2 = at(i + 1),
      p3 = at(i + 2);
    const knot = (a: readonly number[], b: readonly number[]) =>
      Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
    const t0 = 0,
      t1 = t0 + knot(p0, p1),
      t2 = t1 + knot(p1, p2),
      t3 = t2 + knot(p2, p3);
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]),
      steps = Math.max(2, Math.ceil(chord / 0.5));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const out = [0, 0];
      for (let c = 0; c < 2; c++) {
        const a1 = ((t1 - t) / (t1 - t0)) * p0[c] + ((t - t0) / (t1 - t0)) * p1[c],
          a2 = ((t2 - t) / (t2 - t1)) * p1[c] + ((t - t1) / (t2 - t1)) * p2[c],
          a3 = ((t3 - t) / (t3 - t2)) * p2[c] + ((t - t2) / (t3 - t2)) * p3[c],
          b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2,
          b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
        out[c] = ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
      }
      dense.push(out[0], out[1]);
    }
  }
  // Arc-length resampling at an even spacing no larger than `step`.
  const m = dense.length / 2,
    arc = new Float64Array(m);
  for (let i = 1; i < m; i++)
    arc[i] = arc[i - 1] + Math.hypot(dense[i * 2] - dense[i * 2 - 2], dense[i * 2 + 1] - dense[i * 2 - 1]);
  const total = arc[m - 1],
    count = Math.max(2, Math.ceil(total / step) + 1),
    xs: number[] = [],
    zs: number[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    while (j < m - 2 && arc[j + 1] < target) j++;
    const f = (target - arc[j]) / Math.max(1e-9, arc[j + 1] - arc[j]);
    xs.push(dense[j * 2] + (dense[j * 2 + 2] - dense[j * 2]) * f);
    zs.push(dense[j * 2 + 1] + (dense[j * 2 + 3] - dense[j * 2 + 1]) * f);
  }
  return { xs, zs, length: total };
}

interface Polyline {
  road: RoadSpec;
  spec: RoadClassSpec;
  closed: boolean;
  xs: number[];
  zs: number[];
  arc: number[];
  length: number;
  /** Split points: arc position and node index. */
  splits: { arc: number; node: number }[];
}

/**
 * The region's road network: highways, country roads, mountain switchbacks,
 * town streets, dirt tracks and the airfield, sampled from authored control
 * polylines into one set of flat arrays. Builds junctions where roads meet or
 * cross (except authored grade separations), solves grade-limited vertical
 * profiles pinned at junctions, superelevation, bridges, guardrail runs and
 * advisory speeds. Every edge has a range in a single global "station" space
 * so the network can stand in for a circuit's lap distance (`at`, `nearest`).
 * Deterministic: the same region data always yields the same arrays.
 */
export class RoadNetwork {
  readonly nodes: RoadNode[] = [];
  readonly edges: RoadEdge[] = [];
  /** Per-sample arrays (all edges concatenated). */
  x!: Float64Array;
  y!: Float64Array;
  z!: Float64Array;
  s!: Float64Array;
  tx!: Float32Array;
  tz!: Float32Array;
  curvature!: Float32Array;
  bank!: Float32Array;
  gradient!: Float32Array;
  /** Natural terrain height under the centreline. */
  ground!: Float32Array;
  /** Advisory speed (m/s) from curvature and class. */
  advisory!: Float32Array;
  flags!: Uint8Array;
  edgeOf!: Int32Array;
  /** Carving influence radius of the segment starting at each sample (m). */
  influence!: Float32Array;
  readonly totalStation: number;
  /** Uniform grid of segments: CSR start offsets per cell and segment ids. */
  readonly grid: { x0: number; z0: number; cols: number; rows: number; start: Int32Array; items: Int32Array };
  /** Nearest segment of every grid cell (far-field fallback). */
  private readonly far: Int32Array;
  /** Last nearest() result details. */
  lastSegment = 0;
  lastT = 0;
  /** False when the returned road is another layer than the queried height. */
  lastLayerMatch = true;
  lastDistance = 0;
  private readonly lines: Polyline[] = [];

  constructor(
    readonly region: RegionDefinition,
    readonly terrain: TerrainField,
  ) {
    for (const road of region.roads) {
      const spec = ROAD_CLASSES[road.roadClass];
      const { xs, zs, length } = sampleSpline(road.points, !!road.closed, spec.step);
      if (road.closed) {
        // Closed: drop the duplicate end, keep the seam at the first point.
        xs.pop();
        zs.pop();
      }
      const arc = [0];
      for (let i = 1; i < xs.length; i++) arc.push(arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
      this.lines.push({ road, spec, closed: !!road.closed, xs, zs, arc, length, splits: [] });
    }
    this.buildJunctions();
    for (const line of this.lines) this.insertSplitSamples(line);
    const pins = this.crossingPins();
    const heights = this.lines.map((line, i) => this.profile(line, pins.filter((p) => p.road === i)));
    this.assemble(heights, pins);
    this.totalStation = this.edges.reduce((sum, e) => Math.max(sum, e.offset + e.length + EDGE_GAP), 0);
    this.grid = this.buildGrid();
    this.far = this.buildFarField();
  }

  // --- Construction -------------------------------------------------------
  private addNode(x: number, z: number) {
    const node: RoadNode = { index: this.nodes.length, x, z, y: 0, edges: [], kind: 'end' };
    this.nodes.push(node);
    return node.index;
  }
  /** Closest point of polyline `l` to (x, z): arc position and distance. */
  private project(l: Polyline, x: number, z: number) {
    let best = Infinity,
      arc = 0;
    const n = l.xs.length,
      last = l.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n,
        ax = l.xs[i],
        az = l.zs[i],
        dx = l.xs[j] - ax,
        dz = l.zs[j] - az,
        len2 = dx * dx + dz * dz || 1,
        t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1),
        d = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      if (d < best) {
        best = d;
        arc = l.arc[i] + t * Math.sqrt(len2);
      }
    }
    return { arc, distance: Math.sqrt(best) };
  }
  private pointAt(l: Polyline, arc: number): [number, number] {
    const n = l.xs.length,
      total = l.closed ? l.length : l.arc[n - 1];
    if (l.closed) arc = ((arc % total) + total) % total;
    else arc = clamp(arc, 0, total);
    let lo = 0,
      hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (l.arc[mid] <= arc) lo = mid;
      else hi = mid;
    }
    const j = l.closed && lo === n - 1 ? 0 : lo + 1,
      seg = (l.closed && lo === n - 1 ? total : l.arc[j]) - l.arc[lo],
      f = seg > 0 ? (arc - l.arc[lo]) / seg : 0;
    return [l.xs[lo] + (l.xs[j] - l.xs[lo]) * f, l.zs[lo] + (l.zs[j] - l.zs[lo]) * f];
  }
  private isOverpass(a: number, b: number) {
    const ra = this.lines[a].road.id,
      rb = this.lines[b].road.id;
    return this.region.overpasses.some(
      (o) => (o.over === ra && o.under === rb) || (o.over === rb && o.under === ra),
    );
  }
  /** Junctions: snapped road ends (T and shared ends) and at-grade crossings. */
  private buildJunctions() {
    const lines = this.lines,
      snap = 18;
    const split = (line: Polyline, arc: number, node: number) => {
      // Merge with an existing split point on this road within 20 m.
      const near = line.splits.find((p) => Math.abs(p.arc - arc) < 20);
      if (near) {
        if (near.node !== node) this.mergeNodes(near.node, node);
        return;
      }
      line.splits.push({ arc, node });
    };
    // 1. Road ends: on another road (T / shared end) or free ends.
    lines.forEach((line, i) => {
      if (line.closed) return;
      for (const end of [0, 1]) {
        const k = end ? line.xs.length - 1 : 0,
          x = line.xs[k],
          z = line.zs[k],
          arc = end ? line.arc[k] : 0;
        let best: { line: number; arc: number; distance: number } | null = null;
        lines.forEach((other, j) => {
          if (j === i) return;
          const p = this.project(other, x, z);
          if (p.distance < snap && (!best || p.distance < best.distance))
            best = { line: j, arc: p.arc, distance: p.distance };
        });
        const hit = best as { line: number; arc: number; distance: number } | null;
        if (hit) {
          const other = lines[hit.line];
          // Reuse a node already split on the other road near this point.
          const existing = other.splits.find((p) => Math.abs(p.arc - hit.arc) < 20);
          const [px, pz] = this.pointAt(other, hit.arc);
          const node = existing?.node ?? this.addNode(px, pz);
          // Pull this road's end exactly onto the junction point.
          line.xs[k] = this.nodes[this.find(node)].x;
          line.zs[k] = this.nodes[this.find(node)].z;
          split(other, existing?.arc ?? hit.arc, node);
          split(line, arc, node);
        } else split(line, arc, this.addNode(x, z));
      }
    });
    // 2. Interior crossings (segment intersections between different roads).
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        if (this.isOverpass(i, j)) continue;
        for (const c of this.intersections(lines[i], lines[j])) {
          const a = lines[i].splits.find((p) => Math.abs(p.arc - c.arcA) < 25),
            b = lines[j].splits.find((p) => Math.abs(p.arc - c.arcB) < 25);
          const node = a?.node ?? b?.node ?? this.addNode(c.x, c.z);
          split(lines[i], a?.arc ?? c.arcA, node);
          split(lines[j], b?.arc ?? c.arcB, node);
        }
      }
    // Closed roads need at least one split; sort splits along each road.
    for (const line of lines) {
      if (line.closed && line.splits.length === 0) line.splits.push({ arc: 0, node: this.addNode(line.xs[0], line.zs[0]) });
      line.splits.sort((a, b) => a.arc - b.arc);
      for (const s of line.splits) s.node = this.find(s.node);
    }
  }
  /** Put an exact sample at every junction so the edge ends are the node
   * points themselves (no forced kinks), dropping samples crowding them. */
  private insertSplitSamples(line: Polyline) {
    const step = line.spec.step,
      n = line.xs.length,
      total = line.closed ? line.length : line.arc[n - 1],
      marks = line.splits.map((p) => ({ ...p, arc: line.closed ? ((p.arc % total) + total) % total : clamp(p.arc, 0, total) }));
    marks.sort((a, b) => a.arc - b.arc);
    const xs: number[] = [],
      zs: number[] = [];
    let m = 0;
    const emitMarks = (upTo: number) => {
      while (m < marks.length && marks[m].arc <= upTo) {
        const node = this.nodes[this.find(marks[m].node)];
        xs.push(node.x);
        zs.push(node.z);
        m++;
      }
    };
    for (let i = 0; i < n; i++) {
      emitMarks(line.arc[i] + 1e-9);
      // Skip samples within 45% of a step of a junction sample.
      const near = marks.some((p) => Math.abs(p.arc - line.arc[i]) < step * 0.45);
      if (!near) {
        xs.push(line.xs[i]);
        zs.push(line.zs[i]);
      }
    }
    emitMarks(Infinity);
    const arc = [0];
    for (let i = 1; i < xs.length; i++) arc.push(arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
    line.xs = xs;
    line.zs = zs;
    line.arc = arc;
    line.length = arc[arc.length - 1] + (line.closed ? Math.hypot(xs[0] - xs[xs.length - 1], zs[0] - zs[zs.length - 1]) : 0);
    // Re-express every split at its exact sample.
    for (const split of line.splits) {
      const node = this.nodes[this.find(split.node)];
      let best = 0;
      for (let i = 1; i < xs.length; i++)
        if (Math.hypot(xs[i] - node.x, zs[i] - node.z) < Math.hypot(xs[best] - node.x, zs[best] - node.z)) best = i;
      split.arc = arc[best];
    }
  }
  private parent: number[] = [];
  private find(i: number): number {
    while (this.parent[i] !== undefined && this.parent[i] !== i) i = this.parent[i];
    return i;
  }
  private mergeNodes(a: number, b: number) {
    a = this.find(a);
    b = this.find(b);
    if (a !== b) this.parent[b] = a;
  }
  private intersections(a: Polyline, b: Polyline) {
    const out: { x: number; z: number; arcA: number; arcB: number }[] = [];
    const na = a.xs.length,
      nb = b.xs.length,
      la = a.closed ? na : na - 1,
      lb = b.closed ? nb : nb - 1;
    // Disjoint bounding boxes cannot cross.
    const box = (l: Polyline) => [Math.min(...l.xs), Math.max(...l.xs), Math.min(...l.zs), Math.max(...l.zs)];
    const [ax0, ax1, az0, az1] = box(a),
      [bx0, bx1, bz0, bz1] = box(b);
    if (ax1 < bx0 - 1 || bx1 < ax0 - 1 || az1 < bz0 - 1 || bz1 < az0 - 1) return out;
    // Bucket b's segments in a coarse grid.
    const cell = 64,
      buckets = new Map<number, number[]>();
    const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
    for (let j = 0; j < lb; j++) {
      const k = (j + 1) % nb,
        x0 = Math.floor(Math.min(b.xs[j], b.xs[k]) / cell),
        x1 = Math.floor(Math.max(b.xs[j], b.xs[k]) / cell),
        z0 = Math.floor(Math.min(b.zs[j], b.zs[k]) / cell),
        z1 = Math.floor(Math.max(b.zs[j], b.zs[k]) / cell);
      for (let cx = x0; cx <= x1; cx++)
        for (let cz = z0; cz <= z1; cz++) {
          const list = buckets.get(key(cx, cz));
          if (list) list.push(j);
          else buckets.set(key(cx, cz), [j]);
        }
    }
    for (let i = 0; i < la; i++) {
      const i2 = (i + 1) % na,
        ax = a.xs[i],
        az = a.zs[i],
        adx = a.xs[i2] - ax,
        adz = a.zs[i2] - az;
      const seen = new Set<number>();
      for (const [px, pz] of [
        [ax, az],
        [a.xs[i2], a.zs[i2]],
      ])
        for (const j of buckets.get(key(Math.floor(px / cell), Math.floor(pz / cell))) ?? []) {
          if (seen.has(j)) continue;
          seen.add(j);
          const j2 = (j + 1) % nb,
            bx = b.xs[j],
            bz = b.zs[j],
            bdx = b.xs[j2] - bx,
            bdz = b.zs[j2] - bz,
            den = adx * bdz - adz * bdx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((bx - ax) * bdz - (bz - az) * bdx) / den,
            u = ((bx - ax) * adz - (bz - az) * adx) / den;
          if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
          const x = ax + adx * t,
            z = az + adz * t;
          // Ends already joined by a snapped junction are not new crossings.
          if (out.some((c) => Math.hypot(c.x - x, c.z - z) < 30)) continue;
          out.push({
            x,
            z,
            arcA: a.arc[i] + t * Math.hypot(adx, adz),
            arcB: b.arc[j] + u * Math.hypot(bdx, bdz),
          });
        }
    }
    return out;
  }
  /** Mean natural ground in a disk (junction and pin heights). */
  private discHeight(x: number, z: number, radius: number) {
    let sum = 0,
      n = 0;
    for (let i = -2; i <= 2; i++)
      for (let j = -2; j <= 2; j++) {
        if (i * i + j * j > 5) continue;
        sum += this.terrain.height(x + (i * radius) / 2, z + (j * radius) / 2);
        n++;
      }
    return sum / n;
  }
  /** Authored grade separations: the over-road is pinned above the under-road. */
  private crossingPins(): CrossingPin[] {
    const pins: CrossingPin[] = [];
    for (const o of this.region.overpasses) {
      const a = this.lines.findIndex((l) => l.road.id === o.over),
        b = this.lines.findIndex((l) => l.road.id === o.under);
      if (a < 0 || b < 0) continue;
      for (const c of this.intersections(this.lines[a], this.lines[b])) {
        // A shared junction is not a grade separation.
        if (
          this.lines[a].splits.some((p) => Math.abs(p.arc - c.arcA) < 40) ||
          this.lines[b].splits.some((p) => Math.abs(p.arc - c.arcB) < 40)
        )
          continue;
        // The over-road keeps the level of the ground either side (a
        // viaduct across a valley); the under-road runs in its own cut.
        const over = this.lines[a],
          [ax, az] = this.pointAt(over, c.arcA - 250),
          [bx, bz] = this.pointAt(over, c.arcA + 250),
          rims = Math.min(this.discHeight(ax, az, 40), this.discHeight(bx, bz, 40)) - 22,
          under = this.discHeight(c.x, c.z, 60) - 1.5;
        pins.push({ road: b, arc: c.arcB, height: under });
        pins.push({ road: a, arc: c.arcA, height: Math.max(rims, under + OVERPASS_CLEARANCE) });
      }
    }
    return pins;
  }
  /** Grade-limited vertical profile pinned at junction nodes and crossings. */
  private profile(line: Polyline, crossing: CrossingPin[]) {
    const n = line.xs.length,
      spec = line.spec,
      ground = new Float64Array(n);
    for (let i = 0; i < n; i++) ground[i] = this.terrain.height(line.xs[i], line.zs[i]);
    // Moving average of the ground over the class window.
    const half = Math.max(1, Math.round(spec.smoothing / 2 / spec.step)),
      target = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0,
        count = 0;
      for (let k = -half; k <= half; k++) {
        let j = i + k;
        if (line.closed) j = ((j % n) + n) % n;
        else if (j < 0 || j >= n) continue;
        // Triangular weights keep vertical curves round.
        const w = half + 1 - Math.abs(k);
        sum += ground[j] * w;
        count += w;
      }
      target[i] = sum / count;
    }
    // Pins: junction nodes and grade-separation heights.
    const pins: { i: number; h: number }[] = [];
    const index = (arc: number) => {
      let lo = 0,
        hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (line.arc[mid] <= arc) lo = mid;
        else hi = mid;
      }
      return arc - line.arc[lo] < line.arc[hi] - arc ? lo : hi;
    };
    for (const s of line.splits) {
      const node = this.nodes[s.node];
      if (!node.y) {
        node.y = this.discHeight(node.x, node.z, Math.max(30, spec.smoothing / 2));
        node.kind = 'junction';
      }
      pins.push({ i: index(s.arc), h: node.y });
    }
    for (const c of crossing) pins.push({ i: index(c.arc), h: c.height });
    pins.sort((a, b) => a.i - b.i);
    const y = Float64Array.from(target);
    // Piecewise-linear correction between pins (exact at every pin).
    if (pins.length) {
      const residual = pins.map((p) => p.h - target[p.i]),
        m = pins.length;
      for (let i = 0; i < n; i++) {
        if (m === 1) {
          y[i] += residual[0];
          continue;
        }
        // Pins a (at or before i) and b (after i), wrapping on closed roads.
        let k = -1;
        for (let q = 0; q < m; q++) if (pins[q].i <= i) k = q;
        let a: number, b: number;
        if (k < 0) {
          if (!line.closed) {
            y[i] += residual[0];
            continue;
          }
          a = m - 1;
          b = 0;
        } else if (k === m - 1) {
          if (!line.closed) {
            y[i] += residual[m - 1];
            continue;
          }
          a = m - 1;
          b = 0;
        } else {
          a = k;
          b = k + 1;
        }
        const span = (pins[b].i - pins[a].i + n) % n || n,
          along = (i - pins[a].i + n) % n,
          f = clamp(along / span, 0, 1);
        y[i] += residual[a] * (1 - f) + residual[b] * f;
      }
    }
    // Grade limit: alternate forward/backward slope clamps, pins held.
    const pinned = new Uint8Array(n);
    for (const p of pins) {
      pinned[p.i] = 1;
      y[p.i] = p.h;
    }
    // A pin pair closer than the class grade allows relaxes only that span
    // (an authored junction always wins over the grade target).
    const grade = new Float64Array(n).fill(spec.maxGrade);
    for (let k = 0; k < pins.length - 1; k++) {
      const a = pins[k],
        b = pins[k + 1],
        distance = line.arc[b.i] - line.arc[a.i];
      if (distance <= 0) continue;
      const need = Math.abs(b.h - a.h) / distance;
      if (need > spec.maxGrade * 0.97)
        for (let i = a.i; i <= b.i; i++) grade[i] = Math.max(grade[i], need * 1.04 + 0.002);
    }
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < n; i++)
        if (!pinned[i]) {
          const rise = grade[i] * (line.arc[i] - line.arc[i - 1]);
          y[i] = clamp(y[i], y[i - 1] - rise, y[i - 1] + rise);
        }
      for (let i = n - 2; i >= 0; i--)
        if (!pinned[i]) {
          const rise = grade[i] * (line.arc[i + 1] - line.arc[i]);
          y[i] = clamp(y[i], y[i + 1] - rise, y[i + 1] + rise);
        }
    }
    // Round the grade breaks (vertical curves).
    for (let pass = 0; pass < 4; pass++)
      for (let i = 1; i < n - 1; i++) if (!pinned[i]) y[i] = (y[i - 1] + 2 * y[i] + y[i + 1]) / 4;
    return { y, ground };
  }
  /** Fill the flat per-sample arrays, split roads into edges at nodes. */
  private assemble(profiles: { y: Float64Array; ground: Float64Array }[], pins: CrossingPin[]) {
    // Edges from consecutive split points of each road.
    type Piece = { line: number; a: number; b: number; from: number; to: number };
    const pieces: Piece[] = [];
    const index = (line: Polyline, arc: number) => {
      let best = 0;
      for (let i = 0; i < line.xs.length; i++)
        if (Math.abs(line.arc[i] - arc) < Math.abs(line.arc[best] - arc)) best = i;
      return best;
    };
    this.lines.forEach((line, li) => {
      const idx = line.splits.map((s) => ({ i: index(line, s.arc), node: this.find(s.node) }));
      const n = line.xs.length;
      if (line.closed) {
        for (let k = 0; k < idx.length; k++) {
          const a = idx[k],
            b = idx[(k + 1) % idx.length];
          pieces.push({ line: li, a: a.i, b: b.i > a.i ? b.i : b.i + n, from: a.node, to: b.node });
        }
      } else
        for (let k = 0; k < idx.length - 1; k++)
          if (idx[k + 1].i > idx[k].i)
            pieces.push({ line: li, a: idx[k].i, b: idx[k + 1].i, from: idx[k].node, to: idx[k + 1].node });
    });
    let total = 0;
    for (const p of pieces) total += p.b - p.a + 1;
    this.x = new Float64Array(total);
    this.y = new Float64Array(total);
    this.z = new Float64Array(total);
    this.s = new Float64Array(total);
    this.tx = new Float32Array(total);
    this.tz = new Float32Array(total);
    this.curvature = new Float32Array(total);
    this.bank = new Float32Array(total);
    this.gradient = new Float32Array(total);
    this.ground = new Float32Array(total);
    this.advisory = new Float32Array(total);
    this.flags = new Uint8Array(total);
    this.edgeOf = new Int32Array(total);
    this.influence = new Float32Array(total);
    let cursor = 0,
      station = 0;
    const roadCount = new Map<string, number>();
    for (const p of pieces) {
      const line = this.lines[p.line],
        profile = profiles[p.line],
        n = line.xs.length,
        count = p.b - p.a + 1,
        k = roadCount.get(line.road.id) ?? 0;
      roadCount.set(line.road.id, k + 1);
      const edge: RoadEdge = {
        index: this.edges.length,
        id: `${line.road.id}#${k}`,
        road: line.road,
        roadClass: line.road.roadClass,
        spec: line.spec,
        from: p.from,
        to: p.to,
        first: cursor,
        last: cursor + count - 1,
        offset: station,
        length: 0,
      };
      let s = 0;
      for (let c = 0; c < count; c++) {
        const i = (p.a + c) % n,
          o = cursor + c;
        this.x[o] = line.xs[i];
        this.z[o] = line.zs[i];
        this.y[o] = profile.y[i];
        this.ground[o] = profile.ground[i];
        if (c) s += Math.hypot(this.x[o] - this.x[o - 1], this.z[o] - this.z[o - 1]);
        this.s[o] = station + s;
        this.edgeOf[o] = edge.index;
      }
      // Junction endpoints share the node position and height exactly.
      for (const [o, node] of [
        [edge.first, p.from],
        [edge.last, p.to],
      ]) {
        const nd = this.nodes[node];
        this.x[o] = nd.x;
        this.z[o] = nd.z;
        this.y[o] = nd.y;
      }
      edge.length = s;
      this.edges.push(edge);
      this.nodes[p.from].edges.push(edge.index);
      this.nodes[p.to].edges.push(edge.index);
      cursor += count;
      station += s + EDGE_GAP;
    }
    for (const node of this.nodes) if (this.find(node.index) === node.index) node.kind = node.edges.length > 1 ? 'junction' : 'end';
    for (const e of this.edges) this.deriveEdge(e, pins);
  }
  /** Tangents, curvature, superelevation, bridges, barriers and speeds. */
  private deriveEdge(e: RoadEdge, pins: CrossingPin[]) {
    const { first, last, spec } = e,
      n = last - first + 1;
    for (let c = 0; c < n; c++) {
      const o = first + c,
        a = first + Math.max(0, c - 1),
        b = first + Math.min(n - 1, c + 1),
        dx = this.x[b] - this.x[a],
        dz = this.z[b] - this.z[a],
        len = Math.hypot(dx, dz) || 1;
      this.tx[o] = dx / len;
      this.tz[o] = dz / len;
      this.gradient[o] = (this.y[b] - this.y[a]) / Math.max(1e-6, this.s[b] - this.s[a]);
    }
    // Signed curvature (positive: right turn) over ±2 samples, then smoothed.
    const raw = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const a = first + Math.max(0, c - 2),
        b = first + Math.min(n - 1, c + 2),
        ds = this.s[b] - this.s[a] || 1;
      raw[c] =
        Math.atan2(this.tz[a] * this.tx[b] - this.tx[a] * this.tz[b], this.tx[a] * this.tx[b] + this.tz[a] * this.tz[b]) /
        ds;
    }
    const window = Math.max(1, Math.round(12 / spec.step));
    for (let c = 0; c < n; c++) {
      let sum = 0,
        count = 0;
      for (let k = -window; k <= window; k++) {
        const j = c + k;
        if (j < 0 || j >= n) continue;
        sum += raw[j];
        count++;
      }
      this.curvature[first + c] = sum / count;
    }
    // Superelevation from the design speed (outside of every bend raised),
    // eased in over ~40 m.
    const ease = Math.max(1, Math.round(20 / spec.step)),
      bank = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const k = this.curvature[first + c];
      bank[c] = -Math.sign(k) * Math.min(spec.maxBank, (spec.designSpeed ** 2 * Math.abs(k)) / G * 0.55);
    }
    for (let c = 0; c < n; c++) {
      let sum = 0,
        count = 0;
      for (let k = -ease; k <= ease; k++) {
        const j = c + k;
        if (j < 0 || j >= n) continue;
        sum += bank[j];
        count++;
      }
      // Junction mouths are flat so crossing roads meet level.
      const fromEnd = Math.min(this.s[first + c] - this.s[first], this.s[last] - this.s[first + c]);
      this.bank[first + c] = (sum / count) * clamp((fromEnd - 10) / 30, 0, 1);
    }
    // Advisory speed: comfortable lateral acceleration, capped by the class.
    for (let c = 0; c < n; c++) {
      const k = Math.abs(this.curvature[first + c]);
      this.advisory[first + c] = Math.min(spec.designSpeed * 1.3, Math.sqrt(4.5 / Math.max(1e-5, k)));
    }
    // Bridges: deck well above the natural ground, or over water.
    const bridge = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      const o = first + c,
        x = this.x[o],
        z = this.z[o],
        clearance = this.y[o] - this.ground[o],
        valley = this.terrain.valleyAt(x, z);
      const overWater =
        (valley.channel && this.ground[o] < valley.water && this.y[o] > valley.water + 1.5) ||
        (this.ground[o] < this.region.seaLevel - 0.3 && this.y[o] > this.region.seaLevel + 1.5);
      bridge[c] = Number(clearance > 5.5 || overWater);
    }
    // Over-road of an authored grade separation spans the under-road's cut.
    for (const pin of pins) {
      const line = this.lines[pin.road];
      if (line.road.id !== e.road.id) continue;
      if (!this.region.overpasses.some((o) => o.over === e.road.id)) continue;
      // Pins are in road arc space; the edge samples carry their position.
      const [px, pz] = this.pointAt(line, pin.arc);
      for (let c = 0; c < n; c++) {
        const o = first + c;
        if (Math.hypot(this.x[o] - px, this.z[o] - pz) < 22) bridge[c] = 1;
      }
    }
    // Clean spans: fill gaps < 30 m, drop spans < 12 m.
    const gap = Math.round(30 / spec.step),
      min = Math.round(12 / spec.step);
    for (let c = 0; c < n; c++)
      if (!bridge[c] && c > 0 && bridge[c - 1]) {
        let k = c;
        while (k < n && !bridge[k]) k++;
        if (k < n && k - c < gap) for (let j = c; j < k; j++) bridge[j] = 1;
      }
    for (let c = 0; c < n; ) {
      if (!bridge[c]) {
        c++;
        continue;
      }
      let k = c;
      while (k < n && bridge[k]) k++;
      if (k - c < min) for (let j = c; j < k; j++) bridge[j] = 0;
      c = k;
    }
    // Guardrails where the ground drops away beside the road (mountain and
    // highway embankments) and on every bridge; never in junction mouths.
    const nodeClear = (o: number) => {
      for (const node of [this.nodes[e.from], this.nodes[e.to]])
        if (Math.hypot(this.x[o] - node.x, this.z[o] - node.z) < spec.halfWidth + 28) return true;
      return false;
    };
    const rail = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      const o = first + c;
      if (nodeClear(o)) {
        this.flags[o] |= ROAD_FLAG.JUNCTION;
        continue;
      }
      if (bridge[c]) {
        rail[c] = 3;
        continue;
      }
      if (!spec.guardrails) continue;
      const nx = this.tz[o],
        nz = -this.tx[o],
        reach = spec.halfWidth + spec.shoulder + 5;
      for (const [bit, side] of [
        [1, -1],
        [2, 1],
      ]) {
        const drop =
          this.y[o] - this.terrain.height(this.x[o] + nx * side * reach, this.z[o] + nz * side * reach);
        if (drop > (e.roadClass === 'highway' ? 4 : 2.6)) rail[c] |= bit;
      }
    }
    for (const bit of [1, 2]) {
      // Merge gaps < 24 m, drop runs < 20 m.
      const g = Math.round(24 / spec.step),
        r = Math.round(20 / spec.step);
      for (let c = 1; c < n; c++)
        if (!(rail[c] & bit) && rail[c - 1] & bit) {
          let k = c;
          while (k < n && !(rail[k] & bit) && !(this.flags[first + k] & ROAD_FLAG.JUNCTION)) k++;
          if (k < n && rail[k] & bit && k - c < g) for (let j = c; j < k; j++) rail[j] |= bit;
        }
      for (let c = 0; c < n; ) {
        if (!(rail[c] & bit)) {
          c++;
          continue;
        }
        let k = c;
        while (k < n && rail[k] & bit) k++;
        if (k - c < r && !bridge[c]) for (let j = c; j < k; j++) rail[j] &= ~bit;
        c = k;
      }
    }
    for (let c = 0; c < n; c++) {
      const o = first + c;
      if (bridge[c]) this.flags[o] |= ROAD_FLAG.BRIDGE;
      if (rail[c] & 1) this.flags[o] |= ROAD_FLAG.BARRIER_LEFT;
      if (rail[c] & 2) this.flags[o] |= ROAD_FLAG.BARRIER_RIGHT;
    }
    // Carving reach of each segment: half-width, shoulder and an embankment
    // that widens with the height difference to the natural ground.
    for (let c = 0; c < n; c++) {
      const o = first + c,
        nx = this.tz[o],
        nz = -this.tx[o],
        edge = spec.halfWidth + spec.shoulder;
      let delta = Math.abs(this.y[o] - this.ground[o]);
      for (const side of [-1, 1])
        delta = Math.max(
          delta,
          Math.abs(this.y[o] - this.terrain.height(this.x[o] + nx * side * (edge + 6), this.z[o] + nz * side * (edge + 6))),
        );
      this.influence[o] = edge + Math.min(64, 4 + delta * 1.7);
    }
  }
  private buildGrid() {
    const half = this.region.half + 600,
      x0 = -half,
      z0 = -half,
      cols = Math.ceil((2 * half) / ROAD_CELL),
      rows = cols;
    const counts = new Int32Array(cols * rows + 1);
    const visit = (i: number, fn: (cell: number) => void) => {
      const j = i + 1;
      const pad = ROAD_CELL;
      const cx0 = Math.floor((Math.min(this.x[i], this.x[j]) - pad - x0) / ROAD_CELL),
        cx1 = Math.floor((Math.max(this.x[i], this.x[j]) + pad - x0) / ROAD_CELL),
        cz0 = Math.floor((Math.min(this.z[i], this.z[j]) - pad - z0) / ROAD_CELL),
        cz1 = Math.floor((Math.max(this.z[i], this.z[j]) + pad - z0) / ROAD_CELL);
      for (let cx = Math.max(0, cx0); cx <= Math.min(cols - 1, cx1); cx++)
        for (let cz = Math.max(0, cz0); cz <= Math.min(rows - 1, cz1); cz++) fn(cz * cols + cx);
    };
    const n = this.x.length;
    for (let i = 0; i < n - 1; i++) if (this.edgeOf[i] === this.edgeOf[i + 1]) visit(i, (c) => counts[c + 1]++);
    for (let c = 0; c < cols * rows; c++) counts[c + 1] += counts[c];
    const items = new Int32Array(counts[cols * rows]),
      fill = counts.slice(0, cols * rows);
    for (let i = 0; i < n - 1; i++)
      if (this.edgeOf[i] === this.edgeOf[i + 1]) visit(i, (c) => (items[fill[c]++] = i));
    return { x0, z0, cols, rows, start: counts, items };
  }
  /** Breadth-first nearest-segment field over the grid for far queries. */
  private buildFarField() {
    const { cols, rows, start, items } = this.grid,
      far = new Int32Array(cols * rows).fill(-1),
      queue = new Int32Array(cols * rows);
    let head = 0,
      tail = 0;
    for (let c = 0; c < cols * rows; c++)
      if (start[c + 1] > start[c]) {
        far[c] = items[start[c]];
        queue[tail++] = c;
      }
    while (head < tail) {
      const c = queue[head++],
        cx = c % cols,
        cz = (c / cols) | 0;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = cx + dx,
          z = cz + dz;
        if (x < 0 || z < 0 || x >= cols || z >= rows) continue;
        const k = z * cols + x;
        if (far[k] >= 0) continue;
        far[k] = far[c];
        queue[tail++] = k;
      }
    }
    return far;
  }

  // --- Queries ------------------------------------------------------------
  /** Edge containing global station s (clamped to the nearest edge end). */
  edgeAt(s: number) {
    let lo = 0,
      hi = this.edges.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.edges[mid].offset <= s) lo = mid;
      else hi = mid - 1;
    }
    return this.edges[lo];
  }
  /** Fill a TrackPoint from segment i (samples i, i+1) at fraction t. */
  pointOnSegment(i: number, t: number, out: TrackPoint) {
    const j = i + 1,
      e = this.edges[this.edgeOf[i]],
      l = (a: ArrayLike<number>) => a[i] + (a[j] - a[i]) * t;
    out.s = l(this.s);
    out.x = l(this.x);
    out.y = l(this.y);
    out.z = l(this.z);
    let tx = l(this.tx),
      tz = l(this.tz);
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    out.tx = tx;
    out.tz = tz;
    out.nx = tz;
    out.nz = -tx;
    out.curvature = l(this.curvature);
    out.width = e.spec.halfWidth;
    out.bank = l(this.bank);
    out.gradient = l(this.gradient);
    return out;
  }
  /** Road point at global station s (TrackPoint; clamps inside edge gaps). */
  at(s: number, out: TrackPoint) {
    const e = this.edgeAt(s),
      local = clamp(s, e.offset, e.offset + e.length);
    let lo = e.first,
      hi = e.last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid] <= local) lo = mid;
      else hi = mid;
    }
    const i = Math.min(lo, e.last - 1),
      span = this.s[i + 1] - this.s[i];
    return this.pointOnSegment(i, span > 0 ? clamp((local - this.s[i]) / span, 0, 1) : 0, out);
  }
  /** Nearest centreline point (layer-aware like Track.nearest) and the
   * signed lateral offset (positive right of travel). */
  nearest(x: number, z: number, out: TrackPoint, y?: number): number {
    const g = this.grid,
      cx = Math.floor((x - g.x0) / ROAD_CELL),
      cz = Math.floor((z - g.z0) / ROAD_CELL),
      inside = cx >= 0 && cz >= 0 && cx < g.cols && cz < g.rows,
      cell = inside ? cz * g.cols + cx : -1;
    const layered = y !== undefined && Number.isFinite(y);
    let best = Infinity,
      bestI = -1,
      bestT = 0,
      other = Infinity,
      otherI = -1,
      otherT = 0;
    const scan = (i: number) => {
      const j = i + 1,
        ax = this.x[i],
        az = this.z[i],
        dx = this.x[j] - ax,
        dz = this.z[j] - az,
        t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1),
        d = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      if (layered) {
        const len = Math.sqrt(dx * dx + dz * dz) || 1,
          lateral = clamp(((x - ax) * dz - (z - az) * dx) / len, -12, 12),
          road = this.y[i] + (this.y[j] - this.y[i]) * t,
          bank = this.bank[i] + (this.bank[j] - this.bank[i]) * t;
        if (Math.abs((y as number) - road - bank * lateral) > ROAD_LAYER_GAP) {
          if (d < other) {
            other = d;
            otherI = i;
            otherT = t;
          }
          return;
        }
      }
      if (d < best) {
        best = d;
        bestI = i;
        bestT = t;
      }
    };
    if (cell >= 0 && g.start[cell + 1] > g.start[cell])
      for (let k = g.start[cell]; k < g.start[cell + 1]; k++) scan(g.items[k]);
    else {
      // Far from every road: search around the far-field's nearest segment.
      const seed = cell >= 0 ? this.far[cell] : this.far[clamp(cz, 0, g.rows - 1) * g.cols + clamp(cx, 0, g.cols - 1)];
      const e = this.edges[this.edgeOf[Math.max(0, seed)]];
      for (let i = Math.max(e.first, seed - 24); i < Math.min(e.last, seed + 24); i++) scan(i);
    }
    this.lastLayerMatch = bestI >= 0;
    if (bestI < 0) {
      bestI = otherI;
      bestT = otherT;
      best = other;
    }
    if (bestI < 0) {
      bestI = 0;
      bestT = 0;
    }
    this.lastSegment = bestI;
    this.lastT = bestT;
    this.lastDistance = Math.sqrt(best);
    this.pointOnSegment(bestI, bestT, out);
    return (x - out.x) * out.nx + (z - out.z) * out.nz;
  }
  /** Road surface height at a resolved point and lateral offset (camber:
   * superelevation plus the crown that remains on gentle bends). */
  surfaceHeight(p: TrackPoint, lateral: number, halfWidth: number, crown: number) {
    const l = clamp(lateral, -halfWidth, halfWidth),
      crownLeft = Math.max(0, crown - Math.abs(p.bank));
    return p.y + p.bank * l - crownLeft * Math.abs(l);
  }
  /** Edges meeting a node and the direction they leave it (+1 forward). */
  leaving(node: number) {
    const out: { edge: RoadEdge; dir: 1 | -1 }[] = [];
    for (const index of this.nodes[node].edges) {
      const e = this.edges[index];
      if (e.from === node) out.push({ edge: e, dir: 1 });
      if (e.to === node) out.push({ edge: e, dir: -1 });
    }
    return out;
  }
  /** Directed RouteGraph spec of the whole network (both directions of
   * every edge; a U-turn only at dead ends). Validated with validateRoute. */
  routeSpec(spacing = 8): RouteSpec {
    const edges: RouteEdgeSpec[] = [];
    const name = (e: RoadEdge, dir: number) => `${e.id}${dir > 0 ? '+' : '-'}`;
    for (const e of this.edges)
      for (const dir of [1, -1] as const) {
        const points = [];
        const count = Math.max(2, Math.ceil(e.length / spacing) + 1);
        const p = { s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, curvature: 0, width: 0, bank: 0, gradient: 0 };
        for (let k = 0; k < count; k++) {
          const f = k / (count - 1);
          this.at(e.offset + e.length * (dir > 0 ? f : 1 - f), p);
          points.push({ x: p.x, y: p.y, z: p.z });
        }
        const end = dir > 0 ? e.to : e.from;
        const next = this.leaving(end)
          .filter((l) => !(l.edge === e && l.dir === -dir) || this.nodes[end].edges.length === 1)
          .map((l) => name(l.edge, l.dir));
        edges.push({ id: name(e, dir), kind: 'main', points, next });
      }
    return {
      id: `${this.region.id}-network`,
      version: this.region.version,
      closed: false,
      start: edges[0].id,
      edges,
      checkpoints: [{ edge: edges[0].id, s: 1 }],
    };
  }
  /** Network statistics for docs and acceptance (km by class, junctions, bridges). */
  stats() {
    const byClass: Record<string, number> = {},
      bySpeed: Partial<Record<SpeedClass, number>> = {};
    let bridges = 0,
      bridgeLength = 0,
      rails = 0,
      maxGrade = 0,
      minRadius = Infinity;
    for (const e of this.edges) {
      byClass[e.roadClass] = (byClass[e.roadClass] ?? 0) + e.length / 1000;
      bySpeed[e.spec.speedClass] = (bySpeed[e.spec.speedClass] ?? 0) + e.length / 1000;
      let onBridge = false;
      for (let i = e.first; i < e.last; i++) {
        const ds = this.s[i + 1] - this.s[i];
        const isBridge = !!(this.flags[i] & ROAD_FLAG.BRIDGE);
        if (isBridge) bridgeLength += ds;
        if (isBridge && !onBridge) bridges++;
        onBridge = isBridge;
        if (this.flags[i] & (ROAD_FLAG.BARRIER_LEFT | ROAD_FLAG.BARRIER_RIGHT)) rails += ds;
        maxGrade = Math.max(maxGrade, Math.abs(this.y[i + 1] - this.y[i]) / Math.max(0.1, ds));
        if (!(this.flags[i] & ROAD_FLAG.JUNCTION))
          minRadius = Math.min(minRadius, 1 / Math.max(1e-6, Math.abs(this.curvature[i])));
      }
    }
    const total = this.edges.reduce((sum, e) => sum + e.length, 0) / 1000;
    return {
      totalKm: Math.round(total * 100) / 100,
      byClassKm: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      bySpeedClassKm: Object.fromEntries(
        Object.entries(bySpeed).map(([k, v]) => [k, Math.round((v as number) * 100) / 100]),
      ),
      edges: this.edges.length,
      junctions: this.nodes.filter((n) => n.kind === 'junction' && n.edges.length > 0).length,
      deadEnds: this.nodes.filter((n) => n.edges.length === 1).length,
      bridges,
      bridgeKm: Math.round(bridgeLength / 10) / 100,
      guardrailKm: Math.round(rails / 10) / 100,
      maxGrade: Math.round(maxGrade * 1000) / 1000,
      minRadius: Math.round(minRadius * 10) / 10,
    };
  }
}
