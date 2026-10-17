import { clamp } from '../../core/math.ts';

/** The festival HUD receives this snapshot at its normal 10 Hz status rate.
 * These are local driving points, independent of career currency/results. */
export interface FestivalSkillStatus {
  phase: 'idle' | 'active' | 'banked' | 'lost';
  /** Unmultiplied points in the current, unbanked chain. */
  score: number;
  multiplier: number;
  /** Points that this chain will bank if the driver exits cleanly. */
  total: number;
  bankRemaining: number;
  label: string;
  lastBank: number;
  sessionTotal: number;
  bestChain: number;
  /** Increments on a bank or loss, so presentation can announce it once. */
  sequence: number;
}

export interface FestivalSkillSample {
  /** Chassis-local horizontal velocities, in metres per second. */
  lateral: number;
  forward: number;
  onRoad: boolean;
  grounded: boolean;
  impact: boolean;
  assisted: boolean;
  /** Only set by the post-contact, front-to-back traffic pass detector. */
  nearMiss?: boolean;
}

export const FESTIVAL_SKILLS = Object.freeze({
  bankDelay: 4,
  feedbackSeconds: 2.5,
  offRoadGrace: 0.8,
  cleanSpeed: 27,
  cleanLeadIn: 2,
  minDriftSpeed: 9,
  minDriftAngle: 0.2,
  maxDriftAngle: 1.2,
  maxMultiplier: 5,
  maxChainPoints: 100_000,
});

/** A bounded, time-based free-roam skill chain. It consumes real motion;
 * steering input, wheelspin at rest and autopilot cannot manufacture points.
 * No per-tick arrays, timers, DOM access or career rewards live here. */
export class FestivalSkillChain {
  private phase: FestivalSkillStatus['phase'] = 'idle';
  private points = 0;
  private scoringTime = 0;
  private calm = 0;
  private offRoad = 0;
  private cleanTime = 0;
  private driftTime = 0;
  private feedback = 0;
  private cooldown = 0;
  private label = '';
  private lastBank = 0;
  private sessionTotal = 0;
  private bestChain = 0;
  private sequence = 0;
  private slideSide = 0;
  private sideDwell = 0;
  private priorSide = 0;
  private transitionWindow = 0;
  private transitionCooldown = 0;
  private bonusFeedback = 0;
  private bonusLabel = '';

  /** A reset, new machine or manual event start must not bank a teleport. */
  reset(reason = 'CHAIN LOST') {
    const hadPoints = this.points > 0;
    this.clearPending();
    if (hadPoints) {
      this.phase = 'lost';
      this.label = reason;
      this.feedback = FESTIVAL_SKILLS.feedbackSeconds;
      this.sequence++;
    }
  }

  private clearPending() {
    this.points = 0;
    this.scoringTime = 0;
    this.calm = 0;
    this.offRoad = 0;
    this.cleanTime = 0;
    this.driftTime = 0;
    this.slideSide = this.priorSide = 0;
    this.sideDwell = this.transitionWindow = this.transitionCooldown = 0;
    this.bonusFeedback = 0;
    this.bonusLabel = '';
  }

  private multiplier() {
    return Math.min(
      FESTIVAL_SKILLS.maxMultiplier,
      1 + Math.floor((this.scoringTime + 1e-8) / 1.5) * 0.2,
    );
  }

  private projected() {
    return Math.round(Math.round(this.points) * this.multiplier());
  }

  private bank() {
    const total = this.projected();
    this.lastBank = total;
    this.sessionTotal += total;
    this.bestChain = Math.max(this.bestChain, total);
    this.sequence++;
    this.clearPending();
    this.phase = 'banked';
    this.label = 'SKILL CHAIN BANKED';
    this.feedback = FESTIVAL_SKILLS.feedbackSeconds;
  }

