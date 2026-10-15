import { DEFAULT_SETUP, SETUP_LIMITS, type Setup } from '../simulation/config.ts';
import { FORMULA_APX01, setupFor, type VehicleDefinition } from '../simulation/vehicles.ts';

/** Garage setup page model: the parameters the chosen machine exposes
 * (VehicleDefinition.setupKeys) at the values its session will use
 * (`setupFor`: its own baseline and limits), so a motorcycle shows its
 * preload, damping, steering damper, gearing and rider-aid maps and never a
 * car's wings or anti-roll bars. */
export const SETUP_LABELS: Readonly<Record<keyof Setup, string>> = Object.freeze({
  frontWing: 'Front wing',
  rearWing: 'Rear wing',
  brakeBias: 'Front brake bias',
  diffPower: 'Differential · power',
  diffCoast: 'Differential · coast',
  frontSpring: 'Front spring · N/m',
  rearSpring: 'Rear spring · N/m',
  frontARB: 'Front anti-roll · N/m',
  rearARB: 'Rear anti-roll · N/m',
  frontRide: 'Front ride height · m',
  rearRide: 'Rear ride height · m',
  frontPressure: 'Front pressure · kPa',
  rearPressure: 'Rear pressure · kPa',
  frontCamber: 'Front camber · rad',
  rearCamber: 'Rear camber · rad',
  frontToe: 'Front toe · rad',
  rearToe: 'Rear toe · rad',
  frontPreload: 'Fork preload · m',
  rearPreload: 'Shock preload · m',
  frontDamping: 'Fork damping · soft 0 – firm 1',
  rearDamping: 'Shock damping · soft 0 – firm 1',
  steeringDamper: 'Steering damper · off 0 – firm 1',
  gearing: 'Final drive · ratio ×',
  tractionMap: 'Traction control map · 1 least – 6 most',
  wheelieMap: 'Wheelie control map · 1 least – 5 most',
  engineBrakeMap: 'Engine braking map · 0 free – 3 strong',
});
/** Slider increments for the motorcycle clickers, sprockets and maps. */
const STEPS: Partial<Record<keyof Setup, number>> = Object.freeze({
  frontDamping: 0.05,
  rearDamping: 0.05,
  steeringDamper: 0.05,
  gearing: 0.005,
  tractionMap: 1,
  wheelieMap: 1,
  engineBrakeMap: 1,
});
/** Keep useful slider increments without rounding a valid researched/imported setup. */
export function setupStep(
  key: keyof Setup,
  value: number,
  limits: readonly [number, number] = SETUP_LIMITS[key],
): number | 'any' {
  const [min, max] = limits;
  const preferred = STEPS[key] ?? (max > 1000 ? 500 : max > 100 ? 1 : max <= 0.01 ? 0.0005 : 0.001);
  const steps = (value - min) / preferred;
  return Math.abs(steps - Math.round(steps)) < 1e-9 ? preferred : 'any';
}
export interface SetupRow {
  key: keyof Setup;
  label: string;
  min: number;
  max: number;
  step: number | 'any';
  value: number;
}
/** One row per exposed parameter, in the machine's own order. */
export function setupRows(vehicle: VehicleDefinition, setup: Setup): SetupRow[] {
  // APX-01 runs the setup as given (vehicle.ts); every other machine its setupFor.
  const values = vehicle === FORMULA_APX01 ? setup : setupFor(vehicle, setup, DEFAULT_SETUP);
  return vehicle.setupKeys.map((key) => {
    const limits = vehicle.setupLimits?.[key] ?? SETUP_LIMITS[key],
      value = values[key];
    return {
      key,
      label: SETUP_LABELS[key],
      min: limits[0],
      max: limits[1],
      step: setupStep(key, value, limits),
      value,
    };
  });
}
