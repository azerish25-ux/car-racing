import { clamp, G, smooth } from '../core/math.ts';
import { COMPOUNDS, VEHICLE, type Compound } from './config.ts';
import { SURFACE, type SurfaceSample } from './track.ts';
import { updateContamination } from './contamination.ts';
import {
  advanceSinkage,
  groundDrag,
  materialGrip,
  rollingCoefficient,
  sinkageTarget,
  surfaceMaterial,
} from './surface-material.ts';
import {
  camberGrip,
  camberShift,
  carcassStiffness,
  combinedForces,
  FORMULA_SLICK,
  longitudinalForce,
  prepareSlip,
  pressureGrip,
  relaxationLength,
  relaxSlip,
  slipState,
  type TyreConstruction,
} from './tyre-force.ts';
import { advanceTyreTemperatures, hotPressure, type ThermalInputs } from './tyre-thermal.ts';
export interface Tire {
  compound: Compound;
  omega: number;
  rotation: number;
  load: number;
  fx: number;
  fy: number;
  slip: number;
  /** Steady-state slip angle of the contact velocity (rad). */
  angle: number;
  surfaceTemp: number;
  carcassTemp: number;
  /** Inflation gas / inner liner temperature: sets the hot pressure (°C). */
  coreTemp: number;
  pressure: number;
  coldPressure: number;
  wear: number;
  dirt: number;
  marblePickup: number;
  flatSpot: number;
  blistering: number;
  graining: number;
  punctured: boolean;
  /** Geometric wheel travel (m, + bump: suspension and tyre deflection) and
   * the wheel-centre distance below its chassis station (m). */
  compression: number;
  length: number;
  discTemp: number;
  water: number;
  surface: number;
  energy: number;
  radius: number;
  /** Unworn rolling radius and wheel inertia of the vehicle it is fitted to. */
  nominalRadius: number;
  inertia: number;
  /** Tyre-family grip relative to the Formula slick construction (1). */
  gripScale: number;
  /** Share of loose-surface (grass/gravel) grip loss the construction
   * recovers (tire-families.ts); absent or 0 for racing slicks. */
  looseGrip?: number;
  /** Carcass construction: slip stiffness, camber, relaxation, pressure laws. */
  construction: TyreConstruction;
  /** Relaxed (lagged) slip angle entering the force law (rad). */
  relaxedAngle: number;
  /** Road-relative inclination used by the force law (rad, + toward +lateral). */
  inclination: number;
  /** Radial deflection of the carcass (m) and contact-patch length (m). */
  deflection: number;
  patchLength: number;
  /** Ground sinkage (m) on deformable materials. */
  sinkage: number;
  /** Rolling-resistance coefficient and ground drag (N) of this step. */
  rolling: number;
  groundDrag: number;
  /** Fraction of the contact lost to the water film (0 dry … 1 planing). */
  aquaplane: number;
  /** Slip ratio at the force peak for the present load, grip and ground. */
  peakSlip: number;
  /** Combined friction-ellipse utilization (0 free … 1 sliding at the limit). */
  usage: number;
}
/** Peak slip ratio of the Formula slick at nominal load on dry asphalt: the
 * reference for slip thresholds expressed in the former fixed-slip units. */
export const REFERENCE_PEAK_SLIP = 0.25;
/** Scale for a slip threshold calibrated at REFERENCE_PEAK_SLIP. */
export function slipScale(t: Pick<Tire, 'peakSlip'>) {
  return clamp(t.peakSlip / REFERENCE_PEAK_SLIP, 0.35, 1.6);
}
/** Grooved tread depth (mm) when new; slicks have none. */
export const TREAD_DEPTH_MM: Record<Compound, number> = {
  soft: 0,
  medium: 0,
  hard: 0,
  intermediate: 2.5,
  wet: 4,
};
/** Weight of the tread-surface temperature in the grip window; the bulk
 * (carcass) temperature sets the rest of the rubber's viscoelastic state. */
