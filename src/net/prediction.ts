import type { Controls } from '../simulation/config.ts';
import { TICK_MS } from './constants.ts';
import { CAR_FLAG, type CarNetState } from './snapshot.ts';

const DT = TICK_MS / 1000;

export interface Pose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}
/** Inputs the server applied (or will apply) at a tick, if known. */
export type InputLookup = (tick: number) => Controls | undefined;

function rotate(q: ArrayLike<number>, x: number, y: number, z: number, out: Float64Array, o = 0) {
  const qx = q[0],
    qy = q[1],
    qz = q[2],
    qw = q[3],
    tx = 2 * (qy * z - qz * y),
    ty = 2 * (qz * x - qx * z),
    tz = 2 * (qx * y - qy * x);
  out[o] = x + qw * tx + qy * tz - qz * ty;
  out[o + 1] = y + qw * ty + qz * tx - qx * tz;
  out[o + 2] = z + qw * tz + qx * ty - qy * tx;
}
function integrate(q: Float64Array, wx: number, wy: number, wz: number, dt: number) {
  const h = dt * 0.5,
    x = q[0],
    y = q[1],
    z = q[2],
    s = q[3];
  q[0] = x + h * (wx * s + wy * z - wz * y);
  q[1] = y + h * (-wx * z + wy * s + wz * x);
  q[2] = z + h * (wx * y - wy * x + wz * s);
  q[3] = s - h * (wx * x + wy * y + wz * z);
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  q[0] /= n;
  q[1] /= n;
  q[2] /= n;
  q[3] /= n;
}
/** Angle between two orientations (degrees). */
export function headingError(a: Pose, b: Pose) {
  const dot = Math.abs(a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}
export function poseDistance(a: Pose, b: Pose) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const BINS = 20,
  BIN_SPEED = 5,
  FORGET = 0.995;
/** Online-learned response of the local car to its inputs: longitudinal
 * acceleration against throttle/brake and yaw rate against steering, per
 * 5 m/s speed band, with exponential forgetting (≈ 10 s at 20 Hz). Learned
 * from the authoritative stream, so it follows the vehicle class, setup,
 * tyre state and assists without client-side physics. */
export class ResponseModel {
  private normal = new Float64Array(BINS * 9);
  private target = new Float64Array(BINS * 3);
  private yawNum = new Float64Array(BINS);
  private yawDen = new Float64Array(BINS);
  observations = 0;
  private bin(speed: number) {
    return Math.min(BINS - 1, Math.max(0, Math.floor(speed / BIN_SPEED)));
  }
  observe(speed: number, aLong: number, yawRate: number, input: Controls) {
    const b = this.bin(speed),
      x = [1, input.throttle, input.brake];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++)
        this.normal[b * 9 + i * 3 + j] = this.normal[b * 9 + i * 3 + j] * FORGET + x[i] * x[j];
      this.target[b * 3 + i] = this.target[b * 3 + i] * FORGET + x[i] * aLong;
    }
    this.yawNum[b] = this.yawNum[b] * FORGET + yawRate * input.steer;
    this.yawDen[b] = this.yawDen[b] * FORGET + input.steer * input.steer;
    this.observations++;
  }
  /** [d a_long / d throttle, d a_long / d brake] (m/s² per unit input). */
  longGain(speed: number): [number, number] {
    const b = this.bin(speed),
      m = Array.from(this.normal.subarray(b * 9, b * 9 + 9)),
      t = this.target.subarray(b * 3, b * 3 + 3);
    for (const i of [0, 4, 8]) m[i] += 1e-2;
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (!(Math.abs(det) > 1e-6)) return [0, 0];
    // Cramer's rule for the throttle and brake coefficients.
    const replace = (col: number) => {
      const r = [...m];
      for (let i = 0; i < 3; i++) r[i * 3 + col] = t[i];
      return (
        r[0] * (r[4] * r[8] - r[5] * r[7]) -
        r[1] * (r[3] * r[8] - r[5] * r[6]) +
        r[2] * (r[3] * r[7] - r[4] * r[6])
      );
    };
    const gThrottle = replace(1) / det,
      gBrake = replace(2) / det;
    return [
      Number.isFinite(gThrottle) ? Math.max(-5, Math.min(40, gThrottle)) : 0,
      Number.isFinite(gBrake) ? Math.max(-80, Math.min(5, gBrake)) : 0,
    ];
  }
  yawGain(speed: number) {
    const b = this.bin(speed);
    return this.yawDen[b] > 0.05 ? this.yawNum[b] / this.yawDen[b] : 0;
  }
}

