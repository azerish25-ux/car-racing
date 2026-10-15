import { describe, expect, it } from 'vitest';
import { sessionIdentity } from '../src/core/session-identity.ts';
import { DEFAULT_OPTIONS, controls } from '../src/simulation/config.ts';
import { decodeJournal, encodeJournal, type JournalEntry } from '../src/net/authority.ts';
import { ByteReader, ByteWriter, DecodeError, fromBase64, toBase64 } from '../src/net/bytes.ts';
import {
  MSG,
  decodeClientMessage,
  decodeServerMessage,
  encodeControl,
  encodeInput,
  encodeSnapshot,
} from '../src/net/codec.ts';
import { LIMITS, NET_PROTOCOL_VERSION } from '../src/net/constants.ts';
import { NetRandom } from '../src/net/event-loop.ts';
import {
  quantizeControls,
  readInputPacket,
  sanitizeControls,
  writeInputPacket,
  type InputCommand,
} from '../src/net/input.ts';
import { CAR_FLAG, emptyCarState, quantizeCar, type CarNetState } from '../src/net/snapshot.ts';

const command = (seq: number, tick: number, ticks = 2, steer = 0.25): InputCommand => ({
  seq,
  tick,
  ticks,
  controls: quantizeControls({ ...controls(), throttle: 0.8, steer, drs: true }),
});
const car = (id: number, full: boolean): CarNetState => ({
  ...emptyCarState(id),
  flags: full ? CAR_FLAG.FULL | CAR_FLAG.DRS_OPEN : CAR_FLAG.IN_PIT,
  x: 1234.567,
  y: 12.25,
  z: -987.125,
  qx: 0.1,
  qy: 0.7,
  qz: 0.05,
  qw: Math.sqrt(1 - 0.01 - 0.49 - 0.0025),
  vx: 71.234,
  vy: -0.5,
  vz: 12.01,
  wx: 0.01,
  wy: -0.42,
  wz: 0.003,
  ax: -31.5,
  ay: 2,
  az: 18.25,
  steer: -0.3,
  throttle: 0.9,
  brake: 0.1,
  gear: 6,
  rpm: 11200,
  s: 2011.5,
  laps: 2,
  rank: 3,
});

