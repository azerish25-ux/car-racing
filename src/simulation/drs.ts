import { mod } from '../core/math.ts';
import type { DrsZone } from './circuits.ts';
import type { Vehicle } from './vehicle.ts';
import type { VehicleDefinition } from './vehicles.ts';

/** Original session rules for the drag-reduction flap (not a claim of any
 * sporting regulation). Distances metres, times seconds. */
export const DRS = Object.freeze({
  /** Race lap from which DRS is enabled (the leader has completed fromLap - 1). */
  fromLap: 3,
  /** Interval to the car ahead at the detection point. */
  gap: 1.0,
  /** Mean water film above which the flap is locked out. */
  wetLimit: 0.3,
  /** Aero deltas at the fully open flap. */
  rearLoss: 0.22,
  dragLoss: 0.11,
  /** Seconds for the flap to travel fully open or closed. */
  travel: 0.15,
  /** Brake pedal that closes the flap. */
  closeBrake: 0.05,
});
/** ERS overtake: a momentary boost of the hybrid deployment (Attack is 1). */
export const OVERTAKE = Object.freeze({
  seconds: 4,
  deploy: 1.25,
  /** Minimum battery share to start a boost. */
  minBattery: 0.1,
});
export const DRS_STATE = { OFF: 0, AVAILABLE: 1, OPEN: 2 } as const;

/** Is lap distance `s` inside [from, to) going forward (wrapping through the line)? */
export function onArc(s: number, from: number, to: number, length: number) {
  return mod(s - from, length) < mod(to - from, length);
}
/** Did a car travel forward from `last` to `s` across `gate` this step? */
export function crossed(last: number, s: number, gate: number, length: number) {
  const travel = mod(s - last, length);
  return (
    travel > 0 && travel < 15 && mod(gate - last, length) <= travel && mod(gate - last, length) > 0
  );
}

/** DRS is in use on a grid only where the rules permit it and at least one
 * machine carries the flap (a grid of cars without one never sees it). */
export function gridDrs(
  rulesDrs: boolean,
  vehicles: readonly (Pick<VehicleDefinition, 'drs'> | undefined)[],
) {
  return rulesDrs && vehicles.some((v) => v?.drs === true);
}
export interface DrsContext {
  /** Race or endurance (the 1.0 s rule and lap-3 activation apply). */
  racing: boolean;
  /** Laps completed by the race leader. */
  leaderLaps: number;
  /** Mean water film (track.meanWater()). */
  water: number;
  /** A safety car or VSC neutralises the race. */
  neutralised: boolean;
  /** Per-car yellow flags at the car. */
  yellow: (car: number) => boolean;
}

/**
 * Detection, availability and the flap state of every car. A car crossing a
 * detection line within `DRS.gap` s of another running car becomes eligible
 * for that zone until it passes the zone's end; outside racing sessions every
 * car is eligible. Availability also needs the global enable (race lap 3, dry,
 * not neutralised) and no yellow at the car. The flap opens on a request
 * (`Vehicle.drsRequest`: the player's key, or the AI when available) and closes
 * on the brake, at the zone end or when availability is lost. A car built
 * without the flap (`fitted` false: `VehicleDefinition.drs`) is never
 * eligible, so its state stays OFF (the HUD shows nothing for it).
 */
export class DrsControl {
  enabled = false;
  readonly state: Uint8Array;
  /** Zone index each car is eligible for, or -1. */
  readonly eligibleZone: Int8Array;
  private readonly lastS: Float64Array;
  private readonly crossing: Float64Array;
  constructor(
    readonly zones: readonly DrsZone[],
    readonly length: number,
    readonly count: number,
    initialS: readonly number[],
    /** Per car: does the machine carry a DRS flap? Absent: every car does. */
    readonly fitted: readonly boolean[] = [],
  ) {
    this.state = new Uint8Array(count);
    this.eligibleZone = new Int8Array(count).fill(-1);
    this.lastS = Float64Array.from(initialS);
    this.crossing = new Float64Array(Math.max(1, zones.length) * count).fill(-Infinity);
  }
  update(dt: number, time: number, cars: readonly Vehicle[], context: DrsContext) {
    const length = this.length;
    this.enabled =
      context.water <= DRS.wetLimit &&
      !context.neutralised &&
      (!context.racing || context.leaderLaps >= DRS.fromLap - 1);
    // Detection: interpolate this step's crossing times first, then judge the
    // gap to whichever other car crossed most recently (any order in the step).
    for (let z = 0; z < this.zones.length; z++) {
      const zone = this.zones[z];
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (c.inPit || c.retired || c.finishTime) continue;
        if (!crossed(this.lastS[i], c.s, zone.detect, length)) continue;
        const travel = mod(c.s - this.lastS[i], length);
        const before = mod(c.s - zone.detect, length);
        this.crossing[z * this.count + i] = time - (dt * before) / Math.max(1e-9, travel);
      }
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (c.inPit || c.retired || c.finishTime) continue;
        if (!crossed(this.lastS[i], c.s, zone.detect, length)) continue;
        const at = this.crossing[z * this.count + i];
        let gap = Infinity;
        for (let j = 0; j < cars.length; j++) {
          if (j === i || cars[j].inPit || cars[j].retired) continue;
          const other = this.crossing[z * this.count + j];
          if (other <= at) gap = Math.min(gap, at - other);
        }
        this.eligibleZone[i] =
          this.fitted[i] !== false && (!context.racing || gap < DRS.gap) ? z : -1;
      }
    }
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i],
        z = this.eligibleZone[i];
      if (z >= 0 && crossed(this.lastS[i], c.s, this.zones[z].end, length))
        this.eligibleZone[i] = -1;
      const zone = this.eligibleZone[i] >= 0 ? this.zones[this.eligibleZone[i]] : null;
      const available =
        this.enabled &&
        !!zone &&
        !c.inPit &&
        !c.retired &&
        !context.yellow(i) &&
        onArc(c.s, zone.start, zone.end, length);
      let state: number = available ? DRS_STATE.AVAILABLE : DRS_STATE.OFF;
      if (available && (this.state[i] === DRS_STATE.OPEN || c.drsRequest))
        state = c.brake > DRS.closeBrake ? DRS_STATE.AVAILABLE : DRS_STATE.OPEN;
      this.state[i] = state;
      c.drsRequest = false;
      c.drsOpen = state === DRS_STATE.OPEN;
      this.lastS[i] = c.s;
    }
  }
}
