import { clamp } from '../core/math.ts';
import type { Setup } from './config.ts';

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


/** Stick-torque differential model (docs/production/PHYSICS_MODEL.md §3.3),
 * usable for an axle or, with `split`, a centre differential feeding two
 * axles. It runs the APX-01 and TC-1 axle (LEGACY_AXLE: the former viscous
 * coupling, exact) and any `dynamics.differential` override; a catalogue
 * `driveline` above can be evaluated with it through `fromSpec`.
 *
 * Input torque T (after gearbox and final drive) is split T·s / T·(1−s); a
 * locking torque L moves torque from the faster output to the slower one:
 *     first = s·T + L,  second = (1−s)·T − L.
 * L depends on the model:
 *   open     L = 0
 *   locked   L = β·L_stick (no limit)
 *   viscous  L = clamp(c·Δω, ±L_max)                       (speed sensing)
 *   clutch   L = clamp(β·L_stick, ±(preload + r·|T|))       (Salisbury LSD,
 *            r = power or coast ramp locking by the sign of T)
 *   torsen   L = clamp(β·L_stick, ±½|T|·(TBR−1)/(TBR+1))    (torque bias ratio)
 * where L_stick is the locking torque that cancels the output speed
 * difference Δω = ω_second − ω_first within this step, including the split's
 * own relative acceleration and a prediction of the road reaction torques on
 * each output (their previous-step values, since the tyres are solved after
 * the differential), and β < 1 under-relaxes it so a locked or stuck clutch
 * pack is stable at any timestep instead of chattering. */
export type DifferentialKind = 'open' | 'locked' | 'viscous' | 'clutch' | 'torsen';
export interface DifferentialDefinition {
  readonly kind: DifferentialKind;
  /** Clutch-pack preload (N m). */
  readonly preload: number;
  /** Locking torque per unit input torque on drive and on overrun (ramps). */
  readonly powerLock: number;
  readonly coastLock: number;
  /** Viscous coefficient (N m s/rad) on drive and overrun. */
  readonly viscousPower: number;
  readonly viscousCoast: number;
  /** Torsen torque bias ratio (≥ 1). */
  readonly biasRatio: number;
  /** Locking-torque ceiling (N m). */
  readonly maxLocking: number;
  /** First output's share of input torque (0.5 for an axle). */
  readonly split: number;
  /** Under-relaxation β of the stick torque. */
  readonly stickFraction: number;
  /** Whether setup diffPower/diffCoast scale the locking (0.5/0.25 = as defined). */
  readonly setupScaled: boolean;
}
const BASE: DifferentialDefinition = Object.freeze({
  kind: 'open',
  preload: 0,
  powerLock: 0,
  coastLock: 0,
  viscousPower: 0,
  viscousCoast: 0,
  biasRatio: 1,
  maxLocking: 1e9,
  split: 0.5,
  stickFraction: 0.5,
  setupScaled: false,
});
export function differential(overrides: Partial<DifferentialDefinition>): DifferentialDefinition {
  return Object.freeze({ ...BASE, ...overrides });
}
/** The former axle coupling: viscous locking of 55·setting N m s/rad,
 * limited to 1050 N m (power setting on throttle, coast setting off it). */
export const LEGACY_AXLE = differential({
  kind: 'viscous',
  viscousPower: 55,
  viscousCoast: 55,
  maxLocking: 1050,
  setupScaled: true,
});
/** A clutch-pack limited-slip axle differential (racing defaults). */
export const CLUTCH_LSD = differential({
  kind: 'clutch',
  preload: 60,
  powerLock: 0.35,
  coastLock: 0.2,
  maxLocking: 2500,
  setupScaled: true,
});
export const OPEN_AXLE = differential({ kind: 'open' });
/** A spool: the outputs locked together (under-relaxed stick torque). */
export const SPOOL = differential({ kind: 'locked', stickFraction: 0.8 });
export const TORSEN = differential({ kind: 'torsen', biasRatio: 2.5 });
/** The stick-torque model of a catalogue DifferentialSpec: open, locked (a
 * spool at LOCKED_CAPACITY) or a clutch pack with the same preload and ramps,
 * scaled by the setup like `lockingCapacity`. */
export function fromSpec(spec: DifferentialSpec): DifferentialDefinition {
  return spec.type === 'open'
    ? OPEN_AXLE
    : spec.type === 'locked'
      ? differential({ ...SPOOL, maxLocking: LOCKED_CAPACITY })
      : differential({
          kind: 'clutch',
          preload: spec.preload,
          powerLock: spec.power,
          coastLock: spec.coast,
          setupScaled: true,
        });
}
/** Accepts a definition object, a catalogue DifferentialSpec or a model name (as another content source may
 * declare it) and applies the setup locking settings when `setupScaled`. */
