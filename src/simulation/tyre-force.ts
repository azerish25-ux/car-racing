import { clamp, smooth } from '../core/math.ts';

/** Tyre force law (docs/production/PHYSICS_MODEL.md §1). Original engineering
 * calibration, not a fitted manufacturer data set. Pure-slip curves are
 * Magic-Formula shaped, F = D·sin(C·atan(Bx − E(Bx − atan Bx))), with
 *  - peak friction D = μ(Fz,T,p,γ,wear,surface,water)·Fz (tire.ts peakGrip),
 *  - slip stiffness BCD a carcass property: load-saturating, pressure,
 *    wear, temperature and ground dependent, only partly coupled to road μ,
 *    so low-friction ground has a smaller peak slip (the brush-model result);
 *  - combined slip by Magic-Formula weighting functions on normalized slips
 *    sx = κ/κ*, sy = α/α* (MF 5.2 form with C = 1):
 *        Fy = Gyκ·Fy0(α),  Gyκ = cos(atan(By·sx)),  By = by1·cos(atan(by2·sy)),
 *        Fx = Gxα·Fx0(κ),  Gxα = cos(atan(Bx·sy)),  Bx = bx1·cos(atan(bx2·sx)),
 *    then bounded by the friction ellipse (μx Fz, μy Fz), so a spinning or
 *    locked tyre loses its cornering force while moderate slip in one
 *    direction costs the other a calibrated, moderate share;
 *  - camber thrust as an equivalent slip-angle shift Cγ·γ/Cα (saturates with
 *    the lateral force, never adds outside the ellipse);
 *  - first-order lateral relaxation (transient slip lag), faded out at low
 *    speed where the deflection model has no damping, integrated exactly. */
export interface SlipCurve {
  /** Shape factor C (peak sharpness / post-peak fall-off). */
  readonly C: number;
  /** Curvature factor E. */
  readonly E: number;
  /** Slip stiffness per unit load at Fz0 and reference friction (1/rad or per unit κ). */
  readonly stiffness: number;
}
export interface CombinedSlip {
  readonly by1: number;
  readonly by2: number;
  readonly bx1: number;
  readonly bx2: number;
}
export interface TyreConstruction {
  /** Nominal load Fz0 (N) of the load-sensitivity laws. */
  readonly nominalLoad: number;
  /** Peak friction μ ∝ (Fz/Fz0)^-loadSensitivity. */
  readonly loadSensitivity: number;
  /** Cornering stiffness ∝ Fz·(Fz/Fz0)^-q: the peak slip angle grows with
   * load. Longitudinal slip stiffness has its own (MF: close to ∝ Fz). */
  readonly stiffnessLoadExponent: number;
  readonly longitudinalLoadExponent: number;
  /** Rolling-resistance scale of this carcass on the ground's rigid
   * coefficient, and its pressure exponent: c_rr ∝ (p_nominal/p)^n. */
  readonly rollingResistance: number;
  readonly rollingPressureExponent: number;
  /** Slip stiffness ∝ (μ/μref)^p; 1 reproduces a curve that scales with μ. */
  readonly frictionStiffnessCoupling: number;
  /** Friction at which `stiffness` values are quoted (dry medium slick). */
  readonly referenceFriction: number;
  readonly lateral: SlipCurve;
  readonly longitudinal: SlipCurve;
  /** Peak longitudinal friction relative to lateral. */
  readonly longitudinalFriction: number;
  /** Combined-slip weighting: by1/by2 (lateral force lost to longitudinal
   * slip and its fade with slip angle), bx1/bx2 (the converse). */
  readonly combined: CombinedSlip;
  /** Camber thrust stiffness per unit load (N/N/rad). */
  readonly camberStiffness: number;
  /** Inclination into the lateral force with the largest contact patch (rad). */
  readonly camberOptimum: number;
  /** Fractional peak-friction loss per rad² away from that inclination. */
  readonly camberSensitivity: number;
  /** Lateral relaxation length (m) at Fz0 and nominal pressure. */
  readonly relaxationLength: number;
  /** Speeds (m/s) between which the lag fades in. Below the first the force
   * follows slip instantly (the deflection mode would be undamped there). */
  readonly relaxationFade: readonly [number, number];
  /** Hot gauge pressure (kPa) at which pressure-stiffness factors are 1. */
  readonly nominalPressure: number;
  /** Hot pressure (kPa) of the largest contact patch, and the fractional
   * grip loss `pressureGripLoss` at ±`pressureSpan` kPa from it. */
  readonly pressureOptimum: number;
  readonly pressureGripLoss: number;
  readonly pressureSpan: number;
  /** d(ln slip stiffness)/d(ln pressure). */
  readonly pressureStiffness: number;
  /** Radial (vertical) stiffness N/m at nominal pressure, its pressure gain
   * d(ln k)/d(ln p), and its damping N s/m. */
  readonly verticalStiffness: number;
  readonly verticalPressureGain: number;
  readonly verticalDamping: number;
  /** Tread width (m): contact patch, water displacement, sinkage. */
  readonly width: number;
  /** Peak friction lost at full wear, and slip stiffness gained (shorter tread blocks). */
  readonly wearGripLoss: number;
  readonly wearStiffnessGain: number;
  /** Slip stiffness gained per K below the compound's ideal temperature. */
  readonly temperatureStiffness: number;
}
/** APX-01 slick: original calibration with the former pure-slip shapes at
 * nominal load (B 7.2/10.5, C 1.28/1.3, E 0.15) and physically separated
 * carcass stiffness, load saturation and relaxation. */
