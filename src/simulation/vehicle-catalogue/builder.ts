import { G } from '../../core/math.ts';
import { sampleAeroMap } from '../aero-map.ts';
import { LEGACY_ENGINE, type TurboDefinition } from '../powertrain.ts';
import type { Setup } from '../config.ts';
import type { DrivelineSpec } from '../differential.ts';
import { TIRE_FAMILIES, type TireFamilyId } from '../tire-families.ts';
import type {
  CapabilityEnvelope,
  Drivetrain,
  EngineSpec,
  VehicleClass,
  VehicleDefinition,
} from '../vehicles.ts';

/** Catalogue authoring (WP17/WP30, masterplan §10). A vehicle is written as a
 * physical target sheet — mass, weight distribution, centre-of-gravity height,
 * dimensions, power unit, gearing, brakes, aero coefficients and balance, tyre
 * family — and this builder derives the solver's VehicleDefinition from it
 * (wheel centres, placement height, floor stations, inertia, aero map scales
 * and application points). The derivation is deterministic, so the content
 * hash of a definition changes exactly when its sheet does.
 *
 * Nothing here may import config.ts at runtime (config.ts imports the vehicle
 * registry); the few shared baselines below are pinned to DEFAULT_SETUP by
 * tests/vehicle-catalogue.test.ts. */
export const BASELINE = Object.freeze({
  fuel: 24,
  frontSpring: 115000,
  rearSpring: 125000,
  frontRide: 0.065,
  rearRide: 0.075,
  frontWing: 0.55,
  rearWing: 0.58,
  /** Formula floor map at its static clearance gives ClA per unit scale. */
  airDensity: 1.225,
});
/** Design-brief target bands checked by scripts/vehicle-calibration.ts. */
export interface DesignBands {
  accel0to100: readonly [number, number];
  topSpeed: readonly [number, number];
  braking100Distance: readonly [number, number];
  lateral80G: readonly [number, number];
}
export interface CatalogueSheet {
  id: string;
  version?: number;
  name: string;
  classId: VehicleClass;
  /** One-paragraph design brief (skill, strengths, weaknesses, role). */
  brief: string;
  /** Mass with driver, without fuel (kg). */
  mass: number;
  /** Static front-axle share of weight (0-1). */
  frontWeight: number;
  /** Centre-of-gravity height above the road at rest (m). */
  cogHeight: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  /** Body envelope (m): overall width, height and the overhangs beyond the axles. */
  width: number;
  height: number;
  overhangFront: number;
  overhangRear: number;
  /** Floor height above the road at rest (m). */
  groundClearance: number;
  wheelRadius: number;
  wheelInertia: number;
  restLength?: number;
  /** Roll/pitch centre height above the patch where tread forces enter (m). */
  linkCentreHeight: number;
  maxSteer: number;
  /** Override [pitch, yaw, roll] inertia (kg m²); otherwise derived. */
  inertia?: readonly [number, number, number];
  finalDrive: number;
  gearRatios: readonly number[];
  idleRPM: number;
  shiftRPM: number;
  downshiftRPM: number;
  limiterRPM: number;
  /** Net brake torque (N m) by RPM, as a power-unit sheet quotes it. The
   * builder adds the solver's engine friction so the delivered torque matches. */
  torqueCurve: readonly (readonly [number, number])[];
  engine: EngineSpec;
  /** Turbocharger response (powertrain.ts): boost builds over `spoolTime`
   * after the throttle opens and dumps on a lift, so the boost share of the
   * full-load curve arrives late out of a corner. Absent: instant response.
   * With `spoolRPM` below the working range the steady full-load curve above
   * it is unchanged; the lag is the transient. */
  turbo?: TurboDefinition;
  hybrid?: {
    motorPowerW: number;
    regenPowerW: number;
    batteryJ: number;
    /** Front-axle motor deploying above a road speed (m/s). */
    frontAxleAbove?: number;
  };
  /** Total brake torque at full pedal, all four wheels (N m). */
  brakeTorque: number;
  /** Aero coefficients at rest ride height with the baseline wing setting:
   * lift area ClA (m², downforce positive), drag area CdA (m²) and the front
   * axle's share of downforce. */
  aero: { clA: number; cdA: number; balance: number };
  tireFamily: TireFamilyId;
  tireGrip: number;
  /** Rear/front grip ratio of a staggered fitment (wider rears); 1 = square.
   * Load-proportional cornering stiffness makes a rear-heavy car oversteer
   * on a square fitment, exactly as wider rear tyres exist to prevent. */
  rearGrip?: number;
  drivetrain: Drivetrain;
  driveline: DrivelineSpec;
  drs?: boolean;
  powertrain?: VehicleDefinition['powertrain'];
  setupKeys: readonly (keyof Setup)[];
  setupDefaults?: Partial<Setup>;
  setupLimits?: Partial<Record<keyof Setup, readonly [number, number]>>;
  /** Sprint fuel load (kg); absent: the shared 24 kg. */
  fuelLoad?: number;
  /** Detachable front/rear element masses (kg): wings, splitters, bumpers. */
  elementMass?: readonly [number, number];
  /** Fan-assisted floor: suction (N) at the static clearance, acting at a
   * station (m, +Z nose; absent: the centre of mass). */
  fan?: { force: number; z?: number };
  /** AI envelope measured by scripts/vehicle-calibration.ts (m/s², m/s). */
  ai: Omit<CapabilityEnvelope, 'referenceMu' | 'downforceReference'>;
  bands: DesignBands;
}
export interface CatalogueEntry {
  definition: VehicleDefinition;
  bands: DesignBands;
  brief: string;
}
const round = (x: number, digits = 4) => Number(x.toFixed(digits));
/** Friction torque the solver subtracts at `rpm` (vehicle.ts). */
export const engineFriction = (engine: EngineSpec, rpm: number) =>
  engine.frictionBase + ((rpm * Math.PI) / 30) * engine.frictionPerRad;
