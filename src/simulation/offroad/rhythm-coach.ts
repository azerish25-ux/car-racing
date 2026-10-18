import { jumpHoldSpeed } from './jump-target.ts';
import type { JumpSurvey } from './profile.ts';
import { LANDING_RULES, type MotocrossLandingFeedback } from './riding-feedback.ts';

export interface JumpApproachCue {
  kind: 'build' | 'hold' | 'ease' | 'roll';
  targetKph: number;
  cue: string;
}

/** A surveyed reference speed, not a guarantee or an automatic throttle aid.
 * Share the calibrated target with the production AI instead of inventing a
 * second ballistic solution in the HUD. Distances and speed are SI units. */
export function motocrossApproachCue(
  jump: JumpSurvey,
  distanceToLip: number,
  speed: number,
  wet = false,
): JumpApproachCue | null {
  if (![distanceToLip, speed].every(Number.isFinite) || distanceToLip < 0 || distanceToLip > 100)
    return null;
  const target = jumpHoldSpeed(jump);
  const targetKph = Math.round(target * 3.6);
  const deficit = target - Math.max(0, speed);
  // Warn while there is still an approach, not after the bike has left the lip.
  // Rolling calls for a controlled climb, not braking to a halt on the face.
  if (deficit > 2.5 && distanceToLip <= Math.max(8, jump.takeoff - jump.start + 4))
    return {
      kind: 'roll',
      targetKph,
      cue: jump.forgiving
        ? 'Short on speed · roll the deck with steady drive.'
        : 'Short on speed · roll the mounds; do not chase the gap.',
    };
  if (deficit < -1.2)
    return { kind: 'ease', targetKph, cue: 'Ease speed while straight, before the face.' };
  if (deficit > 1.2)
    return {
      kind: 'build',
      targetKph,
      cue: wet
        ? 'Wet soil · build drive early and keep the bike straight.'
        : 'Build drive before the face, then hold a steady line.',
    };
  return {
    kind: 'hold',
    targetKph,
    cue: 'Reference speed reached · hold your line and match the downslope.',
  };
}

export interface RhythmSnapshot {
  course: object;
  time: number;
  airborne: boolean;
  airTime: number;
  crashed: boolean;
  landing: MotocrossLandingFeedback;
}

/** Session-local practice objective: link three clean, settled landings.
 * Reads snapshots only; it never changes grip, awards career currency, unlocks
 * content or controls the bike. A hold cannot count twice. A seek, long gap or
 * course switch resets history rather than fabricating a streak from a replay. */
export class MotocrossRhythm {
  streak = 0;
  best = 0;
  completed = 0;
  private course: object | null = null;
  private time = -Infinity;
  private airborne = false;
  private airTime = 0;
  private pending: { at: number; clean: boolean } | null = null;
  reset() {
    this.streak = this.best = this.completed = 0;
    this.pending = null;
    this.airborne = false;
    this.airTime = 0;
    this.course = null;
    this.time = -Infinity;
  }
  update(sample: RhythmSnapshot) {
    if (!Number.isFinite(sample.time) || !Number.isFinite(sample.airTime)) {
      this.reset();
      return;
    }
    if (sample.course !== this.course || sample.time < this.time || sample.time > this.time + 2)
      this.reset();
    // Re-presenting a paused packet must not age settlement or register a flight.
    if (sample.time === this.time) return;
    this.time = sample.time;
    this.course = sample.course;
    if (sample.crashed) {
      this.streak = 0;
      this.pending = null;
      this.airborne = false;
      this.airTime = 0;
      return;
    }
    if (sample.airborne) {
      if (!this.airborne && this.pending) {
        // An early rebound is not a settled landing. Preserve the personal best
        // but do not count it as clean, even if the first contact looked good.
        this.streak = 0;
        this.pending = null;
      }
      this.airTime = Math.max(0, sample.airTime);
    } else {
      if (this.airborne && Math.max(this.airTime, sample.airTime) > 0.2)
        this.pending = { at: sample.time, clean: sample.landing.kind === 'clean' };
      if (this.pending) {
        // The worst observed result in the spring-settlement window wins.
        this.pending.clean &&= sample.landing.kind === 'clean';
        if (sample.time - this.pending.at >= LANDING_RULES.settleSeconds) {
          this.streak = this.pending.clean ? this.streak + 1 : 0;
          this.best = Math.max(this.best, this.streak);
          this.completed++;
          this.pending = null;
        }
      }
    }
    this.airborne = sample.airborne;
  }
}
