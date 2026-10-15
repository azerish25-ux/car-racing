import {
  RouteGraph,
  RouteProgress,
  type RoutePoint,
  type RouteSpec,
} from '../simulation/route-graph.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
import type { Simulation } from '../simulation/world.ts';

/** A closed two-edge RouteSpec along a Track's centreline, with gates at the
 * half-lap points and the finish just past the line, so a RouteProgress lap
 * completes on the same crossing as the RaceDirector lap counter. */
export function trackRouteSpec(track: Track, spacing = 8): RouteSpec {
  const half = track.length / 2,
    p = trackPoint();
  const edge = (from: number, to: number): RoutePoint[] => {
    const n = Math.max(2, Math.ceil((to - from) / spacing) + 1);
    return Array.from({ length: n }, (_, i) => {
      track.at(from + ((to - from) * i) / (n - 1), p);
      return { x: p.x, y: p.y, z: p.z };
    });
  };
  const a = edge(0, half),
    b = edge(half, track.length);
  const lengthOf = (pts: RoutePoint[]) =>
    pts.reduce(
      (sum, q, i) =>
        i ? sum + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y, q.z - pts[i - 1].z) : 0,
      0,
    );
  return {
    id: 'server-audit',
    version: 1,
    closed: true,
    // Grids sit behind the line, at the end of the second edge.
    start: 'b',
    edges: [
      { id: 'a', kind: 'main', points: a, next: ['b'] },
      { id: 'b', kind: 'main', points: b, next: ['a'] },
    ],
    checkpoints: [
      { edge: 'a', s: lengthOf(a) / 2 },
      { edge: 'b', s: 0.5 },
      { edge: 'b', s: lengthOf(b) / 2 },
      { edge: 'a', s: 0.5 },
    ],
  };
}

/** Server-side legal-progress audit (masterplan §22: the server owns legal
 * progress). RaceDirector still classifies; every car is also tracked through
 * a RouteGraph with RouteProgress, which only credits permitted transitions
 * and bounded steps, so a disagreement between the two lap counts is
 * reported as a progress dispute instead of passing silently. */
export class LegalProgressAudit {
  readonly graph: RouteGraph;
  readonly progress: RouteProgress[];
  readonly offRouteSamples: number[];
  private samples = 0;
  constructor(
    private readonly sim: Simulation,
    /** Lateral tolerance: road half-width plus the pit-lane offset. */
    tolerance = 40,
  ) {
    this.graph = new RouteGraph(trackRouteSpec(sim.track));
    this.progress = sim.cars.map((car) => {
      const progress = new RouteProgress(this.graph, tolerance),
        at = this.graph.project('b', car.body.position);
      if (at) progress.s = at.s;
      return progress;
    });
    this.offRouteSamples = sim.cars.map(() => 0);
  }
  update() {
    this.samples++;
    this.sim.cars.forEach((car, i) => {
      this.progress[i].update(car.body.position);
      if (this.progress[i].offRoute) this.offRouteSamples[i]++;
    });
  }
  laps(car: number) {
    return this.progress[car].laps;
  }
  /** Cars whose RouteProgress lap count differs from the lap counter. */
  disputes() {
    const out: number[] = [];
    this.sim.cars.forEach((_, i) => {
      if (this.progress[i].laps !== this.sim.race.laps[i].completed) out.push(i);
    });
    return out;
  }
}
