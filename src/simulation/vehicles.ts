import type { Setup } from './config.ts';
import { BIKE_ADDITIONS, BIKE_VEHICLES, type BikeSpec } from './bike-definitions.ts';
import type { DrivelineSpec } from './differential.ts';
import type { TireFamilyId } from './tire-families.ts';
import { CATALOGUE } from './vehicle-catalogue/index.ts';
import { DIRT_BIKES } from './offroad/dirt-bikes.ts';
import type { VehicleDynamicsOverrides } from './vehicle-dynamics.ts';

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
  /** Power-unit friction, inertia, idle governor and clutch; absent: the
   * Formula power unit's values (12 + 0.04·ω N m, 0.34 kg m², 180, 760 N m). */
  engine?: EngineSpec;
}
export interface EngineSpec {
  frictionBase: number;
  /** Friction torque per rad/s of crankshaft speed (N m s). */
  frictionPerRad: number;
  /** Crankshaft + flywheel (+ motor) inertia (kg m²). */
  inertia: number;
  /** Idle governor torque ceiling (N m). */
  idleTorque: number;
  /** Clutch friction capacity at the crankshaft (N m). */
  clutchCapacity: number;
  /** Automatic clutch full-engagement reference (rpm); absent: idle. */
  engageRPM?: number;
  /** Share (0-1) of the road-coupled vehicle inertia the clutch synchronizes
   * against while the driven tyres grip; absent: 0 (wheels only, as the
   * Formula car). */
  clutchCoupling?: number;
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
  /** Share of the racing line's lateral offset this machine uses (1 = all). */
  lineScale?: number;
  /** Steering preview distance base (m) and per m/s; absent: 6 + 0.48 v. */
  lookahead?: readonly [number, number];
  /** Share of lateralBase / brakingBase (m/s²) a fan-assisted floor supplies
   * with the floor intact: the fan-on fit less a fan-off fit
   * (scripts/vehicle-calibration.ts). The AI scales it with floor health, as
   * the solver scales the suction (floorEnvelope in ai.ts). */
  fanBase?: { readonly lateral: number; readonly braking: number };
}
export type VehicleClass =
  | 'formula'
  | 'formula-junior'
  | 'historic'
  | 'hypercar'
  | 'prototype'
  | 'gt'
  | 'gt-sport'
  | 'touring'
  | 'club'
  | 'rally'
  | 'rallycross'
  | 'offroad'
  | 'kart'
  | 'road'
  | 'gp-bike'
  | 'superbike'
  // Catalogue growth (CONTENT_PIPELINE.md §1.4): feeder single-seaters, the
  // historic eras, loose-surface heritage, experimental machines and further
  // road-motorcycle classes. Appended; existing ids never change meaning.
  | 'formula-feeder'
  | 'formula-entry'
  | 'historic-aero'
  | 'historic-turbo'
  | 'historic-prototype'
  | 'vintage'
  | 'historic-rally'
  | 'experimental'
  | 'supersport'
  | 'classic-bike'
  | 'road-bike'
  // Off-road motorcycles (WP39).
  | 'motocross'
  | 'supermoto';
/** Fan-assisted floor (vehicle.ts applies it at the floor centre). */
export interface FanSpec {
  /** Suction (N) with the skirts sealed at or below `sealHeight`. */
  force: number;
  /** Floor clearance (m) up to which the skirts seal fully. */
  sealHeight: number;
  /** Extra clearance (m) over which suction fades to nothing. */
  fade: number;
  /** Car-local station (m, +Z nose) where the suction acts. */
  z: number;
}
/** Driven axle(s); 'awd' splits torque through `driveline.centre`. */
export type Drivetrain = 'rwd' | 'fwd' | 'awd';
export interface VehicleDefinition {
  id: string;
  version: number;
  name: string;
  classId: VehicleClass;
  /** Dynamics adapter family (masterplan §8, §9, D13): 'four-wheel' runs
   * Vehicle; 'bike' runs BikeVehicle (bike-vehicle.ts) and carries `bike`. */
  dynamicsKind: 'four-wheel' | 'bike';
  /** Two-wheel family block (bike-definitions.ts); present iff a 'bike'. */
  bike?: BikeSpec;
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
    /** Floor skid footprint (half width, front z, rear z) at floorY; absent:
     * the Formula plank (skid-contact.ts). */
    skid?: readonly [number, number, number];
  };
  /** Tyre family grip relative to the Formula slick construction. */
  tireGrip: number;
  hybrid: boolean;
  drs: boolean;
  /** Setup parameters this car genuinely exposes; others stay at default. */
  setupKeys: readonly (keyof Setup)[];
  ai: CapabilityEnvelope;
  /** Catalogue fields (WP17/WP30, src/simulation/vehicle-catalogue/). Absent
   * on APX-01 and TC-1, whose behaviour and content hashes stay unchanged. */
  /** Differentials; absent: the original viscous axle coupling. */
  driveline?: DrivelineSpec;
  /** Hybrid motor on its own axle instead of the crankshaft, deploying only
   * above `minSpeed` (m/s); regeneration then uses that axle too. */
  hybridAxle?: { axle: 'front'; minSpeed: number };
  tireFamily?: TireFamilyId;
  /** Rear tyre grip when the car runs a staggered (wider) rear fitment;
   * absent: tireGrip on all four corners. */
  tireGripRear?: number;
  /** Body-origin height above the road when placed (m); absent: 0.516. */
  restHeight?: number;
  /** Fuel (kg) aboard at the start of a sprint session; absent: 24. */
  fuelLoad?: number;
  /** The car's own setup baseline (keys it does not expose keep these). */
  setupDefaults?: Partial<Setup>;
  /** Per-car limits for exposed setup keys. */
  setupLimits?: Partial<Record<keyof Setup, readonly [number, number]>>;
  powertrain?: 'combustion' | 'hybrid' | 'electric';
  /** Fan-assisted underbody (an auxiliary-engine fan evacuating a skirted
   * floor): suction independent of road speed, lost as the floor lifts off
   * its seal. Absent on every machine without one. */
  fan?: FanSpec;
  /** Optional physical blocks (tyre construction, suspension, engine,
   * gearbox, differential, aero platform) overriding the class defaults of
   * vehicle-dynamics.ts (docs/production/PHYSICS_MODEL.md). */
  dynamics?: VehicleDynamicsOverrides;
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
/** Registry order is the snapshot index (R.VEHICLE): append only. */
export const VEHICLES: Readonly<Record<string, VehicleDefinition>> = Object.freeze({
  apx01: FORMULA_APX01,
  tc1: TOURING_TC1,
  ...BIKE_VEHICLES,
  ...CATALOGUE,
  ...BIKE_ADDITIONS,
  // Off-road motorcycles (WP39), appended after the catalogue and bikes.
  ...DIRT_BIKES,
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
 * touring car cannot silently carry a rear-wing value (masterplan §7.3). A
 * car's own baseline (setupDefaults) replaces the shared default; an exposed
 * value the player left at the shared default also takes the car's baseline,
 * and exposed values are clamped to the car's setupLimits. */
export function setupFor(definition: VehicleDefinition, setup: Setup, defaults: Setup): Setup {
  const own = definition.setupDefaults;
  const out = { ...defaults, ...own };
  for (const key of definition.setupKeys) {
    const limit = definition.setupLimits?.[key],
      value = own?.[key] !== undefined && setup[key] === defaults[key] ? own[key] : setup[key];
    out[key] = limit ? Math.max(limit[0], Math.min(limit[1], value)) : value;
  }
  return out;
}
