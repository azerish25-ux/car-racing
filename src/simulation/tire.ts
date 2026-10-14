import { clamp, G, smooth } from '../core/math.ts';
import { COMPOUNDS, VEHICLE, type Compound } from './config.ts';
import type { SurfaceSample } from './track.ts';
import { updateContamination } from './contamination.ts';
export interface Tire {
  compound: Compound;
  omega: number;
  rotation: number;
  load: number;
  fx: number;
  fy: number;
  slip: number;
  angle: number;
  surfaceTemp: number;
  carcassTemp: number;
  pressure: number;
  coldPressure: number;
  wear: number;
  dirt: number;
  marblePickup: number;
  flatSpot: number;
  blistering: number;
  graining: number;
  punctured: boolean;
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
}
export function makeTire(
  compound: Compound,
  pressure = 155,
  nominalRadius: number = VEHICLE.wheelRadius,
  inertia: number = VEHICLE.wheelInertia,
  gripScale = 1,
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
  };
}
export function magic(x: number, stiffness: number, shape = 1.35, curvature = 0.15) {
  const bx = stiffness * x;
  return Math.sin(shape * Math.atan(bx - curvature * (bx - Math.atan(bx))));
}
export function temperatureGrip(compound: Compound, temp: number) {
  const d = temp - COMPOUNDS[compound].ideal;
  return 1 - (d < 0 ? 0.35 : 0.48) * (1 - Math.exp(-((d / (d < 0 ? 45 : 65)) ** 2)));
}
/** Smooth load/tread/water coupling, not a random aquaplaning event. Higher
 * contact load moves both speed breakpoints upward. It is a bounded reduced
 * grip model, not a hydrodynamic contact-patch solver. */
export function aquaplaning(compound: Compound, load: number, waterMm: number, speed: number) {
  if (load <= 0 || waterMm <= 0) return 0;
  const tolerance = COMPOUNDS[compound].waterTolerance;
  const loadScale = Math.sqrt(clamp(load / 2200, 0.25, 4));
  return (
    smooth(tolerance * 0.7, tolerance * 3 + 1, waterMm) *
    smooth(24 * loadScale, 95 * loadScale, Math.abs(speed))
  );
}
export function peakGrip(t: Tire, load: number, s: SurfaceSample, speed: number) {
  const c = COMPOUNDS[t.compound],
    loadRatio = Math.max(load, 100) / 2200,
    wetRatio = s.water / (s.water + c.waterTolerance),
    wetPenalty =
      (t.compound === 'wet' ? 0.1 : t.compound === 'intermediate' ? 0.22 : 0.63) * wetRatio,
    hydro = aquaplaning(t.compound, load, s.water, speed),
    pressurePenalty = 1 - 0.12 * ((t.pressure - 165) / 65) ** 2;
  return (
    c.mu *
    t.gripScale *
    loadRatio ** -0.105 *
    s.grip *
    temperatureGrip(t.compound, t.carcassTemp) *
    (1 - wetPenalty) *
    (1 - hydro * 0.62) *
    (1 - 0.5 * t.wear) *
    (1 - 0.34 * t.dirt) *
    (1 - 0.08 * t.flatSpot) *
    (1 - 0.18 * t.blistering - 0.12 * t.graining) *
    (t.punctured ? 0.28 : 1) *
    clamp(pressurePenalty, 0.75, 1) *
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
/** Backward Euler wheel solve with dissipative brake complementarity. Bisection
 * resolves the stiff low-speed wheel mode without arbitrary angular-velocity clamps. */
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
) {
  t.load = Math.max(0, load);
  t.water = surface.water;
  t.surface = surface.surface;
  if (t.wear >= 0.999) t.punctured = true;
  t.radius = t.nominalRadius * (t.punctured ? 0.77 : 1 - 0.06 * smooth(0.97, 1, t.wear));
  const r = t.radius,
    I = t.inertia,
    old = t.omega,
    regularization = Math.max(2.5, Math.abs(vLong));
  t.angle = Math.atan2(vLat, Math.hypot(vLong, 3));
  const cap = peakGrip(t, t.load, surface, vLong) * t.load,
    lateral = -cap * magic(t.angle, 7.2, 1.28) + cap * camber * 0.14;
  const evalForce = (omega: number) => {
    const fx = cap * magic((omega * r - vLong) / regularization, 10.5, 1.3);
    return fx / Math.max(1, Math.hypot(fx, lateral) / Math.max(cap, 1));
  };
  const torqueAtZero = drive - evalForce(0) * r;
  let omega = 0;
  if (Math.abs((I * old) / dt + torqueAtZero) > brake) {
    const sign = Math.sign((I * old) / dt + torqueAtZero) || 1,
      delta = ((Math.abs(drive) + brake + cap * r) * dt) / I;
    let lo = old - delta - 0.01,
      hi = old + delta + 0.01;
    for (let k = 0; k < 16; k++) {
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
  ellipse(cap * magic(t.slip, 10.5, 1.3), lateral, cap, t);
  t.energy = Math.abs(t.fx * (omega * r - vLong)) + Math.abs(t.fy * vLat);
  if (t.load < 1) {
    t.fx = 0;
    t.fy = 0;
    t.energy = 0;
  }
  // Force times slip-speed gives watts, not a cosmetic heating timer.
  const conduction = (t.surfaceTemp - t.carcassTemp) * 85,
    convection =
      (t.surfaceTemp - surface.temp) * (18 + Math.abs(vLong) * 1.5 + surface.water * 150);
  t.surfaceTemp +=
    ((t.energy * 0.62 + t.load * Math.abs(vLong) * 0.0012 - conduction - convection) * dt) / 9000;
  t.carcassTemp += ((conduction - (t.carcassTemp - surface.temp) * 12) * dt) / 52000;
  t.pressure =
    ((t.punctured ? 12 : t.coldPressure) * (t.carcassTemp + 273.15)) /
    (COMPOUNDS[t.compound].ideal - 5 + 273.15);
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
    t.blistering +
      slipWork *
        smooth(COMPOUNDS[t.compound].ideal + 20, COMPOUNDS[t.compound].ideal + 60, t.surfaceTemp),
    0,
    1,
  );
  t.graining = clamp(
    t.graining +
      slipWork *
        (1 - smooth(COMPOUNDS[t.compound].ideal - 30, COMPOUNDS[t.compound].ideal, t.carcassTemp)) -
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
  if (!Number.isFinite(t.omega + t.fx + t.fy + t.surfaceTemp))
    throw new Error('Non-finite tire state');
}
export function brakeEfficiency(temp: number) {
  return 0.78 + 0.22 * smooth(80, 350, temp) - 0.28 * smooth(1050, 1450, temp);
}
export const staticLoad = (mass: number) => (mass * G) / 4;
