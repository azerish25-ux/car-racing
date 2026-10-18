import { scoreEvents, type ScoreEvent } from '../../core/scoring.ts';
import { RouteGraph, RouteProgress, validateRoute } from '../route-graph.ts';
import type { Vehicle } from '../vehicle.ts';
import type { FestivalResult } from './festival-result.ts';
import type { FestivalEventSpec } from './region-data.ts';
import { pathPoint, planRoute, RoutePath } from './route-path.ts';
import type { OpenWorld } from './world.ts';

export {
  EVENT_KIND_LABEL,
  FESTIVAL_RESULT_VERSION,
  isRace,
  RACE_KINDS,
  type DragSlip,
  type FestivalResult,
} from './festival-result.ts';

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
    const path = new RoutePath(
      world.network,
      planRoute(world.network, spec.waypoints, closed),
      closed,
      spec.finish,
    );
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
  private quality = 0;
  private duration = 0;
  private calm = 0;
  private invalid = false;
  /** Current live angle (rad) for presentation. */
  angle = 0;
  update(
    car: Vehicle,
    time: number,
    dt: number,
    offRoad: boolean,
    impact: boolean,
    grounded = true,
  ) {
    if (!Number.isFinite(time) || !Number.isFinite(dt) || dt <= 0 || dt > 0.25) return;
    const v = car.localVelocity,
      speed = Math.hypot(v.x, v.z);
    this.angle = speed > 3 ? Math.atan2(Math.abs(v.x), Math.max(0.1, v.z)) : 0;
    // A spin is not a controlled drift. Contacts also count during the
    // short straightening grace period, otherwise a last-frame wall hit
    // could bank a slide that should have been voided.
    const bailout =
      offRoad ||
      impact ||
      !grounded ||
      !Number.isFinite(speed) ||
      (speed > 9 && (v.z <= 2 || this.angle > 1.2));
    if (this.active && bailout) this.invalid = true;
    const sliding = speed > 9 && v.z > 2 && this.angle > 0.2 && this.angle <= 1.2;
    if (sliding) {
      if (!this.active) {
        this.active = true;
        this.quality = 0;
        this.duration = 0;
        this.invalid = false;
      }
      this.calm = 0;
      // Angle beyond ~12 degrees, saturating at ~45, weighted by speed.
      // Weight by elapsed simulation time, not frame count, so different
      // substep rates and brief straightening gaps score consistently.
      this.quality += Math.min(1, (this.angle - 0.2) / 0.55) * Math.min(1, speed / 25) * dt;
      this.duration += dt;
      if (bailout) this.invalid = true;
    } else if (this.active) {
      this.calm += dt;
      if (this.calm > 0.35) this.close(time);
    }
  }
  private close(time: number) {
    this.active = false;
    const event = this.current(time);
    if (event) this.events.push(event);
  }
  private current(time: number): ScoreEvent | null {
    return this.duration > 0.4
      ? {
          time,
          kind: 'drift',
          quality: this.duration ? this.quality / this.duration : 0,
          duration: this.duration,
          valid: !this.invalid,
        }
      : null;
  }
  /** Recovery must not preserve a provisional drift across a teleport. */
  invalidate(time: number) {
    if (this.active) {
      this.invalid = true;
      this.close(time);
    }
    this.angle = 0;
  }
  /** Close any open drift and score everything so far. */
  finish(time: number) {
    if (this.active) this.close(time);
    return scoreEvents(this.events);
  }
  /** Live total: closed drifts plus the running one's provisional points. */
  live(time: number) {
    const provisional = this.active ? this.current(time) : null;
    // The exact same formula as finish(): no phantom provisional points
    // for invalid/low-quality slides and no score jump when a drift closes.
    return scoreEvents(provisional ? [...this.events, provisional] : this.events).total;
  }
  get drifting() {
    return this.active;
  }
  /** Rewind: the meter's state now, and back to such a state (closed
   * drifts are only ever appended, so a count restores them). */
  snapshot(): DriftSnapshot {
    return {
      events: this.events.length,
      active: this.active,
      quality: this.quality,
      duration: this.duration,
      calm: this.calm,
      invalid: this.invalid,
    };
  }
  restore(s: DriftSnapshot) {
    this.events.length = Math.min(this.events.length, s.events);
    this.active = s.active;
    this.quality = s.quality;
    this.duration = s.duration;
    this.calm = s.calm;
    this.invalid = s.invalid;
    this.angle = 0;
  }
}
export interface DriftSnapshot {
  events: number;
  active: boolean;
  quality: number;
  duration: number;
  calm: number;
  invalid: boolean;
}

/** Participant of a running event. */
export interface Participant {
  car: Vehicle;
  progress: RouteProgress;
  finishTime: number | null;
  name: string;
}
/** Stars for a result against the event's targets. */
export function starsFor(
  spec: FestivalEventSpec,
  result: Pick<
    FestivalResult,
    'completed' | 'position' | 'trapKmh' | 'averageKmh' | 'driftScore' | 'time' | 'margin'
  >,
) {
  if (!result.completed) return 0;
  const t = spec.stars;
  switch (spec.kind) {
    case 'touge': {
      // Head to head: the margin over the rival at the finish (s).
      const margin = result.margin ?? (result.position === 1 ? 0.001 : -Infinity);
      return t ? t.filter((v) => margin >= v).length : result.position === 1 ? 3 : 1;
    }
    case 'speed-trap':
      return t ? t.filter((v) => (result.trapKmh ?? 0) >= v).length : 0;
    case 'speed-zone':
      return t ? t.filter((v) => (result.averageKmh ?? 0) >= v).length : 0;
    case 'drift-zone':
      return t ? t.filter((v) => (result.driftScore ?? 0) >= v).length : 0;
    case 'showcase':
      // Stars by time, and beating the pace car is at least one star.
      return Math.max(
        t ? t.filter((v) => (result.time ?? Infinity) <= v).length : 0,
        result.position === 1 ? 1 : 0,
      );
    default:
      return result.position === 1 ? 3 : (result.position ?? 99) <= 3 ? 2 : 1;
  }
}
