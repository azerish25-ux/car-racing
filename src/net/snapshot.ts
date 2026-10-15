import { clamp } from '../core/math.ts';
import { ByteReader, ByteWriter, DecodeError } from './bytes.ts';
import { LIMITS } from './constants.ts';

/** Per-car network state (compact, quantized). The receiving client's own
 * car is sent FULL (angular velocity and acceleration for prediction); other
 * cars omit those fields, which interpolation does not need. */
export interface CarNetState {
  id: number;
  flags: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  ax: number;
  ay: number;
  az: number;
  steer: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  /** Track progress (m from the line). */
  s: number;
  laps: number;
  rank: number;
}
export const CAR_FLAG = Object.freeze({
  FULL: 1,
  IN_PIT: 2,
  RETIRED: 4,
  FINISHED: 8,
  /** A contact impulse acted on the car within the last snapshot interval. */
  CONTACT: 16,
  /** Driven by the server AI (pit lane, cool-down, disconnect takeover). */
  AI: 32,
  DRS_OPEN: 64,
  /** Disconnected car under the ghost policy (presentation/classification). */
  GHOST: 128,
});
export const emptyCarState = (id = 0): CarNetState => ({
  id,
  flags: 0,
  x: 0,
  y: 0,
  z: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  vx: 0,
  vy: 0,
  vz: 0,
  wx: 0,
  wy: 0,
  wz: 0,
  ax: 0,
  ay: 0,
  az: 0,
  steer: 0,
  throttle: 0,
  brake: 0,
  gear: 0,
  rpm: 0,
  s: 0,
  laps: 0,
  rank: 0,
});

const VEL = 100,
  OMEGA = 1000,
  ACCEL = 50,
  QUAT = 32767;
const q16 = (v: number, scale: number) => Math.round(clamp(v * scale, -32767, 32767));

export function writeCar(w: ByteWriter, c: CarNetState) {
  w.u8(c.id).u8(c.flags);
  w.f32(c.x).f32(c.y).f32(c.z);
  w.i16(q16(c.qx, QUAT)).i16(q16(c.qy, QUAT)).i16(q16(c.qz, QUAT)).i16(q16(c.qw, QUAT));
  w.i16(q16(c.vx, VEL)).i16(q16(c.vy, VEL)).i16(q16(c.vz, VEL));
  if (c.flags & CAR_FLAG.FULL) {
    w.i16(q16(c.wx, OMEGA)).i16(q16(c.wy, OMEGA)).i16(q16(c.wz, OMEGA));
    w.i16(q16(c.ax, ACCEL)).i16(q16(c.ay, ACCEL)).i16(q16(c.az, ACCEL));
  }
  w.i8(Math.round(clamp(c.steer, -1, 1) * 127));
  w.u8(Math.round(clamp(c.throttle, 0, 1) * 255));
  w.u8(Math.round(clamp(c.brake, 0, 1) * 255));
  w.i8(clamp(Math.round(c.gear), -1, 9));
  w.u8(Math.round(clamp(c.rpm / 64, 0, 255)));
  w.f32(c.s);
  w.u8(clamp(c.laps, 0, 255)).u8(clamp(c.rank, 0, 255));
}
export function readCar(r: ByteReader): CarNetState {
  const c = emptyCarState(r.u8());
  c.flags = r.u8();
  c.x = r.f32();
  c.y = r.f32();
  c.z = r.f32();
  let qx = r.i16() / QUAT,
    qy = r.i16() / QUAT,
    qz = r.i16() / QUAT,
    qw = r.i16() / QUAT;
  const n = Math.hypot(qx, qy, qz, qw);
  if (n < 0.5) throw new DecodeError('Invalid orientation');
  qx /= n;
  qy /= n;
  qz /= n;
  qw /= n;
  Object.assign(c, { qx, qy, qz, qw });
  c.vx = r.i16() / VEL;
  c.vy = r.i16() / VEL;
  c.vz = r.i16() / VEL;
  if (c.flags & CAR_FLAG.FULL) {
    c.wx = r.i16() / OMEGA;
    c.wy = r.i16() / OMEGA;
    c.wz = r.i16() / OMEGA;
    c.ax = r.i16() / ACCEL;
    c.ay = r.i16() / ACCEL;
    c.az = r.i16() / ACCEL;
  }
  c.steer = r.i8() / 127;
  c.throttle = r.u8() / 255;
  c.brake = r.u8() / 255;
  c.gear = r.i8();
  c.rpm = r.u8() * 64;
  c.s = r.f32();
  c.laps = r.u8();
  c.rank = r.u8();
  return c;
}
/** The value a receiver decodes for `c` (used by the server so its own
 * bookkeeping and the client agree on quantization). */
export function quantizeCar(c: CarNetState): CarNetState {
  const w = new ByteWriter(64);
  writeCar(w, c);
  return readCar(new ByteReader(w.finish()));
}

/** Snapshot (server → client, unreliable, 20 Hz). The header carries the
 * recipient's input acknowledgement, the measured input slack and an echo of
 * the client's newest packet timestamp for round-trip measurement. */
export interface Snapshot {
  tick: number;
  phase: number;
  raceTime: number;
  /** Highest contiguous input sequence received; -1 when none. */
  ackSeq: number;
  /** Smallest margin (ticks) by which recent commands beat their tick;
   * 127 means no new command arrived in the interval. */
  slack: number;
  /** Ticks in the interval for which no command had arrived (saturating). */
  missing: number;
  echo: number;
  /** ms the server held the echoed packet before this snapshot. */
  hold: number;
  cars: CarNetState[];
}
export function writeSnapshot(w: ByteWriter, s: Snapshot) {
  if (s.cars.length > LIMITS.carsPerSnapshot) throw new Error('Too many cars in snapshot');
  w.u32(s.tick).u8(s.phase).f32(s.raceTime);
  w.u32(s.ackSeq < 0 ? 0xffffffff : s.ackSeq);
  w.i8(clamp(Math.round(s.slack), -128, 127));
  w.u8(clamp(Math.round(s.missing), 0, 255));
  w.u32(s.echo >>> 0).u16(clamp(Math.round(s.hold), 0, 65535));
  w.u8(s.cars.length);
  for (const c of s.cars) writeCar(w, c);
}
export function readSnapshot(r: ByteReader): Snapshot {
  const tick = r.u32(),
    phase = r.u8(),
    raceTime = r.f32(),
    ack = r.u32(),
    slack = r.i8(),
    missing = r.u8(),
    echo = r.u32(),
    hold = r.u16(),
    count = r.u8();
  if (count > LIMITS.carsPerSnapshot) throw new DecodeError('Too many cars');
  const cars: CarNetState[] = [],
    ids = new Set<number>();
  for (let i = 0; i < count; i++) {
    const c = readCar(r);
    if (c.id >= LIMITS.carsPerSnapshot || ids.has(c.id)) throw new DecodeError('Invalid car id');
    ids.add(c.id);
    cars.push(c);
  }
  return {
    tick,
    phase,
    raceTime,
    ackSeq: ack === 0xffffffff ? -1 : ack,
    slack,
    missing,
    echo,
    hold,
    cars,
  };
}