export const GRIP_SURFACE_WEIGHT = 0.3;
export function makeTire(
  compound: Compound,
  pressure = 155,
  nominalRadius: number = VEHICLE.wheelRadius,
  inertia: number = VEHICLE.wheelInertia,
  gripScale = 1,
  looseGrip = 0,
  construction: TyreConstruction = FORMULA_SLICK,
): Tire {
  const temp = COMPOUNDS[compound].ideal - 5;
  return {
    compound,
    omega: 0,
    rotation: 0,
    load: 0,
    fx: 0,
    fy: 0,
    slip: 0,
    angle: 0,
    surfaceTemp: temp,
    carcassTemp: temp,
    coreTemp: temp,
    pressure,
    coldPressure: pressure,
    wear: 0,
    dirt: 0,
    marblePickup: 0,
    flatSpot: 0,
    blistering: 0,
    graining: 0,
    punctured: false,
    compression: 0,
    length: 0.25,
    discTemp: 320,
    water: 0,
    surface: 0,
    energy: 0,
    radius: nominalRadius,
    nominalRadius,
    inertia,
    gripScale,
    construction,
    relaxedAngle: 0,
    inclination: 0,
    deflection: 0,
    patchLength: 0.14,
    sinkage: 0,
    rolling: 0.015,
    groundDrag: 0,
    aquaplane: 0,
    peakSlip: REFERENCE_PEAK_SLIP,
    usage: 0,
    ...(looseGrip > 0 ? { looseGrip } : {}),
  };
}
/** Surface friction this tyre sees: loose-surface constructions keep part of
 * the grip grass and gravel remove from a slick. */
function surfaceGrip(t: Tire, s: SurfaceSample) {
  const loose = t.looseGrip;
  if (!loose || (s.surface !== SURFACE.GRASS && s.surface !== SURFACE.GRAVEL)) return s.grip;
  return s.grip + (1 - s.grip) * loose;
}
export function magic(x: number, stiffness: number, shape = 1.35, curvature = 0.15) {
  const bx = stiffness * x;
  return Math.sin(shape * Math.atan(bx - curvature * (bx - Math.atan(bx))));
}
export function temperatureGrip(compound: Compound, temp: number) {
  const d = temp - COMPOUNDS[compound].ideal;
  return 1 - (d < 0 ? 0.35 : 0.48) * (1 - Math.exp(-((d / (d < 0 ? 45 : 65)) ** 2)));
}
/** Grip-window temperature: tread surface blended with the bulk. */
export function gripTemperature(t: Pick<Tire, 'surfaceTemp' | 'carcassTemp'>) {
  return GRIP_SURFACE_WEIGHT * t.surfaceTemp + (1 - GRIP_SURFACE_WEIGHT) * t.carcassTemp;
}
/** Smooth load/tread/water coupling, not a random aquaplaning event. The water
 * depth the tread cannot evacuate (compound tolerance scaled by remaining
 * groove depth and road macrotexture) sets the depth window; the onset speed
 * rises with the square roots of contact load and inflation pressure (the
 * classic dynamic-hydroplaning law V ∝ √p). A bounded reduced-grip model, not
 * a hydrodynamic contact-patch solver. */
export function aquaplaning(
  compound: Compound,
  load: number,
  waterMm: number,
  speed: number,
  wear = 0,
  pressure = 160,
  textureMm = 0.8,
) {
  if (load <= 0 || waterMm <= 0) return 0;
  const grooves = TREAD_DEPTH_MM[compound] > 0 ? 1 - 0.55 * clamp(wear, 0, 1) : 1,
    drainage = grooves * clamp(0.75 + 0.3125 * textureMm, 0.6, 1.25),
    tolerance = COMPOUNDS[compound].waterTolerance * drainage;
  const onset = Math.sqrt(clamp(load / 2200, 0.25, 4)) * Math.sqrt(clamp(pressure / 160, 0.5, 1.6));
  return (
    smooth(tolerance * 0.7, tolerance * 3 + drainage, waterMm) *
    smooth(24 * onset, 95 * onset, Math.abs(speed))
  );
}
/** Peak friction coefficient μ (excluding camber, which needs the slip
 * direction). Load sensitivity, grip window, water film, aquaplaning, wear,
 * contamination, damage, pressure, rubber/marbles and the ground material. */
