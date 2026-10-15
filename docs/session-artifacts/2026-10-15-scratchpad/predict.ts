import { DEFAULT_OPTIONS, validateOptions } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/simulation/config.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/simulation/world.ts';

interface Row {
  p: number[];
  v: number[];
  q: number[];
  w: number[];
  thr: number;
  brk: number;
  str: number;
}
const sim = new Simulation(
  validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', laps: 3, opponents: 7, seed: 909 }),
);
sim.autoPlayer = true;
const CAR = Number(process.argv[2] ?? 3);
const rows: Row[] = [];
for (let tick = 0; tick < 120 * 66; tick++) {
  sim.step(1 / 120);
  const c = sim.cars[CAR],
    b = c.body;
  rows.push({
    p: [b.position.x, b.position.y, b.position.z],
    v: [b.velocity.x, b.velocity.y, b.velocity.z],
    q: [b.orientation.x, b.orientation.y, b.orientation.z, b.orientation.w],
    w: [b.omega.x, b.omega.y, b.omega.z],
    thr: c.input.throttle,
    brk: c.input.brake,
    str: c.input.steer,
  });
}
// quaternion helpers
function rot(q: number[], v: number[]) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]),
    ty = 2 * (z * v[0] - x * v[2]),
    tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
function inv(q: number[]) {
  return [-q[0], -q[1], -q[2], q[3]];
}
function integ(q: number[], w: number[], dt: number) {
  const h = dt * 0.5,
    [x, y, z, s] = q;
  const o = [x + h * (w[0] * s + w[1] * z - w[2] * y), y + h * (-w[0] * z + w[1] * s + w[2] * x), z + h * (w[0] * y - w[1] * x + w[2] * s), s - h * (w[0] * x + w[1] * y + w[2] * z)];
  const n = Math.hypot(...o);
  return o.map((k) => k / n);
}
const DT = 1 / 120;
const H = Number(process.argv[3] ?? 18);
const K = 3;
// learned tables
const bins = 20;
const yawNum = new Float64Array(bins),
  yawDen = new Float64Array(bins);
function bin(v: number) {
  return Math.min(bins - 1, Math.max(0, Math.floor(v / 5)));
}
// long accel regression per bin: a = c0 + c1 thr + c2 brk (accumulate normal equations)
const XtX = Array.from({ length: bins }, () => new Float64Array(9)),
  Xty = Array.from({ length: bins }, () => new Float64Array(3));
