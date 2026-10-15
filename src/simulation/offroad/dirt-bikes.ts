import { bikeEnvelope, type BikeSpec } from '../bike-definitions.ts';
import type { VehicleDefinition } from '../vehicles.ts';
import type { OffroadBikeSpec } from './types.ts';

/** Off-road motorcycles (WP39, masterplan §8/§9): original designs, no real
 * manufacturer, team or series. They run the motorcycle adapter family with
 * the airborne, long-travel, loose-surface extension (DirtBikeVehicle):
 * ~300 mm of travel at both wheels on rising-rate springs, knobby (or, for
 * supermoto, treaded-slick) tyres whose loose-surface bite comes from the
 * shared material table, rear-wheel gyroscopic pitch control in the air and
 * landing/bottoming crash thresholds. By family convention `spec.dryMass`
 * includes the rider. Calibration bands: scripts/offroad-calibration.ts. */
const MX_AIR: OffroadBikeSpec = Object.freeze({
  progression: 2.2,
  forkDamping: 1400,
  shockDamping: 1600,
  damperKnee: 2.2,
  pitchInertia: 105,
  spinInertia: 0.62,
  spinUp: 95,
  spinBrake: 260,
  bodyTorque: 85,
  noseDownLimit: 0.46,
  noseUpLimit: 0.62,
  bottomOutSpeed: 6.0,
  dabSpeed: 6.5,
  dabLean: 0.42,
});
const MX450: BikeSpec = Object.freeze({
  riderMass: 75,
  fuel: 5.5,
  cgHeight: 0.86,
  cgToFront: 0.75,
  cgToRear: 0.73,
  frontWheelRadius: 0.355,
  rearWheelRadius: 0.345,
  crownRadius: 0.062,
  maxSteer: 0.72,
  steerRate: 3.4,
  maxLean: 0.95,
  mu: 1.12,
  frontBrake: 2300,
  rearBrake: 950,
  drag: 0.4,
  tuckDrag: 0.02,
  downforce: 0,
  downforceFront: 0.5,
  rolling: 0.024,
  riderOffsetMax: 0.12,
  drivelineEfficiency: 0.9,
  gearbox: 'quickshifter',
  shiftCut: 0.06,
  launchRPM: 7000,
  wheelieLimit: 0.2,
  stoppieMargin: 0.86,
  forkTravel: 0.3,
  forkRate: 9400,
  shockTravel: 0.3,
  shockRate: 9800,
  crashEnergy: 1800,
  offroad: MX_AIR,
});
const MX250: BikeSpec = Object.freeze({
  ...MX450,
  riderMass: 75,
  fuel: 6,
  cgHeight: 0.85,
  cgToFront: 0.74,
  cgToRear: 0.73,
  mu: 1.12,
  frontBrake: 2200,
  rearBrake: 900,
  launchRPM: 9000,
  forkRate: 9000,
  shockRate: 9400,
  offroad: Object.freeze({ ...MX_AIR, pitchInertia: 98, spinInertia: 0.52, spinUp: 120 }),
});
const SM450: BikeSpec = Object.freeze({
  ...MX450,
  fuel: 6,
  cgHeight: 0.82,
  cgToFront: 0.73,
  cgToRear: 0.72,
  frontWheelRadius: 0.3,
  rearWheelRadius: 0.31,
  crownRadius: 0.075,
  maxSteer: 0.62,
  maxLean: 0.98,
  mu: 1.38,
  frontBrake: 3300,
  rearBrake: 1000,
  drag: 0.36,
  forkTravel: 0.27,
  forkRate: 11500,
  shockTravel: 0.28,
  shockRate: 12000,
  wheelieLimit: 0.15,
  stoppieMargin: 0.9,
  offroad: Object.freeze({ ...MX_AIR, noseDownLimit: 0.4, bottomOutSpeed: 5.5 }),
});
/** The road-bike envelope with off-road margins: loose ground, hops over
 * rollers (no braking in the air) and berms ask for earlier braking. */
function dirtEnvelope(b: BikeSpec, wheelbase: number, mass: number, top: number) {
  return Object.freeze({
    ...bikeEnvelope(b, wheelbase, mass, top),
    brakingMargin: 0.5,
    lateralMargin: 0.8,
    slowLateralMargin: 0.74,
  });
}
const stations = Object.freeze({
  floorY: -0.6,
  damageZ: 0.62,
  frontElement: Object.freeze([1.0, 0.5] as const),
  rearElement: Object.freeze([-1.0, 0.6] as const),
  jackZ: Object.freeze([-0.8, 0.7] as const),
  jackX: 0.1,
});
const wheels = (b: BikeSpec) =>
  Object.freeze([
    Object.freeze([0, b.frontWheelRadius - b.cgHeight, b.cgToFront] as const),
    Object.freeze([0, b.frontWheelRadius - b.cgHeight, b.cgToFront] as const),
    Object.freeze([0, b.rearWheelRadius - b.cgHeight, -b.cgToRear] as const),
    Object.freeze([0, b.rearWheelRadius - b.cgHeight, -b.cgToRear] as const),
  ]);
