import { clamp, G } from '../core/math.ts';
import type { BikeParameters } from './bike.ts';
import type { CapabilityEnvelope, VehicleDefinition } from './vehicles.ts';
import type { OffroadBikeSpec } from './offroad/types.ts';

/** Two-wheel family block of a VehicleDefinition (WP33/WP34, masterplan §8,
 * decision D13): a motorcycle runs its own dynamics adapter (BikeVehicle), so
 * its physics lives here instead of in optional four-wheel fields. Units SI.
 * By family convention `spec.dryMass` includes the rider (`riderMass`). */
export interface BikeSpec {
  riderMass: number;
  /** Fuel at the start of a session (kg). */
  fuel: number;
  cgHeight: number;
  /** CG distance behind the front contact / ahead of the rear contact (m). */
  cgToFront: number;
  cgToRear: number;
  frontWheelRadius: number;
  rearWheelRadius: number;
  /** Tyre crown radius: the bike rolls on this profile as it leans (m). */
  crownRadius: number;
  maxSteer: number;
  steerRate: number;
  /** Chassis lean limit (rad): fairing/footpeg ground clearance. */
  maxLean: number;
  /** Peak dry-slick friction of this tyre family. */
  mu: number;
  frontBrake: number;
  rearBrake: number;
  /** ½ρCdA sitting up (N per (m/s)²) and the share a full tuck removes. */
  drag: number;
  tuckDrag: number;
  /** Wing downforce (N per (m/s)²) and its front share; 0 without wings. */
  downforce: number;
  downforceFront: number;
  rolling: number;
  riderOffsetMax: number;
  drivelineEfficiency: number;
  /** Shift interruption: a seamless gearbox has none, a quickshifter a few ms. */
  gearbox: 'seamless' | 'quickshifter';
  shiftCut: number;
  /** Clutch-slip launch speed in first gear (rpm). */
  launchRPM: number;
  /** Rider aids: wheelie-control pitch (rad) and stoppie margin. */
  wheelieLimit: number;
  stoppieMargin: number;
  /** Suspension at the wheel: travel (m) and rate (N/m). */
  forkTravel: number;
  forkRate: number;
  shockTravel: number;
  shockRate: number;
  /** Contact energy (J) above which the rider cannot stay on. */
  crashEnergy: number;
  /** Off-road machines (offroad/dirt-bikes.ts): airborne and terrain block. */
  offroad?: OffroadBikeSpec;
}
export function isBike(def: Pick<VehicleDefinition, 'dynamicsKind'>) {
  return def.dynamicsKind === 'bike';
}
/** Grid family: cars and motorcycles never share a session (sessionIncompatibilities). */
export function vehicleFamily(def: Pick<VehicleDefinition, 'dynamicsKind'>): 'car' | 'bike' {
  return isBike(def) ? 'bike' : 'car';
}
/** Chassis lean shown by the bike for the dynamics lean (the lean of the line
 * from the contact patch to the CG): the bike rolls on its tyre crown, so the
 * chassis leans further than that line, by asin(r·sin φ / (h − r)). */