const tuple = <T extends readonly unknown[]>(v: T) => Object.freeze(v) as T;
/** Value of a setup key for the car's static solve: its baseline (setupFor
 * applies it to an exposed key the player left at the shared default). */
function effective(sheet: CatalogueSheet, key: keyof typeof BASELINE & keyof Setup) {
  const limit = sheet.setupLimits?.[key];
  const value = sheet.setupDefaults?.[key] ?? BASELINE[key];
  return limit ? Math.max(limit[0], Math.min(limit[1], value)) : value;
}
/** Aero map scales and application points reproducing ClA, CdA and balance at
 * the static floor clearance (the solver's shared map, aero.ts). */
export function aeroScales(sheet: CatalogueSheet, frontAxle: number, rearAxle: number) {
  const fw = effective(sheet, 'frontWing'),
    rw = effective(sheet, 'rearWing'),
    h = sheet.groundClearance,
    map = sampleAeroMap(h, h, 0, { front: 0, rear: 0, floor: 0, drag: 0 }),
    cf = map.front * (0.85 + fw * 0.8),
    cr = map.rear * (1.05 + rw * 0.9),
    cfl = map.floor * 2.25,
    sum = cf + cr + cfl,
    L = sheet.wheelbase,
    { clA, cdA, balance } = sheet.aero;
  const drag = cdA / (1.3 * map.drag * (0.76 + fw * 0.14 + rw * 0.23));
  if (!(clA > 0)) return { downforce: 0, drag, frontZ: frontAxle, rearZ: rearAxle };
  const target = balance * sum * L;
  // Rear force at the rear axle; place the front force for the balance, then
  // move the rear force if the front point would leave the bodywork.
  let frontZ = rearAxle + (target + cfl * rearAxle) / cf;
  frontZ = Math.max(rearAxle + 0.2, Math.min(frontAxle + sheet.overhangFront, frontZ));
  let rearZ = rearAxle + (target - cf * (frontZ - rearAxle) + cfl * rearAxle) / cr;
  rearZ = Math.max(rearAxle - sheet.overhangRear, Math.min(frontAxle, rearZ));
  return { downforce: clA / (1.3 * sum), drag, frontZ, rearZ };
}
export function defineVehicle(sheet: CatalogueSheet): CatalogueEntry {
  const L = sheet.wheelbase,
    frontAxle = (1 - sheet.frontWeight) * L,
    rearAxle = -sheet.frontWeight * L,
    restLength = sheet.restLength ?? 0.25,
    fuel = sheet.fuelLoad ?? BASELINE.fuel,
    loaded = (sheet.mass + fuel) * G,
    frontSag = (loaded * sheet.frontWeight * 0.5) / effective(sheet, 'frontSpring'),
    rearSag = (loaded * (1 - sheet.frontWeight) * 0.5) / effective(sheet, 'rearSpring'),
    frontRest = restLength + effective(sheet, 'frontRide') - BASELINE.frontRide,
    rearRest = restLength + effective(sheet, 'rearRide') - BASELINE.rearRide,
    // Body origin (CG) at cogHeight: hub = origin - length, patch = hub - radius.
    frontY = round(frontRest - frontSag + sheet.wheelRadius - sheet.cogHeight),
    rearY = round(rearRest - rearSag + sheet.wheelRadius - sheet.cogHeight),
    frontExtent = frontAxle + sheet.overhangFront,
    rearExtent = -rearAxle + sheet.overhangRear,
    length = frontExtent + rearExtent,
    yaw = (0.8 * sheet.mass * (length * length + sheet.width * sheet.width)) / 12,
    inertia = sheet.inertia ?? [round(yaw * 0.35, 0), round(yaw, 0), round(yaw * 0.9, 0)],
    aero = aeroScales(sheet, frontAxle, rearAxle),
    family = TIRE_FAMILIES[sheet.tireFamily],
    [frontMass, rearMass] = sheet.elementMass ?? [3.5, 4],
    hybrid = sheet.hybrid;
  // The AI normalizes contact grip by the Formula slick (as for TC-1), so a
  // lower-grip family also drives with proportionally more reserve; catalogue
  // machines keep 15% further from the edges and use a shorter steering
  // preview (pure pursuit loses accuracy with the square of its preview, and
  // heavier, wider cars need the tighter tracking; measured in AI races).
  const ai: CapabilityEnvelope = Object.freeze({
    lineScale: 0.85,
    lookahead: Object.freeze([5, 0.38] as const),
    ...sheet.ai,
    ...(sheet.ai.fanBase ? { fanBase: Object.freeze({ ...sheet.ai.fanBase }) } : {}),
    referenceMu: 1.82,
    downforceReference:
      sheet.ai.lateralAero > 0 || sheet.ai.brakingAero > 0 ? sheet.mass + fuel : 0,
  });
  const definition: VehicleDefinition = Object.freeze({
    id: sheet.id,
    version: sheet.version ?? 1,
    name: sheet.name,
    classId: sheet.classId,
    dynamicsKind: 'four-wheel' as const,
    spec: Object.freeze({
      dryMass: sheet.mass,
      wheelRadius: sheet.wheelRadius,
      wheelInertia: sheet.wheelInertia,
      wheelbase: L,
      track: sheet.trackFront,
      inertia: tuple(inertia),
      restLength,
      linkCentreHeight: sheet.linkCentreHeight,
      travel: 0.17,
      maxSteer: sheet.maxSteer,
      finalDrive: sheet.finalDrive,
      gearRatios: tuple(sheet.gearRatios),
      idleRPM: sheet.idleRPM,
      shiftRPM: sheet.shiftRPM,
      downshiftRPM: sheet.downshiftRPM,
      limiterRPM: sheet.limiterRPM,
      maxBatteryJ: hybrid?.batteryJ ?? 0,
      motorPowerW: hybrid?.motorPowerW ?? 0,
      regenPowerW: hybrid?.regenPowerW ?? 0,
      brakeTorque: sheet.brakeTorque,
      airDensity: BASELINE.airDensity,
      torqueCurve: tuple(
        sheet.torqueCurve.map(([rpm, net]) =>
          tuple([rpm, round(net + engineFriction(sheet.engine, rpm), 1)] as const),
        ),
      ),
      engine: Object.freeze({ ...sheet.engine }),
    }),
    wheelPositions: tuple([
      tuple([-sheet.trackFront / 2, frontY, round(frontAxle)] as const),
      tuple([sheet.trackFront / 2, frontY, round(frontAxle)] as const),
      tuple([-sheet.trackRear / 2, rearY, round(rearAxle)] as const),
      tuple([sheet.trackRear / 2, rearY, round(rearAxle)] as const),
    ]),
    drivetrain: sheet.drivetrain,
    aero: Object.freeze({
      downforce: round(aero.downforce),
      drag: round(aero.drag),
      frontZ: round(aero.frontZ, 3),
      rearZ: round(aero.rearZ, 3),
    }),
    halfExtents: tuple([
      round(sheet.width / 2, 3),
      round(sheet.height * 0.4, 3),
      round(Math.max(frontExtent, rearExtent), 3),
    ] as const),
    stations: Object.freeze({
      floorY: round(sheet.groundClearance - sheet.cogHeight, 3),
      damageZ: round(Math.min(frontExtent, rearExtent) * 0.55, 3),
      frontElement: tuple([round(frontExtent - 0.12, 3), frontMass] as const),
      rearElement: tuple([round(-(rearExtent - 0.2), 3), rearMass] as const),
      jackZ: tuple([round(rearAxle * 0.85, 3), round(frontAxle * 0.85, 3)] as const),
      jackX: round(sheet.width * 0.24, 3),
      skid: tuple([
        round(sheet.width * 0.3, 3),
        round(frontAxle * 0.8, 3),
        round(rearAxle * 0.8, 3),
      ] as const),
    }),
    tireGrip: sheet.tireGrip,
    ...(sheet.rearGrip !== undefined && sheet.rearGrip !== 1
      ? { tireGripRear: round(sheet.tireGrip * sheet.rearGrip, 4) }
      : {}),
    hybrid: !!hybrid,
    drs: !!sheet.drs,
    setupKeys: tuple([...sheet.setupKeys]),
    ai,
    driveline: Object.freeze({ ...sheet.driveline }),
    ...(hybrid?.frontAxleAbove !== undefined
      ? { hybridAxle: Object.freeze({ axle: 'front' as const, minSpeed: hybrid.frontAxleAbove }) }
      : {}),
    tireFamily: family.id,
    restHeight: round(sheet.cogHeight + 0.01, 3),
    ...(sheet.fuelLoad !== undefined ? { fuelLoad: sheet.fuelLoad } : {}),
    ...(sheet.setupDefaults ? { setupDefaults: Object.freeze({ ...sheet.setupDefaults }) } : {}),
    ...(sheet.setupLimits
      ? {
          setupLimits: Object.freeze(
            Object.fromEntries(
              Object.entries(sheet.setupLimits).map(([k, v]) => [k, tuple([v[0], v[1]] as const)]),
            ),
          ),
        }
      : {}),
    powertrain: sheet.powertrain ?? (hybrid ? 'hybrid' : 'combustion'),
    // Turbo lag on the catalogue's legacy engine block (instant intake,
    // linear part load): the only engine-response change a sheet can make.
    ...(sheet.turbo
      ? {
          dynamics: Object.freeze({
            engine: Object.freeze({
              ...LEGACY_ENGINE,
              turbo: Object.freeze({
                ...sheet.turbo,
                spoolRPM: tuple([sheet.turbo.spoolRPM[0], sheet.turbo.spoolRPM[1]] as const),
              }),
            }),
          }),
        }
      : {}),
    // Skirts seal up to 12 mm above the static floor and lose suction over
    // the next 50 mm (a crest, kerb or rake change breaks the seal).
    ...(sheet.fan
      ? {
          fan: Object.freeze({
            force: sheet.fan.force,
            sealHeight: round(sheet.groundClearance + 0.012, 3),
            fade: 0.05,
            z: round(sheet.fan.z ?? 0, 3),
          }),
        }
      : {}),
  });
  return Object.freeze({
    definition,
    bands: Object.freeze({ ...sheet.bands }),
    brief: sheet.brief,
  });
}
/** Registry fragments keyed by id, preserving authoring order. */
export function catalogue(entries: readonly CatalogueEntry[]) {
  const definitions: Record<string, VehicleDefinition> = {},
    bands: Record<string, DesignBands> = {},
    briefs: Record<string, string> = {};
  for (const e of entries) {
    if (Object.hasOwn(definitions, e.definition.id))
      throw new Error(`Duplicate catalogue vehicle ${e.definition.id}`);
    definitions[e.definition.id] = e.definition;
    bands[e.definition.id] = e.bands;
    briefs[e.definition.id] = e.brief;
  }
  return {
    definitions: Object.freeze(definitions),
    bands: Object.freeze(bands),
    briefs: Object.freeze(briefs),
  };
}
