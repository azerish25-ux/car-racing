import { BikeVehicle } from '../bike-vehicle.ts';
import type { Vehicle } from '../vehicle.ts';

/** Forza-style rewind for the festival session (worker-authoritative): a
 * bounded ring of recent states sampled at a fixed simulation interval —
 * every car's pose, velocities, wheel spin and gearbox (a motorcycle's own
 * dynamics state), and the running event's legal progress and clocks. While
 * the key is held the session scrubs back through it (poses only, nothing
 * is integrated); on release it restores the frame it stopped on exactly
 * and drops everything newer, so legal progress, the event clock and the
 * cars all resume from one consistent instant. */
export const REWIND = Object.freeze({
  /** Sampling interval (s of simulation time). */
  interval: 0.1,
  /** Longest rewind (s). */
  seconds: 10,
  /** Scrub speed (seconds rewound per second held). */
  rate: 2,
});
/** Car record layout (Float64Array per car). */
const C = Object.freeze({
  PX: 0,
  PY: 1,
  PZ: 2,
  QX: 3,
  QY: 4,
  QZ: 5,
  QW: 6,
  VX: 7,
  VY: 8,
  VZ: 9,
  WX: 10,
  WY: 11,
  WZ: 12,
  WHEELS: 13,
  GEAR: 17,
  RPM: 18,
  STEER: 19,
  BIKE_X: 20,
  BIKE_Z: 21,
  BIKE_HEADING: 22,
  BIKE_SPEED: 23,
  BIKE_LEAN: 24,
  BIKE_LEAN_RATE: 25,
  BIKE_STEER: 26,
  STRIDE: 27,
});
export const CAR_RECORD = C;

/** One participant's legal progress (RouteProgress fields) and finish. */
export interface ProgressRecord {
  edge: string;
  s: number;
  checkpoint: number;
  laps: number;
  finished: boolean;
  distance: number;
  offRoute: boolean;
  /** Finish time relative to the event start (s), or null. */
  finish: number | null;
}
/** The running event at the sampled instant (times relative to its start,
 * so a restore shifts the event clock back by the span rewound). */
export interface RunRecord {
  elapsed: number;
  offRoute: number;
  lost: number;
  progressClock: number;
  progress: ProgressRecord[];
  /** Route distance of each AI driver (null: the player). */
  drivers: (number | null)[];
  /** DriftMeter state (drift zones), opaque to the buffer. */
  drift: unknown;
  /** Samples kept per participant trace (touge gaps). */
  traces: number[] | null;
}
export interface RewindFrame {
  /** Simulation time sampled. */
  time: number;
  /** Machine of each car (a frame is only restored onto the same field). */
  vehicles: string[];
  cars: Float64Array[];
  run: RunRecord | null;
}

/** Record one car's dynamic state. */
export function captureCar(car: Vehicle, out = new Float64Array(C.STRIDE)) {
  const b = car.body,
    q = b.orientation;
  out[C.PX] = b.position.x;
  out[C.PY] = b.position.y;
  out[C.PZ] = b.position.z;
  out[C.QX] = q.x;
  out[C.QY] = q.y;
  out[C.QZ] = q.z;
  out[C.QW] = q.w;
  out[C.VX] = b.velocity.x;
  out[C.VY] = b.velocity.y;
  out[C.VZ] = b.velocity.z;
  out[C.WX] = b.omega.x;
  out[C.WY] = b.omega.y;
  out[C.WZ] = b.omega.z;
  for (let i = 0; i < 4; i++) out[C.WHEELS + i] = car.tires[i]?.omega ?? 0;
  out[C.GEAR] = car.gear;
  out[C.RPM] = car.rpm;
  out[C.STEER] = car.steer;
  if (car instanceof BikeVehicle) {
    const d = car.dynamics;
    out[C.BIKE_X] = d.x;
    out[C.BIKE_Z] = d.z;
    out[C.BIKE_HEADING] = d.heading;
    out[C.BIKE_SPEED] = d.speed;
    out[C.BIKE_LEAN] = d.lean;
    out[C.BIKE_LEAN_RATE] = d.leanRate;
    out[C.BIKE_STEER] = d.steer;
  }
  return out;
}
/** Pose a car between two records (`t` 0..1) for the scrub view: position
 * and velocity interpolated, orientation normalised-lerped. Nothing is
 * integrated; the restore on release sets the whole state. */
