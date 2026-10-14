import { mod } from '../core/math.ts';
import type { MarshalControl } from './marshal.ts';
import type { Vehicle } from './vehicle.ts';

/** Original neutralisation rules (not a claim of any sporting regulation).
 * Speeds m/s, distances metres, times seconds. */
export const SAFETY_CAR = Object.freeze({
  /** Flat VSC limit for every running car. */
  vscSpeed: 32,
  /** Safety-car pace and the queue gap behind it and each car ahead. */
  scSpeed: 45,
  gap: 25,
  /** An obstruction (double yellow) this long calls the VSC... */
  vscAfter: 8,
  /** ...and this long deploys the safety car. */
  scAfter: 25,
  /** The track must stay clear this long to end the VSC or call the SC in. */
  clearAfter: 5,
  /** The safety car joins this far ahead of the leader. */
  joinAhead: 150,
  /** It peels off into the pit lane at the pit entry (track length minus this). */
  pitEntry: 210,
  /** Braking the field plans with when closing on its queue slot. */
  braking: 5,
  /** Safety-car acceleration back to pace. */
  accel: 4,
});
export const SC_PHASE = { NONE: 0, VSC: 1, DEPLOYED: 2, IN_THIS_LAP: 3 } as const;

/**
 * Virtual safety car and safety car. A double-yellow obstruction that lasts
 * `vscAfter` s calls a VSC (every running car limited to `vscSpeed`); if it
 * lasts `scAfter` s the safety car joins `joinAhead` m in front of the leader
 * at `scSpeed`, and every car queues `gap` m behind the car ahead of it
 * through the marshal zone targets the AI already obeys. Once the track has
 * been clear for `clearAfter` s the VSC ends, or the safety car is "in this
 * lap" and leaves at the pit entry. Overtaking while neutralised is judged
 * like overtaking under yellow (MarshalControl.neutralised).
 */
export class SafetyCarDirector {
  phase: number = SC_PHASE.NONE;
  /** Safety-car lap distance and speed (presentation and queue target). */
  s = 0;
  speed = 0;
  deployments = 0;
  private obstructed = 0;
  private clear = 0;
  constructor(
    readonly length: number,
    private readonly pitEntry: number = SAFETY_CAR.pitEntry,
  ) {}
  get neutralised() {
    return this.phase !== SC_PHASE.NONE;
  }
  /** `leader`: id of the race leader; `active`: racing and not finishing. */
  update(
    dt: number,
    cars: readonly Vehicle[],
    leader: number,
    control: MarshalControl,
    active: boolean,
  ) {
    if (!active) {
      this.phase = SC_PHASE.NONE;
      control.neutralised = 0;
      return;
    }
    const obstruction = control.hasObstruction;
    this.obstructed = obstruction ? this.obstructed + dt : 0;
    this.clear = obstruction ? 0 : this.clear + dt;
    const length = this.length;
    switch (this.phase) {
      case SC_PHASE.NONE:
        if (this.obstructed >= SAFETY_CAR.vscAfter) this.phase = SC_PHASE.VSC;
        break;
      case SC_PHASE.VSC:
        if (this.obstructed >= SAFETY_CAR.scAfter) {
          this.phase = SC_PHASE.DEPLOYED;
          this.deployments++;
          this.s = mod(cars[leader].s + SAFETY_CAR.joinAhead, length);
          this.speed = SAFETY_CAR.scSpeed;
        } else if (this.clear >= SAFETY_CAR.clearAfter) this.phase = SC_PHASE.NONE;
        break;
      case SC_PHASE.DEPLOYED:
        if (this.clear >= SAFETY_CAR.clearAfter) this.phase = SC_PHASE.IN_THIS_LAP;
        break;
    }
    if (this.phase === SC_PHASE.DEPLOYED || this.phase === SC_PHASE.IN_THIS_LAP) {
      // The safety car keeps to the yellow-zone limits like everyone else.
      const target = Math.min(
        SAFETY_CAR.scSpeed,
        control.speedLimitAt(this.s, SAFETY_CAR.braking * 0.8),
      );
      this.speed =
        this.speed < target
          ? Math.min(target, this.speed + SAFETY_CAR.accel * dt)
          : Math.max(target, this.speed - SAFETY_CAR.braking * dt);
      const last = this.s,
        entry = length - this.pitEntry;
      this.s = mod(this.s + this.speed * dt, length);
      const travel = mod(this.s - last, length);
      if (this.phase === SC_PHASE.IN_THIS_LAP && mod(entry - last, length) <= travel) {
        this.phase = SC_PHASE.NONE; // Into the pit lane: racing resumes.
        this.speed = 0;
      }
    }
    control.neutralised = this.phase;
    if (this.phase === SC_PHASE.VSC) {
      for (let i = 0; i < cars.length; i++) {
        if (cars[i].inPit || cars[i].finishTime || cars[i].retired) continue;
        this.limit(control, i, 0, SAFETY_CAR.vscSpeed);
      }
    } else if (this.phase !== SC_PHASE.NONE) {
      // Queue in track order behind the safety car: each car targets the car
      // physically ahead of it (or the safety car) at `gap` metres.
      const queue: number[] = [];
      for (let i = 0; i < cars.length; i++)
        if (!cars[i].inPit && !cars[i].finishTime && !cars[i].retired) queue.push(i);
      const behind = (i: number) => mod(this.s - cars[i].s, length);
      queue.sort((a, b) => behind(a) - behind(b) || a - b);
      let aheadS = this.s;
      for (const i of queue) {
        const gap = mod(aheadS - cars[i].s, length) - SAFETY_CAR.gap;
        this.limit(control, i, Math.max(0, gap), this.speed);
        aheadS = cars[i].s;
      }
    }
  }
  /** Tighten a car's marshal target when this one is the more restrictive. */
  private limit(control: MarshalControl, car: number, distance: number, speed: number) {
    const a = SAFETY_CAR.braking;
    const current = control.zoneDistance[car];
    if (
      current < 0 ||
      speed * speed + 2 * a * distance <
        control.zoneSpeed[car] ** 2 + 2 * a * control.zoneDistance[car]
    ) {
      control.zoneDistance[car] = distance;
      control.zoneSpeed[car] = speed;
    }
  }
}
