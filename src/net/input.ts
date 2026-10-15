import { clamp } from '../core/math.ts';
import { controls as neutralControls, type Controls } from '../simulation/config.ts';
import { ByteReader, ByteWriter, DecodeError } from './bytes.ts';
import { LIMITS } from './constants.ts';

/** A sequenced input command: the controls a driver wants applied to the
 * server ticks [tick, tick + ticks). Commands are contiguous in both `seq`
 * and `tick`, so a packet carries a run of them with a single base. */
export interface InputCommand {
  seq: number;
  tick: number;
  ticks: number;
  controls: Controls;
}

export type SanitizeResult =
  | { ok: true; controls: Controls; clamped: string[] }
  | { ok: false; reason: string };

const NUMERIC = ['throttle', 'brake', 'clutch', 'steer', 'shift', 'ers'] as const;
const RANGE: Record<(typeof NUMERIC)[number], readonly [number, number]> = {
  throttle: [0, 1],
  brake: [0, 1],
  clutch: [0, 1],
  steer: [-1, 1],
  shift: [-1, 1],
  ers: [0, 2],
};
/** Input sanity limits (WP54): a non-finite or non-numeric control rejects
 * the whole sample; out-of-range values are clamped and reported. */
export function sanitizeControls(raw: unknown): SanitizeResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'controls must be an object' };
  const r = raw as Record<string, unknown>,
    out = neutralControls(),
    clamped: string[] = [];
  for (const key of NUMERIC) {
    // An absent field is neutral; anything present must be a finite number.
    const v = r[key] === undefined ? (key === 'ers' ? 1 : 0) : r[key];
    if (typeof v !== 'number' || !Number.isFinite(v))
      return { ok: false, reason: `${key} is not a finite number` };
    const [a, b] = RANGE[key],
      c = clamp(v, a, b);
    if (c !== v) clamped.push(key);
    if (key === 'shift') out.shift = Math.sign(Math.round(c));
    else if (key === 'ers') out.ers = Math.round(c) as 0 | 1 | 2;
    else out[key] = c;
  }
  out.manualClutch = r.manualClutch === true;
  out.reverse = r.reverse === true;
  out.pit = r.pit === true;
  out.drs = r.drs === true;
  out.overtake = r.overtake === true;
  return { ok: true, controls: out, clamped };
}

const SHIFT_CODE = (shift: number) => (shift > 0 ? 1 : shift < 0 ? 2 : 0);
/** Wire representation: pedals 8 bit, steering 16 bit, discrete fields in a
 * 16-bit word. Both peers derive the applied value from these integers, so
 * the client predicts with exactly the numbers the server applies. */
export function writeControls(w: ByteWriter, c: Controls) {
  w.u8(Math.round(clamp(c.throttle, 0, 1) * 255));
  w.u8(Math.round(clamp(c.brake, 0, 1) * 255));
  w.u8(Math.round(clamp(c.clutch, 0, 1) * 255));
  w.i16(Math.round(clamp(c.steer, -1, 1) * 32767));
  const bits =
    SHIFT_CODE(c.shift) |
    ((c.ers === 0 ? 0 : c.ers === 2 ? 2 : 1) << 2) |
    (c.manualClutch ? 1 << 4 : 0) |
    (c.reverse ? 1 << 5 : 0) |
    (c.drs ? 1 << 6 : 0) |
    (c.overtake ? 1 << 7 : 0) |
    (c.pit ? 1 << 8 : 0);
  w.u16(bits);
}
export function readControls(r: ByteReader): Controls {
  const throttle = r.u8() / 255,
    brake = r.u8() / 255,
    clutch = r.u8() / 255,
    steerRaw = r.i16(),
    bits = r.u16();
  if (steerRaw < -32767) throw new DecodeError('steer out of range');
  if (bits >> 9) throw new DecodeError('unknown control bits');
  const shiftCode = bits & 3,
    ers = (bits >> 2) & 3;
  if (shiftCode === 3 || ers === 3) throw new DecodeError('invalid discrete control');
  return {
    throttle,
    brake,
    clutch,
    steer: steerRaw / 32767,
    shift: shiftCode === 1 ? 1 : shiftCode === 2 ? -1 : 0,
    ers: ers as 0 | 1 | 2,
    manualClutch: (bits & (1 << 4)) !== 0,
    reverse: (bits & (1 << 5)) !== 0,
    drs: (bits & (1 << 6)) !== 0,
    overtake: (bits & (1 << 7)) !== 0,
    pit: (bits & (1 << 8)) !== 0,
  };
}
/** The exact value the server will apply for `c`. */
export function quantizeControls(c: Controls): Controls {
  const w = new ByteWriter(8);
  writeControls(w, c);
  return readControls(new ByteReader(w.finish()));
}
export const CONTROLS_WIRE_BYTES = 7;