export const FORMULA_SLICK: TyreConstruction = Object.freeze({
  nominalLoad: 2200,
  loadSensitivity: 0.105,
  stiffnessLoadExponent: 0.12,
  longitudinalLoadExponent: 0,
  rollingResistance: 0.9,
  rollingPressureExponent: 0.3,
  frictionStiffnessCoupling: 0.6,
  referenceFriction: 1.84,
  lateral: Object.freeze({ C: 1.28, E: 0.15, stiffness: 7.2 * 1.28 * 1.84 }),
  longitudinal: Object.freeze({ C: 1.3, E: 0.15, stiffness: 10.5 * 1.3 * 1.84 }),
  longitudinalFriction: 1,
  combined: Object.freeze({ by1: 0.7, by2: 0.6, bx1: 0.7, bx2: 0.6 }),
  camberStiffness: 0.35,
  camberOptimum: 0.03,
  camberSensitivity: 9,
  relaxationLength: 0.32,
  relaxationFade: Object.freeze([3, 12] as const),
  nominalPressure: 160,
  pressureOptimum: 165,
  pressureGripLoss: 0.12,
  pressureSpan: 65,
  pressureStiffness: 0.25,
  verticalStiffness: 330000,
  verticalPressureGain: 0.7,
  verticalDamping: 350,
  width: 0.36,
  wearGripLoss: 0.5,
  wearStiffnessGain: 0.15,
  temperatureStiffness: 0.0015,
});
/** TC-1 touring slick: narrower, softer carcass, higher pressure, more camber. */
export const TOURING_SLICK: TyreConstruction = Object.freeze({
  ...FORMULA_SLICK,
  nominalLoad: 3300,
  stiffnessLoadExponent: 0.15,
  rollingResistance: 1,
  camberStiffness: 0.45,
  camberOptimum: 0.045,
  camberSensitivity: 7,
  relaxationLength: 0.42,
  verticalStiffness: 260000,
  verticalDamping: 300,
  width: 0.27,
});
/** Catalogue tyre families other than the Formula slick (tire-families.ts):
 * the closed-wheel carcass with the Formula slick's load reference and slip
 * stiffness exponent, because a family's `tireGrip` is defined relative to the
 * Formula slick at that reference load. */
export const FAMILY_CARCASS: TyreConstruction = Object.freeze({
  ...TOURING_SLICK,
  nominalLoad: FORMULA_SLICK.nominalLoad,
  stiffnessLoadExponent: FORMULA_SLICK.stiffnessLoadExponent,
});

const HALF_PI = Math.PI / 2;
/** Normalized pure-slip curve: σ is slip divided by the reference slip X0/B
 * where X0 = tan(π/2C), so σ = 1 is the E = 0 peak. Equal to the Magic
 * Formula with Bx = X0·σ. */
export function slipCurve(sigma: number, C: number, E: number, X0: number) {
  const x = X0 * sigma;
  return Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}
/** Per-substep curve state for one tyre: everything the implicit wheel solve
 * needs to evaluate combined forces cheaply at trial wheel speeds. */
