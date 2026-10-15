import sys
p = sys.argv[1]
s = open(p).read()
a = """export function longitudinalForce(state: SlipState, kappa: number) {"""
b = """export const DEBUG = { circle: false };
export function longitudinalForce(state: SlipState, kappa: number) {
  if (DEBUG.circle) {
    const sx = kappa / state.kappaRef, sy = state.alpha / state.alphaRef;
    const fx = state.dx * slipCurve(Math.abs(sx), state.cx, state.ex, state.x0x) * Math.sign(sx);
    const fy = state.dy * slipCurve(Math.abs(sy), state.cy, state.ey, state.x0y);
    return fx / Math.max(1, Math.hypot(fx, fy) / Math.max(state.dx, 1));
  }"""
assert a in s
s = s.replace(a, b)
a = """export function combinedForces(state: SlipState, kappa: number, out: { fx: number; fy: number }) {"""
b = """export function combinedForces(state: SlipState, kappa: number, out: { fx: number; fy: number }) {
  if (DEBUG.circle) {
    const sx = kappa / state.kappaRef, sy = state.alpha / state.alphaRef;
    const fx = state.dx * slipCurve(Math.abs(sx), state.cx, state.ex, state.x0x) * Math.sign(sx);
    const fy = -state.dy * slipCurve(Math.abs(sy), state.cy, state.ey, state.x0y) * Math.sign(sy);
    const use = Math.hypot(fx, fy) / Math.max(state.dx, 1);
    out.fx = fx / Math.max(1, use);
    out.fy = 0 + fy / Math.max(1, use);
    return out;
  }"""
assert a in s
s = s.replace(a, b)
open(p, 'w').write(s)

p2 = sys.argv[2]
s = open(p2).read()
a = """sim.autoPlayer = true;
for (const c of sim.cars as any[]) {"""
b = """sim.autoPlayer = true;
if (variant.includes('circle')) (await import(`${root}/src/simulation/tyre-force.ts`)).DEBUG.circle = true;
for (const c of sim.cars as any[]) {"""
assert a in s
s = s.replace(a, b)
open(p2, 'w').write(s)
print('ok')
