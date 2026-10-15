import { approach, clamp, mod, Random, Vec3 } from '../core/math.ts';
import type { Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';

export interface DriverPersonality {
  aggression: number;
  consistency: number;
  wetSkill: number;
  overtakingSkill: number;
  tireManagement: number;
  defensiveBias: number;
  errorRate: number;
}
export function personality(seed: number, id: number): DriverPersonality {
  const rng = new Random((seed ^ Math.imul(id + 1, 0x9e3779b9)) >>> 0);
  return {
    aggression: 0.3 + rng.next() * 0.5,
    consistency: 0.92 + rng.next() * 0.07,
    wetSkill: 0.7 + rng.next() * 0.25,
    overtakingSkill: 0.7 + rng.next() * 0.25,
    tireManagement: 0.65 + rng.next() * 0.3,
    defensiveBias: rng.next(),
    errorRate: 0.002 + rng.next() * 0.005,
  };
}
/** A car ahead that has stayed below `speed` (m/s along the track) for
 * `seconds` without gaining `gain` (stalled on the grid, spun, recovering,
 * crawling) will not clear the lane by itself: following it would mean
 * waiting behind it for ever. A car launching from rest gains speed within a
 * few hundredths of a second, so a field leaving the grid is never mistaken
 * for a stalled one. From `holdAfter` cars behind it keep `holdGap` back
 * (bumper to bumper), room to steer out at low speed; once it is stalled they
 * wait there until a lane past it is free of traffic, then take that lane:
 * at `creep` while their nose still overlaps it and only while a full-lock
 * arc from where they are still clears its corner, stopping `contactGap`
 * short of it at the latest. A lane past it leaves `sideMargin` beyond both
 * bodies (its heading included: a spun car is wide). A lane that ends behind
 * it costs `blockedCost`, more than any lane change. */
export const STALLED = Object.freeze({
  speed: 3,
  seconds: 0.5,
  holdAfter: 0.2,
  gain: 0.3,
  holdGap: 4,
  creep: 2,
  contactGap: 0.8,
  sideMargin: 0.8,
  blockedCost: 30,
});
export interface TrafficPlan {
  offset: number;
  speedLimit: number;
  decision: string;
}

/** Swept track-coordinate footprints over a four-second horizon. Lane changes
 * are evaluated at their achievable slew rate, never as instantaneous offsets.
 * Acceleration uncertainty inflates longitudinal separation requirements. */
export class TrafficPlanner {
  readonly result: TrafficPlan = { offset: 0, speedLimit: 110, decision: 'RACING LINE' };
  /** Committed lane, as a distance from the racing line (which moves with s). */
  private heldOffset = 0;
  private holdUntil = 0;
  private preferred = 0;
  private candidates = new Float64Array(8);
  /** Last time each car (by id) was seen moving along the track (STALLED). */
  private movingAt = new Float64Array(0);
  /** Speed along the track when that clock last restarted. */
  private movedAlong = new Float64Array(0);
  /** Per car id this evaluation: ahead and slow (1, STALLED.holdAfter) or
   * stalled (2, STALLED.seconds), with its footprint across and along. */
  private stalled = new Uint8Array(0);
  private across = new Float64Array(0);
  private along = new Float64Array(0);
  private axis = new Vec3();
  private cosine = 1;
  /** The stalled car being passed (its id) this evaluation, or -1. */
  bypass = -1;
  /** The stalled car this car is held behind, waiting for a free lane, or -1. */
  waiting = -1;
  /** Explicit passing commitment (masterplan §13.4, WP20): the car being
   * passed, when the attempt began and since when it stopped closing. */
  passTarget = -1;
  private passSince = 0;
  private notClosingSince = -1;
  /** After an abort, lanes off the line cost more until this time (hysteresis). */
  private retryAfter = 0;
  passes = 0;
  aborts = 0;
  lastAbort = '';
  evaluate(
    car: Vehicle,
    cars: readonly Vehicle[],
    track: Track,
    now: number,
    braking: number,
    traits: DriverPersonality,
    yellow: boolean,
    preferredOffset = 0,
    approachingPit = false,
    /** Racing line offset at distance s (the centreline when not given). The
     * car follows it, so a lane is a distance from the line, and a path's
     * lateral position ahead includes the line's own shift. */
    line: (s: number) => number = () => 0,
    /** Lateral separation scale for narrow machines (1: car widths). */
    lateralScale = 1,
  ) {
    const lineOffset = line(car.s);
    // Lateral shift of a line-relative path between here and distance `s`.
    // The pit approach is an absolute corridor and does not follow the line.
    const shiftAt = (s: number) => (approachingPit ? 0 : line(s) - lineOffset);
    // Pit-lane centre used by queued/released cars (venue data, signed side).
    const pitLaneAt = (s: number) =>
      track.pitOffset(s) * ((track.pit.offset - 1.5) / track.pit.offset);
    // A new tactical purpose (pit entry or an early defensive choice) may
    // release the previous lane commitment; the swept safety tests still apply.
    if (Math.abs(preferredOffset - this.preferred) > 0.5) this.holdUntil = 0;
    this.preferred = preferredOffset;
    const result = this.result;
    const limit = Math.max(1, car.trackPosition.width - 2.4 * lateralScale);
    const closest = clamp(car.lateral, -limit, limit);
    const held = lineOffset + this.heldOffset;
    this.candidates[0] = clamp(now < this.holdUntil ? held : lineOffset, -limit, limit);
    this.candidates[1] = closest;
    this.candidates[2] = clamp(closest - 3.5 * lateralScale, -limit, limit);
    this.candidates[3] = clamp(closest + 3.5 * lateralScale, -limit, limit);
    this.candidates[4] = clamp(lineOffset, -limit, limit);
    this.candidates[5] = clamp(preferredOffset, -limit, limit);
    // Stalled cars ahead (STALLED), each with its footprint across and along
    // the track, and our own nose: its lateral position and reach ahead.
    const brake = Math.max(1, braking * 0.72);
    const [width, , length] = car.definition.halfExtents;
    const ourSin = this.heading(car),
      ourCos = this.cosine;
    // The leading end (the tail, should the car face backwards).
    const nose = car.lateral + length * ourSin * (ourCos < 0 ? -1 : 1),
      noseHalf = width * Math.abs(ourCos),
      front = length * Math.abs(ourCos) + width * Math.abs(ourSin);
    const passing = (other: Vehicle) =>
      Math.max(2.75 * lateralScale, this.across[other.id] + width + STALLED.sideMargin);
    let count = 6,
      nearest = Infinity;
    this.bypass = -1;
    this.waiting = -1;
    for (const other of cars) {
      const id = other.id;
      if (id >= this.movingAt.length) this.grow(id + 1);
      const p = other.trackPosition;
      const along = other.body.velocity.x * p.tx + other.body.velocity.z * p.tz;
      if (
        Number.isNaN(this.movingAt[id]) ||
        other.inPit ||
        along >= STALLED.speed ||
        along > this.movedAlong[id] + STALLED.gain
      ) {
        this.movingAt[id] = now;
        this.movedAlong[id] = along;
      }
      const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
      const slow = now - this.movingAt[id];
      this.stalled[id] =
        other === car || other.inPit || gap <= 0 || slow < STALLED.holdAfter
          ? 0
          : slow < STALLED.seconds
            ? 1
            : 2;
      if (!this.stalled[id]) continue;
      const [w, , l] = other.definition.halfExtents,
        sin = Math.abs(this.heading(other)),
        cos = Math.abs(this.cosine);
      this.across[id] = w * cos + l * sin;
      this.along[id] = l * cos + w * sin;
      // Lanes just clear of the nearest one in our path, on either side.
      if (this.stalled[id] === 2 && gap < nearest && gap < 180) {
        const side = passing(other),
          at = other.lateral - shiftAt(other.s);
        if (Math.abs(at - closest) < side) {
          nearest = gap;
          count = 8;
          this.candidates[6] = clamp(at - side, -limit, limit);
          this.candidates[7] = clamp(at + side, -limit, limit);
        }
      }
    }
    let best = Infinity,
      bestOffset = this.candidates[0],
      found = false;
    for (let k = 0; k < count; k++) {
      const candidate = this.candidates[k];
      // A service approach is a merge, not a new passing attempt. When its
      // destination corridor is occupied, hold and yield longitudinally rather
      // than taking an apparently clear overtaking lane away from the entry.
      if (
        approachingPit &&
        Math.abs(candidate - preferredOffset) > Math.abs(closest - preferredOffset) + 0.1
      )
        continue;
      // Queueing behind cars that are themselves slowing for the entry is the
      // purpose of that corridor, so slower traffic ahead in it is not a reason
      // to stay out. The swept separation test below still decides safety.
      const queueing = approachingPit && Math.abs(candidate - preferredOffset) < 1.4;
      // Under yellow, safe changes around stationary hazards remain legal.
      // The speed planner below prevents gaining on moving competitors.
      let score =
        Math.abs(candidate - preferredOffset) * 1.0 +
        Math.abs(candidate - closest) * (0.2 + (1 - traits.overtakingSkill) * 0.45);
      if (now < this.holdUntil && Math.abs(candidate - held) > 0.6) score += 6;
      if (now < this.retryAfter && Math.abs(candidate - lineOffset) > 1) score += 4;
      let safe = true;
      for (const other of cars) {
        if (
          other === car ||
          (other.inPit !== car.inPit &&
            !(
              Math.abs(other.lateral) < other.trackPosition.width + 2.8 ||
              (other.pitPhase === 6 && other.s > 250)
            ))
        )
          continue;
        const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
        if (Math.abs(gap) > 180) continue;
        const closing = other.speed - car.speed;
        // Other cars on track follow the line too: predict them along it, and
        // extrapolate only the part of their lateral velocity that is a lane
        // change (not the line's own drift across the track).
        const theirLine = other.inPit ? 0 : line(other.s);
        const lineDrift = other.inPit
          ? 0
          : ((line(other.s + 1) - line(other.s - 1)) / 2) * other.speed;
        const lateralVelocity = clamp(
          other.body.velocity.x * other.trackPosition.nx +
            other.body.velocity.z * other.trackPosition.nz -
            lineDrift,
          -2,
          2,
        );
        if (this.stalled[other.id] === 2) {
          // A stationary obstacle is passed in a lane clear of its body, now
          // and as it drifts; any other lane ends behind it. That is no
          // collision course while we can still stop short of it (the speed
          // plan below holds us there), only a lane going nowhere.
          const at = candidate + shiftAt(other.s);
          const clearance = Math.min(
            Math.abs(at - other.lateral),
            Math.abs(at - other.lateral - lateralVelocity * 1.2),
          );
          if (clearance >= passing(other)) continue;
          const room = gap - front - this.along[other.id] - STALLED.contactGap;
          if (room < (car.speed * car.speed) / (2 * brake)) {
            safe = false;
            break;
          }
          score += STALLED.blockedCost;
          continue;
        }
        for (let t = 0.2; t <= 4; t += 0.4) {
          const dx = gap + closing * t;
          const ours = approach(closest, candidate, 1.6 * t) + shiftAt(car.s + car.speed * t);
          const theirs = other.inPit
            ? other.pitPhase === 6
              ? pitLaneAt(other.s + other.speed * t)
              : track.pit.side * Math.max(6, track.pit.side * pitLaneAt(other.s + other.speed * t))
            : other.lateral +
              line(other.s + other.speed * t) -
              theirLine +
              lateralVelocity * Math.min(t, 1.2);
          const dy = Math.abs(theirs - ours);
          if (Math.abs(dx) < 6.5 + Math.min(4, t * 0.5) && dy < 2.75 * lateralScale) {
            safe = false;
            break;
          }
          if (!queueing && dx > 0 && dx < 70 && dy < 2.9 * lateralScale)
            score += ((70 - dx) / 70) * (1 + traits.aggression);
        }
        if (!safe) break;
      }
      if (safe && score < best) {
        best = score;
        bestOffset = candidate;
        found = true;
      }
    }
    // When no lane is safe, hold the currently occupied corridor and brake.
    // Emergency avoidance must not weave across a second car to dodge the first.
    result.offset = found ? bestOffset : closest;
    result.speedLimit = 110;
    result.decision = !found
      ? 'ABORT / FOLLOW'
      : Math.abs(bestOffset - lineOffset) > 1
        ? 'PASS / HOLD LANE'
        : 'RACING LINE';
    if (found && Math.abs(bestOffset - held) > 0.6) {
      this.heldOffset = bestOffset - lineOffset;
      this.holdUntil = now + 3;
    }
    this.trackPass(car, cars, track, now, found, lineOffset, traits);
    for (const other of cars) {
      if (
        other === car ||
        (other.inPit !== car.inPit &&
          !(
            Math.abs(other.lateral) < other.trackPosition.width + 2.8 ||
            (other.pitPhase === 6 && other.s > 250)
          ))
      )
        continue;
      const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
      if (gap <= 0 || gap > 180) continue;
      if (yellow && !other.retired && other.speed > 5 && gap < 55)
        result.speedLimit = Math.min(result.speedLimit, Math.max(5, other.speed - 1));
      // Our path reaches the other car's distance shifted with the line.
      const shift = shiftAt(other.s);
      if (this.stalled[other.id] === 2) {
        // Held back only while our nose overlaps it or our lane ends behind
        // it: alongside in a clear lane is passing it, not following it.
        const overlap =
          Math.abs(other.lateral - (nose + shift)) < this.across[other.id] + noseHalf + 0.3;
        const clear = Math.abs(other.lateral - (result.offset + shift)) >= passing(other);
        if (!overlap && clear) continue;
        const room = gap - front - this.along[other.id] - STALLED.contactGap;
        const reserve = 7 + car.speed * (0.45 + 0.12 * (1 - traits.consistency));
        const creep = clear && this.arcClears(car, other, gap, ourSin, ourCos, result.offset + shift);
        const limited =
          room <= 0
            ? 0
            : creep
              ? Math.sqrt(STALLED.creep ** 2 + 2 * brake * Math.max(0, gap - reserve))
              : Math.sqrt(
                  2 *
                    brake *
                    Math.max(
                      0,
                      gap - Math.max(reserve, front + this.along[other.id] + STALLED.holdGap),
                    ),
                );
        result.speedLimit = Math.min(result.speedLimit, limited);
        if (creep) this.bypass = other.id;
        else this.waiting = other.id;
        continue;
      }
      const corridor =
        Math.abs(other.lateral - (car.lateral + shift)) < 3 * lateralScale ||
        Math.abs(other.lateral - (result.offset + shift)) < 3 * lateralScale;
      if (!corridor) continue;
      let reserve = 7 + car.speed * (0.45 + 0.12 * (1 - traits.consistency));
      // Not closing up to a car that has stopped leaves room to steer past it.
      if (this.stalled[other.id])
        reserve = Math.max(reserve, front + this.along[other.id] + STALLED.holdGap);
      const safeSpeed = Math.sqrt(
        Math.max(0, other.speed * other.speed + 2 * Math.max(1, braking * 0.72) * (gap - reserve)),
      );
      result.speedLimit = Math.min(result.speedLimit, safeSpeed);
      if (gap < 7) result.speedLimit = Math.min(result.speedLimit, Math.max(0, other.speed - 4));
    }
    if (this.waiting >= 0) result.decision = 'WAIT / STALLED CAR';
    else if (this.bypass >= 0 && result.decision !== 'PASS / COMPLETE' && !result.decision.includes('ABORT'))
      result.decision = 'PASS / STALLED CAR';
    return result;
  }
  /** Sine of a car's heading from the track direction (positive: towards
   * positive lateral offsets); its cosine is left in `cosine`. */
  private heading(v: Vehicle) {
    const p = v.trackPosition;
    v.body.orientation.rotate(this.axis.set(0, 0, 1), this.axis);
    this.cosine = this.axis.x * p.tx + this.axis.z * p.tz;
    return this.axis.x * p.nx + this.axis.z * p.nz;
  }
  /** Whether a full-lock turn from our pose towards `lane` sweeps clear of
   * the stalled car's near corner (`gap` ahead): its distance from the turn
   * centre exceeds the radius of our outer front corner, with a margin. */
  private arcClears(
    car: Vehicle,
    other: Vehicle,
    gap: number,
    sin: number,
    cos: number,
    lane: number,
  ) {
    const side = lane >= other.lateral ? 1 : -1,
      [width, , length] = car.definition.halfExtents,
      half = car.spec.wheelbase / 2,
      radius = car.spec.wheelbase / Math.tan(car.spec.maxSteer);
    // Track frame: along from our centre, across as lateral offset.
    const centreAlong = -half * cos - side * radius * sin,
      centreAcross = car.lateral - half * sin + side * radius * cos;
    const corner = Math.hypot(
      gap - this.along[other.id] - centreAlong,
      other.lateral + side * this.across[other.id] - centreAcross,
    );
    return corner > Math.hypot(radius + width, length + half) + 0.25;
  }
  private grow(size: number) {
    const moving = new Float64Array(size).fill(NaN),
      moved = new Float64Array(size);
    moving.set(this.movingAt);
    moved.set(this.movedAlong);
    this.movingAt = moving;
    this.movedAlong = moved;
    this.stalled = new Uint8Array(size);
    this.across = new Float64Array(size);
    this.along = new Float64Array(size);
  }
  /** Commit to one target per attempt; complete when clear ahead, abort when
   * the gap opens, closing speed is lost for a second, the defender covers the
   * chosen lane before overlap, or no lane is safe. */
  private trackPass(
    car: Vehicle,
    cars: readonly Vehicle[],
    track: Track,
    now: number,
    found: boolean,
    lineOffset: number,
    traits: DriverPersonality,
  ) {
    const result = this.result;
    const gapTo = (other: Vehicle) =>
      mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
    if (this.passTarget < 0) {
      if (!found || Math.abs(result.offset - lineOffset) <= 1 || now < this.retryAfter) return;
      let target: Vehicle | null = null,
        nearest = 70;
      for (const other of cars) {
        if (other === car || other.inPit || other.retired || other.finishTime) continue;
        const gap = gapTo(other);
        if (gap > 0 && gap < nearest && Math.abs(other.lateral - car.lateral) < 3) {
          nearest = gap;
          target = other;
        }
      }
      if (!target) return;
      this.passTarget = target.id;
      this.passSince = now;
      this.notClosingSince = -1;
      return;
    }
    const target = cars.find((other) => other.id === this.passTarget);
    const gap = target ? gapTo(target) : Infinity;
    if (target && gap < -6.5) {
      this.passes++;
      this.passTarget = -1;
      result.decision = 'PASS / COMPLETE';
      return;
    }
    let reason = '';
    if (!target || target.inPit || target.retired) reason = 'TARGET GONE';
    else if (!found) reason = 'NO SAFE LANE';
    else if (gap > 45) reason = 'GAP OPENED';
    else {
      if (car.speed - target.speed < -0.5) {
        if (this.notClosingSince < 0) this.notClosingSince = now;
      } else this.notClosingSince = -1;
      if (this.notClosingSince >= 0 && now - this.notClosingSince > 1) reason = 'NOT CLOSING';
      else if (gap > 7 && gap < 25 && Math.abs(target.lateral - result.offset) < 2)
        reason = 'COVERED';
      else if (now - this.passSince > 12) reason = 'TIMED OUT';
    }
    if (!reason) {
      result.decision = 'PASS / COMMITTED';
      return;
    }
    this.aborts++;
    this.lastAbort = reason;
    this.passTarget = -1;
    this.holdUntil = 0;
    this.retryAfter = now + 2.5 + (1 - traits.overtakingSkill) * 2;
    result.decision = `PASS / ABORT ${reason}`;
  }
}