export function sameControls(a: Controls, b: Controls) {
  return (
    a.throttle === b.throttle &&
    a.brake === b.brake &&
    a.clutch === b.clutch &&
    a.steer === b.steer &&
    a.shift === b.shift &&
    a.ers === b.ers &&
    a.manualClutch === b.manualClutch &&
    a.reverse === b.reverse &&
    !!a.drs === !!b.drs &&
    !!a.overtake === !!b.overtake &&
    a.pit === b.pit
  );
}
/** Held on the grid until a driver's first command arrives. */
export function holdControls(): Controls {
  return { ...neutralControls(), brake: 1 };
}

/** Client side: every command issued, the resend set (unacknowledged) and
 * the per-tick lookup the predictor replays from. */
export class ClientCommandLog {
  private commands: InputCommand[] = [];
  nextSeq = 0;
  nextTick = 0;
  ackSeq = -1;
  started = false;
  start(tick: number) {
    this.commands = [];
    this.nextTick = tick;
    this.started = true;
  }
  issue(ticks: number, controls: Controls): InputCommand {
    const command: InputCommand = {
      seq: this.nextSeq++,
      tick: this.nextTick,
      ticks: clamp(Math.round(ticks), 1, LIMITS.commandTicksMax),
      controls: quantizeControls(controls),
    };
    this.nextTick += command.ticks;
    this.commands.push(command);
    return command;
  }
  acknowledge(seq: number) {
    if (seq > this.ackSeq) this.ackSeq = seq;
  }
  /** Newest unacknowledged commands (contiguous), at most `limit`, skipping
   * any whose ticks the server has certainly already simulated. */
  resend(limit: number, serverTick: number): InputCommand[] {
    const out: InputCommand[] = [];
    for (let i = this.commands.length - 1; i >= 0 && out.length < limit; i--) {
      const c = this.commands[i];
      if (c.seq <= this.ackSeq || c.tick + c.ticks <= serverTick) break;
      out.push(c);
    }
    return out.reverse();
  }
  /** Controls the server should apply at `tick`, if this client issued them. */
  at(tick: number): InputCommand | undefined {
    let lo = 0,
      hi = this.commands.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1,
        c = this.commands[mid];
      if (tick < c.tick) hi = mid - 1;
      else if (tick >= c.tick + c.ticks) lo = mid + 1;
      else return c;
    }
    return undefined;
  }
  /** Forget commands that end before `tick` and are acknowledged. */
  prune(tick: number) {
    let n = 0;
    while (
      n < this.commands.length &&
      this.commands[n].tick + this.commands[n].ticks < tick &&
      this.commands[n].seq <= this.ackSeq
    )
      n++;
    if (n) this.commands.splice(0, n);
  }
  get size() {
    return this.commands.length;
  }
}

export interface QueueStats {
  packets: number;
  commands: number;
  duplicates: number;
  /** Commands that arrived after every tick they covered was simulated. */
  late: number;
  lateTicks: number;
  rejected: number;
  /** Ticks with no command, where the previous controls were repeated. */
  missingTicks: number;
  appliedTicks: number;
}
export interface Slot {
  controls: Controls;
  /** First tick of its command: edge controls (overtake, pit) apply here only. */
  first: boolean;
}
/** Server side, one per driver: dedups redundant copies, rejects commands
 * outside the accepted window, and yields the command for each tick. */
