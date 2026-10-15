import type { Setup } from '../config.ts';
import type { EngineSpec } from '../vehicles.ts';

/** Setup parameters by chassis type (masterplan §7.3): a car exposes only
 * what it physically has. */
const ALIGNMENT: readonly (keyof Setup)[] = [
  'frontPressure',
  'rearPressure',
  'frontCamber',
  'rearCamber',
  'frontToe',
  'rearToe',
];
export const KEYS = Object.freeze({
  /** Single-seaters and prototypes: wings, springs, ride, bars, alignment. */
  winged: Object.freeze([
    'frontWing',
    'rearWing',
    'brakeBias',
    'diffPower',
    'diffCoast',
    'frontSpring',
    'rearSpring',
    'frontARB',
    'rearARB',
    'frontRide',
    'rearRide',
    ...ALIGNMENT,
  ] as (keyof Setup)[]),
  /** Racing saloons/GTs without adjustable wings in this model. */
  closed: Object.freeze([
    'brakeBias',
    'diffPower',
    'diffCoast',
    'frontSpring',
    'rearSpring',
    'frontARB',
    'rearARB',
    'frontRide',
    'rearRide',
    ...ALIGNMENT,
  ] as (keyof Setup)[]),
  /** Homologated springs and ride (karts, trucks, road cars, historics). */
  fixedChassis: Object.freeze([
    'brakeBias',
    'diffPower',
    'diffCoast',
    'frontARB',
    'rearARB',
    ...ALIGNMENT,
  ] as (keyof Setup)[]),
});
/** Engine friction/inertia/clutch scaled from displacement (litres): FMEP of
 * roughly 1.5-2 bar at peak speed, crankshaft and flywheel inertia, and a
 * clutch sized above peak torque. */
export function combustion(litres: number, clutchCapacity: number, inertia: number): EngineSpec {
  return Object.freeze({
    frictionBase: Number((3.5 * litres).toFixed(2)),
    frictionPerRad: Number((0.011 * litres).toFixed(4)),
    inertia,
    idleTorque: Math.min(180, Math.round(30 * litres + 20)),
    clutchCapacity,
  });
}