function solve3(A: Float64Array, b: Float64Array) {
  // add ridge
  const m = [A[0] + 1e-3, A[1], A[2], A[3], A[4] + 1e-3, A[5], A[6], A[7], A[8] + 1e-3];
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(det) < 1e-9) return [0, 0, 0];
  const invm = [
    (m[4] * m[8] - m[5] * m[7]) / det, (m[2] * m[7] - m[1] * m[8]) / det, (m[1] * m[5] - m[2] * m[4]) / det,
    (m[5] * m[6] - m[3] * m[8]) / det, (m[0] * m[8] - m[2] * m[6]) / det, (m[2] * m[3] - m[0] * m[5]) / det,
    (m[3] * m[7] - m[4] * m[6]) / det, (m[1] * m[6] - m[0] * m[7]) / det, (m[0] * m[4] - m[1] * m[3]) / det,
  ];
  return [invm[0] * b[0] + invm[1] * b[1] + invm[2] * b[2], invm[3] * b[0] + invm[4] * b[1] + invm[5] * b[2], invm[6] * b[0] + invm[7] * b[1] + invm[8] * b[2]];
}
const LAG = Number(process.argv[4] ?? 6);
function learn(T: number) {
  // learn from snapshot interval [T-6, T]
  const r = rows[T],
    r0 = rows[T - 6];
  const speed = Math.hypot(r.v[0], r.v[2]);
  const fwd = rot(r.q, [0, 0, 1]);
  const a = [(r.v[0] - r0.v[0]) / (6 * DT), 0, (r.v[2] - r0.v[2]) / (6 * DT)];
  const along = a[0] * fwd[0] + a[2] * fwd[2];
  const lr = rows[T - LAG] ?? r;
  const b = bin(speed);
  const x = [1, lr.thr, lr.brk];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) XtX[b][i * 3 + j] = XtX[b][i * 3 + j] * 0.995 + x[i] * x[j];
    Xty[b][i] = Xty[b][i] * 0.995 + x[i] * along;
  }
  yawNum[b] = yawNum[b] * 0.995 + r.w[1] * lr.str;
  yawDen[b] = yawDen[b] * 0.995 + lr.str * lr.str;
}
function predict(T: number, model: string) {
  const r = rows[T],
    rk = rows[T - K];
  let p = [...r.p],
    v = [...r.v],
    q = [...r.q],
    w = [...r.w];
  const aw = [(r.v[0] - rk.v[0]) / (K * DT), (r.v[1] - rk.v[1]) / (K * DT), (r.v[2] - rk.v[2]) / (K * DT)];
  const ab = rot(inv(r.q), aw);
  const speed0 = Math.hypot(r.v[0], r.v[2]);
  const b0 = bin(speed0);
  const coef = solve3(XtX[b0], Xty[b0]);
  const kyaw = yawDen[b0] > 1e-3 ? yawNum[b0] / yawDen[b0] : 0;
  const ref = rows[T - LAG] ?? r;
  let dyaw = 0,
    dlong = 0;
  for (let i = 1; i <= H; i++) {
    const inp = rows[T + i - LAG] ?? rows[T + i];
    if (model === 'cv') {
      // constant velocity
    } else {
      const abNow = [...ab];
      if (model === 'input') {
        const targetLong = coef[1] * (inp.thr - ref.thr) + coef[2] * (inp.brk - ref.brk);
        const targetYaw = kyaw * (inp.str - ref.str);
        dlong += (targetLong - dlong) * Math.min(1, DT / 0.04);
        dyaw += (targetYaw - dyaw) * Math.min(1, DT / 0.04);
        abNow[2] += dlong;
        const sp = Math.hypot(v[0], v[2]);
        abNow[0] += -sp * dyaw * 0; // lateral handled by rotation of velocity
        w = [r.w[0], r.w[1] + dyaw, r.w[2]];
      }
      const a = rot(q, abNow);
      v = [v[0] + a[0] * DT, v[1] + a[1] * DT, v[2] + a[2] * DT];
      if (model === 'input') {
        // rotate velocity with extra yaw so lateral accel responds to steering
        const ang = dyaw * DT;
        const c = Math.cos(ang),
          s = Math.sin(ang);
        v = [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
      }
    }
    p = [p[0] + v[0] * DT, p[1] + v[1] * DT, p[2] + v[2] * DT];
    q = integ(q, w, DT);
  }
  const t = rows[T + H];
  return Math.hypot(p[0] - t.p[0], p[1] - t.p[1], p[2] - t.p[2]);
}
for (const model of ['cv', 'ctra', 'input']) {
  XtX.forEach((a) => a.fill(0));
  Xty.forEach((a) => a.fill(0));
  yawNum.fill(0);
  yawDen.fill(0);
  const errs: number[] = [];
  for (let T = 120 * 7; T + H < rows.length; T += 6) {
    learn(T);
    if (T > 120 * 12) errs.push(predict(T, model));
  }
  errs.sort((a, b) => a - b);
  const mean = errs.reduce((s, x) => s + x, 0) / errs.length;
  console.log(model, 'H', H, 'mean', mean.toFixed(3), 'p50', errs[Math.floor(errs.length * 0.5)].toFixed(3), 'p95', errs[Math.floor(errs.length * 0.95)].toFixed(3), 'max', errs[errs.length - 1].toFixed(3));
}