export interface SlipState {
  /** Peak forces μx·Fz and μy·Fz (N). */
  dx: number;
  dy: number;
  cx: number;
  ex: number;
  cy: number;
  ey: number;
  x0x: number;
  x0y: number;
  /** Reference slips κ* and α* (σ = 1). */
  kappaRef: number;
  alphaRef: number;
  /** Lateral slip after relaxation and camber shift (rad), as σy·α*. */
  alpha: number;
  /** Combined-slip weighting coefficients of this tyre. */
  by1: number;
  by2: number;
  bx1: number;
  bx2: number;
  /** Lateral terms of the combined law, cached for the wheel solve: they
   * depend only on the lateral slip, which is fixed during it. */
  cache: {
    stamp: number;
    alpha: number;
    dy: number;
    alphaRef: number;
    sy: number;
    fy0: number;
    by: number;
  };
  stamp: number;
  /** Cornering stiffness (N/rad) and longitudinal slip stiffness (N/unit). */
  corneringStiffness: number;
  slipStiffness: number;
}
export const slipState = (): SlipState => ({
  dx: 0,
  dy: 0,
  cx: 1.3,
  ex: 0,
  cy: 1.3,
  ey: 0,
  x0x: 1,
  x0y: 1,
  kappaRef: 1,
  alphaRef: 1,
  alpha: 0,
  corneringStiffness: 0,
  slipStiffness: 0,
  by1: 0,
  by2: 0,
  bx1: 0,
  bx2: 0,
  cache: { stamp: -1, alpha: NaN, dy: NaN, alphaRef: NaN, sy: 0, fy0: 0, by: 0 },
  stamp: 0,
});
/** Stiffness multiplier from pressure, wear and carcass temperature. */
export function carcassStiffness(
  c: TyreConstruction,
  pressure: number,
  wear: number,
  carcassTemp: number,
  idealTemp: number,
) {
  const dp = (pressure - c.nominalPressure) / c.nominalPressure;
  return (
    clamp(1 + c.pressureStiffness * dp, 0.6, 1.4) *
    (1 + c.wearStiffnessGain * clamp(wear, 0, 1)) *
    clamp(1 + c.temperatureStiffness * (idealTemp - carcassTemp), 0.85, 1.25)
  );
}
/** Fill `out` for load Fz with peak friction `mu` (already including every
 * grip factor), carcass stiffness factor and ground stiffness/fall-off. */
export function prepareSlip(
  c: TyreConstruction,
  load: number,
  mu: number,
  stiffnessFactor: number,
  groundStiffness: number,
  groundFalloff: number,
  out: SlipState,
  groundCoupling = 1,
) {
  const fz = Math.max(load, 1),
    ratio = clamp(fz / c.nominalLoad, 0.05, 6),
    friction = Math.max(mu, 1e-3),
    common =
      fz *
      (friction / c.referenceFriction) ** c.frictionStiffnessCoupling *
      stiffnessFactor *
      groundStiffness;
  out.stamp++;
  out.dy = friction * fz;
  out.dx = out.dy * c.longitudinalFriction;
  out.by1 = c.combined.by1 * groundCoupling;
  out.by2 = c.combined.by2;
  out.bx1 = c.combined.bx1 * groundCoupling;
  out.bx2 = c.combined.bx2;
  // Loose ground keeps ploughing force at large slip (C → 1, no fall-off).
  out.cy = clamp(1 + (c.lateral.C - 1) * groundFalloff, 1.03, 1.9);
  out.cx = clamp(1 + (c.longitudinal.C - 1) * groundFalloff, 1.03, 1.9);
  out.ey = c.lateral.E;
  out.ex = c.longitudinal.E;
  out.x0y = Math.tan(HALF_PI / out.cy);
  out.x0x = Math.tan(HALF_PI / out.cx);
  out.corneringStiffness = c.lateral.stiffness * common * ratio ** -c.stiffnessLoadExponent;
  out.slipStiffness = c.longitudinal.stiffness * common * ratio ** -c.longitudinalLoadExponent;
  // BCD = stiffness ⇒ B = stiffness/(C·D); reference slip X0/B.
  out.alphaRef = (out.x0y * out.cy * out.dy) / Math.max(1e-6, out.corneringStiffness);
  out.kappaRef = (out.x0x * out.cx * out.dx) / Math.max(1e-6, out.slipStiffness);
  return out;
}
/** Camber thrust as an equivalent slip-angle shift: Fy ≈ −Cα·α + Cγ·γ.
 * `inclination` is signed toward +lateral (driver's left). Like slip-angle
 * force it is a rolling deflection of the tread: a stationary cambered tyre
 * on a slope produces none, so it builds over the first metres per second. */
export function camberShift(
  c: TyreConstruction,
  load: number,
  state: SlipState,
  inclination: number,
  speed: number,
) {
  return (
    (c.camberStiffness * Math.max(load, 0) * inclination * smooth(0.3, 3, Math.abs(speed))) /
    Math.max(1, state.corneringStiffness)
  );
}
/** Contact-patch friction factor of inclination: the optimum leans into the
 * lateral force (direction −sign(α)); straight running prefers none. */
