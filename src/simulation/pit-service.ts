import { clamp } from '../core/math.ts';
import type { VehicleDefinition } from './vehicles.ts';

/** One pit service per vehicle family. The simulation advances the service
 * phases on these boundaries; the presentation reads the same plan, so a crew
 * can never animate a different service from the one the race director timed.
 *
 * Phases on the service clock (s from stopping in the box):
 *   2 lift (jacks / stands in), 3 old wheels off, 4 new wheels on (the tyres
 *   are exchanged as phase 4 begins), 5 lower and clear (bodywork repair);
 *   release is possible from the last boundary, subject to `safePitRelease`. */
export interface PitServicePlan {
  readonly kind: 'car' | 'bike';
  /** End of phases 2, 3, 4 and 5 on the service clock (s), strictly increasing. */
  readonly ends: readonly [number, number, number, number];
  /** Actors the crew presentation draws for one stopped entrant. */
  readonly crew: number;
  /** Lift device: car jacks under the nose and tail, or motorcycle paddock stands. */
  readonly lift: 'jacks' | 'stands';
  /** Peak lift the device gives the serviced entrant (m). */
  readonly liftHeight: number;
  /** HUD labels for phases 0..6. */
  readonly labels: readonly string[];
}

/** Four-wheel car: front and rear jacks, a gun/off/on trio per wheel and the
 * release (fifteen actors). Unchanged since the first integrated pit stop. */
export const CAR_PIT_SERVICE: PitServicePlan = Object.freeze({
  kind: 'car',
  ends: Object.freeze([0.8, 2.2, 3.5, 5.2] as const),
  crew: 15,
  lift: 'jacks',
  liftHeight: 0.19,
  labels: Object.freeze([
    '',
    'PIT ENTRY · APPROACHING BOX',
    'STOPPED · CAR JACKED',
    'TYRE CHANGE',
    'NEW TYRES FITTED',
    'FRONT WING REPAIR',
    'RELEASED · PIT EXIT',
  ]),
});

/** Motorcycle: the rider stays aboard while a rear paddock stand lifts the
 * swingarm spools and a front stand lifts the fork bottoms; one mechanic per
 * axle runs the nut gun, a carrier per wheel takes the old wheel out (the rear
 * rolls back out of the swingarm, the front drops out of the fork) and one
 * fitter per wheel brings the new one in, plus the release: nine actors.
 * A quick-release axle change is slower than a centre-lock car hub, so every
 * phase is longer; both tyres are exchanged so the compound the rider sees on
 * the HUD is the compound on both contact patches. */
export const BIKE_PIT_SERVICE: PitServicePlan = Object.freeze({
  kind: 'bike',
  ends: Object.freeze([1.2, 3.8, 6.6, 8] as const),
  crew: 9,
  lift: 'stands',
  liftHeight: 0.08,
  labels: Object.freeze([
    '',
    'PIT ENTRY · APPROACHING BOX',
    'STOPPED · ON STANDS',
    'WHEELS OUT',
    'NEW WHEELS IN',
    'STANDS DOWN',
    'RELEASED · PIT EXIT',
  ]),
});

/** The service plan a definition's family uses. */
export function pitServicePlan(definition: Pick<VehicleDefinition, 'dynamicsKind'>) {
  return definition.dynamicsKind === 'bike' ? BIKE_PIT_SERVICE : CAR_PIT_SERVICE;
}

/** Service phase (2..5) at a service clock, or 6 once the minimum service
 * has run (release then waits for `safePitRelease`). */
export function servicePhaseAt(plan: PitServicePlan, clock: number) {
  if (!Number.isFinite(clock) || clock < 0) throw new Error('Invalid pit service clock');
  const [lift, off, on, lower] = plan.ends;
  return clock < lift ? 2 : clock < off ? 3 : clock < on ? 4 : clock < lower ? 5 : 6;
}

/** Map a service clock of `plan` onto the car service clock, piecewise
 * linearly between matching phase boundaries. The authored crew actions are
 * keyed on the car clock; a motorcycle crew plays the same actions stretched
 * over its longer phases, so a carried wheel and the hand that carries it
 * still meet the exchange at the same moment. Identity for the car plan. */
export function carServiceClock(plan: PitServicePlan, clock: number) {
  if (!Number.isFinite(clock) || clock < 0) throw new Error('Invalid pit service clock');
  if (plan === CAR_PIT_SERVICE) return clock;
  const from = plan.ends,
    to = CAR_PIT_SERVICE.ends;
  let a = 0,
    b = 0;
  for (let i = 0; i < 4; i++) {
    if (clock < from[i]) return b + ((clock - a) / (from[i] - a)) * (to[i] - b);
    a = from[i];
    b = to[i];
  }
  // Held for traffic after the minimum service: the car clock keeps running
  // at the same rate past its own release boundary, as a held car's does.
  return b + (clock - a);
}

/** Stand lift (m) for a motorcycle service: stands go in and lift over the
 * second half of phase 2 and come down over the first half of phase 5. A
 * recorded presentation value (`F.JACK_HEIGHT`); the dynamics hold the bike. */
export function bikeStandLift(phase: number, clock: number, plan = BIKE_PIT_SERVICE) {
  if (!Number.isFinite(phase) || !Number.isFinite(clock)) throw new Error('Invalid stand state');
  const [lift, , on, lower] = plan.ends;
  if (phase < 2 || phase > 5) return 0;
  const up = clamp((clock - lift * 0.45) / (lift * 0.5), 0, 1),
    down = clamp((clock - on) / ((lower - on) * 0.55), 0, 1);
  const s = (x: number) => x * x * (3 - 2 * x);
  return plan.liftHeight * s(up) * (1 - s(down));
}