export function poseCar(car: Vehicle, a: Float64Array, b: Float64Array, t: number) {
  const body = car.body,
    lerp = (k: number) => a[k] + (b[k] - a[k]) * t;
  body.position.set(lerp(C.PX), lerp(C.PY), lerp(C.PZ));
  body.velocity.set(lerp(C.VX), lerp(C.VY), lerp(C.VZ));
  body.omega.set(lerp(C.WX), lerp(C.WY), lerp(C.WZ));
  // Shortest arc between the two orientations.
  const dot = a[C.QX] * b[C.QX] + a[C.QY] * b[C.QY] + a[C.QZ] * b[C.QZ] + a[C.QW] * b[C.QW],
    sign = dot < 0 ? -1 : 1;
  const qx = a[C.QX] + (sign * b[C.QX] - a[C.QX]) * t,
    qy = a[C.QY] + (sign * b[C.QY] - a[C.QY]) * t,
    qz = a[C.QZ] + (sign * b[C.QZ] - a[C.QZ]) * t,
    qw = a[C.QW] + (sign * b[C.QW] - a[C.QW]) * t,
    n = Math.hypot(qx, qy, qz, qw) || 1;
  const q = body.orientation;
  q.x = qx / n;
  q.y = qy / n;
  q.z = qz / n;
  q.w = qw / n;
  for (let i = 0; i < 4; i++) if (car.tires[i]) car.tires[i].omega = lerp(C.WHEELS + i);
  if (car instanceof BikeVehicle) {
    const d = car.dynamics;
    d.x = lerp(C.BIKE_X);
    d.z = lerp(C.BIKE_Z);
    d.heading = a[C.BIKE_HEADING] + angleDelta(a[C.BIKE_HEADING], b[C.BIKE_HEADING]) * t;
    d.speed = lerp(C.BIKE_SPEED);
    d.lean = lerp(C.BIKE_LEAN);
  }
}
const angleDelta = (from: number, to: number) =>
  ((((to - from + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
/** Speed along the car's heading in a record (m/s). */
export function recordSpeed(r: Float64Array) {
  return Math.hypot(r[C.VX], r[C.VZ]);
}

/** Bounded ring of rewind frames, oldest first. */
export class RewindBuffer {
  private readonly frames: RewindFrame[] = [];
  private clock = 0;
  constructor(
    readonly seconds = REWIND.seconds,
    readonly interval = REWIND.interval,
  ) {}
  /** Frames the buffer may hold: the span plus the newest instant. */
  get capacity() {
    return Math.round(this.seconds / this.interval) + 1;
  }
  get size() {
    return this.frames.length;
  }
  get oldest() {
    return this.frames[0]?.time ?? NaN;
  }
  get newest() {
    return this.frames[this.frames.length - 1]?.time ?? NaN;
  }
  /** Seconds of history available behind `time`. */
  available(time: number) {
    return this.frames.length ? Math.max(0, time - this.frames[0].time) : 0;
  }
  /** Advance by `dt`; true when a frame is due. */
  due(dt: number) {
    this.clock += dt;
    if (this.clock + 1e-9 < this.interval && this.frames.length) return false;
    this.clock = 0;
    return true;
  }
  push(frame: RewindFrame) {
    if (this.frames.length && frame.time <= this.newest) return;
    this.frames.push(frame);
    while (this.frames.length > this.capacity) this.frames.shift();
  }
  /** The two frames around `time` and the blend between them. */
  around(time: number): { a: RewindFrame; b: RewindFrame; t: number } | null {
    const f = this.frames;
    if (!f.length) return null;
    if (time <= f[0].time) return { a: f[0], b: f[0], t: 0 };
    for (let i = f.length - 1; i >= 0; i--)
      if (f[i].time <= time) {
        const b = f[Math.min(f.length - 1, i + 1)],
          span = b.time - f[i].time;
        return { a: f[i], b, t: span > 0 ? Math.min(1, (time - f[i].time) / span) : 0 };
      }
    return null;
  }
  /** The newest frame at or before `time` (the oldest if none). */
  at(time: number) {
    const f = this.frames;
    for (let i = f.length - 1; i >= 0; i--) if (f[i].time <= time + 1e-9) return f[i];
    return f[0] ?? null;
  }
  /** Forget every frame after `time` (the restored instant becomes newest). */
  truncate(time: number) {
    while (this.frames.length && this.newest > time + 1e-9) this.frames.pop();
    this.clock = 0;
  }
  /** Move the history's clock by `dt` (the restored instant becomes the
   * present, so the history stays measured in driving time). */
  shift(dt: number) {
    for (const f of this.frames) f.time += dt;
  }
  clear() {
    this.frames.length = 0;
    this.clock = 0;
  }
}
