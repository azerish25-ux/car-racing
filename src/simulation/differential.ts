import { clamp } from '../core/math.ts';

/** Driveline differentials (WP17, masterplan §7.1). Definitions that carry a
 * `driveline` use these models; definitions without one (the APX-01 Formula
 * and TC-1 touring car) keep their original viscous axle coupling bit for bit.
 *
 * Every coupling is solved the same way as the clutch: the torque that would
 * equalize the two output speeds within one step (an impulse projection on the
 * wheel inertias) is limited by the coupling's friction capacity. An open
 * differential has no capacity, a clutch-pack limited-slip differential has a
 * preload plus a ramp share of the torque passing through it, and a locked
 * differential (spool, solid kart axle, locked centre) has a capacity far above
 * any tyre's traction torque. No wheel speed is overwritten. */
export type DifferentialType = 'open' | 'lsd' | 'locked';
export interface DifferentialSpec {
  type: DifferentialType;
  /** Clutch-pack preload: locking torque available with no input torque (N m). */
  preload: number;
  /** Ramp locking ratio under drive: capacity per N m of input torque (0-1).
   * Scaled by setup diffPower / 0.5, so the default setup gives this value. */
  power: number;
  /** Ramp locking ratio on the overrun, scaled by setup diffCoast / 0.25. */
  coast: number;
}
/** Centre differential of an all-wheel-drive car: a planetary torque split
 * plus an optional coupling between the axles. */
export interface CentreDifferentialSpec extends DifferentialSpec {
  /** Share of drive torque sent to the front axle when the coupling is slipping. */
  frontShare: number;
}
export interface DrivelineSpec {
  front?: DifferentialSpec;
  rear?: DifferentialSpec;
  centre?: CentreDifferentialSpec;
}
/** Capacity of a locked coupling (N m): above any tyre's traction torque. */
export const LOCKED_CAPACITY = 30000;
export const OPEN: DifferentialSpec = Object.freeze({
  type: 'open' as const,
  preload: 0,
  power: 0,
  coast: 0,
});
export const LOCKED: DifferentialSpec = Object.freeze({
  type: 'locked' as const,
  preload: 0,
  power: 0,
  coast: 0,
});
const OPEN_CENTRE: CentreDifferentialSpec = Object.freeze({ ...OPEN, frontShare: 0.5 });
export function lsd(preload: number, power: number, coast: number): DifferentialSpec {
  return Object.freeze({ type: 'lsd' as const, preload, power, coast });
}
/** Locking capacity (N m) of `diff` with `input` N m flowing through it. */
export function lockingCapacity(
  diff: DifferentialSpec,
  input: number,
  diffPower: number,
  diffCoast: number,
) {
  if (diff.type === 'open') return 0;
  if (diff.type === 'locked') return LOCKED_CAPACITY;
  const ramp =
    input >= 0
      ? clamp((diff.power * diffPower) / 0.5, 0, 1)
      : clamp((diff.coast * diffCoast) / 0.25, 0, 1);
  return diff.preload + Math.abs(input) * ramp;
}
/** Torque added to output `a` and removed from output `b` (N m). Positive when
 * `b` turns faster: torque moves from the faster to the slower output.
 * `inertia` is the rotational inertia of one output (kg m²). */
export function lockingTorque(
  diff: DifferentialSpec,
  input: number,
  omegaA: number,
  omegaB: number,
  inertia: number,
  dt: number,
  diffPower: number,
  diffCoast: number,
) {
  const capacity = lockingCapacity(diff, input, diffPower, diffCoast);
  if (capacity <= 0) return 0;
  const equalize = ((omegaB - omegaA) * inertia) / (2 * dt);
  return clamp(equalize, -capacity, capacity);
}
/** Effective inertia factor for the clutch: the driven wheels referred to the
 * gearbox output. Two wheels (one axle) give 1; an AWD split `f` gives
 * 1 / (f² + (1 - f)²), i.e. 2 for an even split (four wheels). */
export function drivenInertiaFactor(frontShare: number | null) {
  if (frontShare === null) return 1;
  return 1 / (frontShare * frontShare + (1 - frontShare) * (1 - frontShare));
}
/** Gearbox output speed seen by the clutch: the carrier speed of the centre
 * differential, f·ω_front + (1-f)·ω_rear (power-consistent with the split). */
export function carrierOmega(omega: ArrayLike<number>, frontShare: number) {
  return frontShare * (omega[0] + omega[1]) * 0.5 + (1 - frontShare) * (omega[2] + omega[3]) * 0.5;
}
/** Distribute gearbox output torque `drive` (N m at the wheels) to the four
 * wheels FR, FL, RR, RL through the driveline. Writes `out`; returns it. */
export function distributeDrive(
  out: Float64Array,
  driveline: DrivelineSpec,
  drivetrain: 'rwd' | 'fwd' | 'awd',
  drive: number,
  omega: ArrayLike<number>,
  wheelInertia: number,
  dt: number,
  diffPower: number,
  diffCoast: number,
) {
  let front = 0,
    rear = 0;
  if (drivetrain === 'awd') {
    const centre = driveline.centre ?? OPEN_CENTRE;
    const f = centre.frontShare;
    const transfer = lockingTorque(
      centre,
      drive,
      (omega[0] + omega[1]) * 0.5,
      (omega[2] + omega[3]) * 0.5,
      2 * wheelInertia,
      dt,
      diffPower,
      diffCoast,
    );
    front = drive * f + transfer;
    rear = drive * (1 - f) - transfer;
  } else if (drivetrain === 'fwd') front = drive;
  else rear = drive;
  out.fill(0);
  if (drivetrain !== 'rwd') {
    const lock = lockingTorque(
      driveline.front ?? OPEN,
      front,
      omega[0],
      omega[1],
      wheelInertia,
      dt,
      diffPower,
      diffCoast,
    );
    out[0] = front * 0.5 + lock;
    out[1] = front * 0.5 - lock;
  }
  if (drivetrain !== 'fwd') {
    const lock = lockingTorque(
      driveline.rear ?? OPEN,
      rear,
      omega[2],
      omega[3],
      wheelInertia,
      dt,
      diffPower,
      diffCoast,
    );
    out[2] = rear * 0.5 + lock;
    out[3] = rear * 0.5 - lock;
  }
  return out;
}