export interface PredictorOptions {
  /** Input-to-response delay used by the learned model (ticks). */
  responseLagTicks: number;
  /** First-order response time of acceleration/yaw changes (s). */
  responseSeconds: number;
  /** Visual error decay time constant (s), normally and during contact. */
  smoothingSeconds: number;
  contactSmoothingSeconds: number;
  /** Corrections larger than this (m / degrees) snap instead of blending. */
  snapMeters: number;
  snapDegrees: number;
  /** Never predict further than this past the authoritative state. */
  maxHorizonTicks: number;
}
export const DEFAULT_PREDICTOR: PredictorOptions = Object.freeze({
  responseLagTicks: 6,
  responseSeconds: 0.04,
  smoothingSeconds: 0.1,
  contactSmoothingSeconds: 0.04,
  snapMeters: 5,
  snapDegrees: 25,
  maxHorizonTicks: 60,
});

export interface PredictionStats {
  /** |predicted − authoritative| at the authoritative tick (m, degrees). */
  positionError: number[];
  headingError: number[];
  /** The same, split: human-driven with no contact in the prediction
   * window, versus within reach of a server-resolved contact or AI-driven. */
  positionErrorClean: number[];
  positionErrorContact: number[];
  positionErrorAi: number[];
  /** Jump of the present predicted pose when re-predicting (m). */
  correction: number[];
  /** Per rendered frame, change of the smoothing offset (m): the motion the
   * player sees that is not the car's own. */
  visualStep: number[];
  snaps: number;
  reconciles: number;
  aiDriven: number;
}

/** Local-car prediction (WP50). Full re-simulation of the shared world on
 * the client is not possible today (the Simulation has no state restore and
 * re-running every car for each correction would cost ≈ 20 ms per snapshot),
 * so the client predicts only its own car: from the newest authoritative
 * state it integrates a constant-turn-rate-and-acceleration model, corrected
 * for its own unacknowledged inputs through the learned ResponseModel, up to
 * the tick its newest command covers. A new snapshot re-runs that from the
 * new authoritative state; the difference to the previous present pose goes
 * into a visual offset that decays smoothly (or snaps when large). Contacts
 * are never predicted: the server alone resolves them, and a CONTACT flag
 * only shortens the smoothing time so the player feels the impact promptly. */
