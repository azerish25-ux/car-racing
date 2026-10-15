import sys
root = sys.argv[1]
p = root + '/src/simulation/tyre-force.ts'
s = open(p).read()
def rep(a, b):
    global s
    assert a in s, a[:90]
    s = s.replace(a, b, 1)

rep("""  by1: number;
  by2: number;
  bx1: number;
  bx2: number;
""", """  by1: number;
  by2: number;
  bx1: number;
  bx2: number;
  /** Lateral terms of the combined law, cached for the wheel solve: they
   * depend only on the lateral slip, which is fixed during it. */
  cache: { stamp: number; alpha: number; dy: number; alphaRef: number; sy: number; fy0: number; by: number };
  stamp: number;
""")
rep("""  by1: 0,
  by2: 0,
  bx1: 0,
  bx2: 0,
});""", """  by1: 0,
  by2: 0,
  bx1: 0,
  bx2: 0,
  cache: { stamp: -1, alpha: NaN, dy: NaN, alphaRef: NaN, sy: 0, fy0: 0, by: 0 },
  stamp: 0,
});""")
rep("""  out.dy = friction * fz;
  out.dx = out.dy * c.longitudinalFriction;""", """  out.stamp++;
  out.dy = friction * fz;
  out.dx = out.dy * c.longitudinalFriction;""")
rep("""function combine(state: SlipState, sx: number, sy: number, out: { fx: number; fy: number }) {
  const fx0 = pure(state.dx, sx, state.cx, state.ex, state.x0x),
    fy0 = pure(state.dy, sy, state.cy, state.ey, state.x0y),
    // cos(atan(x)) = 1/√(1+x²): the C = 1 weighting functions are algebraic.
    by = state.by1 / Math.sqrt(1 + (state.by2 * sy) ** 2),
    bx = state.bx1 / Math.sqrt(1 + (state.bx2 * sx) ** 2),""", """function combine(state: SlipState, sx: number, out: { fx: number; fy: number }) {
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
    bx = state.bx1 / Math.sqrt(1 + (state.bx2 * sx) ** 2),""")
rep("""/** Combined forces for normalized slips (sx, sy): MF weighting, then the
 * friction-ellipse bound. Writes fx (along +rolling) and fy (along +sy, i.e.
 * before the sign that opposes the lateral slip). */""", """/** Combined forces for normalized slips (sx, α/α*): MF weighting, then the
 * friction-ellipse bound. Writes fx (along +rolling) and fy (along +α, i.e.
 * before the sign that opposes the lateral slip). */""")
rep("""  return combine(state, kappa / state.kappaRef, state.alpha / state.alphaRef, SCRATCH).fx;""",
    """  return combine(state, kappa / state.kappaRef, SCRATCH).fx;""")
rep("""  combine(state, kappa / state.kappaRef, state.alpha / state.alphaRef, out);""",
    """  combine(state, kappa / state.kappaRef, out);""")
open(p, 'w').write(s)
print('ok')
