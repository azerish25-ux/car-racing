import { clamp } from '../../core/math.ts';
import type { Checkpoint, RouteEdgeSpec, RoutePoint, RouteSpec } from '../route-graph.ts';
import type { RoadNetwork } from './road-network.ts';
import type { XZ } from './region-data.ts';

/** One piece of a planned route: part of a network edge, in its forward
 * (dir +1) or reverse (dir -1) direction, between local stations. */
export interface RouteLeg {
  edge: number;
  dir: 1 | -1;
  /** Local stations along the edge (forward metres from its first sample). */
  from: number;
  to: number;
}
interface Position {
  edge: number;
  s: number;
  x: number;
  z: number;
}
/** Snap a world point to the closest network position. */
export function snapToNetwork(network: RoadNetwork, x: number, z: number): Position {
  const p = {
    s: 0,
    x: 0,
    y: 0,
    z: 0,
    tx: 0,
    tz: 1,
    nx: 1,
    nz: 0,
    curvature: 0,
    width: 0,
    bank: 0,
    gradient: 0,
  };
  network.nearest(x, z, p);
  const edge = network.edgeOf[network.lastSegment],
    e = network.edges[edge];
  return { edge, s: clamp(p.s - e.offset, 0, e.length), x: p.x, z: p.z };
}
/** A U-turn at an intermediate waypoint costs this much (m). */
const U_TURN = 8000;

/** Shortest legal path between two network positions. Dijkstra over
 * directed edge states (no U-turn at a junction, only at a dead end), with
 * deterministic tie-breaks; `departDir` forces the direction of travel away
 * from `a` (no U-turn after a waypoint) unless only a U-turn reaches `b`. */
function shortest(network: RoadNetwork, a: Position, b: Position, departDir: 0 | 1 | -1) {
  const edges = network.edges,
    states = edges.length * 2,
    state = (edge: number, dir: 1 | -1) => edge * 2 + (dir > 0 ? 0 : 1),
    dist = new Float64Array(states).fill(Infinity),
    prev = new Int32Array(states).fill(-1),
    done = new Uint8Array(states);
  const ea = edges[a.edge],
    eb = edges[b.edge];
  const penalty = (dir: 1 | -1) => (departDir !== 0 && dir !== departDir ? U_TURN : 0);
  // A state's cost is the distance travelled to the END of that directed
  // edge. Starting states: the rest of a's edge in either direction.
  dist[state(a.edge, 1)] = ea.length - a.s + penalty(1);
  dist[state(a.edge, -1)] = a.s + penalty(-1);
  const options: { cost: number; legs: RouteLeg[] }[] = [];
  if (a.edge === b.edge) {
    const dir: 1 | -1 = b.s >= a.s ? 1 : -1;
    options.push({
      cost: Math.abs(b.s - a.s) + penalty(dir),
      legs: [{ edge: a.edge, dir, from: a.s, to: b.s }],
    });
  }
  for (;;) {
    let u = -1;
    for (let i = 0; i < states; i++)
      if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = 1;
    const edge = edges[u >> 1],
      dir: 1 | -1 = u & 1 ? -1 : 1,
      end = dir > 0 ? edge.to : edge.from,
      deadEnd = network.nodes[end].edges.length === 1;
    for (const next of network.leaving(end)) {
      // No U-turn back along the same edge except at a dead end (or on a
      // loop edge that leaves and returns to one node).
      if (next.edge === edge && next.dir === -dir && !deadEnd && edge.from !== edge.to) continue;
      const v = state(next.edge.index, next.dir),
        cost = dist[u] + next.edge.length;
      if (cost < dist[v] - 1e-9) {
        dist[v] = cost;
        prev[v] = u;
      }
    }
  }
  // Arrive on b's edge from either end: the cheapest state ending at the
  // node b's edge starts from in that direction (not b's own reverse).
  for (const dir of [1, -1] as const) {
    const startNode = dir > 0 ? eb.from : eb.to;
    let best = -1;
    for (let u = 0; u < states; u++) {
      if (dist[u] === Infinity) continue;
      const e = edges[u >> 1],
        d: 1 | -1 = u & 1 ? -1 : 1;
      if ((d > 0 ? e.to : e.from) !== startNode) continue;
      if (e === eb && d === -dir && network.nodes[startNode].edges.length > 1 && eb.from !== eb.to)
        continue;
      if (best < 0 || dist[u] < dist[best]) best = u;
    }
    if (best < 0) continue;
    const legs: RouteLeg[] = [];
    let u = best;
    while (u >= 0) {
      const e = edges[u >> 1],
        d: 1 | -1 = u & 1 ? -1 : 1;
      if (prev[u] < 0) legs.unshift({ edge: e.index, dir: d, from: a.s, to: d > 0 ? e.length : 0 });
      else
        legs.unshift({
          edge: e.index,
          dir: d,
          from: d > 0 ? 0 : e.length,
          to: d > 0 ? e.length : 0,
        });
      u = prev[u];
    }
    legs.push({ edge: b.edge, dir, from: dir > 0 ? 0 : eb.length, to: b.s });
    options.push({ cost: dist[best] + (dir > 0 ? b.s : eb.length - b.s), legs });
  }
  options.sort((x, y) => x.cost - y.cost);
  if (!options.length) throw new Error('No route between waypoints');
  // Drop zero-length pieces (a waypoint exactly on a node).
  return options[0].legs.filter((l) => Math.abs(l.to - l.from) > 0.05);
}

