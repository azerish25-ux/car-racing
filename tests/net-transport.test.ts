import { describe, expect, it } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import { LIMITS } from '../src/net/constants.ts';
import { EventLoop } from '../src/net/event-loop.ts';
import { TickBudgetMonitor, TokenBucket, distribution } from '../src/net/guards.ts';
import {
  ClientCommandLog,
  ServerInputQueue,
  quantizeControls,
  type InputCommand,
} from '../src/net/input.ts';
import { NetworkSimulator, TARGET_LINK, type Channel } from '../src/net/transport.ts';

describe('event loop', () => {
  it('runs events in time order, ties in scheduling order, periodic events without drift', () => {
    const loop = new EventLoop(),
      seen: string[] = [];
    loop.at(5, () => seen.push('b'));
    loop.at(1, () => seen.push('a'));
    loop.at(5, () => seen.push('c'));
    const cancelled = loop.at(3, () => seen.push('never'));
    loop.cancel(cancelled);
    const times: number[] = [];
    const stop = loop.every(1000 / 120, () => times.push(loop.now));
    loop.runUntil(1000.001);
    stop();
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(times.length).toBe(121);
    // k × period, not an accumulated sum: no drift after 120 periods.
    expect(times[120]).toBeCloseTo(1000, 9);
    loop.runUntil(2000);
    expect(times.length).toBe(121);
  });
});

describe('simulated network (loss, jitter, duplication, reordering)', () => {
  it('drops, duplicates and reorders datagrams at the configured rates', () => {
    const loop = new EventLoop(),
      net = new NetworkSimulator(loop, 3),
      { client, server, link } = net.connect({ ...TARGET_LINK, duplicate: 0.02, reorder: 0.05 });
    const arrivals: number[] = [];
    server.onMessage = (data) =>
      arrivals.push(new DataView(data.buffer, data.byteOffset).getUint32(0));
    for (let i = 0; i < 20000; i++) {
      loop.at(i, () => {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, i);
        client.send(b, 'unreliable');
      });
    }
    loop.runUntil(30000);
    const unique = new Set(arrivals);
    expect(link.upStats.dropped / 20000).toBeGreaterThan(0.015);
    expect(link.upStats.dropped / 20000).toBeLessThan(0.025);
    expect(arrivals.length - unique.size).toBe(link.upStats.duplicated);
    let outOfOrder = 0;
    for (let i = 1; i < arrivals.length; i++) if (arrivals[i] < arrivals[i - 1]) outOfOrder++;
    expect(outOfOrder).toBeGreaterThan(100);
    expect(link.upStats.wireBytes).toBe(link.upStats.payloadBytes + 28 * 20000);
  });
  it('delivers the reliable channel completely and in order despite 20% loss', () => {
    const loop = new EventLoop(),
      net = new NetworkSimulator(loop, 4),
      { client, server, link } = net.connect({ ...TARGET_LINK, loss: 0.2 });
    const got: number[] = [],
      channels = new Set<Channel>();
    server.onMessage = (data, channel) => {
      got.push(data[0]);
      channels.add(channel);
    };
    for (let i = 0; i < 200; i++)
      loop.at(i * 3, () => client.send(new Uint8Array([i]), 'reliable'));
    loop.runUntil(20000);
    expect(got).toEqual(Array.from({ length: 200 }, (_, i) => i));
    expect([...channels]).toEqual(['reliable']);
    expect(link.upStats.retransmits).toBeGreaterThan(20);
  });
  it('a severed link loses everything silently; a close is announced to the peer', () => {
    const loop = new EventLoop(),
      net = new NetworkSimulator(loop, 5),
      a = net.connect(TARGET_LINK),
      b = net.connect(TARGET_LINK);
    let received = 0,
      closedWith = '';
    a.server.onMessage = () => received++;
    a.server.onClose = () => (closedWith = 'should not happen');
    a.client.send(new Uint8Array([1]), 'reliable');
    a.link.sever();
    a.client.send(new Uint8Array([2]), 'reliable');
    a.client.close('gone');
    b.server.onClose = (reason) => (closedWith = reason);
    b.client.close('bye');
    loop.runUntil(2000);
    expect(received).toBe(0);
    expect(closedWith).toBe('bye');
    expect(b.server.open).toBe(false);
  });
});

