import { TICKS_PER_SNAPSHOT, TICK_MS } from './constants.ts';
import type { Pose } from './prediction.ts';
import type { CarNetState } from './snapshot.ts';

const DT = TICK_MS / 1000;

/** Server-tick clock as observed by a client. Each snapshot gives one
 * sample of (tick − local arrival time); the least-delayed sample in a
 * sliding window anchors the estimate, and the spread of the others is the
 * arrival jitter (RFC 3550-style smoothed deviation). */
export class ServerClock {
  private window: number[] = [];
  private offset = -Infinity;
  jitterTicks = 0;
  samples = 0;
  constructor(private readonly size = 40) {}
  observe(tick: number, localMs: number) {
    const sample = tick - localMs / TICK_MS;
    this.window.push(sample);
    if (this.window.length > this.size) this.window.shift();
    this.offset = Math.max(...this.window);
    const deviation = this.offset - sample;
    this.jitterTicks += (deviation - this.jitterTicks) / 16;
    this.samples++;
  }
  get synced() {
    return this.samples > 0;
  }
  /** Newest server tick a snapshot could have reached us with by `localMs`. */
  arrivalTick(localMs: number) {
    return localMs / TICK_MS + this.offset;
  }
}

/** Snapshot history of one remote car with Hermite interpolation. */
export class RemoteCarTrack {
  private ticks: number[] = [];
  private states: CarNetState[] = [];
  push(tick: number, state: CarNetState) {
    let i = this.ticks.length;
    while (i > 0 && this.ticks[i - 1] > tick) i--;
    if (i > 0 && this.ticks[i - 1] === tick) return false;
    this.ticks.splice(i, 0, tick);
    this.states.splice(i, 0, state);
    const newest = this.ticks[this.ticks.length - 1];
    while (this.ticks.length > 2 && this.ticks[0] < newest - 240) {
      this.ticks.shift();
      this.states.shift();
    }
    return true;
  }
  get newest() {
    return this.ticks.length ? this.ticks[this.ticks.length - 1] : -1;
  }
  latest() {
    return this.states[this.states.length - 1];
  }
  /** Pose at fractional server tick `t`. Extrapolates up to `maxExtrapolate`
   * ticks past the newest snapshot, then holds; null while the buffer does
   * not reach back to `t` yet (just joined: nothing truthful to draw). */
  sample(
    t: number,
    maxExtrapolate = 15,
  ): { pose: Pose; kind: 'interpolated' | 'extrapolated' | 'held' } | null {
    const n = this.ticks.length;
    if (!n) return null;
    if (t >= this.ticks[n - 1]) {
      const s = this.states[n - 1],
        ahead = Math.min(t - this.ticks[n - 1], maxExtrapolate) * DT;
      return {
        pose: {
          x: s.x + s.vx * ahead,
          y: s.y + s.vy * ahead,
          z: s.z + s.vz * ahead,
          qx: s.qx,
          qy: s.qy,
          qz: s.qz,
          qw: s.qw,
        },
        kind:
          t - this.ticks[n - 1] > maxExtrapolate
            ? 'held'
            : t > this.ticks[n - 1]
              ? 'extrapolated'
              : 'interpolated',
      };
    }
    if (t < this.ticks[0]) return null;
    let i = n - 1;
    while (i > 0 && this.ticks[i - 1] > t) i--;
    const a = this.states[i - 1],
      b = this.states[i],
      span = (this.ticks[i] - this.ticks[i - 1]) * DT,
      u = (t - this.ticks[i - 1]) / (this.ticks[i] - this.ticks[i - 1]);
    // Cubic Hermite with the snapshot velocities as tangents.
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1,
      h10 = u ** 3 - 2 * u ** 2 + u,
      h01 = -2 * u ** 3 + 3 * u ** 2,
      h11 = u ** 3 - u ** 2;
    const hermite = (p0: number, v0: number, p1: number, v1: number) =>
      h00 * p0 + h10 * span * v0 + h01 * p1 + h11 * span * v1;
    return {
      pose: {
        x: hermite(a.x, a.vx, b.x, b.vx),
        y: hermite(a.y, a.vy, b.y, b.vy),
        z: hermite(a.z, a.vz, b.z, b.vz),
        ...slerp(a, b, u),
      },
      kind: 'interpolated',
    };
  }
}
function slerp(a: Pose, b: Pose, u: number) {
  let bx = b.qx,
    by = b.qy,
    bz = b.qz,
    bw = b.qw,
    dot = a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  let ka = 1 - u,
    kb = u;
  if (dot < 0.9995) {
    const theta = Math.acos(Math.min(1, dot)),
      s = Math.sin(theta);
    ka = Math.sin((1 - u) * theta) / s;
    kb = Math.sin(u * theta) / s;
  }
  const x = a.qx * ka + bx * kb,
    y = a.qy * ka + by * kb,
    z = a.qz * ka + bz * kb,
    w = a.qw * ka + bw * kb,
    n = Math.hypot(x, y, z, w);
  return { qx: x / n, qy: y / n, qz: z / n, qw: w / n };
}

/** Adaptive interpolation delay (jitter buffer): two snapshot intervals, so
 * one lost snapshot is bridged by interpolation, plus twice the measured
 * arrival jitter. The delay moves by at most half a tick per update, so the
 * remote clock never visibly jumps. */
export class JitterBuffer {
  delayTicks = 2 * TICKS_PER_SNAPSHOT;
  update(clock: ServerClock) {
    const target = Math.min(36, 2 * TICKS_PER_SNAPSHOT + 2 * clock.jitterTicks);
    this.delayTicks += Math.max(-0.5, Math.min(0.5, target - this.delayTicks));
  }
}
