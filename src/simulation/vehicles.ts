import type { Setup } from './config.ts';

/** Per-vehicle content contract (WP08 / F04, masterplan §6.3). Every entrant is
 * built from one of these; nothing in the solver reads a global vehicle. Units
 * are SI (kg, m, N m, W, J, rad). The Formula definition carries the former
 * global VEHICLE values unchanged, so existing sessions are numerically
 * identical. Definitions are validated by validateVehicleDefinition (WP14). */
export interface VehicleSpec {
  dryMass: number;
  wheelRadius: number;
  wheelInertia: number;
  wheelbase: number;
  track: number;
  inertia: readonly [number, number, number];
  restLength: number;
  linkCentreHeight: number;
  travel: number;
  maxSteer: number;
  finalDrive: number;
  /** Index 0 reverse, 1 neutral, 2.. forward gears. */
  gearRatios: readonly number[];
  idleRPM: number;
  shiftRPM: number;
  /** Automatic downshift threshold (wheel-coupled RPM). */
  downshiftRPM: number;
  limiterRPM: number;
  maxBatteryJ: number;
  motorPowerW: number;
  regenPowerW: number;
  brakeTorque: number;
  airDensity: number;
  torqueCurve: readonly (readonly [number, number])[];
}
/** AI capability envelope: base + aero·v² limits in m/s² (masterplan §13.5). */
export interface CapabilityEnvelope {
  lateralBase: number;
  lateralAero: number;
  brakingBase: number;
  brakingAero: number;
  lateralMargin: number;
  slowLateralMargin: number;
  brakingMargin: number;
  /** Straight-line target ceiling (m/s) before skill. */
  topSpeed: number;
  /** Peak tyre μ the AI normalizes contact grip by. */
  referenceMu: number;
  /** Downforce reference (N at unit normalization) divided by mass at runtime. */
  downforceReference: number;
}
export type VehicleClass = 'formula' | 'touring' | 'gt' | 'club';
/** Driven axle. All-wheel drive needs a centre differential model first. */
export type Drivetrain = 'rwd' | 'fwd';
export interface VehicleDefinition {
  id: string;
  version: number;
  name: string;
  classId: VehicleClass;
  /** Dynamics adapter family. Only the four-wheel solver exists today; bikes
   * and deformable-terrain vehicles need their own (masterplan §8, §9). */
  dynamicsKind: 'four-wheel';
  spec: VehicleSpec;
  /** Car-local wheel centres: FR, FL, RR, RL (+Z nose, +X driver's left). */
  wheelPositions: readonly (readonly [number, number, number])[];
  drivetrain: Drivetrain;
  /** Aero scaling of the shared body map; 1 is the Formula car. */
  aero: { downforce: number; drag: number; frontZ: number; rearZ: number };
  /** Collision/floor box half extents (x, y, z). */
  halfExtents: readonly [number, number, number];
  /** Car-local body stations (m): floor plane height, nose/tail damage zone
   * boundary, detachable front/rear element positions and masses, jack feet. */
  stations: {
    floorY: number;
    damageZ: number;
    frontElement: readonly [number, number];
    rearElement: readonly [number, number];
    jackZ: readonly [number, number];
    jackX: number;
  };
  /** Tyre family grip relative to the Formula slick construction. */
  tireGrip: number;
  hybrid: boolean;
  drs: boolean;
  /** Setup parameters this car genuinely exposes; others stay at default. */
  setupKeys: readonly (keyof Setup)[];
  ai: CapabilityEnvelope;
}
const FORMULA_SPEC: VehicleSpec = Object.freeze<VehicleSpec>({
  dryMass: 770,
  wheelRadius: 0.335,
  wheelInertia: 1.8,
  wheelbase: 3.44,
  track: 1.66,
  inertia: [510, 1220, 1080],
  restLength: 0.25,
  /** Height above the contact patch where tread forces enter the chassis (m). */
  linkCentreHeight: 0.26,
  travel: 0.17,
  maxSteer: 0.38,
  finalDrive: 3.7,
  gearRatios: [-3.1, 0, 3.3, 2.8, 2.35, 2.02, 1.78, 1.59, 1.44, 1.31],
  idleRPM: 4200,
  shiftRPM: 12300,
  downshiftRPM: 6900,
  limiterRPM: 13700,
  maxBatteryJ: 4e6,
  motorPowerW: 100000,
  regenPowerW: 70000,
  brakeTorque: 13200,
  airDensity: 1.225,
  torqueCurve: [
    [4000, 360],
    [6500, 460],
    [9000, 510],
    [11000, 490],
    [12500, 450],
    [13700, 360],
  ],
});
const FORMULA_WHEELS = Object.freeze([
  Object.freeze([-0.83, 0.05, 1.82] as const),
  Object.freeze([0.83, 0.05, 1.82] as const),
  Object.freeze([-0.83, 0.05, -1.62] as const),
  Object.freeze([0.83, 0.05, -1.62] as const),
]);
/** Fitted from measured Formula limits (scripts/reference-targets.ts). */
const FORMULA_ENVELOPE: CapabilityEnvelope = Object.freeze({
  lateralBase: 15.95,
  lateralAero: 0.00548,
  brakingBase: 19.9,
  brakingAero: 0.0056,
  lateralMargin: 0.72,
  slowLateralMargin: 0.62,
  brakingMargin: 0.55,
  topSpeed: 92,
  referenceMu: 1.82,
  downforceReference: 794,
});
export const FORMULA_APX01: VehicleDefinition = Object.freeze({
  id: 'apx01',
  version: 1,
  name: 'APX-01 FORMULA',
  classId: 'formula',
  dynamicsKind: 'four-wheel',
  spec: FORMULA_SPEC,
  wheelPositions: FORMULA_WHEELS,
  drivetrain: 'rwd',
  aero: Object.freeze({ downforce: 1, drag: 1, frontZ: 1.7, rearZ: -1.6 }),
  halfExtents: Object.freeze([0.94, 0.38, 2.5] as const),
  stations: Object.freeze({
    floorY: -0.43,
    damageZ: 1.35,
    frontElement: Object.freeze([2.5, 4.5] as const),
    rearElement: Object.freeze([-2.1, 6] as const),
    jackZ: Object.freeze([-1.4, 1.5] as const),
    jackX: 0.38,
  }),
  tireGrip: 1,
  hybrid: true,
  drs: true,
  setupKeys: Object.freeze([
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
    'frontPressure',
    'rearPressure',
    'frontCamber',
    'rearCamber',
    'frontToe',
    'rearToe',
  ] as const),
  ai: FORMULA_ENVELOPE,
});
/** An original front-drive touring saloon: 1.3 t, 2.70 m wheelbase, six-speed,
 * no hybrid, no DRS and only residual body downforce. It exists to prove the
 * per-entry contract with a genuinely different mass, geometry, drivetrain
 * and aero character (WP18). Its AI envelope is measured by
 * scripts/vehicle-calibration.ts (docs/VEHICLE_CALIBRATION.md). */