  update(sample: FestivalSkillSample, dt: number) {
    // Pause time is not driving time. The simulation supplies fixed steps;
    // accepting a huge/invalid delta would otherwise award a whole chain.
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.transitionCooldown = Math.max(0, this.transitionCooldown - dt);
    this.transitionWindow = Math.max(0, this.transitionWindow - dt);
    this.bonusFeedback = Math.max(0, this.bonusFeedback - dt);
    this.feedback = Math.max(0, this.feedback - dt);
    if (this.feedback === 0 && (this.phase === 'banked' || this.phase === 'lost')) {
      this.phase = 'idle';
      this.label = '';
    }
    if (sample.assisted) {
      this.reset('AUTOPILOT · PRACTICE');
      return;
    }
    if (!Number.isFinite(sample.lateral) || !Number.isFinite(sample.forward) || sample.impact) {
      this.reset('CHAIN LOST');
      this.cooldown = 0.8;
      return;
    }
    this.offRoad = sample.onRoad ? 0 : this.offRoad + dt;
    if (this.offRoad > FESTIVAL_SKILLS.offRoadGrace) {
      this.reset('RETURN TO THE ROAD');
      return;
    }
    const speed = Math.hypot(sample.lateral, sample.forward);
    const angle = Math.atan2(Math.abs(sample.lateral), Math.max(0.01, sample.forward));
    if (
      speed > FESTIVAL_SKILLS.minDriftSpeed &&
      (sample.forward <= 2 || angle > FESTIVAL_SKILLS.maxDriftAngle)
    ) {
      this.reset('SPIN · CHAIN LOST');
      return;
    }
    const valid = sample.onRoad && sample.grounded && sample.forward > 3 && this.cooldown === 0;
    const drifting =
      valid &&
      speed >= FESTIVAL_SKILLS.minDriftSpeed &&
      angle >= FESTIVAL_SKILLS.minDriftAngle &&
      angle <= FESTIVAL_SKILLS.maxDriftAngle;
    const clean = valid && speed >= FESTIVAL_SKILLS.cleanSpeed && angle < 0.11;
    this.cleanTime = clean ? this.cleanTime + dt : 0;
    this.driftTime = drifting ? this.driftTime + dt : 0;
    let bonus = 0;
    if (drifting) {
      const side = Math.sign(sample.lateral);
      if (side !== this.slideSide) {
        this.slideSide = side;
        this.sideDwell = 0;
      }
      this.sideDwell += dt;
      // Both sides must be sustained physical slides, not steering flips.
      if (this.sideDwell >= 0.65) {
        if (
          this.priorSide !== 0 &&
          this.priorSide !== side &&
          this.transitionWindow > 0 &&
          this.transitionCooldown === 0
        ) {
          bonus = 180;
          this.bonusLabel = 'DRIFT TRANSITION';
          this.transitionCooldown = 1.5;
        }
        this.priorSide = side;
        this.transitionWindow = 1.2;
      }
    } else {
      this.slideSide = 0;
      this.sideDwell = 0;
    }
    if (valid && sample.nearMiss === true && speed >= 14) {
      bonus += 150;
      this.bonusLabel = 'CLEAN PASS';
    }
    if (bonus > 0) this.bonusFeedback = 1.1;
    let rate = 0;
    if (drifting) {
      rate = 180 * clamp((angle - 0.15) / 0.6, 0.2, 1) * clamp(speed / 26, 0.35, 1.35);
      this.label =
        this.driftTime > 4 ? 'EXCELLENT DRIFT' : this.driftTime > 1.5 ? 'GREAT DRIFT' : 'DRIFT';
    } else if (clean && this.cleanTime > FESTIVAL_SKILLS.cleanLeadIn) {
      rate = 45 + Math.min(60, (speed - FESTIVAL_SKILLS.cleanSpeed) * 2);
      this.label = speed > 45 ? 'HIGH SPEED' : 'CLEAN LINE';
    }
    if (this.bonusFeedback > 0) this.label = this.bonusLabel;
    if (rate > 0 || bonus > 0) {
      this.phase = 'active';
      this.feedback = 0;
      this.calm = 0;
      this.scoringTime += dt;
      this.points = Math.min(FESTIVAL_SKILLS.maxChainPoints, this.points + rate * dt + bonus);
    } else if (this.points > 0) {
      this.calm += dt;
      // Land and recover the road before banking a chain. Airborne motion
      // earns nothing, even when its horizontal velocity resembles a slide.
      if (this.calm + 1e-8 >= FESTIVAL_SKILLS.bankDelay && sample.onRoad && sample.grounded)
        this.bank();
    }
  }

  status(): FestivalSkillStatus {
    return {
      phase: this.phase,
      score: Math.round(this.points),
      multiplier: Math.round(this.multiplier() * 10) / 10,
      total: this.projected(),
      bankRemaining: this.points > 0 ? Math.max(0, FESTIVAL_SKILLS.bankDelay - this.calm) : 0,
      label: this.label,
      lastBank: this.lastBank,
      sessionTotal: this.sessionTotal,
      bestChain: this.bestChain,
      sequence: this.sequence,
    };
  }
}