export class ServerInputQueue {
  private pending = new Map<number, Slot>();
  /** seq → first tick, for received commands above the contiguous ack. */
  private seen = new Map<number, number>();
  contiguousSeq = -1;
  private slack = Infinity;
  readonly stats: QueueStats = {
    packets: 0,
    commands: 0,
    duplicates: 0,
    late: 0,
    lateTicks: 0,
    rejected: 0,
    missingTicks: 0,
    appliedTicks: 0,
  };
  /** Accept a decoded command run at server tick `now` (next tick to simulate). */
  accept(commands: readonly InputCommand[], now: number) {
    this.stats.packets++;
    for (const c of commands) {
      if (c.seq <= this.contiguousSeq || this.seen.has(c.seq)) {
        this.stats.duplicates++;
        continue;
      }
      if (c.tick > now + LIMITS.leadTicksMax || c.ticks < 1 || c.ticks > LIMITS.commandTicksMax) {
        this.stats.rejected++;
        this.mark(c.seq, c.tick);
        continue;
      }
      this.stats.commands++;
      this.mark(c.seq, c.tick);
      if (c.tick + c.ticks <= now) {
        this.stats.late++;
        this.stats.lateTicks += c.ticks;
        continue;
      }
      this.slack = Math.min(this.slack, c.tick - now);
      for (let t = c.tick; t < c.tick + c.ticks; t++) {
        if (t < now) {
          this.stats.lateTicks++;
          continue;
        }
        if (!this.pending.has(t))
          this.pending.set(t, { controls: c.controls, first: t === c.tick });
      }
    }
  }
  private mark(seq: number, tick: number) {
    this.seen.set(seq, tick);
    while (this.seen.has(this.contiguousSeq + 1)) this.seen.delete(++this.contiguousSeq);
  }
  /** The command slot for `tick`, or null when none arrived in time. */
  take(tick: number): Slot | null {
    const slot = this.pending.get(tick) ?? null;
    for (const t of this.pending.keys()) if (t <= tick) this.pending.delete(t);
    // A gap whose successor already started is in the past: never wait on it.
    for (;;) {
      let next = Infinity;
      for (const seq of this.seen.keys()) next = Math.min(next, seq);
      if (next === Infinity || (this.seen.get(next) as number) > tick) break;
      this.contiguousSeq = next - 1;
      while (this.seen.has(this.contiguousSeq + 1)) this.seen.delete(++this.contiguousSeq);
    }
    if (slot) this.stats.appliedTicks++;
    return slot;
  }
  /** Smallest margin (ticks) by which a new command beat its first tick since
   * the last call; Infinity when nothing new arrived. */
  takeSlack() {
    const s = this.slack;
    this.slack = Infinity;
    return s;
  }
  get depth() {
    return this.pending.size;
  }
}

/** Input packet (client → server, unreliable). */
export interface InputPacket {
  /** Client clock (ms, wrapped to 32 bits) echoed back for RTT measurement. */
  sentAt: number;
  /** Newest snapshot tick the client has received. */
  ackTick: number;
  commands: InputCommand[];
}
export function writeInputPacket(w: ByteWriter, p: InputPacket) {
  const n = p.commands.length;
  if (n > LIMITS.commandsPerPacket) throw new Error('Too many commands for one packet');
  w.u32(p.sentAt >>> 0).u32(p.ackTick >>> 0);
  w.u8(n);
  if (!n) return;
  w.u32(p.commands[0].seq).u32(p.commands[0].tick);
  for (let i = 0; i < n; i++) {
    const c = p.commands[i];
    if (
      i &&
      (c.seq !== p.commands[i - 1].seq + 1 ||
        c.tick !== p.commands[i - 1].tick + p.commands[i - 1].ticks)
    )
      throw new Error('Commands in a packet must be contiguous');
    w.u8(c.ticks);
    writeControls(w, c.controls);
  }
}
export function readInputPacket(r: ByteReader): InputPacket {
  const sentAt = r.u32(),
    ackTick = r.u32(),
    n = r.u8();
  if (n > LIMITS.commandsPerPacket) throw new DecodeError('Too many commands');
  const commands: InputCommand[] = [];
  if (n) {
    let seq = r.u32(),
      tick = r.u32();
    for (let i = 0; i < n; i++) {
      const ticks = r.u8();
      if (ticks < 1 || ticks > LIMITS.commandTicksMax)
        throw new DecodeError('Invalid command length');
      commands.push({ seq, tick, ticks, controls: readControls(r) });
      seq++;
      tick += ticks;
      if (seq > 0xffffffff || tick > 0xffffffff) throw new DecodeError('Sequence overflow');
    }
  }
  return { sentAt, ackTick, commands };
}