export class LocalCarPredictor {
  readonly options: PredictorOptions;
  readonly model = new ResponseModel();
  readonly stats: PredictionStats = {
    positionError: [],
    headingError: [],
    positionErrorClean: [],
    positionErrorContact: [],
    positionErrorAi: [],
    correction: [],
    visualStep: [],
    snaps: 0,
    reconciles: 0,
    aiDriven: 0,
  };
  private p = new Float64Array(3);
  private v = new Float64Array(3);
  private q = new Float64Array(4);
  private w = new Float64Array(3);
  private ab = new Float64Array(3);
  private scratch = new Float64Array(3);
  private half = new Float64Array(4);
  private ref = { throttle: 0, brake: 0, steer: 0 };
  private gains = { throttle: 0, brake: 0, yaw: 0 };
  private dLong = 0;
  private dYaw = 0;
  private inputAware = true;
  private baseTick = -1;
  /** Last predicted tick. */
  tick = -1;
  private history = new Map<number, Pose>();
  /** First prediction made for each tick (the pose displayed at that time). */
  private shown = new Map<number, Pose>();
  private newest = -1;
  private offset = new Float64Array(3);
  private rotOffset = new Float64Array(3);
  private contactUntil = -Infinity;
  private lastContactTick = -Infinity;
  private lastRender = -1;
  private lastAuth: { tick: number; state: CarNetState } | null = null;
  constructor(options: Partial<PredictorOptions> = {}) {
    this.options = { ...DEFAULT_PREDICTOR, ...options };
  }
  get ready() {
    return this.baseTick >= 0;
  }
  private pose(): Pose {
    return {
      x: this.p[0],
      y: this.p[1],
      z: this.p[2],
      qx: this.q[0],
      qy: this.q[1],
      qz: this.q[2],
      qw: this.q[3],
    };
  }
  /** Learn from consecutive authoritative states of the local car. */
  private learn(state: CarNetState, tick: number, inputAt: InputLookup) {
    if (state.flags & CAR_FLAG.AI) return;
    const input = inputAt(tick - this.options.responseLagTicks);
    if (!input) return;
    rotate([state.qx, state.qy, state.qz, state.qw], 0, 0, 1, this.scratch);
    const fx = this.scratch[0],
      fz = this.scratch[2],
      speed = Math.hypot(state.vx, state.vz),
      aLong = state.ax * fx + state.az * fz;
    this.model.observe(speed, aLong, state.wy, input);
  }
  /** Re-predict from a new authoritative state at `tick` up to `present`. */
  reconcile(state: CarNetState, tick: number, inputAt: InputLookup, present: number, now: number) {
    if (tick <= this.baseTick) return;
    // Error of what was shown: the first (full-horizon) prediction of `tick`.
    if (state.flags & CAR_FLAG.CONTACT) this.lastContactTick = tick;
    const shown = this.shown.get(tick);
    if (shown) {
      const auth: Pose = state,
        error = poseDistance(shown, auth);
      this.stats.positionError.push(error);
      this.stats.headingError.push(headingError(shown, auth));
      if (state.flags & CAR_FLAG.AI) this.stats.positionErrorAi.push(error);
      else if (tick - this.lastContactTick <= this.options.maxHorizonTicks)
        this.stats.positionErrorContact.push(error);
      else this.stats.positionErrorClean.push(error);
    }
    for (const t of this.shown.keys()) if (t <= tick) this.shown.delete(t);
    this.learn(state, tick, inputAt);
    let before: Pose | null = null;
    if (this.ready) {
      this.advance(present, inputAt);
      before = this.pose();
    }
    this.start(state, tick, inputAt);
    this.advance(present, inputAt);
    for (const t of this.history.keys()) if (t <= tick) this.history.delete(t);
    this.stats.reconciles++;
    if (state.flags & CAR_FLAG.AI) this.stats.aiDriven++;
    if (state.flags & CAR_FLAG.CONTACT) this.contactUntil = now + 300;
    if (!before) return;
    const after = this.pose(),
      dx = before.x - after.x,
      dy = before.y - after.y,
      dz = before.z - after.z,
      jump = Math.hypot(dx, dy, dz),
      angle = headingError(before, after);
    this.stats.correction.push(jump);
    // Age the existing offset to now before adding this correction to it.
    this.decay(now);
    if (jump > this.options.snapMeters || angle > this.options.snapDegrees) {
      this.offset.fill(0);
      this.rotOffset.fill(0);
      this.stats.snaps++;
      return;
    }
    this.offset[0] += dx;
    this.offset[1] += dy;
    this.offset[2] += dz;
    // Small-angle rotation taking the new orientation to the old one: the
    // vector part of old ⊗ conj(new), doubled.
    const a = before,
      b = after,
      rx = a.qx * b.qw - a.qw * b.qx - a.qy * b.qz + a.qz * b.qy,
      ry = a.qy * b.qw - a.qw * b.qy + a.qx * b.qz - a.qz * b.qx,
      rz = a.qz * b.qw - a.qw * b.qz - a.qx * b.qy + a.qy * b.qx,
      sign = b.qw * a.qw + b.qx * a.qx + b.qy * a.qy + b.qz * a.qz < 0 ? -1 : 1;
    this.rotOffset[0] += 2 * rx * sign;
    this.rotOffset[1] += 2 * ry * sign;
    this.rotOffset[2] += 2 * rz * sign;
  }
  private start(state: CarNetState, tick: number, inputAt: InputLookup) {
    this.lastAuth = { tick, state };
    this.baseTick = tick;
    this.tick = tick;
    this.p.set([state.x, state.y, state.z]);
    this.v.set([state.vx, state.vy, state.vz]);
    this.q.set([state.qx, state.qy, state.qz, state.qw]);
    this.w.set([state.wx, state.wy, state.wz]);
    // Body-frame acceleration: held while the car rotates (CTRA).
    const q = this.q,
      inv = [-q[0], -q[1], -q[2], q[3]];
    rotate(inv, state.ax, state.ay, state.az, this.ab);
    this.inputAware = (state.flags & CAR_FLAG.AI) === 0;
    const ref = inputAt(tick - this.options.responseLagTicks);
    this.ref = ref
      ? { throttle: ref.throttle, brake: ref.brake, steer: ref.steer }
      : { throttle: state.throttle, brake: state.brake, steer: 0 };
    const speed = Math.hypot(state.vx, state.vz),
      [gThrottle, gBrake] = this.model.longGain(speed);
    this.gains = { throttle: gThrottle, brake: gBrake, yaw: this.model.yawGain(speed) };
    this.dLong = 0;
    this.dYaw = 0;
    this.history.set(tick, this.pose());
  }
  /** Extend the prediction to `present` (new commands were issued). */
  advance(present: number, inputAt: InputLookup) {
    if (!this.ready) return;
    const limit = Math.min(present, this.baseTick + this.options.maxHorizonTicks),
      alpha = Math.min(1, DT / this.options.responseSeconds),
      lag = this.options.responseLagTicks,
      a = this.scratch;
    while (this.tick < limit) {
      const t = ++this.tick;
      if (this.inputAware) {
        const input = inputAt(t - lag);
        if (input) {
          const long =
            this.gains.throttle * (input.throttle - this.ref.throttle) +
            this.gains.brake * (input.brake - this.ref.brake);
          const yaw = this.gains.yaw * (input.steer - this.ref.steer);
          this.dLong += (long - this.dLong) * alpha;
          this.dYaw += (yaw - this.dYaw) * alpha;
        }
      }
      // Midpoint step: acceleration at the half-step orientation, and
      // p += v·dt + ½a·dt², exact for constant acceleration.
      const yawRate = this.w[1] + this.dYaw;
      this.half.set(this.q);
      integrate(this.half, this.w[0] * 0.5, yawRate * 0.5, this.w[2] * 0.5, DT);
      rotate(this.half, this.ab[0], this.ab[1], this.ab[2] + this.dLong, a);
      this.p[0] += (this.v[0] + 0.5 * a[0] * DT) * DT;
      this.p[1] += (this.v[1] + 0.5 * a[1] * DT) * DT;
      this.p[2] += (this.v[2] + 0.5 * a[2] * DT) * DT;
      this.v[0] += a[0] * DT;
      this.v[1] += a[1] * DT;
      this.v[2] += a[2] * DT;
      if (this.dYaw) {
        const c = Math.cos(this.dYaw * DT),
          s = Math.sin(this.dYaw * DT),
          vx = this.v[0],
          vz = this.v[2];
        this.v[0] = vx * c + vz * s;
        this.v[2] = -vx * s + vz * c;
      }
      integrate(this.q, this.w[0], yawRate, this.w[2], DT);
      const pose = this.pose();
      this.history.set(t, pose);
      if (t > this.newest) {
        this.newest = t;
        this.shown.set(t, pose);
      }
    }
  }
  /** Pose to draw now: prediction plus the decaying correction offset. */
  /** Decay the smoothing offset up to `now`; returns how far it moved. */
  private decay(now: number) {
    if (this.lastRender < 0 || now <= this.lastRender) {
      this.lastRender = Math.max(this.lastRender, now);
      return 0;
    }
    const dt = (now - this.lastRender) / 1000,
      tau =
        now < this.contactUntil
          ? this.options.contactSmoothingSeconds
          : this.options.smoothingSeconds,
      k = Math.exp(-dt / tau),
      before = Math.hypot(this.offset[0], this.offset[1], this.offset[2]);
    for (let i = 0; i < 3; i++) {
      this.offset[i] *= k;
      this.rotOffset[i] *= k;
    }
    this.lastRender = now;
    return before * (1 - k);
  }
  render(now: number): Pose {
    const pose = this.pose(),
      first = this.lastRender < 0,
      step = this.decay(now);
    if (!first) this.stats.visualStep.push(step);
    this.lastRender = now;
    pose.x += this.offset[0];
    pose.y += this.offset[1];
    pose.z += this.offset[2];
    // Apply the small rotation offset: q' = exp(r/2) ⊗ q.
    const rx = this.rotOffset[0] / 2,
      ry = this.rotOffset[1] / 2,
      rz = this.rotOffset[2] / 2,
      { qx, qy, qz, qw } = pose;
    let x = qx + rx * qw + ry * qz - rz * qy,
      y = qy - rx * qz + ry * qw + rz * qx,
      z = qz + rx * qy - ry * qx + rz * qw,
      w = qw - rx * qx - ry * qy - rz * qz;
    const n = Math.hypot(x, y, z, w);
    x /= n;
    y /= n;
    z /= n;
    w /= n;
    return { ...pose, qx: x, qy: y, qz: z, qw: w };
  }
  /** Latest authoritative state of the local car, for HUD fields. */
  get authoritative() {
    return this.lastAuth;
  }
  /** Predicted (unsmoothed) pose at `tick`, if still held. */
  predictedAt(tick: number) {
    return this.history.get(tick);
  }
}