describe('online codec: controls and input commands', () => {
  it('rejects non-finite controls and clamps out-of-range ones (WP54 input sanity)', () => {
    for (const bad of [NaN, Infinity, -Infinity, '1', null, {}])
      expect(sanitizeControls({ ...controls(), throttle: bad }).ok).toBe(false);
    expect(sanitizeControls(null).ok).toBe(false);
    expect(sanitizeControls('throttle').ok).toBe(false);
    const result = sanitizeControls({ ...controls(), throttle: 3, steer: -7, ers: 9, shift: 0.4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.throttle).toBe(1);
    expect(result.controls.steer).toBe(-1);
    expect(result.controls.ers).toBe(2);
    expect(result.controls.shift).toBe(0);
    expect(result.clamped.sort()).toEqual(['ers', 'steer', 'throttle']);
    // Booleans are strict: only `true` enables an edge.
    const edges = sanitizeControls({ ...controls(), drs: 'yes', overtake: 1, pit: true });
    expect(edges.ok && [edges.controls.drs, edges.controls.overtake, edges.controls.pit]).toEqual([
      false,
      false,
      true,
    ]);
  });
  it('quantizes to exactly the values the server decodes', () => {
    const random = new NetRandom(9);
    for (let i = 0; i < 500; i++) {
      const c = quantizeControls({
        ...controls(),
        throttle: random.next(),
        brake: random.next(),
        clutch: random.next(),
        steer: random.next() * 2 - 1,
        shift: Math.round(random.next() * 2 - 1),
        ers: (i % 3) as 0 | 1 | 2,
        reverse: i % 7 === 0,
        drs: i % 2 === 0,
        overtake: i % 5 === 0,
        pit: i % 11 === 0,
      });
      expect(quantizeControls(c)).toEqual(c);
    }
  });
  it('round-trips a redundant command run and enforces contiguity', () => {
    const commands = [command(41, 900), command(42, 902, 3), command(43, 905, 1, -1)];
    const w = new ByteWriter();
    writeInputPacket(w, { sentAt: 123456, ackTick: 890, commands });
    const back = readInputPacket(new ByteReader(w.finish()));
    expect(back).toEqual({ sentAt: 123456, ackTick: 890, commands });
    expect(() =>
      writeInputPacket(new ByteWriter(), {
        sentAt: 0,
        ackTick: 0,
        commands: [command(1, 10), command(3, 12)],
      }),
    ).toThrow(/contiguous/);
    // 18 B header + 8 B per command.
    expect(encodeInput({ sentAt: 1, ackTick: 2, commands }).length).toBe(1 + 4 + 4 + 1 + 8 + 3 * 8);
  });
});

describe('online codec: snapshots', () => {
  it('encodes the local car FULL (51 B) and remote cars compact (39 B) within quantization', () => {
    const snapshot = {
      tick: 7200,
      phase: 2,
      raceTime: 60.5,
      ackSeq: 1499,
      slack: 3,
      missing: 0,
      echo: 4000000000,
      hold: 12,
      cars: [car(0, true), car(1, false)],
    };
    const bytes = encodeSnapshot(snapshot);
    expect(bytes.length).toBe(1 + 22 + 51 + 39);
    const decoded = decodeServerMessage(bytes, 'unreliable');
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || decoded.value.type !== 'snapshot') return;
    const s = decoded.value.snapshot;
    expect(s.tick).toBe(7200);
    expect(s.ackSeq).toBe(1499);
    expect(s.echo).toBe(4000000000);
    const [full, compact] = s.cars;
    expect(full.x).toBeCloseTo(1234.567, 3);
    expect(full.vx).toBeCloseTo(71.234, 2);
    expect(full.wy).toBeCloseTo(-0.42, 3);
    expect(full.ax).toBeCloseTo(-31.5, 1);
    expect(Math.hypot(full.qx, full.qy, full.qz, full.qw)).toBeCloseTo(1, 9);
    expect(compact.wy).toBe(0);
    expect(compact.flags & CAR_FLAG.IN_PIT).toBeTruthy();
    expect(quantizeCar(full)).toEqual(full);
    expect(encodeSnapshot({ ...snapshot, ackSeq: -1 }).length).toBe(bytes.length);
  });
  it('rejects duplicate car ids, degenerate orientations and trailing bytes', () => {
    const base = {
      tick: 1,
      phase: 0,
      raceTime: 0,
      ackSeq: 0,
      slack: 0,
      missing: 0,
      echo: 0,
      hold: 0,
    };
    expect(
      decodeServerMessage(
        encodeSnapshot({ ...base, cars: [car(2, false), car(2, false)] }),
        'unreliable',
      ).ok,
    ).toBe(false);
    const flat = { ...car(1, false), qx: 0, qy: 0, qz: 0, qw: 0 };
    expect(decodeServerMessage(encodeSnapshot({ ...base, cars: [flat] }), 'unreliable').ok).toBe(
      false,
    );
    const good = encodeSnapshot({ ...base, cars: [car(1, false)] }),
      padded = new Uint8Array(good.length + 1);
    padded.set(good);
    expect(decodeServerMessage(padded, 'unreliable').ok).toBe(false);
  });
});