export const TOURING_TC1: VehicleDefinition = Object.freeze({
  id: 'tc1',
  version: 1,
  name: 'TC-1 TOURING',
  classId: 'touring',
  dynamicsKind: 'four-wheel',
  spec: Object.freeze({
    dryMass: 1265,
    wheelRadius: 0.318,
    wheelInertia: 1.35,
    wheelbase: 2.7,
    track: 1.56,
    inertia: Object.freeze([560, 2150, 1950] as const),
    restLength: 0.25,
    linkCentreHeight: 0.34,
    travel: 0.17,
    maxSteer: 0.48,
    finalDrive: 4.1,
    gearRatios: Object.freeze([-3.2, 0, 3.2, 2.3, 1.78, 1.43, 1.19, 1.0]),
    idleRPM: 1600,
    shiftRPM: 7600,
    downshiftRPM: 3900,
    limiterRPM: 8100,
    maxBatteryJ: 0,
    motorPowerW: 0,
    regenPowerW: 0,
    brakeTorque: 9200,
    airDensity: 1.225,
    torqueCurve: Object.freeze([
      Object.freeze([1500, 215] as const),
      Object.freeze([3000, 305] as const),
      Object.freeze([4500, 350] as const),
      Object.freeze([6000, 335] as const),
      Object.freeze([7200, 305] as const),
      Object.freeze([8100, 250] as const),
    ]),
  }),
  wheelPositions: Object.freeze([
    Object.freeze([-0.78, 0.05, 1.12] as const),
    Object.freeze([0.78, 0.05, 1.12] as const),
    Object.freeze([-0.78, 0.05, -1.58] as const),
    Object.freeze([0.78, 0.05, -1.58] as const),
  ]),
  drivetrain: 'fwd',
  aero: Object.freeze({ downforce: 0.08, drag: 0.62, frontZ: 1.3, rearZ: -1.7 }),
  halfExtents: Object.freeze([0.9, 0.55, 2.25] as const),
  stations: Object.freeze({
    floorY: -0.4,
    damageZ: 1.25,
    frontElement: Object.freeze([2.2, 3.5] as const),
    rearElement: Object.freeze([-2.2, 4] as const),
    jackZ: Object.freeze([-1.3, 1.0] as const),
    jackX: 0.45,
  }),
  tireGrip: 0.8,
  hybrid: false,
  drs: false,
  setupKeys: Object.freeze([
    'brakeBias',
    'diffPower',
    'diffCoast',
    'frontSpring',
    'rearSpring',
    'frontARB',
    'rearARB',
    'frontRide',
    'rearRide',
    'frontPressure',
    'rearPressure',
    'frontCamber',
    'rearCamber',
    'frontToe',
    'rearToe',
  ] as const),
  ai: Object.freeze({
    lateralBase: 12.7,
    lateralAero: 0,
    brakingBase: 13.4,
    brakingAero: 0,
    lateralMargin: 0.74,
    slowLateralMargin: 0.66,
    brakingMargin: 0.6,
    topSpeed: 66,
    referenceMu: 1.82,
    downforceReference: 0,
  }),
});
export const VEHICLES: Readonly<Record<string, VehicleDefinition>> = Object.freeze({
  apx01: FORMULA_APX01,
  tc1: TOURING_TC1,
});
export const VEHICLE_IDS = Object.freeze(Object.keys(VEHICLES));
export const DEFAULT_VEHICLE_ID = 'apx01';
export function vehicleDefinition(id: unknown): VehicleDefinition {
  return typeof id === 'string' && Object.hasOwn(VEHICLES, id) ? VEHICLES[id] : FORMULA_APX01;
}
/** Stable small integer carried in snapshots (protocol R.VEHICLE). */
export function vehicleIndex(id: string) {
  return Math.max(0, VEHICLE_IDS.indexOf(id));
}
export function vehicleAt(index: number): VehicleDefinition {
  return vehicleDefinition(VEHICLE_IDS[index]);
}
/** Class-specific setup: parameters a car does not expose keep defaults so a
 * touring car cannot silently carry a rear-wing value (masterplan §7.3). */
export function setupFor(definition: VehicleDefinition, setup: Setup, defaults: Setup): Setup {
  const out = { ...defaults };
  for (const key of definition.setupKeys) out[key] = setup[key];
  return out;
}