export function peakGrip(t: Tire, load: number, s: SurfaceSample, speed: number) {
  const c = COMPOUNDS[t.compound],
    k = t.construction,
    m = surfaceMaterial(s.surface),
    loadRatio = Math.max(load, 100) / k.nominalLoad,
    wetRatio = s.water / (s.water + c.waterTolerance),
    wetPenalty =
      (t.compound === 'wet' ? 0.1 : t.compound === 'intermediate' ? 0.22 : 0.63) * wetRatio,
    hydro = aquaplaning(t.compound, load, s.water, speed, t.wear, t.pressure, m.textureMm),
    ground = materialGrip(m, s.water, s.temp) / m.grip;
  return (
    c.mu *
    t.gripScale *
    loadRatio ** -k.loadSensitivity *
    surfaceGrip(t, s) *
    ground *
    temperatureGrip(t.compound, gripTemperature(t)) *
    (1 - wetPenalty) *
    (1 - hydro * 0.62) *
    (1 - k.wearGripLoss * t.wear) *
    (1 - 0.34 * t.dirt) *
    (1 - 0.08 * t.flatSpot) *
    (1 - 0.18 * t.blistering - 0.12 * t.graining) *
    (t.punctured ? 0.28 : 1) *
    pressureGrip(k, t.pressure) *
    (1 + s.rubber * 0.05 * (1 - wetRatio) - s.marbles * 0.14)
  );
}
export function ellipse(fx: number, fy: number, limit: number, out: { fx: number; fy: number }) {
  if (limit <= 0) {
    out.fx = 0;
    out.fy = 0;
    return;
  }
  const use = Math.hypot(fx, fy) / Math.max(limit, 1);
  out.fx = fx / Math.max(1, use);
  out.fy = fy / Math.max(1, use);
}
const SLIP = slipState();
const THERMAL: ThermalInputs = {
  slipPower: 0,
  load: 0,
  speed: 0,
  airTemp: 0,
  trackTemp: 0,
  waterMm: 0,
  discTemp: 0,
  wear: 0,
};
/** Backward Euler wheel solve with dissipative brake complementarity. Bisection
 * resolves the stiff low-speed wheel mode without arbitrary angular-velocity
 * clamps. Forces come from the combined-slip law (tyre-force.ts) with the
 * relaxed slip angle and camber `camber` (road-relative inclination, signed
 * toward +lateral); temperatures from the three-node model (tyre-thermal.ts).
 * `airTemp` defaults to the road temperature. */
