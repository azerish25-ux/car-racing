import { F, H, carBase } from './protocol.ts';

export type PracticeGrade =
  | 'banker'
  | 'gold'
  | 'silver'
  | 'bronze'
  | 'miss'
  | 'invalid'
  | 'assisted';
export interface PracticeLap {
  lap: number;
  seconds: number;
  grade: PracticeGrade;
  reason: string;
}
export interface PracticeProgress {
  active: boolean;
  finished: boolean;
  target: number;
  attempts: readonly PracticeLap[];
  clean: number;
  message: string;
}
/** Five-lap programme based only on live worker crossings. Opening a replay,
 * seeking a photo, or repeating a render frame cannot award a lap. The first
 * clean human lap banks the target; later targets are fixed for this run. */
export class PracticeProgramme {
  private active = false;
  private finished = false;
  private lastTick = -1;
  private lastLaps = -1;
  private attempts: PracticeLap[] = [];
  private target = 0;
  private message = 'Choose a five-lap programme from the Driving Academy.';
  start() {
    this.active = true;
    this.finished = false;
    this.lastTick = -1;
    this.lastLaps = -1;
    this.attempts = [];
    this.target = 0;
    this.message = 'Bank a clean lap. Its time becomes the target for the next four attempts.';
  }
  stop() {
    this.active = false;
  }
  observe(frame: Float32Array) {
    if (!this.active || this.finished) return;
    const o = carBase(0);
    if (frame.length <= o + F.LAST_LAP_ASSISTED || frame[H.PHASE] !== 2) return;
    const tick = frame[H.TICK],
      laps = frame[o + F.LAPS],
      time = frame[o + F.LAST_LAP];
    if (
      ![tick, laps, time].every(Number.isFinite) ||
      !Number.isInteger(laps) ||
      laps < 0 ||
      tick <= this.lastTick
    )
      return;
    this.lastTick = tick;
    if (this.lastLaps < 0) {
      this.lastLaps = laps;
    }
    if (laps < this.lastLaps) {
      this.message = 'Session changed. Start a new programme.';
      this.active = false;
      return;
    }
    if (laps === this.lastLaps) return;
    // The worker owns completed-lap validity, penalties and AI participation.
    // Current-lap resets or an AI toggle AFTER the crossing cannot alter it.
    // A missing crossing is not evidence of a successful unseen lap.
    const skipped = laps !== this.lastLaps + 1;
    let grade: PracticeGrade = 'miss',
      reason = 'Outside the target window.';
    if (skipped || time <= 0 || frame[o + F.LAST_LAP_VALID] !== 1) {
      grade = 'invalid';
      reason = skipped
        ? 'Snapshot gap: not every crossing was observed.'
        : 'Track limits, pit visit, penalty or incomplete timing.';
    } else if (frame[o + F.LAST_LAP_ASSISTED] !== 0) {
      grade = 'assisted';
      reason = 'AI demonstration used during this lap. No human award.';
    } else if (!this.target) {
      this.target = time;
      grade = 'banker';
      reason = 'Clean human lap: target locked.';
    } else if (time <= this.target) {
      grade = 'gold';
      reason = 'Matched or beat the banker lap.';
    } else if (time <= this.target * 1.02) {
      grade = 'silver';
      reason = 'Within 2% of the banker lap.';
    } else if (time <= this.target * 1.05) {
      grade = 'bronze';
      reason = 'Within 5% of the banker lap.';
    }
    this.attempts.push({ lap: laps, seconds: time, grade, reason });
    this.lastLaps = laps;
    this.finished = this.attempts.length === 5;
    this.message = this.finished
      ? 'Programme complete. Review the five measured attempts in the Academy.'
      : `${grade.toUpperCase()} · ${reason}`;
  }
  /** Cheap per-frame check; progress() copies every attempt. */
  get running() {
    return this.active;
  }
  progress(): PracticeProgress {
    return {
      active: this.active,
      finished: this.finished,
      target: this.target,
      attempts: this.attempts.map((lap) => ({ ...lap })),
      clean: this.attempts.filter((lap) =>
        ['banker', 'gold', 'silver', 'bronze', 'miss'].includes(lap.grade),
      ).length,
      message: this.message,
    };
  }
}
