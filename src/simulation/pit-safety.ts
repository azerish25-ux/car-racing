import { clamp, mod } from '../core/math.ts';
import type { Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';

// Standard-paddock values; venues supply their own through Track.pit.
export const PIT_HOLD_S = 268;
export const PIT_MERGE_END_S = 330;
/** Lane centre used by released/queued cars: 1.5 m inboard of the pit offset. */
const laneLateral = (track: Track, s: number) =>
  track.pitOffset(s) * ((track.pit.offset - 1.5) / track.pit.offset);
/** Predict the swept merge corridor from the hold line. Cars already committed
 * beyond it continue merging; racing traffic also predicts that trajectory.
 * The controller, not this predicate, supplies the actual braking force. */
export function pitMergeConflict(car: Vehicle, cars: readonly Vehicle[], track: Track): boolean {
  const hold = track.pit.holdLine,
    mergeEnd = track.pit.mergeEnd;
  if (car.pitPhase !== 6 || car.s < track.pit.limitAfter - 10 || car.s > hold + 2) return false;
  const approachTime = Math.max(0, hold - car.s) / Math.max(8, car.speed);
  for (const other of cars) {
    if (other === car || other.inPit || other.retired || other.speed < 1) continue;
    const initialGap = mod(other.s - hold + track.length / 2, track.length) - track.length / 2;
    if (initialGap > 100 || initialGap < -other.speed * (approachTime + 9)) continue;
    for (let t = 0.25; t <= 8; t += 0.25) {
      // Conservative low-speed acceleration followed by the exit speed cap.
      const travel = t < 3.5 ? 2 * t * t : 24.5 + 14 * (t - 3.5);
      const s = hold + travel;
      const ourLateral = laneLateral(track, s);
      const longitudinalGap = initialGap + other.speed * (approachTime + t) - travel;
      const theirLateral = other.lateral + clamp(other.aiOffset - other.lateral, -1.6 * t, 1.6 * t);
      if (
        Math.abs(longitudinalGap) < 7 + (other.speed + 14) * 0.125 &&
        Math.abs(theirLateral - ourLateral) < 3
      )
        return true;
      if (s > mergeEnd + 12) break;
    }
  }
  return false;
}
/** A stationary queue behind a serviced car must not deadlock its release.
 * Adjacent cars always block, moving upstream traffic blocks by time-to-arrival,
 * and a car waiting at least one chassis length behind yields priority. */
export function safePitRelease(car: Vehicle, cars: readonly Vehicle[], track: Track): boolean {
  for (const other of cars) {
    if (
      other === car ||
      !other.inPit ||
      Math.abs(other.lateral - track.pit.side * (track.pit.offset - 1.5)) > 2.4
    )
      continue;
    const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
    const a = car.forward.x * car.trackPosition.tx + car.forward.z * car.trackPosition.tz;
    const b = other.forward.x * car.trackPosition.tx + other.forward.z * car.trackPosition.tz;
    const occupied =
      2.5 * (Math.abs(a) + Math.abs(b)) +
      0.94 * (Math.sqrt(Math.max(0, 1 - a * a)) + Math.sqrt(Math.max(0, 1 - b * b))) +
      0.05;
    if (gap > -occupied && gap < 12) return false;
    if (gap <= -occupied && other.speed > 1 && -gap / other.speed < 2.5) return false;
  }
  return true;
}
export function pitYieldSpeed(
  car: Vehicle,
  conflict: boolean,
  braking: number,
  hold = PIT_HOLD_S,
): number {
  if (!conflict) return Infinity;
  const remaining = Math.max(0, hold - car.s);
  return Math.sqrt(2 * clamp(braking, 1, 8) * remaining);
}

/** Preparation must budget a finite-speed cross-track movement plus controller
 * response, not assume every car starts next to the pit-entry lane. */
export function pitPreparationDistance(speed: number, lateral: number, entryOffset = 6) {
  return Math.max(450, Math.max(0, speed) * (Math.abs(entryOffset - lateral) / 1.6 + 3));
}
/** When an occupied approach corridor prevents moving toward the pit entry,
 * yield longitudinally to traffic already nearer that corridor. Otherwise two
 * equally slow cars can stay side by side until the entry line is missed.
 * This returns a pedal-controller target only; no pose or velocity is rewritten.
 */
export function pitApproachTrafficSpeed(
  car: Vehicle,
  cars: readonly Vehicle[],
  track: Track,
  plannedOffset: number,
  entryOffset = 6,
): number {
  if (Math.abs(car.lateral - entryOffset) < 1.4 || Math.abs(plannedOffset - entryOffset) < 1.4)
    return Infinity;
  let speed = Infinity;
  for (const other of cars) {
    if (other === car || other.retired || other.inPit) continue;
    const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
    const reserve = 8 + Math.max(car.speed, other.speed) * 0.75;
    const nearer =
      Math.abs(other.lateral - entryOffset) < Math.abs(car.lateral - entryOffset) - 0.5;
    const separation = Math.abs(other.lateral - car.lateral);
    // In the planner's shared following corridor (<3 m), the rear car already
    // brakes for us. Yielding back to that follower creates a directed cycle:
    // both targets become zero and stationary-hazard flags sustain the queue.
    // Keep longitudinal priority here; swept lane-change checks still prohibit
    // cutting across it. A genuinely separate lane retains entry-lane priority.
    // A stopped follower cannot claim priority from the car ahead: doing so
    // creates a circular wait once both are classified as stationary hazards.
    // Moving traffic in the separate entry lane keeps the existing priority.
    if (gap < 0 && (separation < 3 || other.speed < 3)) continue;
    if (nearer && gap > -reserve && gap < reserve && separation > 2)
      speed = Math.min(speed, Math.max(0, other.speed - 4));
  }
  return speed;
}