describe('online codec: untrusted client messages (WP54 size limits)', () => {
  const identity = sessionIdentity({ ...DEFAULT_OPTIONS, opponents: 0, vehicles: ['apx01'] });
  const join = {
    kind: 'join',
    net: NET_PROTOCOL_VERSION,
    name: 'Driver',
    vehicle: 'apx01',
    identity,
  };
  it('accepts a valid join and rejects malformed or oversize ones', () => {
    const ok = decodeClientMessage(encodeControl(join as never), 'reliable');
    expect(ok.ok).toBe(true);
    const cases: [unknown, RegExp][] = [
      [{ ...join, name: '' }, /name/],
      [{ ...join, name: 'x'.repeat(LIMITS.nameLength + 1) }, /name/],
      [{ ...join, name: 'bad\u0007name' }, /name/],
      [{ ...join, identity: { ...identity, circuitHash: 'nothex!!' } }, /identity/],
      [{ ...join, identity: { ...identity, vehicles: [] } }, /identity/],
      [{ ...join, token: 'short' }, /token/],
      [{ ...join, account: 'has space' }, /account/],
      [{ kind: 'ready', ready: 'yes' }, /ready/],
      [{ kind: 'ping', t: null }, /ping/],
      [{ kind: 'admin' }, /unknown/],
      [[1, 2, 3], /object/],
    ];
    for (const [message, reason] of cases) {
      const result = decodeClientMessage(encodeControl(message as never), 'reliable');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(reason);
    }
    // Control messages must use the reliable channel.
    expect(decodeClientMessage(encodeControl(join as never), 'unreliable').ok).toBe(false);
    const huge = encodeControl({
      ...join,
      name: 'x',
      padding: 'y'.repeat(LIMITS.reliableBytes),
    } as never);
    const tooBig = decodeClientMessage(huge, 'reliable');
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.reason).toMatch(/exceeds/);
    const datagram = new Uint8Array(LIMITS.datagramBytes + 1);
    datagram[0] = MSG.INPUT;
    expect(decodeClientMessage(datagram, 'unreliable').ok).toBe(false);
  });
  it('never throws on random or truncated bytes', () => {
    const random = new NetRandom(77);
    const valid = [
      encodeInput({ sentAt: 5, ackTick: 6, commands: [command(1, 10), command(2, 12)] }),
      encodeControl(join as never),
    ];
    let accepted = 0;
    for (let i = 0; i < 4000; i++) {
      let data: Uint8Array;
      if (i % 2) {
        data = new Uint8Array(1 + Math.floor(random.next() * 80));
        for (let k = 0; k < data.length; k++) data[k] = Math.floor(random.next() * 256);
        if (i % 4 === 1) data[0] = MSG.INPUT;
      } else {
        const source = valid[(i >> 1) % valid.length];
        data = source.slice(0, Math.floor(random.next() * source.length));
        if (data.length && i % 3 === 0) data[Math.floor(random.next() * data.length)] ^= 0xff;
      }
      const result = decodeClientMessage(data, i % 5 === 0 ? 'reliable' : 'unreliable');
      if (result.ok) accepted++;
      expect(typeof result.ok).toBe('boolean');
      expect(() => decodeServerMessage(data, 'unreliable')).not.toThrow();
    }
    // Some random input packets are structurally valid; everything else is refused.
    expect(accepted).toBeLessThan(4000);
  });
});

describe('online codec: journals and base64', () => {
  it('round-trips a journal of every entry kind exactly', () => {
    const entries: JournalEntry[] = [
      { tick: 0, car: 1, kind: 'mode', mode: 'ai' },
      { tick: 0, car: 0, kind: 'controls', controls: command(0, 0).controls },
      { tick: 7, car: 0, kind: 'overtake' },
      { tick: 7, car: 2, kind: 'pit', compound: 'soft' },
      { tick: 300, car: 2, kind: 'pit' },
      { tick: 90000, car: 3, kind: 'mode', mode: 'human' },
    ];
    const bytes = encodeJournal(entries);
    expect(decodeJournal(bytes)).toEqual(entries);
    expect(decodeJournal(fromBase64(toBase64(bytes)))).toEqual(entries);
    expect(() => decodeJournal(bytes.slice(0, bytes.length - 2))).toThrow(DecodeError);
    for (const length of [0, 1, 2, 5, 31, 32, 33])
      expect(
        Array.from(fromBase64(toBase64(new Uint8Array(length).map((_, i) => i * 37)))),
      ).toEqual(Array.from(new Uint8Array(length).map((_, i) => i * 37)));
    expect(() => fromBase64('abc')).toThrow(DecodeError);
    expect(() => fromBase64('a=bc')).toThrow(DecodeError);
  });
});