export function solveTire(
  t: Tire,
  vLong: number,
  vLat: number,
  load: number,
  drive: number,
  brake: number,
  surface: SurfaceSample,
  camber: number,
  dt: number,
  regen = 0,
  airTemp = surface.temp,
) {
  const k = t.construction,
    material = surfaceMaterial(surface.surface);
  t.load = Math.max(0, load);
  t.water = surface.water;
  t.surface = surface.surface;
  t.inclination = camber;
  if (t.wear >= 0.999) t.punctured = true;
  t.radius = t.nominalRadius * (t.punctured ? 0.77 : 1 - 0.06 * smooth(0.97, 1, t.wear));
  const r = t.radius,
    I = t.inertia,
    old = t.omega,
    regularization = Math.max(2.5, Math.abs(vLong));
  t.angle = Math.atan2(vLat, Math.hypot(vLong, 3));
  // Transient lateral slip: the carcass deflection lags the contact velocity.
  t.relaxedAngle =
    t.load < 1
      ? t.angle
      : relaxSlip(
          t.relaxedAngle,
          t.angle,
          vLong,
          relaxationLength(k, t.load, t.pressure, t.wear, vLong),
          dt,
        );
  const ideal = COMPOUNDS[t.compound].ideal,
    mu = peakGrip(t, t.load, surface, vLong);
  prepareSlip(
    k,
    t.load,
    mu,
    carcassStiffness(k, t.pressure, t.wear, t.carcassTemp, ideal),
    material.stiffness,
    material.falloff,
    SLIP,
    material.coupling,
  );
  // Camber: patch-size factor on the peak (scales D and the reference slips
  // together so slip stiffness is unchanged) and thrust as a slip-angle shift.
  const alpha = t.relaxedAngle - camberShift(k, t.load, SLIP, camber, vLong),
    camberFactor = camberGrip(k, camber, alpha / SLIP.alphaRef);
  SLIP.dx *= camberFactor;
  SLIP.dy *= camberFactor;
  SLIP.kappaRef *= camberFactor;
  SLIP.alphaRef *= camberFactor;
  SLIP.alpha = alpha;
  const cap = SLIP.dx;
  const evalForce = (omega: number) =>
    t.load < 1 ? 0 : longitudinalForce(SLIP, (omega * r - vLong) / regularization);
  const torqueAtZero = drive - evalForce(0) * r;
  let omega = 0;
  if (Math.abs((I * old) / dt + torqueAtZero) > brake) {
    const sign = Math.sign((I * old) / dt + torqueAtZero) || 1,
      delta = ((Math.abs(drive) + brake + cap * r) * dt) / I;
    let lo = old - delta - 0.01,
      hi = old + delta + 0.01;
    for (let n = 0; n < 16; n++) {
      const mid = (lo + hi) * 0.5,
        residual = (I * (mid - old)) / dt - drive + brake * sign + evalForce(mid) * r;
      if (residual > 0) hi = mid;
      else lo = mid;
    }
    omega = (lo + hi) * 0.5;
  }
  t.omega = omega;
  t.rotation = (t.rotation + omega * dt) % (Math.PI * 2);
  t.slip = (omega * r - vLong) / regularization;
  combinedForces(SLIP, t.slip, t);
  t.energy = Math.abs(t.fx * (omega * r - vLong)) + Math.abs(t.fy * vLat);
  t.peakSlip = SLIP.kappaRef;
  t.usage = Math.hypot(t.fx / Math.max(1, SLIP.dx), t.fy / Math.max(1, SLIP.dy));
  if (t.load < 1) {
    t.fx = 0;
    t.fy = 0;
    t.energy = 0;
    t.usage = 0;
  }
  // Contact patch, ground sinkage, rolling resistance and ground drag.
  t.aquaplane = aquaplaning(
    t.compound,
    t.load,
    surface.water,
    vLong,
    t.wear,
    t.pressure,
    material.textureMm,
  );
  t.patchLength = clamp(2 * Math.sqrt(2 * r * (Math.max(0, t.deflection) + t.sinkage)), 0.06, 0.4);
  t.sinkage = advanceSinkage(
    t.sinkage,
    sinkageTarget(material, t.load, k.width * t.patchLength),
    vLong,
    dt,
  );
  // Rigid rolling loss of this carcass (hysteresis falls as pressure rises)
  // plus the compaction work of deformable ground.
  t.rolling =
    surface.resistance *
      k.rollingResistance *
      (k.nominalPressure / Math.max(60, t.pressure)) ** k.rollingPressureExponent +
    rollingCoefficient(material, t.sinkage, t.patchLength) -
    material.rolling;
  t.groundDrag =
    t.load < 1 ? 0 : groundDrag(material, t.sinkage, k.width, vLong, surface.water, t.aquaplane);
  // Force times slip-speed gives watts, not a cosmetic heating timer.
  THERMAL.slipPower = t.energy;
  THERMAL.load = t.load;
  THERMAL.speed = vLong;
  THERMAL.airTemp = airTemp;
  THERMAL.trackTemp = surface.temp;
  THERMAL.waterMm = surface.water;
  THERMAL.discTemp = t.discTemp;
  THERMAL.wear = t.wear;
  advanceTyreTemperatures(t, THERMAL, dt);
  t.pressure = hotPressure(t.punctured ? 12 : t.coldPressure, t.coreTemp, ideal - 5);
  t.wear = clamp(
    t.wear +
      ((t.energy * dt) / COMPOUNDS[t.compound].lifeJ) *
        (1 + Math.max(0, t.surfaceTemp - 120) * 0.015),
    0,
    1,
  );
  // Damage accumulation is proportional to dissipated slip energy; cold grain
  // can clean up through rolling, while heat-blistered rubber does not regrow.
  const slipWork = (t.energy * dt) / COMPOUNDS[t.compound].lifeJ;
  t.blistering = clamp(
    t.blistering + slipWork * smooth(ideal + 20, ideal + 60, t.surfaceTemp),
    0,
    1,
  );
  t.graining = clamp(
    t.graining +
      slipWork * (1 - smooth(ideal - 30, ideal, t.carcassTemp)) -
      Math.abs(t.omega) * dt * 0.000008,
    0,
    1,
  );
  if (vLong > 12 && t.slip < -0.8 && t.load > 700)
    t.flatSpot = clamp(t.flatSpot + (Math.abs(t.fx * vLong) * dt) / 2e7, 0, 1);
  updateContamination(t, surface, t.load, vLong, omega, dt);
  t.discTemp +=
    ((Math.max(0, brake - regen) * Math.abs(omega) -
      (t.discTemp - 24) * (25 + Math.abs(vLong) * 4)) *
      dt) /
    16000;
  if (!Number.isFinite(t.omega + t.fx + t.fy + t.surfaceTemp + t.coreTemp + t.relaxedAngle))
    throw new Error('Non-finite tire state');
}
export function brakeEfficiency(temp: number) {
  return 0.78 + 0.22 * smooth(80, 350, temp) - 0.28 * smooth(1050, 1450, temp);
}
export const staticLoad = (mass: number) => (mass * G) / 4;
