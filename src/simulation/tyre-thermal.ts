/** Three-node tyre thermal model (docs/production/PHYSICS_MODEL.md §1.6).
 *
 * Nodes: tread SURFACE (thin layer that sees sliding friction), CARCASS
 * (tread bulk, belts and sidewalls: hysteresis), CORE (inflation gas and inner
 * liner: sets the hot pressure). Heat paths, all in W:
 *   surface ← share·Pslip + (1-k)·Proll,  carcass ← k·Proll,
 *   surface ↔ carcass ↔ core conduction,  surface → air (forced convection),
 *   surface → track (contact conduction),  surface → water film (rain),
 *   carcass → air (sidewall),  core → rim/air,  brake disc → core (rim).
 * The coupled linear system is advanced with backward Euler (a 3×3
 * tridiagonal M-matrix solve), so it is unconditionally stable and cannot
 * overshoot the bounding temperatures at any timestep. Original engineering
 * calibration, not measured thermal data. Units: J/K, W/K, °C, m/s, mm. */
export interface TyreThermalParameters {
  readonly surfaceCapacity: number;
  readonly carcassCapacity: number;
  readonly coreCapacity: number;
  readonly surfaceCarcass: number;
  readonly carcassCore: number;
  /** Surface forced convection: base + per m/s. */
  readonly airBase: number;
  readonly airSpeed: number;
  /** Surface → track conduction while loaded. */
  readonly trackContact: number;
  /** Water film cooling per mm of water: base + per m/s. */
  readonly waterBase: number;
  readonly waterSpeed: number;
  /** Sidewall convection (carcass → air): base + per m/s. */
  readonly sidewallBase: number;
  readonly sidewallSpeed: number;
  /** Core → rim/air: base + per m/s; brake disc → core through the rim. */
  readonly rimBase: number;
  readonly rimSpeed: number;
  readonly discToCore: number;
  /** Share of contact slip power entering the tread (the rest heats the road). */
  readonly slipShare: number;
  /** Rolling hysteresis power per (N·m/s), and the share deposited in the carcass. */
  readonly hysteresis: number;
  readonly hysteresisCarcassShare: number;
  /** Tread surface heat capacity lost at full wear (thinner tread). */
  readonly wearCapacityLoss: number;
}
export const TYRE_THERMAL: TyreThermalParameters = Object.freeze({
  surfaceCapacity: 9000,
  carcassCapacity: 52000,
  coreCapacity: 7000,
  surfaceCarcass: 85,
  carcassCore: 30,
  airBase: 12,
  airSpeed: 1.25,
  trackContact: 8,
  waterBase: 130,
  waterSpeed: 0.6,
  sidewallBase: 4,
  sidewallSpeed: 0.08,
  rimBase: 2,
  rimSpeed: 0.05,
  discToCore: 0.6,
  slipShare: 0.62,
  hysteresis: 0.0012,
  hysteresisCarcassShare: 0.6,
  wearCapacityLoss: 0.4,
});
export interface TyreTemperatures {
  surfaceTemp: number;
  carcassTemp: number;
  coreTemp: number;
}
export interface ThermalInputs {
  /** Contact slip power |Fx·Vsx| + |Fy·Vsy| (W). */
  slipPower: number;
  load: number;
  speed: number;
  airTemp: number;
  trackTemp: number;
  waterMm: number;
  discTemp: number;
  wear: number;
}
/** Advance the three temperatures by dt with backward Euler. */
export function advanceTyreTemperatures(
  t: TyreTemperatures,
  input: ThermalInputs,
  dt: number,
  p: TyreThermalParameters = TYRE_THERMAL,
) {
  if (!(dt > 0)) throw new Error('Invalid tyre thermal timestep');
  const v = Math.abs(input.speed),
    loaded = input.load > 1 ? 1 : 0,
    rolling = p.hysteresis * Math.max(0, input.load) * v,
    qs = p.slipShare * Math.max(0, input.slipPower) + (1 - p.hysteresisCarcassShare) * rolling,
    qc = p.hysteresisCarcassShare * rolling,
    cs = (p.surfaceCapacity * (1 - p.wearCapacityLoss * Math.min(1, Math.max(0, input.wear)))) / dt,
    cc = p.carcassCapacity / dt,
    cg = p.coreCapacity / dt,
    gsc = p.surfaceCarcass,
    gcg = p.carcassCore,
    gsa = p.airBase + p.airSpeed * v,
    gst = p.trackContact * loaded,
    gw = Math.max(0, input.waterMm) * (p.waterBase + p.waterSpeed * v) * loaded,
    gca = p.sidewallBase + p.sidewallSpeed * v,
    gga = p.rimBase + p.rimSpeed * v,
    gd = p.discToCore;
  // Tridiagonal system [a1 -gsc 0; -gsc a2 -gcg; 0 -gcg a3]·T' = b.
  const a1 = cs + gsc + gsa + gst + gw,
    a2 = cc + gsc + gcg + gca,
    a3 = cg + gcg + gga + gd,
    b1 =
      cs * t.surfaceTemp + qs + gsa * input.airTemp + gst * input.trackTemp + gw * input.airTemp,
    b2 = cc * t.carcassTemp + qc + gca * input.airTemp,
    b3 = cg * t.coreTemp + gga * input.airTemp + gd * input.discTemp;
  const c1 = -gsc / a1,
    d1 = b1 / a1,
    m2 = a2 + gsc * c1,
    c2 = -gcg / m2,
    d2 = (b2 + gsc * d1) / m2,
    m3 = a3 + gcg * c2,
    core = (b3 + gcg * d2) / m3,
    carcass = d2 - c2 * core,
    surface = d1 - c1 * carcass;
  t.coreTemp = core;
  t.carcassTemp = carcass;
  t.surfaceTemp = surface;
  return t;
}
/** Hot gauge pressure (kPa) from the core temperature: ideal gas at constant
 * volume on absolute pressure, set cold at `setTemp`. */
export const ATMOSPHERE_KPA = 101.325;
export function hotPressure(coldGauge: number, coreTemp: number, setTemp: number) {
  return ((coldGauge + ATMOSPHERE_KPA) * (coreTemp + 273.15)) / (setTemp + 273.15) - ATMOSPHERE_KPA;
}
