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
 *   torsen   L = clamp(β·L_stick, ±|T|·(TBR−1)/(TBR+1))     (torque bias ratio)
 * where L_stick is the locking torque that would cancel the output speed
 * difference Δω = ω_second − ω_first within this step (including the split's
 * own relative acceleration), and β < 1 under-relaxes it against the
 * explicitly coupled tyre torques so a locked or stuck clutch pack is stable
 * at any timestep instead of chattering. */
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
    ? differential({ ...def, viscousPower: def.viscousPower * power, viscousCoast: def.viscousCoast * coast })
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
) {
  if (![input, omegaFirst, omegaSecond, dt].every(Number.isFinite) || dt <= 0)
    throw new Error('Invalid differential state');
  const s = def.split,
    delta = omegaSecond - omegaFirst;
  let locking = 0;
  if (def.kind === 'viscous') {
    locking = clamp(delta * (onPower ? def.viscousPower : def.viscousCoast), -def.maxLocking, def.maxLocking);
  } else if (def.kind !== 'open') {
    const mobility = (1 / inertiaFirst + 1 / inertiaSecond) * dt,
      drift = ((1 - s) * input) / inertiaSecond - (s * input) / inertiaFirst,
      stick = (def.stickFraction * (delta + drift * dt)) / mobility;
    const capacity =
      def.kind === 'locked'
        ? def.maxLocking
        : def.kind === 'torsen'
          ? (Math.abs(input) * (def.biasRatio - 1)) / (def.biasRatio + 1)
          : def.preload + (input >= 0 ? def.powerLock : def.coastLock) * Math.abs(input);
    const limit = Math.min(capacity, def.maxLocking);
    locking = clamp(stick, -limit, limit);
  }
  out.first = s * input + locking;
  out.second = (1 - s) * input - locking;
  out.locking = locking;
  return out;
}
