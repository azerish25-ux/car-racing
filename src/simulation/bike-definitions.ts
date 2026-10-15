import { clamp, G } from '../core/math.ts';
import type { BikeParameters } from './bike.ts';
import type { CapabilityEnvelope, VehicleDefinition } from './vehicles.ts';

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
    Pick<BikeSpec, 'downforce' | 'downforceFront' | 'crownRadius' | 'riderOffsetMax'>,
  wheelbase: number,
  mass: number,
  topSpeed: number,
): CapabilityEnvelope {
  const gain = (spec.riderOffsetMax * 0.25) / spec.cgHeight;
  const lean = Math.min(
    dynamicLean(spec.maxLean, spec),
    Math.atan(Math.max(0.2, 0.72 * spec.mu - gain)),
  );
  const lateralBase = G * Math.min(Math.tan(lean) + gain / Math.cos(lean), 0.8 * spec.mu);
  const brakingBase = ((G * spec.cgToFront) / spec.cgHeight) * spec.stoppieMargin;
  const rearWing = spec.downforce * (1 - spec.downforceFront);
  const brakingAero =
    (spec.drag + (spec.stoppieMargin * rearWing * wheelbase) / spec.cgHeight) / mass;
  return Object.freeze({
    lateralBase: Math.round(lateralBase * 100) / 100,
    lateralAero: 0,
    brakingBase: Math.round(brakingBase * 100) / 100,
    brakingAero: Math.round(brakingAero * 1e6) / 1e6,
    lateralMargin: 0.86,
    slowLateralMargin: 0.8,
    brakingMargin: 0.78,
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
