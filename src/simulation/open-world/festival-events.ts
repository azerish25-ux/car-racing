import { scoreEvents, type ScoreEvent } from '../../core/scoring.ts';
import { RouteGraph, RouteProgress, validateRoute } from '../route-graph.ts';
import type { Vehicle } from '../vehicle.ts';
import type { FestivalResult } from './festival-result.ts';
import type { FestivalEventSpec } from './region-data.ts';
import { pathPoint, planRoute, RoutePath } from './route-path.ts';
import type { OpenWorld } from './world.ts';

export { EVENT_KIND_LABEL, FESTIVAL_RESULT_VERSION, isRace, RACE_KINDS, type FestivalResult } from './festival-result.ts';

/** A festival event resolved against the road network. */
export interface FestivalEvent {
  index: number;
  spec: FestivalEventSpec;
  path: RoutePath;
  graph: RouteGraph;
  laps: number;
  /** Marker: the route start, its heading and the ground there. */
  marker: { x: number; y: number; z: number; heading: number };
  /** Total race distance (m). */
  distance: number;
}
/** Resolve every authored event: plan its route through the network,
 * validate the RouteGraph spec, place the marker. Throws on invalid data. */
export function resolveEvents(world: OpenWorld): FestivalEvent[] {
  return world.region.events.map((spec, index) => {
    const closed = spec.kind === 'circuit';
    const path = new RoutePath(world.network, planRoute(world.network, spec.waypoints, closed), closed);
    const routeSpec = path.routeSpec(spec.id);
    const errors = validateRoute(routeSpec);
    if (errors.length) throw new Error(`Festival event ${spec.id}: ${errors.join('; ')}`);
    const p = path.at(0, pathPoint());
    const laps = closed ? Math.max(1, spec.laps ?? 1) : 1;
    return {
      index,
      spec,
      path,
      graph: new RouteGraph(routeSpec),
      laps,
      marker: { x: p.x, y: p.y, z: p.z, heading: Math.atan2(p.tx, p.tz) },
      distance: closed ? path.length * laps : path.finishDistance,
    };
  });
}

/** Drift detector: slip angle over a speed floor, scored with scoring.ts
 * (event-based, explainable, repetition-decayed and combo-multiplied). */
export class DriftMeter {
  readonly events: ScoreEvent[] = [];
  private active = false;
  private start = 0;
  private quality = 0;
  private samples = 0;
  private calm = 0;
  private invalid = false;
  /** Current live angle (rad) for presentation. */
  angle = 0;
  update(car: Vehicle, time: number, dt: number, offRoad: boolean, impact: boolean) {
    const v = car.localVelocity,
      speed = Math.hypot(v.x, v.z);
    this.angle = speed > 3 ? Math.atan2(Math.abs(v.x), Math.max(0.1, v.z)) : 0;
    const sliding = speed > 9 && v.z > 2 && this.angle > 0.2;
    if (sliding) {
      if (!this.active) {
        this.active = true;
        this.start = time;
        this.quality = 0;
        this.samples = 0;
        this.invalid = false;
      }
      this.calm = 0;
      // Angle beyond ~12 degrees, saturating at ~45, weighted by speed.
      this.quality += Math.min(1, (this.angle - 0.2) / 0.55) * Math.min(1, speed / 25);
      this.samples++;
      if (offRoad || impact) this.invalid = true;
    } else if (this.active) {
      this.calm += dt;
      if (this.calm > 0.35) this.close(time);
    }
  }
  private close(time: number) {
    this.active = false;
    const duration = time - this.start - this.calm;
    if (duration > 0.4)
      this.events.push({
        time,
        kind: 'drift',
        quality: this.samples ? this.quality / this.samples : 0,
        duration,
        valid: !this.invalid,
      });
  }
  /** Close any open drift and score everything so far. */
  finish(time: number) {
    if (this.active) this.close(time);
    return scoreEvents(this.events);
  }
  /** Live total: closed drifts plus the running one's provisional points. */
  live(time: number) {
    const closed = scoreEvents(this.events).total;
    if (!this.active || !this.samples) return closed;
    return closed + Math.round(100 * Math.min(10, time - this.start) * (this.quality / this.samples));
  }
  get drifting() {
    return this.active;
  }
}

/** Participant of a running event. */
export interface Participant {
  car: Vehicle;
  progress: RouteProgress;
  finishTime: number | null;
  name: string;
}
/** Stars for a result against the event's targets. */
export function starsFor(spec: FestivalEventSpec, result: Pick<FestivalResult, 'completed' | 'position' | 'trapKmh' | 'averageKmh' | 'driftScore' | 'time'>) {
  if (!result.completed) return 0;
  const t = spec.stars;
  switch (spec.kind) {
    case 'speed-trap':
      return t ? t.filter((v) => (result.trapKmh ?? 0) >= v).length : 0;
    case 'speed-zone':
      return t ? t.filter((v) => (result.averageKmh ?? 0) >= v).length : 0;
    case 'drift-zone':
      return t ? t.filter((v) => (result.driftScore ?? 0) >= v).length : 0;
    case 'showcase':
      // Stars by time, and beating the pace car is at least one star.
      return Math.max(t ? t.filter((v) => (result.time ?? Infinity) <= v).length : 0, result.position === 1 ? 1 : 0);
    default:
      return result.position === 1 ? 3 : (result.position ?? 99) <= 3 ? 2 : 1;
  }
}