export function chassisLean(lean: number, spec: Pick<BikeSpec, 'cgHeight' | 'crownRadius'>) {
  const arm = spec.cgHeight - spec.crownRadius;
  return lean + Math.asin(clamp((spec.crownRadius * Math.sin(lean)) / arm, -1, 1));
}
/** Inverse of chassisLean (bisection; monotonic over ±π/2). */
export function dynamicLean(chassis: number, spec: Pick<BikeSpec, 'cgHeight' | 'crownRadius'>) {
  let lo = -Math.PI / 2,
    hi = Math.PI / 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (chassisLean(mid, spec) < chassis) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Dynamics-core parameters of a bike definition at a given mass. */
export function bikeParameters(def: VehicleDefinition, mass = def.spec.dryMass): BikeParameters {
  const b = def.bike;
  if (!b) throw new Error(`${def.id} is not a motorcycle definition`);
  return {
    mass,
    wheelbase: def.spec.wheelbase,
    cgHeight: b.cgHeight,
    cgToFront: b.cgToFront,
    cgToRear: b.cgToRear,
    maxSteer: b.maxSteer,
    steerRate: b.steerRate,
    maxLean: dynamicLean(b.maxLean, b),
    mu: b.mu,
    power: def.spec.motorPowerW,
    maxDrive: 0,
    frontBrake: b.frontBrake,
    rearBrake: b.rearBrake,
    drag: b.drag,
    riderOffsetMax: b.riderOffsetMax,
    downforce: b.downforce,
    downforceFront: b.downforceFront,
    rolling: b.rolling,
    wheelieLimit: b.wheelieLimit,
    stoppieMargin: b.stoppieMargin,
  };
}
/** AI capability envelope derived from the bike's own limits (§13.5): the
 * lateral limit is the lean the rider aid will hold (lean- or grip-limited,
 * whichever is lower), the braking limit is the stoppie deceleration plus drag
 * and wing load, expressed through the base + aero·v² envelope with the
 * mass as the downforce reference. */
export function bikeEnvelope(
  spec: Pick<BikeSpec, 'maxLean' | 'mu' | 'cgHeight' | 'cgToFront' | 'stoppieMargin' | 'drag'> &
    Pick<BikeSpec, 'downforce' | 'downforceFront' | 'crownRadius' | 'riderOffsetMax'> &
    Partial<Pick<BikeSpec, 'frontBrake' | 'rearBrake'>>,
  wheelbase: number,
  mass: number,
  topSpeed: number,
  /** Margins for a machine the rider must treat more gently (absent: the
   * road-racing defaults below). */
  margins: Partial<
    Pick<CapabilityEnvelope, 'lateralMargin' | 'slowLateralMargin' | 'brakingMargin'>
  > = {},
): CapabilityEnvelope {
  const gain = (spec.riderOffsetMax * 0.25) / spec.cgHeight;
  const lean = Math.min(
    dynamicLean(spec.maxLean, spec),
    Math.atan(Math.max(0.2, 0.72 * spec.mu - gain)),
  );
  const lateralBase = G * Math.min(Math.tan(lean) + gain / Math.cos(lean), 0.8 * spec.mu);
  // Stoppie-limited, unless the brakes themselves cannot reach that (a
  // classic machine's drum-era brakes).
  const brakingBase = Math.min(
    ((G * spec.cgToFront) / spec.cgHeight) * spec.stoppieMargin,
    ((spec.frontBrake ?? Infinity) + (spec.rearBrake ?? 0)) / mass,
  );
  const rearWing = spec.downforce * (1 - spec.downforceFront);
  const brakingAero =
    (spec.drag + (spec.stoppieMargin * rearWing * wheelbase) / spec.cgHeight) / mass;
  return Object.freeze({
    lateralBase: Math.round(lateralBase * 100) / 100,
    lateralAero: 0,
    brakingBase: Math.round(brakingBase * 100) / 100,
    brakingAero: Math.round(brakingAero * 1e6) / 1e6,
    lateralMargin: margins.lateralMargin ?? 0.86,
    slowLateralMargin: margins.slowLateralMargin ?? 0.8,
    brakingMargin: margins.brakingMargin ?? 0.78,
    topSpeed,
    referenceMu: 1.82,
    downforceReference: mass,
  });
}
const GP_BIKE: BikeSpec = Object.freeze({
  riderMass: 72,
  fuel: 16,
  cgHeight: 0.62,
  cgToFront: 0.7,
  cgToRear: 0.75,
  frontWheelRadius: 0.3,
  rearWheelRadius: 0.32,
  crownRadius: 0.075,
  maxSteer: 0.6,
  steerRate: 2.4,
  maxLean: 1.12,
  mu: 1.75,
  frontBrake: 7600,
  rearBrake: 1900,
  drag: 0.215,
  tuckDrag: 0.09,
  downforce: 0.045,
  downforceFront: 0.6,
  rolling: 0.015,
  riderOffsetMax: 0.3,
  drivelineEfficiency: 0.92,
  gearbox: 'seamless',
  shiftCut: 0,
  launchRPM: 9000,
  wheelieLimit: 0.1,
  stoppieMargin: 0.92,
  forkTravel: 0.125,
  forkRate: 32000,
  shockTravel: 0.13,
  shockRate: 38000,
  crashEnergy: 2600,
});
const SUPERBIKE: BikeSpec = Object.freeze({
  riderMass: 72,
  fuel: 15,
  cgHeight: 0.64,
  cgToFront: 0.69,
  cgToRear: 0.75,
  frontWheelRadius: 0.3,
  rearWheelRadius: 0.32,
  crownRadius: 0.08,
  maxSteer: 0.6,
  steerRate: 2.2,
  maxLean: 1.08,
  mu: 1.62,
  frontBrake: 6800,
  rearBrake: 1700,
  drag: 0.235,
  tuckDrag: 0.08,
  downforce: 0,
  downforceFront: 0.6,
  rolling: 0.016,
  riderOffsetMax: 0.28,
  drivelineEfficiency: 0.91,
  gearbox: 'quickshifter',
  shiftCut: 0.035,
  launchRPM: 7500,
  wheelieLimit: 0.12,
  stoppieMargin: 0.9,
  forkTravel: 0.12,
  forkRate: 30000,
  shockTravel: 0.12,
  shockRate: 36000,
  crashEnergy: 2800,
});
const bikeStations = Object.freeze({
  floorY: -0.5,
  damageZ: 0.62,
  frontElement: Object.freeze([1.0, 0.8] as const),
  rearElement: Object.freeze([-1.0, 1.2] as const),
  jackZ: Object.freeze([-0.8, 0.7] as const),
  jackX: 0.1,
});
const wheels = (spec: BikeSpec) =>
  Object.freeze([
    Object.freeze([0, spec.frontWheelRadius - spec.cgHeight, spec.cgToFront] as const),
    Object.freeze([0, spec.frontWheelRadius - spec.cgHeight, spec.cgToFront] as const),
    Object.freeze([0, spec.rearWheelRadius - spec.cgHeight, -spec.cgToRear] as const),
    Object.freeze([0, spec.rearWheelRadius - spec.cgHeight, -spec.cgToRear] as const),
  ]);
/** An original 1000 cc prototype-class racing motorcycle: ~300 hp (224 kW),
 * 157 kg, carbon wings, seamless six-speed gearbox, ~350 km/h. Generic
 * design; no real manufacturer, team or series is represented. */
export const GP_R1: VehicleDefinition = Object.freeze({
  id: 'gpr1',
  version: 1,
  name: 'GP-R1 PROTOTYPE',
  classId: 'gp-bike',
  dynamicsKind: 'bike',
  spec: Object.freeze({
    dryMass: 157 + GP_BIKE.riderMass,
    wheelRadius: GP_BIKE.rearWheelRadius,
    wheelInertia: 0.9,
    wheelbase: 1.45,
    track: 0,
    inertia: Object.freeze([62, 55, 24] as const),
    restLength: 0.3,
    linkCentreHeight: 0.3,
    travel: GP_BIKE.forkTravel,
    maxSteer: GP_BIKE.maxSteer,
    finalDrive: 2.6,
    gearRatios: Object.freeze([0, 0, 4.7, 3.85, 3.25, 2.85, 2.55, 2.36]),
    idleRPM: 4200,
    shiftRPM: 17600,
    downshiftRPM: 11500,
    limiterRPM: 18200,
    maxBatteryJ: 0,
    motorPowerW: 224000,
    regenPowerW: 0,
    brakeTorque: GP_BIKE.frontBrake * GP_BIKE.frontWheelRadius,
    airDensity: 1.225,
    torqueCurve: Object.freeze([
      Object.freeze([4000, 58] as const),
      Object.freeze([8000, 92] as const),
      Object.freeze([11000, 113] as const),
      Object.freeze([13500, 124] as const),
      Object.freeze([16000, 127] as const),
      Object.freeze([17500, 121] as const),
      Object.freeze([18200, 104] as const),
    ]),
  }),
  wheelPositions: wheels(GP_BIKE),
  drivetrain: 'rwd',
  aero: Object.freeze({ downforce: 0, drag: 1, frontZ: 0.55, rearZ: -0.55 }),
  halfExtents: Object.freeze([0.36, 0.56, 1.02] as const),
  stations: bikeStations,
  tireGrip: 1,
  hybrid: false,
  drs: false,
  setupKeys: Object.freeze(['brakeBias'] as const),
  ai: bikeEnvelope(GP_BIKE, 1.45, 157 + GP_BIKE.riderMass + GP_BIKE.fuel, 99),
  bike: GP_BIKE,
});
/** An original production-based 1000 cc superbike: ~215 hp (160 kW), 200 kg,
 * no wings, quickshifter six-speed, ~300 km/h. Generic design. */
export const SBK_1000: VehicleDefinition = Object.freeze({
  id: 'sbk1000',
  version: 1,
  name: 'SBK-1000 SUPERBIKE',
  classId: 'superbike',
  dynamicsKind: 'bike',
  spec: Object.freeze({
    dryMass: 200 + SUPERBIKE.riderMass,
    wheelRadius: SUPERBIKE.rearWheelRadius,
    wheelInertia: 0.95,
    wheelbase: 1.44,
    track: 0,
    inertia: Object.freeze([70, 62, 28] as const),
    restLength: 0.3,
    linkCentreHeight: 0.3,
    travel: SUPERBIKE.forkTravel,
    maxSteer: SUPERBIKE.maxSteer,
    finalDrive: 2.53,
    gearRatios: Object.freeze([0, 0, 4.55, 3.7, 3.1, 2.7, 2.4, 2.19]),
    idleRPM: 2000,
    shiftRPM: 14300,
    downshiftRPM: 9200,
    limiterRPM: 14800,
    maxBatteryJ: 0,
    motorPowerW: 160000,
    regenPowerW: 0,
    brakeTorque: SUPERBIKE.frontBrake * SUPERBIKE.frontWheelRadius,
    airDensity: 1.225,
    torqueCurve: Object.freeze([
      Object.freeze([3000, 55] as const),
      Object.freeze([6000, 84] as const),
      Object.freeze([9000, 107] as const),
      Object.freeze([11000, 117] as const),
      Object.freeze([13000, 114] as const),
      Object.freeze([14000, 106] as const),
      Object.freeze([14800, 88] as const),
    ]),
  }),
  wheelPositions: wheels(SUPERBIKE),
  drivetrain: 'rwd',
  aero: Object.freeze({ downforce: 0, drag: 1, frontZ: 0.55, rearZ: -0.55 }),
  halfExtents: Object.freeze([0.38, 0.58, 1.04] as const),
  stations: bikeStations,
  tireGrip: 1,
  hybrid: false,
  drs: false,
  setupKeys: Object.freeze(['brakeBias'] as const),
  ai: bikeEnvelope(SUPERBIKE, 1.44, 200 + SUPERBIKE.riderMass + SUPERBIKE.fuel, 87),
  bike: SUPERBIKE,
});
/** Registered with the vehicle registry (vehicles.ts spreads this). */
export const BIKE_VEHICLES: Readonly<Record<string, VehicleDefinition>> = Object.freeze({
  gpr1: GP_R1,
  sbk1000: SBK_1000,
});
/** A road motorcycle definition from its bike block and power-unit sheet
 * (the same layout as GP-R1 and SBK-1000 above). */
function roadBike(sheet: {
  id: string;
  name: string;
  classId: VehicleDefinition['classId'];
  bike: BikeSpec;
  machineMass: number;
  wheelInertia: number;
  inertia: readonly [number, number, number];
  finalDrive: number;
  gearRatios: readonly number[];
  idleRPM: number;
  shiftRPM: number;
  downshiftRPM: number;
  limiterRPM: number;
  powerW: number;
  torqueCurve: readonly (readonly [number, number])[];
  halfExtents: readonly [number, number, number];
  topSpeed: number;
  aiMargins?: Parameters<typeof bikeEnvelope>[4];
}): VehicleDefinition {
  const b = sheet.bike,
    wheelbase = b.cgToFront + b.cgToRear,
    mass = sheet.machineMass + b.riderMass;
  return Object.freeze({
    id: sheet.id,
    version: 1,
    name: sheet.name,
    classId: sheet.classId,
    dynamicsKind: 'bike' as const,
    spec: Object.freeze({
      dryMass: mass,
      wheelRadius: b.rearWheelRadius,
      wheelInertia: sheet.wheelInertia,
      wheelbase,
      track: 0,
      inertia: Object.freeze([...sheet.inertia] as const),
      restLength: 0.3,
      linkCentreHeight: 0.3,
      travel: b.forkTravel,
      maxSteer: b.maxSteer,
      finalDrive: sheet.finalDrive,
      gearRatios: Object.freeze([...sheet.gearRatios]),
      idleRPM: sheet.idleRPM,
      shiftRPM: sheet.shiftRPM,
      downshiftRPM: sheet.downshiftRPM,
      limiterRPM: sheet.limiterRPM,
      maxBatteryJ: 0,
      motorPowerW: sheet.powerW,
      regenPowerW: 0,
      brakeTorque: b.frontBrake * b.frontWheelRadius,
      airDensity: 1.225,
      torqueCurve: Object.freeze(
        sheet.torqueCurve.map((p) => Object.freeze([p[0], p[1]] as const)),
      ),
    }),
    wheelPositions: wheels(b),
    drivetrain: 'rwd' as const,
    aero: Object.freeze({ downforce: 0, drag: 1, frontZ: 0.55, rearZ: -0.55 }),
    halfExtents: Object.freeze([...sheet.halfExtents] as const),
    stations: bikeStations,
    tireGrip: 1,
    hybrid: false,
    drs: false,
    setupKeys: Object.freeze(['brakeBias'] as const),
    ai: bikeEnvelope(b, wheelbase, mass + b.fuel, sheet.topSpeed, sheet.aiMargins),
    bike: b,
  });
}
/** A second prototype-class bike: an inline-four "screamer" with a ducted,
 * ground-effect lower fairing and box wings instead of GP-R1's V4 and
 * stacked wings. The trade against GP-R1: its mass sits further back, so it
 * stands on its nose later and brakes shorter but lifts the front sooner;
 * with the weaker bottom end and the draggier fairing it gives away launch
 * and top speed. Generic design. */
export const GP_R2: VehicleDefinition = roadBike({
  id: 'gpr2',
  name: 'GP-R2 PROTOTYPE',
  classId: 'gp-bike',
  bike: Object.freeze({
    ...GP_BIKE,
    cgHeight: 0.61,
    cgToFront: 0.72,
    cgToRear: 0.73,
    maxLean: 1.13,
    frontBrake: 7700,
    drag: 0.25,
    tuckDrag: 0.09,
    downforce: 0.062,
    downforceFront: 0.7,
    launchRPM: 9000,
    wheelieLimit: 0.09,
  }),
  machineMass: 157,
  wheelInertia: 0.9,
  inertia: [61, 54, 24],
  finalDrive: 2.6,
  gearRatios: [0, 0, 4.6, 3.8, 3.2, 2.82, 2.53, 2.34],
  idleRPM: 4300,
  shiftRPM: 18000,
  downshiftRPM: 11800,
  limiterRPM: 18500,
  powerW: 216000,
  torqueCurve: [
    [4000, 46],
    [8000, 76],
    [11000, 98],
    [14000, 116],
    [16500, 124],
    [17800, 117],
    [18500, 100],
  ],
  halfExtents: [0.37, 0.56, 1.02],
  topSpeed: 96,
});
/** An original 600 cc four-cylinder supersport: about 95 kW at 14 500 rpm,
 * 175 kg, road-legal racing tyres, quickshifter six-speed. Generic design. */
export const SS_600: VehicleDefinition = roadBike({
  id: 'ss600',
  name: 'SS-600 SUPERSPORT',
  classId: 'supersport',
  bike: Object.freeze({
    ...SUPERBIKE,
    fuel: 13,
    cgHeight: 0.6,
    cgToFront: 0.66,
    cgToRear: 0.71,
    frontWheelRadius: 0.3,
    rearWheelRadius: 0.315,
    crownRadius: 0.08,
    steerRate: 2.3,
    maxLean: 1.05,
    mu: 1.55,
    frontBrake: 6200,
    rearBrake: 1500,
    drag: 0.215,
    tuckDrag: 0.09,
    launchRPM: 9000,
    wheelieLimit: 0.12,
    forkRate: 26000,
    shockRate: 32000,
    crashEnergy: 2600,
  }),
  machineMass: 175,
  wheelInertia: 0.8,
  inertia: [60, 52, 23],
  finalDrive: 2.85,
  gearRatios: [0, 0, 5.2, 4.1, 3.45, 3.0, 2.7, 2.48],
  idleRPM: 1800,
  shiftRPM: 15600,
  downshiftRPM: 10000,
  limiterRPM: 16000,
  powerW: 95000,
  torqueCurve: [
    [4000, 30],
    [8000, 46],
    [11000, 58],
    [13000, 63],
    [14500, 62.5],
    [15500, 57],
    [16000, 52],
  ],
  halfExtents: [0.35, 0.56, 1.0],
  topSpeed: 74,
});
/** An original 890 cc three-cylinder naked roadster for the open world:
 * about 88 kW, upright riding position, no fairing, road tyres. Generic. */
export const NR_900: VehicleDefinition = roadBike({
  id: 'nr900',
  name: 'NR-900 NAKED ROADSTER',
  classId: 'road-bike',
  bike: Object.freeze({
    ...SUPERBIKE,
    riderMass: 75,
    fuel: 11,
    cgHeight: 0.66,
    cgToFront: 0.68,
    cgToRear: 0.75,
    frontWheelRadius: 0.3,
    rearWheelRadius: 0.315,
    crownRadius: 0.085,
    maxSteer: 0.62,
    steerRate: 2.6,
    maxLean: 0.96,
    mu: 1.3,
    frontBrake: 5600,
    rearBrake: 1500,
    drag: 0.3,
    tuckDrag: 0.04,
    rolling: 0.017,
    riderOffsetMax: 0.2,
    drivelineEfficiency: 0.9,
    shiftCut: 0.04,
    launchRPM: 6500,
    wheelieLimit: 0.14,
    stoppieMargin: 0.88,
    forkTravel: 0.13,
    forkRate: 22000,
    shockTravel: 0.13,
    shockRate: 28000,
    crashEnergy: 2400,
  }),
  machineMass: 182,
  wheelInertia: 0.85,
  inertia: [66, 58, 26],
  finalDrive: 2.9,
  gearRatios: [0, 0, 4.4, 3.4, 2.8, 2.4, 2.15, 1.97],
  idleRPM: 1300,
  shiftRPM: 10600,
  downshiftRPM: 6000,
  limiterRPM: 11000,
  powerW: 88000,
  torqueCurve: [
    [2000, 55],
    [4000, 78],
    [7000, 93],
    [9000, 88],
    [10000, 84],
    [10500, 76],
    [11000, 68],
  ],
  halfExtents: [0.42, 0.58, 1.02],
  topSpeed: 62,
});
/** An original 1970s-style 750 cc two-stroke triple road racer: about 75 kW
 * in a narrow power band, twin-shock frame, drum-era geometry with a single
 * front disc, narrow treaded racing tyres, round-nosed fairing. Generic. */
export const CR_750: VehicleDefinition = roadBike({
  id: 'cr750',
  name: 'CR-750 CLASSIC RACER',
  classId: 'classic-bike',
  bike: Object.freeze({
    ...SUPERBIKE,
    fuel: 18,
    cgHeight: 0.58,
    cgToFront: 0.7,
    cgToRear: 0.72,
    frontWheelRadius: 0.31,
    rearWheelRadius: 0.315,
    crownRadius: 0.065,
    steerRate: 2.0,
    maxLean: 0.9,
    mu: 1.25,
    // Single front disc and a rear drum: brake-limited, not stoppie-limited.
    frontBrake: 1700,
    rearBrake: 650,
    drag: 0.24,
    tuckDrag: 0.1,
    rolling: 0.018,
    riderOffsetMax: 0.2,
    drivelineEfficiency: 0.9,
    shiftCut: 0.09,
    launchRPM: 7500,
    wheelieLimit: 0.15,
    stoppieMargin: 0.86,
    forkRate: 18000,
    shockTravel: 0.09,
    shockRate: 26000,
    crashEnergy: 2200,
  }),
  machineMass: 160,
  wheelInertia: 0.8,
  inertia: [58, 50, 22],
  finalDrive: 2.4,
  gearRatios: [0, 0, 3.4, 2.75, 2.35, 2.1, 1.94],
  idleRPM: 1500,
  shiftRPM: 9600,
  downshiftRPM: 6800,
  limiterRPM: 10000,
  powerW: 75000,
  torqueCurve: [
    [4000, 45],
    [6000, 62],
    [7500, 76],
    [8500, 80],
    [9000, 79],
    [9500, 70],
    [10000, 58],
  ],
  halfExtents: [0.34, 0.55, 1.0],
  topSpeed: 66,
  // Narrow tyres and drum-era brakes: the rider brakes earlier and leans less.
  aiMargins: { lateralMargin: 0.8, slowLateralMargin: 0.74, brakingMargin: 0.66 },
});
/** Bikes registered after the car catalogue (vehicles.ts appends them, so
 * existing snapshot indices are unchanged). Append only. */
export const BIKE_ADDITIONS: Readonly<Record<string, VehicleDefinition>> = Object.freeze({
  gpr2: GP_R2,
  ss600: SS_600,
  nr900: NR_900,
  cr750: CR_750,
});
/** Content contract for the bike family (WP14 style: unit-checked, each
 * failure names what and where). Four-wheel rules (track, four distinct hubs,
 * reverse gear) do not apply; two contact patches and the bike block do. */
export function validateBikeDefinition(def: VehicleDefinition): string[] {
  const e: string[] = [],
    at = `vehicle ${def.id}`,
    s = def.spec,
    b = def.bike;
  const inRange = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!/^[a-z0-9-]{2,32}$/.test(def.id)) e.push(`${at}: id must be 2-32 lowercase characters`);
  if (!Number.isInteger(def.version) || def.version < 1) e.push(`${at}: version must be >= 1`);
  if (!b) return [...e, `${at}: a 'bike' dynamics kind needs its bike block`];
  if (!inRange(s.dryMass, 80, 450))
    e.push(`${at}: dryMass ${s.dryMass} kg (with rider) outside 80-450`);
  if (!inRange(b.riderMass, 40, 120) || s.dryMass - b.riderMass < 60)
    e.push(`${at}: riderMass must be 40-120 kg and leave a plausible machine mass`);
  if (!inRange(s.wheelbase, 1.1, 1.8)) e.push(`${at}: wheelbase outside 1.1-1.8 m`);
  if (Math.abs(b.cgToFront + b.cgToRear - s.wheelbase) > 0.01)
    e.push(`${at}: cgToFront + cgToRear must equal the wheelbase`);
  if (!inRange(b.cgHeight, 0.35, 0.9)) e.push(`${at}: cgHeight outside 0.35-0.9 m`);
  if (!inRange(b.maxLean, 0.6, 1.2)) e.push(`${at}: maxLean outside 0.6-1.2 rad`);
  if (!inRange(b.mu, 0.8, 2)) e.push(`${at}: tyre mu outside 0.8-2`);
  if (!inRange(b.crownRadius, 0.03, 0.12) || !(b.crownRadius < b.frontWheelRadius))
    e.push(`${at}: tyre crown radius must be 0.03-0.12 m and inside the wheel`);
  if (def.wheelPositions.length !== 4) e.push(`${at}: wheel slots 0/1 front, 2/3 rear required`);
  else {
    const [f1, f2, r1, r2] = def.wheelPositions;
    if (!(f1[2] === f2[2] && r1[2] === r2[2] && f1[2] > r1[2]))
      e.push(`${at}: two contact patches, front ahead of rear (+Z)`);
    if (Math.abs(f1[2] - r1[2] - s.wheelbase) > 0.01)
      e.push(`${at}: wheel positions disagree with the wheelbase`);
  }
  const g = s.gearRatios;
  if (g.length < 4 || g[0] !== 0 || g[1] !== 0)
    e.push(`${at}: bike gearRatios are [0, 0, first...]`);
  for (let i = 3; i < g.length; i++)
    if (!(g[i] > 0 && g[i] < g[i - 1])) e.push(`${at}: gear ${i - 1} must be taller than ${i - 2}`);
  if (!(s.idleRPM < s.downshiftRPM && s.downshiftRPM < s.shiftRPM && s.shiftRPM <= s.limiterRPM))
    e.push(`${at}: require idle < downshift < shift <= limiter RPM`);
  if (s.torqueCurve.some(([, t], i, c) => !(t > 0) || (i > 0 && !(c[i][0] > c[i - 1][0]))))
    e.push(`${at}: torque curve must be positive with increasing rpm`);
  if (def.hybrid || def.drs) e.push(`${at}: motorcycles carry no hybrid or DRS`);
  if (!def.halfExtents.every((v) => inRange(v, 0.1, 1.5)) || def.halfExtents[0] > 0.6)
    e.push(`${at}: slim collision box needs half extents 0.1-1.5 m, width <= 0.6 m`);
  if (!inRange(b.frontBrake, 500, 20000) || !inRange(b.rearBrake, 100, 8000))
    e.push(`${at}: brake forces outside plausible bounds`);
  if (!(b.downforce >= 0 && b.downforceFront >= 0 && b.downforceFront <= 1))
    e.push(`${at}: wing downforce must be >= 0 with a 0-1 front share`);
  if (!inRange(b.forkTravel, 0.05, 0.3) || !inRange(b.shockTravel, 0.05, 0.3))
    e.push(`${at}: suspension travel outside 0.05-0.3 m`);
  const ai = def.ai;
  if (!(ai.lateralBase > 0 && ai.brakingBase > 0 && ai.topSpeed > 0 && ai.downforceReference > 0))
    e.push(`${at}: AI envelope needs positive limits and a mass reference`);
  return e;
}