const curve = (points: readonly (readonly [number, number])[]) =>
  Object.freeze(points.map((p) => Object.freeze(p) as readonly [number, number]));
/** An original 450 cc four-stroke motocross bike: ~63 hp (47 kW), 104 kg,
 * five-speed, 21/19-inch wheels, 300 mm of travel. */
export const MX_450: VehicleDefinition = Object.freeze({
  id: 'mx450',
  version: 1,
  name: 'MX-450 MOTOCROSS',
  classId: 'motocross',
  dynamicsKind: 'bike',
  spec: Object.freeze({
    dryMass: 104 + MX450.riderMass,
    wheelRadius: MX450.rearWheelRadius,
    wheelInertia: 0.7,
    wheelbase: 1.48,
    track: 0,
    inertia: Object.freeze([60, 52, 22] as const),
    restLength: 0.3,
    linkCentreHeight: 0.3,
    travel: MX450.forkTravel,
    maxSteer: MX450.maxSteer,
    finalDrive: 4.0,
    gearRatios: Object.freeze([0, 0, 7.8, 5.73, 4.53, 3.72, 3.12]),
    idleRPM: 1800,
    shiftRPM: 11300,
    downshiftRPM: 6200,
    limiterRPM: 12000,
    maxBatteryJ: 0,
    motorPowerW: 47000,
    regenPowerW: 0,
    brakeTorque: MX450.frontBrake * MX450.frontWheelRadius,
    airDensity: 1.225,
    torqueCurve: curve([
      [3000, 30],
      [5000, 42],
      [7000, 49],
      [8500, 50],
      [9500, 47],
      [10500, 41],
      [12000, 31],
    ]),
  }),
  wheelPositions: wheels(MX450),
  drivetrain: 'rwd',
  aero: Object.freeze({ downforce: 0, drag: 1, frontZ: 0.55, rearZ: -0.55 }),
  halfExtents: Object.freeze([0.42, 0.62, 1.08] as const),
  stations,
  tireGrip: 1,
  tireFamily: 'knobby',
  hybrid: false,
  drs: false,
  setupKeys: Object.freeze(['brakeBias'] as const),
  ai: dirtEnvelope(MX450, 1.48, 104 + 75 + 5.5, 34),
  bike: MX450,
});
/** An original 250 cc two-stroke motocross bike: ~48 hp (36 kW) on a narrow,
 * high-revving power band, 97 kg, five-speed. Races the 450 four-strokes in
 * the open motocross class. */
export const MX_250: VehicleDefinition = Object.freeze({
  ...MX_450,
  id: 'mx250',
  name: 'MX-250 TWO-STROKE',
  spec: Object.freeze({
    ...MX_450.spec,
    dryMass: 97 + MX250.riderMass,
    wheelInertia: 0.65,
    finalDrive: 4.3,
    gearRatios: Object.freeze([0, 0, 7.7, 5.75, 4.6, 3.8, 3.2]),
    idleRPM: 2200,
    shiftRPM: 12900,
    downshiftRPM: 8200,
    limiterRPM: 13600,
    motorPowerW: 36000,
    brakeTorque: MX250.frontBrake * MX250.frontWheelRadius,
    torqueCurve: curve([
      [4000, 14],
      [7000, 22],
      [9000, 29],
      [10500, 31],
      [11500, 30],
      [12500, 25],
      [13600, 18],
    ]),
  }),
  wheelPositions: wheels(MX250),
  ai: dirtEnvelope(MX250, 1.48, 97 + 75 + 6, 33),
  bike: MX250,
});
/** An original 450 cc supermoto: the motocross chassis on 17-inch wheels,
 * treaded slicks, a large front disc and shorter, stiffer suspension, for
 * mixed asphalt and dirt (~150 km/h, six-speed). */
export const SM_450: VehicleDefinition = Object.freeze({
  ...MX_450,
  id: 'sm450',
  name: 'SM-450 SUPERMOTO',
  classId: 'supermoto',
  spec: Object.freeze({
    ...MX_450.spec,
    dryMass: 108 + SM450.riderMass,
    wheelRadius: SM450.rearWheelRadius,
    wheelInertia: 0.75,
    wheelbase: 1.45,
    travel: SM450.forkTravel,
    maxSteer: SM450.maxSteer,
    finalDrive: 3.4,
    gearRatios: Object.freeze([0, 0, 7.4, 5.5, 4.4, 3.65, 3.1, 2.75]),
    brakeTorque: SM450.frontBrake * SM450.frontWheelRadius,
  }),
  wheelPositions: wheels(SM450),
  halfExtents: Object.freeze([0.42, 0.6, 1.06] as const),
  tireFamily: 'supermoto',
  ai: dirtEnvelope(SM450, 1.45, 108 + 75 + 6, 41),
  bike: SM450,
});
/** Registered after the catalogue (append-only snapshot vehicle index). */
export const DIRT_BIKES: Readonly<Record<string, VehicleDefinition>> = Object.freeze({
  mx450: MX_450,
  mx250: MX_250,
  sm450: SM_450,
});
export function isDirtBike(def: Pick<VehicleDefinition, 'bike'>) {
  return !!def.bike?.offroad;
}