/** Plan a route through ordered waypoints (closed: back to the first). */
export function planRoute(
  network: RoadNetwork,
  waypoints: readonly XZ[],
  closed: boolean,
): RouteLeg[] {
  if (waypoints.length < 2) throw new Error('A route needs at least two waypoints');
  const stops = waypoints.map(([x, z]) => snapToNetwork(network, x, z));
  if (closed) stops.push(stops[0]);
  const legs: RouteLeg[] = [];
  let dir: 0 | 1 | -1 = 0;
  for (let k = 0; k < stops.length - 1; k++) {
    const previous = legs[legs.length - 1];
    const continuation = previous?.edge === stops[k].edge ? dir : 0;
    const piece = shortest(network, stops[k], stops[k + 1], continuation);
    legs.push(...piece);
    dir = piece[piece.length - 1]?.dir ?? dir;
  }
  // Merge consecutive pieces of the same edge and direction.
  const merged: RouteLeg[] = [];
  for (const l of legs) {
    const last = merged[merged.length - 1];
    if (last && last.edge === l.edge && last.dir === l.dir && Math.abs(last.to - l.from) < 0.5)
      last.to = l.to;
    else merged.push({ ...l });
  }
  // A circuit whose first and last pieces are one edge continues across the
  // start: keep them separate legs (the start/finish line sits between).
  return merged;
}

/** A point on a route path. */
export interface PathPoint {
  d: number;
  x: number;
  y: number;
  z: number;
  /** Unit direction of travel and its left-hand normal (Track convention). */
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  /** Signed curvature in the travel direction (positive: left turn). */
  curvature: number;
  halfWidth: number;
  edge: number;
  leg: number;
}
export const pathPoint = (): PathPoint => ({
  d: 0,
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  tz: 1,
  nx: 1,
  nz: 0,
  curvature: 0,
  halfWidth: 4,
  edge: 0,
  leg: 0,
});

/** A planned route sampled into one polyline in travel order: distance,
 * heading, curvature and road width per sample, the race line within the
 * road, and the RouteGraph spec the event's RouteProgress validates. */
