import { G } from '../../core/math.ts';
import { takeoffSpeed, type JumpSurvey } from './profile.ts';

/** Take-off speed the sprung chassis adds to the speed held up the face
 * (m/s): the springs rebound off the lip and the flight starts slightly
 * behind the point-mass lip. Measured per feature kind on the production
 * terrain by scripts/offroad-calibration.ts (the AI's lip speeds there must
 * land on every surveyed landing face). */
export const TAKEOFF_GAIN: Readonly<Record<JumpSurvey['kind'], number>> = Object.freeze({
  tabletop: 0.4,
  'step-up': 0.45,
  crest: 0.3,
  kicker: 1.0,
  double: 0.5,
  triple: 0.78,
});
/** Lip speed (m/s) a rider rolls a feature at: below it the bike stays on the ground. */
export const ROLL_SPEED = 2.5;
/** Speed (m/s) whose energy carries a rolling bike `climb` metres up to a
 * crest at ROLL_SPEED (the drive is not counted on: on loose faces it
 * barely holds the grade). */
export function rollSpeed(climb: number) {
  return Math.sqrt(ROLL_SPEED * ROLL_SPEED + 2 * G * Math.max(0, climb));
}
/** The speed to hold up the face of `j` so the flight lands on its landing
 * zone (tabletops a little short: the deck is the safe side). */
export function jumpHoldSpeed(j: JumpSurvey) {
  const aim = j.landing - (j.forgiving ? 0.15 * j.landingLength : 0),
    v = takeoffSpeed(aim - j.takeoff, j.lipHeight - j.landingHeight, j.lipAngle);
  return Number.isFinite(v) ? Math.max(ROLL_SPEED, v - TAKEOFF_GAIN[j.kind]) : 12;
}