export function resolveDifferential(
  value: unknown,
  setup: Pick<Setup, 'diffPower' | 'diffCoast'>,
  fallback: DifferentialDefinition = LEGACY_AXLE,
): DifferentialDefinition {
  let def = fallback;
  if (typeof value === 'string') {
    const name = value.toLowerCase();
    def =
      name === 'open'
        ? OPEN_AXLE
        : name === 'locked' || name === 'spool'
          ? SPOOL
          : name === 'torsen'
            ? TORSEN
            : name === 'viscous'
              ? LEGACY_AXLE
              : name.includes('lsd') || name.includes('clutch') || name === 'limited-slip'
                ? CLUTCH_LSD
                : fallback;
  } else if (value && typeof value === 'object')
    def =
      'type' in value
        ? fromSpec(value as DifferentialSpec)
        : differential({ ...fallback, ...(value as Partial<DifferentialDefinition>) });
  if (!def.setupScaled) return def;
  const power = clamp(setup.diffPower, 0, 1),
    coast = clamp(setup.diffCoast, 0, 1);
  return def.kind === 'viscous'
    ? differential({
        ...def,
        viscousPower: def.viscousPower * power,
        viscousCoast: def.viscousCoast * coast,
      })
    : differential({
        ...def,
        powerLock: clamp(def.powerLock * (power / 0.5), 0, 1),
        coastLock: clamp(def.coastLock * (coast / 0.25), 0, 1),
      });
}
export interface DifferentialOutput {
  first: number;
  second: number;
  locking: number;
}
export const differentialOutput = (): DifferentialOutput => ({ first: 0, second: 0, locking: 0 });
/** Output torques for input torque `input` (N m). `onPower` selects the drive
 * or overrun setting of speed-sensing models; ramps use the sign of `input`. */
export function differentialTorques(
  def: DifferentialDefinition,
  input: number,
  onPower: boolean,
  omegaFirst: number,
  omegaSecond: number,
  inertiaFirst: number,
  inertiaSecond: number,
  dt: number,
  out: DifferentialOutput,
  /** Predicted road reaction torques on each output (N m, previous step). */
  reactionFirst = 0,
  reactionSecond = 0,
) {
  if (
    ![input, omegaFirst, omegaSecond, dt, reactionFirst, reactionSecond].every(Number.isFinite) ||
    dt <= 0
  )
    throw new Error('Invalid differential state');
  const s = def.split,
    delta = omegaSecond - omegaFirst;
  let locking = 0;
  if (def.kind === 'viscous') {
    locking = clamp(
      delta * (onPower ? def.viscousPower : def.viscousCoast),
      -def.maxLocking,
      def.maxLocking,
    );
  } else if (def.kind !== 'open') {
    const mobility = (1 / inertiaFirst + 1 / inertiaSecond) * dt,
      drift =
        ((1 - s) * input + reactionSecond) / inertiaSecond -
        (s * input + reactionFirst) / inertiaFirst,
      stick = (def.stickFraction * delta + drift * dt) / mobility;
    const capacity =
      def.kind === 'locked'
        ? def.maxLocking
        : def.kind === 'torsen'
          ? (0.5 * Math.abs(input) * (def.biasRatio - 1)) / (def.biasRatio + 1)
          : def.preload + (input >= 0 ? def.powerLock : def.coastLock) * Math.abs(input);
    const limit = Math.min(capacity, def.maxLocking);
    locking = clamp(stick, -limit, limit);
  }
  out.first = s * input + locking;
  out.second = (1 - s) * input - locking;
  out.locking = locking;
  return out;
}
/** Driven layout and its differentials. Wheel order follows the vehicle:
 * 0 FR, 1 FL, 2 RR, 3 RL; an axle differential's first output is the right
 * wheel. For 'awd' the centre differential's first output (share `split`) is
 * the front axle. */
export type DrivenLayout = 'rwd' | 'fwd' | 'awd';
export interface Driveline {
  readonly layout: DrivenLayout;
  readonly front: DifferentialDefinition;
  readonly rear: DifferentialDefinition;
  readonly centre: DifferentialDefinition;
}
const AXLE = differentialOutput(),
  CENTRE = differentialOutput();
/** Wheel drive torques (N m) for gearbox output `input`: centre split for
 * all-wheel drive, then each driven axle's differential. `reaction` holds the
 * previous step's road reaction torque on each wheel (−Fx·r). */
export function drivelineTorques(
  line: Driveline,
  input: number,
  onPower: boolean,
  omega: ArrayLike<number>,
  inertia: ArrayLike<number>,
  reaction: ArrayLike<number>,
  dt: number,
  out: Float64Array,
) {
  out.fill(0);
  let front = 0,
    rear = 0;
  if (line.layout === 'awd') {
    differentialTorques(
      line.centre,
      input,
      onPower,
      (omega[0] + omega[1]) * 0.5,
      (omega[2] + omega[3]) * 0.5,
      inertia[0] + inertia[1],
      inertia[2] + inertia[3],
      dt,
      CENTRE,
      reaction[0] + reaction[1],
      reaction[2] + reaction[3],
    );
    front = CENTRE.first;
    rear = CENTRE.second;
  } else if (line.layout === 'fwd') front = input;
  else rear = input;
  for (const [axle, torque, def] of [
    [0, front, line.front],
    [2, rear, line.rear],
  ] as const) {
    // Only driven axles carry a differential's locking torque.
    const driven = line.layout === 'awd' || (axle === 0) === (line.layout === 'fwd');
    if (!driven) continue;
    differentialTorques(
      def,
      torque,
      onPower,
      omega[axle],
      omega[axle + 1],
      inertia[axle],
      inertia[axle + 1],
      dt,
      AXLE,
      reaction[axle],
      reaction[axle + 1],
    );
    out[axle] = AXLE.first;
    out[axle + 1] = AXLE.second;
  }
  return out;
}