export class RoutePath {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly d: Float64Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  readonly curvature: Float32Array;
  readonly halfWidth: Float32Array;
  readonly edge: Int32Array;
  readonly leg: Int32Array;
  /** Race line: lateral offset (m, positive left) and its curvature. */
  readonly line: Float32Array;
  readonly lineCurvature: Float32Array;
  /** Vertical curvature of the road profile (1/m; negative over crests). */
  readonly verticalCurvature: Float32Array;
  readonly length: number;
  readonly count: number;
  /** Legs that contribute samples (zero-length pieces dropped). */
  readonly legs: readonly RouteLeg[];
  constructor(
    readonly network: RoadNetwork,
    planned: readonly RouteLeg[],
    readonly closed: boolean,
    readonly finishBuffer = 60,
  ) {
    const xs: number[] = [],
      ys: number[] = [],
      zs: number[] = [],
      edges: number[] = [],
      legIndex: number[] = [];
    const p = {
      s: 0,
      x: 0,
      y: 0,
      z: 0,
      tx: 0,
      tz: 1,
      nx: 1,
      nz: 0,
      curvature: 0,
      width: 0,
      bank: 0,
      gradient: 0,
    };
    const kept: RouteLeg[] = [];
    planned.forEach((l) => {
      const k = kept.length,
        before = xs.length;
      const e = network.edges[l.edge],
        stations: number[] = [l.from];
      // Network samples strictly between from and to, in travel order.
      if (l.dir > 0) {
        for (let i = e.first; i <= e.last; i++) {
          const s = network.s[i] - e.offset;
          if (s > l.from + 0.5 && s < l.to - 0.5) stations.push(s);
        }
      } else
        for (let i = e.last; i >= e.first; i--) {
          const s = network.s[i] - e.offset;
          if (s < l.from - 0.5 && s > l.to + 0.5) stations.push(s);
        }
      stations.push(l.to);
      for (const s of stations) {
        network.at(e.offset + s, p);
        const last = xs.length - 1;
        if (last >= 0 && Math.hypot(p.x - xs[last], p.z - zs[last]) < 0.25) continue;
        xs.push(p.x);
        ys.push(p.y);
        zs.push(p.z);
        edges.push(l.edge);
        legIndex.push(k);
      }
      if (xs.length > before) kept.push(l);
    });
    this.legs = kept;
    const n = xs.length;
    this.count = n;
    this.x = Float64Array.from(xs);
    this.y = Float64Array.from(ys);
    this.z = Float64Array.from(zs);
    this.edge = Int32Array.from(edges);
    this.leg = Int32Array.from(legIndex);
    this.d = new Float64Array(n);
    for (let i = 1; i < n; i++)
      this.d[i] = this.d[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    this.length = this.d[n - 1] + (closed ? Math.hypot(xs[0] - xs[n - 1], zs[0] - zs[n - 1]) : 0);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.curvature = new Float32Array(n);
    this.halfWidth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.wrap(i - 1),
        b = this.wrap(i + 1),
        dx = xs[b] - xs[a],
        dz = zs[b] - zs[a],
        len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
      this.halfWidth[i] = network.edges[edges[i]].spec.halfWidth;
    }
    for (let i = 0; i < n; i++) {
      const a = this.wrap(i - 3),
        b = this.wrap(i + 3),
        ds = this.span(a, b) || 1;
      this.curvature[i] =
        Math.atan2(
          this.tz[a] * this.tx[b] - this.tx[a] * this.tz[b],
          this.tx[a] * this.tx[b] + this.tz[a] * this.tz[b],
        ) / ds;
    }
    this.line = new Float32Array(n);
    this.lineCurvature = new Float32Array(n);
    // Second difference of height over ±10 m (crests and dips).
    this.verticalCurvature = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = i,
        b = i;
      while (a > 0 && this.d[i] - this.d[a] < 10) a--;
      while (b < n - 1 && this.d[b] - this.d[i] < 10) b++;
      const da = this.d[i] - this.d[a],
        db = this.d[b] - this.d[i];
      if (da > 1 && db > 1)
        this.verticalCurvature[i] =
          (2 * ((this.y[b] - this.y[i]) / db - (this.y[i] - this.y[a]) / da)) / (da + db);
    }
    this.solveLine();
  }
  private wrap(i: number) {
    const n = this.count;
    return this.closed ? ((i % n) + n) % n : clamp(i, 0, n - 1);
  }
  /** Path distance from sample a forward to sample b. */
  private span(a: number, b: number) {
    const d = this.d[b] - this.d[a];
    return d >= 0 ? d : d + this.length;
  }
  /** Minimum-curvature race line inside the road (relaxed second
   * differences, clamped a car width from each edge). Junction mouths keep
   * the centreline so cars do not cut across side roads. */
  private solveLine() {
    const n = this.count,
      offset = this.line,
      margin = 1.6;
    const px = new Float64Array(n),
      pz = new Float64Array(n);
    for (let iteration = 0; iteration < 160; iteration++) {
      for (let i = 0; i < n; i++) {
        px[i] = this.x[i] + this.tz[i] * offset[i];
        pz[i] = this.z[i] - this.tx[i] * offset[i];
      }
      for (let i = 1; i < n - 1; i++) {
        const a = this.wrap(i - 1),
          b = this.wrap(i + 1);
        // Move toward the midpoint of the neighbours, along the normal.
        const mx = (px[a] + px[b]) / 2 - px[i],
          mz = (pz[a] + pz[b]) / 2 - pz[i],
          shift = mx * this.tz[i] - mz * this.tx[i],
          reach = Math.max(0, this.halfWidth[i] - margin);
        offset[i] = clamp(offset[i] + shift * 0.5, -reach, reach);
      }
      if (!this.closed) {
        offset[0] = 0;
        offset[n - 1] = 0;
      }
    }
    // Light smoothing of the offsets.
    for (let pass = 0; pass < 3; pass++)
      for (let i = 1; i < n - 1; i++)
        offset[i] = (offset[i - 1] + 2 * offset[i] + offset[i + 1]) / 4;
    for (let i = 0; i < n; i++) {
      const a = this.wrap(i - 3),
        b = this.wrap(i + 3);
      const ax = this.x[a] + this.tz[a] * offset[a],
        az = this.z[a] - this.tx[a] * offset[a],
        cx = this.x[i] + this.tz[i] * offset[i],
        cz = this.z[i] - this.tx[i] * offset[i],
        bx = this.x[b] + this.tz[b] * offset[b],
        bz = this.z[b] - this.tx[b] * offset[b];
      const h1x = cx - ax,
        h1z = cz - az,
        h2x = bx - cx,
        h2z = bz - cz,
        l1 = Math.hypot(h1x, h1z) || 1,
        l2 = Math.hypot(h2x, h2z) || 1;
      this.lineCurvature[i] =
        Math.atan2(h1z * h2x - h1x * h2z, h1x * h2x + h1z * h2z) / ((l1 + l2) / 2);
    }
  }
  /** Sample index at or before distance d (binary search). */
  index(d: number) {
    if (this.closed) d = ((d % this.length) + this.length) % this.length;
    else d = clamp(d, 0, this.d[this.count - 1]);
    let lo = 0,
      hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.d[mid] <= d) lo = mid;
      else hi = mid;
    }
    return this.d[hi] <= d ? hi : lo;
  }
  at(d: number, out: PathPoint) {
    if (this.closed) d = ((d % this.length) + this.length) % this.length;
    else d = clamp(d, 0, this.d[this.count - 1]);
    const i = this.index(d),
      j = this.wrap(i + 1),
      seg = this.span(i, j),
      t = seg > 0 && j !== i ? clamp((d - this.d[i]) / seg, 0, 1) : 0,
      l = (a: ArrayLike<number>) => a[i] + (a[j] - a[i]) * t;
    out.d = d;
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
    out.halfWidth = l(this.halfWidth);
    out.edge = this.edge[i];
    out.leg = this.leg[i];
    return out;
  }
  lineAt(d: number) {
    const i = this.index(d),
      j = this.wrap(i + 1),
      seg = this.span(i, j),
      t = seg > 0 && j !== i ? clamp((d - this.d[i]) / seg, 0, 1) : 0;
    return this.line[i] + (this.line[j] - this.line[i]) * t;
  }
  verticalCurvatureAt(d: number) {
    return this.verticalCurvature[this.index(d)];
  }
  lineCurvatureAt(d: number) {
    const i = this.index(d);
    return this.lineCurvature[i];
  }
  /** Closest path distance to (x, z) within ±window of `guess` (local
   * search keeps switchback legs apart); returns lateral via `out`. */
  locate(
    x: number,
    z: number,
    guess: number,
    window = 60,
    out?: { lateral: number; distance: number },
  ) {
    const n = this.count;
    const start = this.index(guess - window),
      steps = Math.min(n, Math.ceil((2 * window) / 2) + 64);
    let best = Infinity,
      bestD = guess,
      bestLateral = 0;
    for (let k = 0, i = start; k < steps; k++) {
      const j = this.wrap(i + 1);
      if (j === i) break;
      const ax = this.x[i],
        az = this.z[i],
        dx = this.x[j] - ax,
        dz = this.z[j] - az,
        len2 = dx * dx + dz * dz || 1,
        t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1),
        ex = x - ax - dx * t,
        ez = z - az - dz * t,
        dist = ex * ex + ez * ez;
      if (dist < best) {
        best = dist;
        const seg = this.span(i, j);
        bestD = this.d[i] + seg * t;
        bestLateral = ((x - ax) * dz - (z - az) * dx) / Math.sqrt(len2);
      }
      if (this.span(start, j) > 2 * window) break;
      i = j;
    }
    if (out) {
      out.lateral = bestLateral;
      out.distance = Math.sqrt(best);
    }
    return this.closed ? ((bestD % this.length) + this.length) % this.length : bestD;
  }
  /** Path distance of a location on this route's RouteGraph (routeSpec):
   * leg `edge` (its id is the leg index) at 3-D arc `s` along that leg's
   * points, which start at the previous leg's last sample. RouteProgress
   * reports where a participant's legal progress stands in these terms. */
  progressDistance(edge: string | number, s: number) {
    const leg = Number(edge),
      n = this.count;
    let first = -1,
      last = -1;
    for (let i = 0; i < n; i++)
      if (this.leg[i] === leg) {
        if (first < 0) first = i;
        last = i;
      }
    if (first < 0) return 0;
    // The leg's polyline in the graph: joined to the previous leg's end,
    // closed back to the start on a circuit's last leg.
    const start = leg > 0 && first > 0 ? first - 1 : first,
      end = this.closed && last === n - 1 ? n : last;
    let arc = 0;
    for (let i = start; i < end; i++) {
      const j = (i + 1) % n,
        step = Math.hypot(this.x[j] - this.x[i], this.y[j] - this.y[i], this.z[j] - this.z[i]);
      if (arc + step >= s) {
        const f = step > 0 ? clamp((s - arc) / step, 0, 1) : 0,
          d = this.d[i] + this.span(i, j) * f;
        return this.closed ? d % this.length : d;
      }
      arc += step;
    }
    return end === n ? 0 : this.d[end];
  }
  /** RouteGraph spec of this route (legs as directed edges) with checkpoints
   * every `gateSpacing` metres and the finish at the route end. */
  routeSpec(id: string, gateSpacing = 400): RouteSpec {
    const edges: RouteEdgeSpec[] = [],
      checkpoints: Checkpoint[] = [];
    const legs = this.legs.length,
      finish = this.finishDistance;
    let finishGate: Checkpoint | null = null;
    let travelled = 0,
      nextGate = gateSpacing;
    for (let k = 0; k < legs; k++) {
      const points: RoutePoint[] = [];
      let arc3 = 0;
      for (let i = 0; i < this.count; i++) {
        if (this.leg[i] !== k) continue;
        const p = { x: this.x[i], y: this.y[i], z: this.z[i] };
        const last = points[points.length - 1];
        if (last) {
          const step = Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z);
          arc3 += step;
          travelled += Math.hypot(p.x - last.x, p.z - last.z);
        } else if (k > 0) {
          // Join the previous leg's end so consecutive edges share the point.
          const prev = edges[k - 1].points[edges[k - 1].points.length - 1];
          points.push(prev);
          const step = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
          arc3 += step;
          travelled += Math.hypot(p.x - prev.x, p.z - prev.z);
        }
        points.push(p);
        while (travelled >= nextGate && nextGate < finish - gateSpacing * 0.5) {
          checkpoints.push({ edge: `${k}`, s: arc3 });
          nextGate += gateSpacing;
        }
        if (!this.closed && !finishGate && travelled >= finish)
          finishGate = { edge: `${k}`, s: arc3 };
      }
      if (k === legs - 1 && this.closed) {
        const end = points[points.length - 1];
        if (Math.hypot(end.x - this.x[0], end.y - this.y[0], end.z - this.z[0]) > 0.05)
          points.push({ x: this.x[0], y: this.y[0], z: this.z[0] });
      }
      edges.push({
        id: `${k}`,
        kind: 'stage',
        points: points.length >= 2 ? points : [points[0], { ...points[0], x: points[0].x + 0.5 }],
        next: k < legs - 1 ? [`${k + 1}`] : this.closed ? ['0'] : [],
      });
    }
    // Finish: a circuit's line is the start; a point-to-point finish leaves
    // run-out before the end of the route.
    if (!finishGate) {
      const last = edges[legs - 1].points;
      let arc = 0;
      for (let i = 1; i < last.length; i++)
        arc += Math.hypot(
          last[i].x - last[i - 1].x,
          last[i].y - last[i - 1].y,
          last[i].z - last[i - 1].z,
        );
      finishGate = { edge: `${legs - 1}`, s: Math.max(0, arc - 1) };
    }
    checkpoints.push(finishGate);
    return { id, version: 1, closed: this.closed, start: '0', edges, checkpoints };
  }
  /** Distance of the finish line: the start of a circuit's lap, or short of
   * a point-to-point route's end so cars can stop beyond it. */
  get finishDistance() {
    return this.closed
      ? this.length
      : this.length - Math.min(Math.max(0, this.finishBuffer), this.length * 0.2);
  }
  /** Widest road half-width on the route (RouteProgress tolerance). */
  maxHalfWidth() {
    let w = 0;
    for (let i = 0; i < this.count; i++) w = Math.max(w, this.halfWidth[i]);
    return w;
  }
}