export function camberGrip(c: TyreConstruction, inclination: number, alphaNormalized: number) {
  const into = -Math.tanh(2 * alphaNormalized),
    error = inclination - c.camberOptimum * into;
  return clamp(1 - c.camberSensitivity * error * error, 0.7, 1);
}
/** Inflation-pressure friction factor (contact-patch size), as before. */
export function pressureGrip(c: TyreConstruction, pressure: number) {
  return clamp(
    1 - c.pressureGripLoss * ((pressure - c.pressureOptimum) / c.pressureSpan) ** 2,
    0.75,
    1,
  );
}
/** Pure-slip force of a normalized slip (signed, magnitude ≤ peak). */
function pure(peak: number, sigma: number, C: number, E: number, X0: number) {
  return sigma >= 0 ? peak * slipCurve(sigma, C, E, X0) : -peak * slipCurve(-sigma, C, E, X0);
}
/** Combined forces for normalized slips (sx, α/α*): MF weighting, then the
 * friction-ellipse bound. Writes fx (along +rolling) and fy (along +α, i.e.
 * before the sign that opposes the lateral slip). */
function combine(state: SlipState, sx: number, out: { fx: number; fy: number }) {
  const lateral = state.cache;
  if (
    lateral.stamp !== state.stamp ||
    lateral.alpha !== state.alpha ||
    lateral.dy !== state.dy ||
    lateral.alphaRef !== state.alphaRef
  ) {
    const sigma = state.alpha / state.alphaRef;
    lateral.stamp = state.stamp;
    lateral.alpha = state.alpha;
    lateral.dy = state.dy;
    lateral.alphaRef = state.alphaRef;
    lateral.sy = sigma;
    lateral.fy0 = pure(state.dy, sigma, state.cy, state.ey, state.x0y);
    // cos(atan(x)) = 1/√(1+x²): the C = 1 weighting functions are algebraic.
    lateral.by = state.by1 / Math.sqrt(1 + (state.by2 * sigma) ** 2);
  }
  const sy = lateral.sy,
    by = lateral.by,
    fy0 = lateral.fy0,
    fx0 = pure(state.dx, sx, state.cx, state.ex, state.x0x),
    bx = state.bx1 / Math.sqrt(1 + (state.bx2 * sx) ** 2),
    fy = fy0 / Math.sqrt(1 + (by * sx) ** 2),
    fx = fx0 / Math.sqrt(1 + (bx * sy) ** 2),
    use = Math.hypot(fx / Math.max(1e-9, state.dx), fy / Math.max(1e-9, state.dy)),
    scale = use > 1 ? 1 / use : 1;
  out.fx = fx * scale;
  out.fy = fy * scale;
  return out;
}
const SCRATCH = { fx: 0, fy: 0 };
/** Longitudinal force (N) of the combined law at slip ratio κ with the
 * prepared lateral slip; used by the implicit wheel solve. */
export function longitudinalForce(state: SlipState, kappa: number) {
  return combine(state, kappa / state.kappaRef, SCRATCH).fx;
}
/** Combined forces: Fx along +rolling, Fy opposing lateral slip. */
export function combinedForces(state: SlipState, kappa: number, out: { fx: number; fy: number }) {
  combine(state, kappa / state.kappaRef, out);
  // 0 - x, not -x: an unloaded or straight-running tyre reports +0.
  out.fy = 0 - out.fy;
  return out;
}
/** Effective relaxation length (m): grows ~√load, shortens with pressure and
 * wear (stiffer carcass/shorter tread), and fades to zero at low speed. */
export function relaxationLength(
  c: TyreConstruction,
  load: number,
  pressure: number,
  wear: number,
  speed: number,
) {
  const dp = (pressure - c.nominalPressure) / c.nominalPressure;
  return (
    c.relaxationLength *
    clamp(Math.sqrt(Math.max(load, 0) / c.nominalLoad), 0.4, 2) *
    clamp(1 - 0.35 * dp, 0.7, 1.3) *
    (1 - 0.3 * clamp(wear, 0, 1)) *
    smooth(c.relaxationFade[0], c.relaxationFade[1], Math.abs(speed))
  );
}
/** Exact first-order slip lag dα/dt = (V/σ)(α_ss − α) over a step with the
 * speed held: unconditionally stable and never overshoots the target. */
export function relaxSlip(
  current: number,
  target: number,
  speed: number,
  length: number,
  dt: number,
) {
  if (length < 1e-4) return target;
  return target + (current - target) * Math.exp((-Math.abs(speed) * dt) / length);
}
