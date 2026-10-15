import { clamp } from '../core/math.ts';
import type { Setup } from './config.ts';

/** Differential models (docs/production/PHYSICS_MODEL.md §3.3), usable for an
 * axle or, with `split`, a centre differential feeding two axles.
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
export const OPEN = differential({ kind: 'open' });
export const LOCKED = differential({ kind: 'locked', stickFraction: 0.8 });
export const TORSEN = differential({ kind: 'torsen', biasRatio: 2.5 });
/** Accepts a definition object or a model name (as another content source may
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
        ? OPEN
        : name === 'locked' || name === 'spool'
          ? LOCKED
          : name === 'torsen'
            ? TORSEN
            : name === 'viscous'
              ? LEGACY_AXLE
              : name.includes('lsd') || name.includes('clutch') || name === 'limited-slip'
                ? CLUTCH_LSD
                : fallback;
  } else if (value && typeof value === 'object')
    def = differential({ ...fallback, ...(value as Partial<DifferentialDefinition>) });
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
