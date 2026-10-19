import { mod } from '../../core/math.ts';
import type { JumpSurvey } from './profile.ts';
import { LANDING_RULES, type MotocrossLandingFeedback } from './riding-feedback.ts';

/** Kickers onto flat ground have no downslope pocket to aim at. */
export function isMotocrossLandingTarget(jump: JumpSurvey) {
  return jump.landingPitch < 0 && jump.landingLength > 0;
}

export interface LandingChallengeSample {
  course: object;
  /** Machine and assist setting own one practice run. */
  machine: string;
  jumps: readonly JumpSurvey[];
  length: number;
  time: number;
  s: number;
  speed: number;
  lateral: number;
  halfWidth: number;
  airborne: boolean;
  airTime: number;
  crashed: boolean;
  /** False for autopilot, replay, cautions, pit travel or a retired rider. */
  eligible: boolean;
  landing: MotocrossLandingFeedback;
}

export interface LandingChallengeResult {
  jump: JumpSurvey;
  at: number;
  kind: 'target' | 'short' | 'long' | 'rough';
  /** Repeating an already cleared feature never inflates course progress. */
  first: boolean;
}

/** Optional solo objective: land cleanly in every authored downslope zone.
 * Uses observed takeoff/contact transitions and the survey shared with the
 * physics and AI. This measures placement, not stunt points or a speed aid.
 * Progress is session-local; no career, storage or simulation writes. */
export class MotocrossLandingChallenge {
  readonly cleared = new Set<number>();
  last: LandingChallengeResult | null = null;
  private course: object | null = null;
  private machine = '';
  private time = -Infinity;
  private previousS = 0;
  private previousSpeed = 0;
  private previousEligible = false;
  private airborne = false;
  private airTime = 0;
  private flight: JumpSurvey | null = null;
  private pending: { jump: JumpSurvey; at: number; s: number; clean: boolean } | null = null;

  reset() {
    this.cleared.clear();
    this.course = null;
    this.machine = '';
    this.time = -Infinity;
    this.previousS = this.previousSpeed = 0;
    this.previousEligible = false;
    this.cancelAttempt();
    this.airborne = false;
  }

  private cancelAttempt() {
    this.flight = this.pending = null;
    this.airTime = 0;
    this.last = null;
  }

  /** Watching recorded footage pauses the live objective. Preserve completed
   * targets but discard an unfinished flight; replay cannot earn progress. */
  suspend() {
    this.cancelAttempt();
    this.previousEligible = false;
  }

  update(sample: LandingChallengeSample) {
    if (
      ![
        sample.time,
        sample.s,
        sample.speed,
        sample.lateral,
        sample.halfWidth,
        sample.length,
        sample.airTime,
      ].every(Number.isFinite) ||
      sample.length <= 0 ||
      sample.halfWidth <= 0
    ) {
      this.reset();
      return;
    }
    const s = mod(sample.s, sample.length);
    const eligible =
      sample.eligible &&
      !sample.crashed &&
      sample.speed >= 0 &&
      Math.abs(sample.lateral) <= Math.max(0, sample.halfWidth - 0.3);
    const changed = sample.course !== this.course || sample.machine !== this.machine;
    if (changed || sample.time < this.time) this.reset();
    // Repeating a paused snapshot cannot age the landing settlement.
    if (sample.time === this.time) return;
    const dt = sample.time - this.time;
    const delta = mod(s - this.previousS + sample.length / 2, sample.length) - sample.length / 2;
    const continuous =
      this.course !== null &&
      dt <= 2 &&
      delta >= -0.75 &&
      delta <= Math.max(sample.speed, this.previousSpeed) * dt * 1.8 + 2;
    if (!continuous || !eligible) this.cancelAttempt();
    else if (sample.airborne) {
      if (!this.airborne) {
        // A rebound before the suspension settles invalidates that attempt.
        this.pending = null;
        this.last = null;
        this.flight = null;
        if (this.previousEligible && sample.speed > LANDING_RULES.rollingHopSpeed) {
          const observedTravel = Math.max(3, delta + 1);
          this.flight =
            sample.jumps.find(
              (jump) =>
                isMotocrossLandingTarget(jump) &&
                this.previousS >= jump.start - observedTravel &&
                this.previousS <= jump.takeoff + 1 &&
                s >= jump.start - 1 &&
                s <= jump.takeoff + observedTravel,
            ) ?? null;
        }
        this.airTime = 0;
      }
      this.airTime = Math.max(this.airTime, sample.airTime);
    } else {
      if (this.airborne) {
        if (this.flight && Math.max(this.airTime, sample.airTime) > 0.2)
          this.pending = {
            jump: this.flight,
            at: sample.time,
            s,
            clean: sample.landing.kind === 'clean',
          };
        this.flight = null;
        this.airTime = 0;
      }
      if (this.pending) {
        this.pending.clean &&= sample.landing.kind === 'clean';
        if (sample.time - this.pending.at >= LANDING_RULES.settleSeconds) {
          const { jump, at, s: landedS, clean } = this.pending;
          const error =
            mod(landedS - jump.landing + sample.length / 2, sample.length) - sample.length / 2;
          const halfZone = jump.landingLength / 2;
          const kind = !clean
            ? 'rough'
            : error < -halfZone
              ? 'short'
              : error > halfZone
                ? 'long'
                : 'target';
          const first = kind === 'target' && !this.cleared.has(jump.takeoff);
          if (kind === 'target') this.cleared.add(jump.takeoff);
          this.last = { jump, at, kind, first };
          this.pending = null;
        }
      }
    }
    this.course = sample.course;
    this.machine = sample.machine;
    this.time = sample.time;
    this.previousS = s;
    this.previousSpeed = sample.speed;
    this.previousEligible = eligible;
    this.airborne = sample.airborne;
  }
}