const cmd = (seq: number, tick: number, ticks = 2, throttle = 0.5): InputCommand => ({
  seq,
  tick,
  ticks,
  controls: quantizeControls({ ...controls(), throttle, overtake: seq === 3 }),
});
describe('input commands: server queue and client log', () => {
  it('dedups redundant copies, applies each tick once and flags the first tick', () => {
    const q = new ServerInputQueue();
    q.accept([cmd(0, 100), cmd(1, 102)], 95);
    q.accept([cmd(0, 100), cmd(1, 102), cmd(2, 104)], 96);
    expect(q.stats.duplicates).toBe(2);
    expect(q.contiguousSeq).toBe(2);
    expect(q.takeSlack()).toBe(5);
    expect(q.takeSlack()).toBe(Infinity);
    const slots = [100, 101, 102, 103, 104, 105].map((t) => q.take(t));
    expect(slots.map((s) => s?.first)).toEqual([true, false, true, false, true, false]);
    expect(q.take(106)).toBeNull();
    expect(q.stats.appliedTicks).toBe(6);
  });
  it('counts late commands, rejects ones beyond the lead window, expires gaps', () => {
    const q = new ServerInputQueue();
    q.accept([cmd(0, 10)], 50);
    expect(q.stats.late).toBe(1);
    q.accept([cmd(1, 50 + 241)], 50);
    expect(q.stats.rejected).toBe(1);
    // seq 2 never arrives; seq 3 starts at tick 60: once tick 60 is taken,
    // the gap is in the past and the acknowledgement moves past it.
    const r = new ServerInputQueue();
    r.accept([cmd(0, 56), cmd(1, 58)], 55);
    r.accept([cmd(3, 62)], 55);
    expect(r.contiguousSeq).toBe(1);
    for (let t = 56; t <= 62; t++) r.take(t);
    expect(r.contiguousSeq).toBe(3);
    // Partial lateness: only the remaining ticks are queued.
    const p = new ServerInputQueue();
    p.accept([cmd(0, 99, 4)], 101);
    expect(p.stats.lateTicks).toBe(2);
    expect(p.take(101)?.first).toBe(false);
  });
  it('reports negative slack for a fully late command, so a short lead can grow', () => {
    const q = new ServerInputQueue();
    q.accept([cmd(0, 80)], 100);
    expect(q.stats.late).toBe(1);
    expect(q.takeSlack()).toBe(-20);
    q.accept([cmd(1, 98, 4)], 100);
    expect(q.takeSlack()).toBe(-2);
  });
  it('never remembers rejected commands: a far-away flood leaves the queue bounded', () => {
    const q = new ServerInputQueue();
    let seq = 5_000_000;
    // 75 packets/s × 16 commands for 60 s, far beyond the sequence window and
    // the lead window, with gaps so a contiguous walk could never absorb them.
    for (let p = 0; p < 75 * 60; p++, seq += 17) {
      const run = Array.from({ length: 16 }, (_, k) => cmd(seq + k, 0xfff00000 + k, 1));
      expect(q.accept(run, 100)).toBe(16);
    }
    expect(q.stats.rejected).toBe(75 * 60 * 16);
    expect(q.remembered).toBe(0);
    // In the tick window but beyond the sequence window: rejected too.
    expect(q.accept([cmd(LIMITS.seqWindow + 1, 120)], 100)).toBe(1);
    expect(q.remembered).toBe(0);
    // A legitimate stream with losses still flows, and dedup state stays
    // within the window.
    for (let i = 0; i < 2000; i++) {
      if (i % 7 !== 3) q.accept([cmd(i, 100 + 2 * i)], 100 + 2 * i - 10);
      expect(q.remembered).toBeLessThanOrEqual(LIMITS.seqWindow);
      q.take(100 + 2 * i - 10);
    }
    expect(q.contiguousSeq).toBeGreaterThan(1980);
    // A command beyond the lead window is not remembered: its resend counts.
    const r = new ServerInputQueue();
    expect(r.accept([cmd(0, 400)], 100)).toBe(1);
    expect(r.accept([cmd(0, 400)], 200)).toBe(0);
    expect(r.stats.commands).toBe(1);
  });
  it('client log resends only unacknowledged future commands and finds controls by tick', () => {
    const log = new ClientCommandLog();
    log.start(200);
    for (let i = 0; i < 10; i++) log.issue(i === 4 ? 3 : 2, { ...controls(), throttle: i / 10 });
    expect(log.nextTick).toBe(221);
    expect(log.at(208)?.seq).toBe(4);
    expect(log.at(210)?.seq).toBe(4);
    expect(log.at(211)?.seq).toBe(5);
    expect(log.resend(4, 0).map((c) => c.seq)).toEqual([6, 7, 8, 9]);
    log.acknowledge(7);
    expect(log.resend(12, 0).map((c) => c.seq)).toEqual([8, 9]);
    expect(log.resend(12, 221)).toEqual([]);
    log.prune(212);
    expect(log.at(205)).toBeUndefined();
    expect(log.at(215)?.seq).toBe(7);
  });
});

describe('guards', () => {
  it('token bucket admits the burst then the sustained rate', () => {
    const bucket = new TokenBucket(10, 5, 0);
    let admitted = 0;
    for (let i = 0; i < 20; i++) if (bucket.take(0)) admitted++;
    expect(admitted).toBe(5);
    expect(bucket.take(50)).toBe(false);
    expect(bucket.take(100)).toBe(true);
    // Sustained: 10 per second.
    let sustained = 0;
    for (let t = 1000; t < 2000; t += 10) if (bucket.take(t)) sustained++;
    expect(sustained).toBeGreaterThanOrEqual(10);
    expect(sustained).toBeLessThanOrEqual(15);
  });
  it('tick budget monitor reports overruns and a degraded streak', () => {
    const monitor = new TickBudgetMonitor(8.33, 3, 0);
    for (let i = 0; i < 100; i++) monitor.record(i === 50 ? 20 : 2);
    expect(monitor.report()).toMatchObject({ overruns: 1, status: 'ok', worstMs: 20 });
    for (let i = 0; i < 3; i++) monitor.record(12);
    const report = monitor.report();
    expect(report.status).toBe('degraded');
    expect(report.longestOverrunStreak).toBe(3);
    expect(distribution([3, 1, 2]).p50).toBe(2);
  });
});
