import { clamp } from '../core/math.ts';

/** Replay playback clock (masterplan §6.2 replay service, §24.2 four
 * clocks). It owns the recorded-session position in seconds from the
 * recording start, the play/pause state, rate and seek acknowledgement.
 * Conversion: recorded time = recording start + position; presented time is
 * whatever the renderer draws for that position. Wall time only advances it
 * through `target()`, capped per callback so a stall cannot jump the clock.
 * It never depends on a scene being drawn to make logical progress. */
export class ReplayClock {
  position = 0;
  playing = true;
  rate = 1;
  /** A seek waits to be presented once before playback advances again. */
  seekPending = false;
  /** Largest wall interval a single callback may advance (s). */
  static readonly MAX_STEP = 0.5;
  setRate(value: number) {
    if (Number.isFinite(value)) this.rate = clamp(value, 0.25, 2);
  }
  seek(value: number, floor: number, duration: number) {
    if (!Number.isFinite(value)) return;
    this.position = clamp(value, floor, Math.max(floor, duration));
    this.seekPending = true;
  }
  /** Position to present after `wallDelta` seconds; `advancing` is false when
   * playback is covered (dialogs, hidden tab) or paused. */
  target(wallDelta: number, duration: number, advancing: boolean) {
    if (!this.playing || this.seekPending || !advancing) return this.position;
    return Math.min(
      duration,
      this.position + Math.min(Math.max(0, wallDelta), ReplayClock.MAX_STEP) * this.rate,
    );
  }
  /** The target was presented: commit it; playback stops at the end. */
  presented(target: number, duration: number) {
    this.position = target;
    this.seekPending = false;
    if (this.position >= duration) this.playing = false;
  }
  /** PLAY/PAUSE control; playing again from the end restarts from `floor`. */
  toggle(floor: number, duration: number) {
    if (!this.playing && this.position >= duration) this.seek(floor, floor, duration);
    this.playing = !this.playing;
    return this.playing;
  }
}
