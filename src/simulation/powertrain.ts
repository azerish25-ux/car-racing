import { clamp, lerp, smooth } from '../core/math.ts';
import type { VehicleSpec } from './vehicles.ts';

/** Engine and gearbox models (docs/production/PHYSICS_MODEL.md §3).
 *
 * Engine torque T = map(rpm, θ_eff)·(1 − b_share + b_share·boost) − pumping,
 * where θ_eff is the pedal after intake filling (first-order lag with
 * separate opening/closing times) and `boost` the turbo state:
 *     d(boost)/dt = (boost* − boost)/τ,  boost* = smooth(rpm_lo, rpm_hi, rpm)·θ_eff,
 * τ = spool time while building, a fraction of it when the wastegate/blow-off
 * dumps. Both lags are integrated exactly (no overshoot at any timestep).
 * The torque map is the definition's full-load curve scaled by
 * θ^progression, or an explicit rpm × throttle table. Crank inertia feeds the
 * friction clutch. Original calibration, not dynamometer data. */
export interface TurboDefinition {
  /** Share of full-load torque supplied by boost. */
  readonly boostShare: number;
  /** Spool-up time constant (s) and the fraction of it for boost decay. */
  readonly spoolTime: number;
  readonly dumpFraction: number;
  /** Engine speeds (rpm) over which exhaust energy reaches full boost. */
  readonly spoolRPM: readonly [number, number];
}
export interface TorqueTable {
  readonly rpm: readonly number[];
  readonly throttle: readonly number[];
  /** torque[throttleIndex][rpmIndex], N m. */
  readonly torque: readonly (readonly number[])[];
}
export interface EngineDefinition {
  /** Crank, flywheel and motor reflected inertia (kg m²). */
  readonly inertia: number;
  /** Intake response time constants (s) for opening and closing the throttle. */
  readonly throttleRise: number;
  readonly throttleFall: number;
  /** Part-throttle exponent: torque ∝ θ^progression of the full-load curve. */
  readonly throttleProgression: number;
  /** Internal friction a + b·ω (N m, ω in rad/s). */
  readonly frictionBase: number;
  readonly frictionViscous: number;
  /** Closed-throttle pumping loss per rad/s (N m s). */
  readonly pumping: number;
  readonly turbo: TurboDefinition | null;
  readonly table: TorqueTable | null;
}
export interface GearboxDefinition {
  /** Torque interruption per shift (s). */
  readonly shiftTime: number;
  /** Fraction of engine torque cut while shifting (1 dog box / sequential
   * cut, 0 seamless); a seamless box also keeps the clutch engaged. */
  readonly shiftCut: number;
}
/** The former engine: instant throttle, linear part-load, no turbo. */
export const LEGACY_ENGINE: EngineDefinition = Object.freeze({
  inertia: 0.34,
  throttleRise: 0,
  throttleFall: 0,
  throttleProgression: 1,
  frictionBase: 12,
  frictionViscous: 0.04,
  pumping: 0,
  turbo: null,
  table: null,
});
export const LEGACY_GEARBOX: GearboxDefinition = Object.freeze({ shiftTime: 0.09, shiftCut: 1 });

export class EngineState {
  /** Effective (manifold) throttle 0..1 and turbo boost 0..1. */
  throttle = 0;
  boost = 0;
  /** Advance intake and turbo states over dt for pedal θ at `rpm`. */
  advance(def: EngineDefinition, pedal: number, rpm: number, dt: number) {
    const target = clamp(pedal, 0, 1),
      tau = target > this.throttle ? def.throttleRise : def.throttleFall;
    this.throttle = tau <= 0 ? target : target + (this.throttle - target) * Math.exp(-dt / tau);
    const turbo = def.turbo;
    if (turbo) {
      const goal = smooth(turbo.spoolRPM[0], turbo.spoolRPM[1], rpm) * this.throttle,
        time = goal > this.boost ? turbo.spoolTime : turbo.spoolTime * turbo.dumpFraction;
      this.boost = time <= 0 ? goal : goal + (this.boost - goal) * Math.exp(-dt / time);
    } else this.boost = 1;
    return this;
  }
}
/** Full-load torque from the definition's curve (N m). */
export function curveTorque(rpm: number, spec: Pick<VehicleSpec, 'torqueCurve'>) {
  const curve = spec.torqueCurve;
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++)
    if (rpm <= curve[i][0])
      return lerp(
        curve[i - 1][1],
        curve[i][1],
        (rpm - curve[i - 1][0]) / (curve[i][0] - curve[i - 1][0]),
      );
  return 0;
}
function tableTorque(table: TorqueTable, rpm: number, throttle: number) {
  const index = (axis: readonly number[], x: number) => {
    let i = 0;
    while (i < axis.length - 2 && x > axis[i + 1]) i++;
    return i;
  };
  const i = index(table.rpm, rpm),
    j = index(table.throttle, throttle),
    u = clamp((rpm - table.rpm[i]) / (table.rpm[i + 1] - table.rpm[i]), 0, 1),
    v = clamp((throttle - table.throttle[j]) / (table.throttle[j + 1] - table.throttle[j]), 0, 1);
  return lerp(
    lerp(table.torque[j][i], table.torque[j][i + 1], u),
    lerp(table.torque[j + 1][i], table.torque[j + 1][i + 1], u),
    v,
  );
}
/** Combustion torque (N m) at `rpm` for the engine state, before friction. */
export function combustionTorque(
  def: EngineDefinition,
  spec: Pick<VehicleSpec, 'torqueCurve'>,
  state: EngineState,
  rpm: number,
  omega: number,
) {
  const throttle = state.throttle,
    base = def.table
      ? tableTorque(def.table, rpm, throttle)
      : curveTorque(rpm, spec) *
        (def.throttleProgression === 1 ? throttle : throttle ** def.throttleProgression),
    boost = def.turbo ? 1 - def.turbo.boostShare + def.turbo.boostShare * state.boost : 1;
  return base * boost - def.pumping * (1 - throttle) * Math.max(0, omega);
}
/** Engine internal friction torque (N m) at crank speed ω. */
export function frictionTorque(def: EngineDefinition, omega: number) {
  return def.frictionBase + Math.max(0, omega) * def.frictionViscous;
}
