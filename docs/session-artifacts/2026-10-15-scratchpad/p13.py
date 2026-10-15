import sys
root = sys.argv[1]
p = root + '/src/simulation/tyre-force.ts'
s = open(p).read()
def rep(a, b):
    global s
    assert a in s, a[:90]
    s = s.replace(a, b)

rep(""" *  - combined slip by the normalized slip vector: σ = |(κ/κ*, α/α*)|, force
 *    magnitude from the pure curves at σ, direction along the slip vector, so
 *    every combined force lies inside the friction ellipse (μx Fz, μy Fz);""",
""" *  - combined slip by Magic-Formula weighting functions on normalized slips
 *    sx = κ/κ*, sy = α/α* (MF 5.2 form with C = 1):
 *        Fy = Gyκ·Fy0(α),  Gyκ = cos(atan(By·sx)),  By = by1·cos(atan(by2·sy)),
 *        Fx = Gxα·Fx0(κ),  Gxα = cos(atan(Bx·sy)),  Bx = bx1·cos(atan(bx2·sx)),
 *    then bounded by the friction ellipse (μx Fz, μy Fz), so a spinning or
 *    locked tyre loses its cornering force while moderate slip in one
 *    direction costs the other a calibrated, moderate share;""")

rep("""  /** Peak longitudinal friction relative to lateral. */
  readonly longitudinalFriction: number;""", """  /** Peak longitudinal friction relative to lateral. */
  readonly longitudinalFriction: number;
  /** Combined-slip weighting: by1/by2 (lateral force lost to longitudinal
   * slip and its fade with slip angle), bx1/bx2 (the converse). */
  readonly combined: CombinedSlip;""")

rep("""export interface TyreConstruction {""", """export interface CombinedSlip {
  readonly by1: number;
  readonly by2: number;
  readonly bx1: number;
  readonly bx2: number;
}
export interface TyreConstruction {""")

rep("""  longitudinalFriction: 1,
  camberStiffness: 0.35,""", """  longitudinalFriction: 1,
  combined: Object.freeze({ by1: 1.4, by2: 0.6, bx1: 1.4, bx2: 0.6 }),
  camberStiffness: 0.35,""")

rep("""  /** Lateral slip after relaxation and camber shift (rad), as σy·α*. */
  alpha: number;""", """  /** Lateral slip after relaxation and camber shift (rad), as σy·α*. */
  alpha: number;
  /** Combined-slip weighting coefficients of this tyre. */
  by1: number;
  by2: number;
  bx1: number;
  bx2: number;""")

rep("""  alpha: 0,
  corneringStiffness: 0,
  slipStiffness: 0,
});""", """  alpha: 0,
  corneringStiffness: 0,
  slipStiffness: 0,
  by1: 0,
  by2: 0,
  bx1: 0,
  bx2: 0,
});""")

rep("""  out.dy = friction * fz;
  out.dx = out.dy * c.longitudinalFriction;""", """  out.dy = friction * fz;
  out.dx = out.dy * c.longitudinalFriction;
  out.by1 = c.combined.by1;
  out.by2 = c.combined.by2;
  out.bx1 = c.combined.bx1;
  out.bx2 = c.combined.bx2;""")

a = s.index("/** Longitudinal force (N) of the combined law at slip ratio κ with the")
b = s.index("/** Effective relaxation length (m)")
s = s[:a] + """/** Pure-slip force of a normalized slip (signed, magnitude ≤ peak). */
function pure(peak: number, sigma: number, C: number, E: number, X0: number) {
  return sigma >= 0 ? peak * slipCurve(sigma, C, E, X0) : -peak * slipCurve(-sigma, C, E, X0);
}
/** Combined forces for normalized slips (sx, sy): MF weighting, then the
 * friction-ellipse bound. Writes fx (along +rolling) and fy (along +sy, i.e.
 * before the sign that opposes the lateral slip). */
function combine(state: SlipState, sx: number, sy: number, out: { fx: number; fy: number }) {
  const fx0 = pure(state.dx, sx, state.cx, state.ex, state.x0x),
    fy0 = pure(state.dy, sy, state.cy, state.ey, state.x0y),
    // cos(atan(x)) = 1/√(1+x²): the C = 1 weighting functions are algebraic.
    by = state.by1 / Math.sqrt(1 + (state.by2 * sy) ** 2),
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
  return combine(state, kappa / state.kappaRef, state.alpha / state.alphaRef, SCRATCH).fx;
}
/** Combined forces: Fx along +rolling, Fy opposing lateral slip. */
export function combinedForces(state: SlipState, kappa: number, out: { fx: number; fy: number }) {
  combine(state, kappa / state.kappaRef, state.alpha / state.alphaRef, out);
  // 0 - x, not -x: an unloaded or straight-running tyre reports +0.
  out.fy = 0 - out.fy;
  return out;
}
""" + s[b:]
open(p, 'w').write(s)
print('ok')
