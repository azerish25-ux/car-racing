/** Directed route graph with legal progress (WP11 / F05, masterplan §14.2).
 * Road sections are directed edges with local three-dimensional frames; each
 * participant's progress keeps its current edge, distance along it, accepted
 * checkpoints and permitted next transitions. Candidates are resolved by
 * horizontal proximity, height, travel direction and previous route state —
 * never by the horizontally closest centreline alone — so stacked roads,
 * pit branches, joker laps and point-to-point stages share one contract.
 * Physical contact stays with the contact mesh; this owns race progression. */
export interface RoutePoint {
  x: number;
  y: number;
  z: number;
}
export interface RouteEdgeSpec {
  id: string;
  kind: 'main' | 'pit' | 'joker' | 'stage';
  points: readonly RoutePoint[];
  /** Edges a participant may legally continue onto from this edge's end. */
  next: readonly string[];
}
export interface Checkpoint {
  edge: string;
  s: number;
}
export interface RouteSpec {
  id: string;
  version: number;
  closed: boolean;
  start: string;
  edges: readonly RouteEdgeSpec[];
  /** Ordered gates a valid lap/stage must pass; the last is the finish. */
  checkpoints: readonly Checkpoint[];
}
interface Frame extends RoutePoint {
  s: number;
  tx: number;
  ty: number;
  tz: number;
  /** Lateral (left) unit vector and surface normal: a right-handed local frame. */
  lx: number;
  lz: number;
}
interface Edge {
  spec: RouteEdgeSpec;
  frames: Frame[];
  length: number;
}
export interface RouteLocation {
  edge: string;
  s: number;
  lateral: number;
  height: number;
  distance: number;
}
/** Bounds for untrusted/imported routes (WP14 / WP56). */
export const ROUTE_LIMITS = Object.freeze({
  edges: 256,
  pointsPerEdge: 4096,
  checkpoints: 256,
  coordinate: 1e5,
  idLength: 64,
});
/** Every reason a route spec cannot be used; empty when valid. */
export function validateRoute(spec: RouteSpec): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(spec.edges) || spec.edges.length < 1 || spec.edges.length > ROUTE_LIMITS.edges)
    return [`Route ${spec.id}: 1-${ROUTE_LIMITS.edges} edges required`];
  for (const edge of spec.edges) {
    if (typeof edge.id !== 'string' || !edge.id || edge.id.length > ROUTE_LIMITS.idLength)
      errors.push('Edge with an invalid id');
    else if (ids.has(edge.id)) errors.push(`Duplicate edge ${edge.id}`);
    ids.add(edge.id);
    if (!Array.isArray(edge.points) || edge.points.length < 2)
      errors.push(`Edge ${edge.id}: at least two points`);
    else if (edge.points.length > ROUTE_LIMITS.pointsPerEdge)
      errors.push(`Edge ${edge.id}: too many points`);
    else
      edge.points.forEach((p: RoutePoint, i: number) => {
        if (
          ![p.x, p.y, p.z].every(
            (v) => Number.isFinite(v) && Math.abs(v) <= ROUTE_LIMITS.coordinate,
          )
        )
          errors.push(`Edge ${edge.id}: non-finite or out-of-range point ${i}`);
        else if (i > 0) {
          const q = edge.points[i - 1];
          if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-3)
            errors.push(`Edge ${edge.id}: zero-length segment at point ${i}`);
        }
      });
  }
  for (const edge of spec.edges)
    for (const next of edge.next ?? [])
      if (!ids.has(next)) errors.push(`Edge ${edge.id} continues to unknown edge ${next}`);
  if (!ids.has(spec.start)) errors.push(`Unknown start edge ${spec.start}`);
  // Every edge must be reachable from the start: a disconnected edge is a bug.
  const reached = new Set<string>([spec.start]),
    queue = [spec.start];
  while (queue.length) {
    const id = queue.pop();
    const edge = spec.edges.find((e) => e.id === id);
    for (const next of edge?.next ?? [])
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
  }
  for (const id of ids)
    if (!reached.has(id)) errors.push(`Edge ${id} is disconnected from ${spec.start}`);
  if (!spec.checkpoints?.length || spec.checkpoints.length > ROUTE_LIMITS.checkpoints)
    errors.push('A route needs 1-256 checkpoints');
  for (const c of spec.checkpoints ?? [])
    if (!ids.has(c.edge) || !(c.s >= 0)) errors.push(`Invalid checkpoint on ${c.edge}`);
  if (spec.closed && !spec.edges.some((e) => e.next.includes(spec.start)))
    errors.push('A closed route must return to its start edge');
  return errors;
}
export class RouteGraph {
  private readonly edges = new Map<string, Edge>();
  constructor(readonly spec: RouteSpec) {
    const errors = validateRoute(spec);
    if (errors.length) throw new Error(`Invalid route ${spec.id}: ${errors.join('; ')}`);
    for (const e of spec.edges) {
      const frames: Frame[] = [];
      let s = 0;
      e.points.forEach((p, i) => {
        const a = e.points[Math.max(0, i - 1)],
          b = e.points[Math.min(e.points.length - 1, i + 1)];
        if (i) {
          const q = e.points[i - 1];
          s += Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        }
        const dx = b.x - a.x,
          dy = b.y - a.y,
          dz = b.z - a.z,
          len = Math.hypot(dx, dy, dz),
          horizontal = Math.hypot(dx, dz) || 1;
        // Lateral is horizontal and left of travel; normal follows from it.
        frames.push({
          ...p,
          s,
          tx: dx / len,
          ty: dy / len,
          tz: dz / len,
          lx: -dz / horizontal,
          lz: dx / horizontal,
        });
      });
      this.edges.set(e.id, { spec: e, frames, length: s });
    }
  }
  length(edge: string) {
    return this.edges.get(edge)?.length ?? 0;
  }
  /** Closest point on one edge in 3-D, weighting height mismatch heavily. */
  project(edgeId: string, p: RoutePoint): RouteLocation | null {
    const edge = this.edges.get(edgeId);
    if (!edge) return null;
    let best: RouteLocation | null = null;
    const f = edge.frames;
    for (let i = 0; i < f.length - 1; i++) {
      const a = f[i],
        b = f[i + 1],
        dx = b.x - a.x,
        dz = b.z - a.z,
        t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz))),
        x = a.x + dx * t,
        y = a.y + (b.y - a.y) * t,
        z = a.z + dz * t,
        height = p.y - y,
        lateral = (p.x - x) * a.lx + (p.z - z) * a.lz,
        // Height counts four times horizontal distance: a road 9 m below is
        // never "closer" than the road a car is 1 m above.
        distance = Math.hypot(p.x - x, p.z - z, 4 * Math.max(0, Math.abs(height) - 1.5));
      if (!best || distance < best.distance)
        best = { edge: edgeId, s: a.s + (b.s - a.s) * t, lateral, height, distance };
    }
    return best;
  }
  successors(edge: string) {
    return this.edges.get(edge)?.spec.next ?? [];
  }
}
/** One participant's legal progress through a RouteGraph. */
export class RouteProgress {
  edge: string;
  s = 0;
  /** Index of the next checkpoint to pass. */
  checkpoint = 0;
  laps = 0;
  finished = false;
  /** Metres travelled along accepted route edges. */
  distance = 0;
  /** True while the physical position does not match any permitted edge. */
  offRoute = false;
  constructor(
    readonly graph: RouteGraph,
    /** Lateral tolerance (m) for being on an edge, e.g. road half-width + margin. */
    readonly tolerance = 14,
  ) {
    this.edge = graph.spec.start;
  }
  /** Advance from a physical position; returns the accepted location. Only
   * the current edge and its permitted successors are candidates, and along
   * an edge progress may not jump more than `maxStep` metres (a shortcut
   * across an infield is detected, not credited). */
  update(p: RoutePoint, maxStep = 60): RouteLocation | null {
    const candidates = [this.edge, ...this.graph.successors(this.edge)];
    let best: RouteLocation | null = null;
    for (const id of candidates) {
      const at = this.graph.project(id, p);
      if (!at || at.distance > this.tolerance) continue;
      const along = id === this.edge ? at.s - this.s : this.graph.length(this.edge) - this.s + at.s;
      if (along < -maxStep || along > maxStep) continue;
      // Prefer staying on the current edge until its end is genuinely reached.
      const score = at.distance + (id === this.edge ? 0 : 2);
      if (!best || score < best.distance + (best.edge === this.edge ? 0 : 2)) best = at;
    }
    this.offRoute = !best;
    if (!best || this.finished) return best;
    const travelled =
      best.edge === this.edge ? best.s - this.s : this.graph.length(this.edge) - this.s + best.s;
    if (best.edge !== this.edge) this.edge = best.edge;
    this.s = best.s;
    this.distance += Math.max(0, travelled);
    const gates = this.graph.spec.checkpoints,
      gate = gates[this.checkpoint];
    if (gate && gate.edge === this.edge && this.s >= gate.s) {
      this.checkpoint++;
      if (this.checkpoint === gates.length) {
        // A lap counts only when every gate was passed in order.
        if (this.graph.spec.closed) {
          this.checkpoint = 0;
          this.laps++;
        } else this.finished = true;
      }
    }
    return best;
  }
}
