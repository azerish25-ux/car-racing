import { describe, expect, it } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import { MSG, encodeControl, encodeInput } from '../src/net/codec.ts';
import { LIMITS, RATES, TICK_MS } from '../src/net/constants.ts';
import type { RaceEvent } from '../src/net/messages.ts';
import { quantizeControls } from '../src/net/input.ts';
import { runOnlineSlice } from '../src/net/slice.ts';
import type { LinkConditions } from '../src/net/transport.ts';
import { onlineFixture } from './net-helpers.ts';

const link = (latencyMs: number): LinkConditions => ({
  latencyMs,
  jitterMs: 4,
  loss: 0.02,
  duplicate: 0.005,
  reorder: 0.01,
});
/** The car's mode changes in the journal. */
const modes = (f: ReturnType<typeof onlineFixture>, car: number) =>
  f.server.world?.journal
    .filter((e) => e.kind === 'mode' && e.car === car)
    .map((e) => e.kind === 'mode' && e.mode);

describe('resilience (WP54)', () => {
  it('takes a lost driver over with the AI and hands the car back on rejoin', () => {
    const { report, server } = runOnlineSlice({
      clients: 2,
      seed: 31,
      raceSeconds: 4,
      disconnect: { client: 1, atSeconds: 6, offlineSeconds: 1.5 },
    });
    const d = report.resilience.disconnect;
    expect(d).not.toBeNull();
    if (!d) return;
    // Takeover 1 s after the last packet arrived (packets in flight at the
    // cut are lost, so slightly under 1 s after the cut itself).
    expect(d.takeoverAfterMs).toBeGreaterThan(900);
    expect(d.takeoverAfterMs).toBeLessThan(1020);
    // Reconnected with its token after 1.5 s; control returns with the first command.
    expect(d.rejoinedAfterMs).toBeGreaterThan(1500);
    expect(d.humanAgainAfterMs).toBeGreaterThan(d.rejoinedAfterMs as number);
    expect((d.humanAgainAfterMs as number) - (d.rejoinedAfterMs as number)).toBeLessThan(600);
    // Never more than the starvation threshold on stale inputs.
    expect(report.resilience.inputStarvations).toBe(1);
    const modes = server.world?.journal
      .filter((e) => e.kind === 'mode' && e.car === d.car)
      .map((e) => e.kind === 'mode' && e.mode);
    expect(modes).toEqual(['ai', 'human']);
    expect(report.verification?.ok).toBe(true);
    expect(report.classification.find((r) => r.car === d.car)?.status).toBe('running');
  });
  it('holds a car with the AI during an input gap shorter than the timeout, then hands it back', () => {
    const f = onlineFixture({ capacity: 1, raceSeconds: 3 });
    const { client, link } = f.connect('Gappy');
    f.loop.runUntil(6000);
    link.sever();
    f.loop.runUntil(6400);
    link.severed = false;
    f.loop.runWhile(() => f.server.phase !== 'results', 30000);
    expect(f.server.stats.starvations).toBe(1);
    expect(f.server.stats.takeovers).toEqual([]);
    const modes = f.server.world?.journal
      .filter((e) => e.kind === 'mode' && e.car === client.car)
      .map((e) => e.kind === 'mode' && e.mode);
    expect(modes).toEqual(['ai', 'human']);
    // Starvation began 250 ms (30 ticks) after the last command was applied.
    const input = f.server.inputStats()[0];
    expect(input.missingTicks).toBeGreaterThan(30);
    expect(input.missingTicks).toBeLessThan(70);
  });
  it('refuses a rejoin after the window and classifies a ghost behind running cars', () => {
    const f = onlineFixture({
      capacity: 2,
      raceSeconds: 3,
      server: { disconnectPolicy: 'ghost', timeouts: { rejoinWindowMs: 800 } },
    });
    f.connect('Stays');
    const lost = f.connect('Lost');
    f.loop.runUntil(4000);
    expect(f.server.phase).toBe('race');
    const token = lost.client.token,
      car = lost.client.car;
    lost.link.sever();
    lost.client.dispose();
    f.loop.runUntil(6500);
    expect(f.server.playerByCar(car)).toMatchObject({ connected: false, mode: 'ai' });
    const late = f.connect('Lost', { token });
    f.loop.runUntil(7000);
    expect(late.client.state).toBe('rejected');
    expect(late.client.reason).toMatch(/rejoin window has expired/);
    f.loop.runWhile(() => f.server.phase !== 'teardown', 30000);
    const rows = f.server.results?.classification ?? [];
    expect(rows[rows.length - 1]).toMatchObject({ car, status: 'ghost' });
  });
  it('tolerates heavy loss, duplication and reordering without breaking authority', () => {
    const { report } = runOnlineSlice({
      clients: 2,
      seed: 5,
      raceSeconds: 3,
      link: { latencyMs: 60, jitterMs: 12, loss: 0.1, duplicate: 0.1, reorder: 0.1 },
    });
    expect(report.network.duplicated).toBeGreaterThan(50);
    expect(report.network.reordered).toBeGreaterThan(50);
    expect(report.network.snapshotsDuplicate + report.network.snapshotsLate).toBeGreaterThan(10);
    expect(report.inputs.duplicatesDropped).toBeGreaterThan(report.inputs.commandsSent);
    // Redundancy keeps nearly every tick supplied even at 10% loss.
    expect(report.inputs.missingTicks).toBeLessThan(report.inputs.appliedTicks * 0.01);
    expect(report.verification?.ok).toBe(true);
    expect(report.prediction.snaps).toBe(0);
  });
  it('rejects non-finite samples at the client; the server only ever applies in-range controls', () => {
    let n = 0;
    const f = onlineFixture({ capacity: 1, raceSeconds: 1 });
    const { client } = f.connect('Noisy', {
      input: () => {
        n++;
        if (n % 5 === 0) return { ...controls(), throttle: NaN };
        if (n % 7 === 0) return { ...controls(), steer: Infinity };
        if (n % 11 === 0) return 'full throttle';
        return { ...controls(), throttle: 3, steer: n % 2 ? -9 : 0.2 };
      },
    });
    f.loop.runWhile(() => f.server.phase !== 'results', 30000);
    expect(client.stats.rejectedSamples).toBeGreaterThan(50);
    expect(client.stats.clampedSamples).toBeGreaterThan(50);
    const applied = f.server.world?.journal.filter((e) => e.kind === 'controls') ?? [];
    expect(applied.length).toBeGreaterThan(2);
    for (const e of applied)
      if (e.kind === 'controls') {
        expect(Number.isFinite(e.controls.throttle) && e.controls.throttle <= 1).toBe(true);
        expect(Math.abs(e.controls.steer)).toBeLessThanOrEqual(1);
      }
  });
  it('drops oversize and malformed messages and kicks a flooding client; others are unaffected', () => {
    const f = onlineFixture({ capacity: 2, raceSeconds: 1 });
    const good = f.connect('Good', { autoReady: false });
    const bad = f.connect('Flood', { autoReady: false });
    f.loop.runUntil(1000);
    expect(bad.client.state).toBe('lobby');
    // Oversize datagram and garbage: dropped with a strike each.
    const big = new Uint8Array(LIMITS.datagramBytes + 100);
    big[0] = MSG.INPUT;
    bad.transport.send(big, 'unreliable');
    bad.transport.send(new Uint8Array([MSG.CONTROL, 0x7b, 0x7b]), 'reliable');
    f.loop.runUntil(1200);
    expect(f.server.stats.invalidMessages).toBe(2);
    expect(bad.client.state).toBe('lobby');
    // A burst of pings far above the control rate: rate-limited, then kicked.
    for (let i = 0; i < RATES.control.burst + RATES.strikesToKick + 5; i++)
      bad.transport.send(encodeControl({ kind: 'ping', t: i }), 'reliable');
    f.loop.runUntil(2000);
    expect(f.server.stats.rateLimited).toBeGreaterThanOrEqual(RATES.strikesToKick - 2);
    expect(bad.client.state).toBe('kicked');
    expect(bad.client.reason).toMatch(/rate limit/);
    expect(good.client.state).toBe('lobby');
    expect(f.lobby.members.map((m) => m.name)).toEqual(['Good']);
  });
  it('host moderation: a banned account cannot come back', () => {
    const kicks: string[] = [];
    const f = onlineFixture({
      capacity: 3,
      moderation: { onBan: (e) => kicks.push(`${e.player}:${e.reason}`) },
    });
    f.connect('Host', { account: 'host-1' });
    const troll = f.connect('Troll', { account: 'troll-9' });
    f.loop.runUntil(1000);
    expect(f.server.kick('troll-9', 'abusive chat', true)).toBe(true);
    f.loop.runUntil(2000);
    expect(troll.client.state).toBe('kicked');
    expect(troll.client.reason).toBe('abusive chat');
    expect(kicks).toEqual(['troll-9:abusive chat']);
    const again = f.connect('Troll again', { account: 'troll-9' });
    f.loop.runUntil(3000);
    expect(again.client.state).toBe('rejected');
    expect(again.client.reason).toBe('Banned from this lobby');
    const twice = f.connect('Host clone', { account: 'host-1' });
    f.loop.runUntil(4000);
    expect(twice.client.reason).toMatch(/already in the session/);
  });
  it('monitors the server tick budget', () => {
    const f = onlineFixture({ capacity: 1, raceSeconds: 0.5 });
    f.connect('Solo');
    f.loop.runWhile(() => f.server.phase !== 'results', 30000);
    const budget = f.server.budget.report();
    expect(budget.budgetMs).toBeCloseTo(1000 / 120, 6);
    expect(budget.ticks).toBe(f.server.world?.tick);
    expect(budget.meanMs).toBeGreaterThan(0);
    expect(budget.p99Ms).toBeGreaterThanOrEqual(budget.meanMs * 0.5);
    expect(['ok', 'degraded']).toContain(budget.status);
  });
});

describe('review regressions: input lead, rejoin, lobby and queue bounds', () => {
  it('drives at 200 and 300 ms RTT: the first lead comes from the keep-alive round trip', () => {
    for (const oneWay of [100, 150]) {
      const f = onlineFixture({ capacity: 1, raceSeconds: 3, link: link(oneWay) });
      const { client } = f.connect('Far', { input: () => ({ ...controls(), throttle: 1 }) });
      f.loop.runWhile(() => f.server.phase !== 'results', 60000);
      const input = f.server.inputStats()[0],
        world = f.server.world;
      expect(client.pingRttMs).toBeGreaterThanOrEqual(2 * oneWay - 20);
      expect(client.lead).toBeGreaterThan((2 * oneWay) / TICK_MS);
      expect(input.appliedTicks).toBeGreaterThan(0.9 * (world?.tick ?? 0));
      expect(input.lateTicks).toBeLessThan(20);
      expect(world?.drivers[0].mode).toBe('human');
      expect(world?.sim.cars[0].speed).toBeGreaterThan(20);
    }
  });
  it('a driver rejoining over a 300 ms link gets the car back', () => {
    const f = onlineFixture({ capacity: 1, raceSeconds: 5, link: link(150) });
    const first = f.connect('Far');
    f.loop.runWhile(() => f.server.phase !== 'race', 10000);
    f.loop.runUntil(f.loop.now + 1500);
    const { token, car } = first.client;
    first.link.sever();
    first.client.dispose();
    f.loop.runUntil(f.loop.now + 1500);
    const again = f.connect('Far', { token });
    f.loop.runWhile(() => f.server.phase !== 'results', 60000);
    expect(modes(f, car)).toEqual(['ai', 'human']);
    expect(f.server.world?.drivers[car].mode).toBe('human');
    expect(again.client.lead).toBeGreaterThan(300 / TICK_MS);
  });
  it('a lead that starts too short grows from negative slack (latency rises at the start)', () => {
    const f = onlineFixture({ capacity: 1, raceSeconds: 4, link: link(50) });
    const { client, link: wire } = f.connect('Spiky', {
      input: () => ({ ...controls(), throttle: 1 }),
    });
    f.loop.runWhile(() => f.server.phase !== 'race', 10000);
    // The keep-alive measured 100 ms; from now on every packet takes 300 ms.
    wire.client.conditions = link(150);
    wire.server.conditions = link(150);
    f.loop.runWhile(() => f.server.phase !== 'results', 60000);
    const input = f.server.inputStats()[0];
    expect(input.late).toBeGreaterThan(0);
    expect(client.lead).toBeGreaterThan(300 / TICK_MS);
    expect(input.appliedTicks).toBeGreaterThan(0.7 * (f.server.world?.tick ?? 0));
    expect(f.server.world?.sim.cars[0].speed).toBeGreaterThan(20);
  });
  it('a driver whose client restarts during the countdown rejoins and races', () => {
    const f = onlineFixture({ capacity: 2, raceSeconds: 2 });
    f.connect('Stays');
    const b = f.connect('Restarts');
    f.loop.runWhile(() => f.server.phase !== 'grid', 10000);
    f.loop.runUntil(f.loop.now + 100);
    const { token, car } = b.client;
    // The process dies; its operating system closes the connection.
    b.client.dispose();
    b.transport.close('process exited');
    f.loop.runUntil(f.loop.now + 100);
    const again = f.connect('Restarts', { token });
    f.loop.runUntil(f.loop.now + 200);
    expect(f.server.phase).toBe('grid');
    expect(again.client.state).toBe('grid');
    expect(again.client.needsKeepAlive).toBe(true);
    f.loop.runWhile(() => f.server.phase !== 'results', 30000);
    f.loop.runUntil(f.loop.now + 500);
    expect(f.server.stats.takeovers.map((t) => t.reason)).toEqual([
      'closed by client: process exited',
    ]);
    expect(again.client.state).toBe('results');
    expect(modes(f, car)).toEqual(['ai', 'human']);
    expect(f.server.results?.classification.find((r) => r.car === car)?.status).toBe('running');
  });
  it('session tokens are independent CSPRNG values and cannot take a live car', () => {
    const f = onlineFixture({ capacity: 3, raceSeconds: 4 });
    const a = f.connect('Alice'),
      b = f.connect('Bob'),
      c = f.connect('Carol', { account: 'carol-7' });
    f.loop.runWhile(() => f.server.phase !== 'race', 10000);
    f.loop.runUntil(f.loop.now + 1000);
    const tokens = [a, b, c].map((p) => p.client.token);
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(tokens).size).toBe(3);
    // The old generator leaked the next token from the last word of one.
    const xs = (x: number) => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return x >>> 0;
    };
    let state = parseInt(tokens[0].slice(24), 16),
      derived = '';
    for (let i = 0; i < 4; i++) derived += (state = xs(state)).toString(16).padStart(8, '0');
    expect(derived).not.toBe(tokens[1]);
    // Even the right token cannot take a car whose driver is still connected…
    const thief = f.connect('Mallory', { token: tokens[1] });
    // …a token bound to an account needs that account…
    const anonymous = f.connect('Carol', { token: tokens[2] });
    f.loop.runUntil(f.loop.now + 500);
    expect(thief.client.state).toBe('rejected');
    expect(thief.client.reason).toMatch(/still connected/);
    expect(anonymous.client.reason).toMatch(/belongs to another account/);
    expect(b.client.state).toBe('race');
    expect(f.server.playerByCar(b.client.car)).toMatchObject({ connected: true, mode: 'human' });
    expect(f.server.stats.rejoins).toEqual([]);
    // …and retries with one token are rate-limited.
    const retries = Array.from({ length: RATES.rejoin.burst + 2 }, () =>
      f.connect('Mallory', { token: tokens[1] }),
    );
    f.loop.runUntil(f.loop.now + 500);
    expect(retries.map((r) => r.client.reason)).toContain('too many rejoin attempts');
    // Once the holder has gone silent past the timeout, its owner gets it back.
    b.link.sever();
    b.client.dispose();
    f.loop.runUntil(f.loop.now + 1500);
    const back = f.connect('Bob', { token: tokens[1] });
    f.loop.runWhile(() => f.server.phase !== 'results', 30000);
    f.loop.runUntil(f.loop.now + 500);
    expect(back.client.state).toBe('results');
    expect(modes(f, b.client.car)).toEqual(['ai', 'human']);
  });
  it('a late rejoin receives the whole event history in size-limited chunks', () => {
    const f = onlineFixture({ capacity: 2, raceSeconds: 6 });
    f.connect('Stays');
    const lost = f.connect('Lost');
    f.loop.runWhile(() => f.server.phase !== 'race', 10000);
    f.loop.runUntil(f.loop.now + 1500);
    // Stand-in for ≈ 33 laps of a 12-car field: far over one message.
    const history = (f.server as unknown as { events: RaceEvent[] }).events;
    for (let i = 0; i < 400; i++)
      history.push({
        type: 'lap',
        car: i % 2,
        lap: 1 + Math.floor(i / 2),
        time: 51.689896971517314,
        valid: true,
        tick: 6200 * (1 + Math.floor(i / 12)),
      });
    expect(encodeControl({ kind: 'events', events: history }).length).toBeGreaterThan(
      LIMITS.resultBytes,
    );
    const { token, car } = lost.client;
    lost.link.sever();
    lost.client.dispose();
    f.loop.runUntil(f.loop.now + 1500);
    const back = f.connect('Lost', { token });
    f.loop.runUntil(f.loop.now + 1000);
    expect(back.client.state).toBe('race');
    expect(back.client.car).toBe(car);
    expect(back.client.stats.invalidMessages).toBe(0);
    expect(f.server.stats.oversizeMessages).toBe(0);
    expect(back.client.events).toEqual(history.slice(0, back.client.events.length));
    expect(back.client.events.length).toBeGreaterThanOrEqual(history.length - 2);
    expect(f.server.playerByCar(car)).toMatchObject({ connected: true, mode: 'human' });
  });
  it('sends a classification larger than one message as lap-time chunks', () => {
    let padded = false;
    const f = onlineFixture({
      capacity: 2,
      raceSeconds: 1.5,
      server: {
        onTick: (world) => {
          if (padded || world.tick < 600) return;
          padded = true;
          // ≈ 6 h of laps for both cars: the whole results would be ≈ 60 KiB.
          for (const times of world.lapTimes) for (let i = 0; i < 1500; i++) times.push(50 + i / 7);
        },
      },
    });
    const clients = [f.connect('A'), f.connect('B')].map((c) => c.client);
    f.loop.runWhile(() => f.server.phase !== 'teardown', 30000);
    const results = f.server.results;
    expect(results).not.toBeNull();
    if (!results) return;
    expect(encodeControl({ kind: 'results', results }).length).toBeGreaterThan(LIMITS.resultBytes);
    expect(f.server.stats.oversizeMessages).toBe(0);
    for (const client of clients) {
      expect(client.state).toBe('results');
      expect(client.stats.invalidMessages).toBe(0);
      expect(client.results?.classification).toEqual(results.classification);
    }
  });
  it('strikes and kicks a client flooding commands outside the windows; its queue stays empty', () => {
    const f = onlineFixture({ capacity: 2, raceSeconds: 4 });
    const flood = f.connect('Flood'),
      good = f.connect('Good');
    f.loop.runWhile(() => f.server.phase !== 'race', 10000);
    f.loop.runUntil(f.loop.now + 1000);
    let seq = 5_000_000;
    const stop = f.loop.every(1000 / RATES.input.perSecond, () => {
      const commands = Array.from({ length: 16 }, (_, k) => ({
        seq: seq + k,
        tick: 0xfff00000 + k,
        ticks: 1,
        controls: quantizeControls(controls()),
      }));
      seq += 17;
      flood.transport.send(encodeInput({ sentAt: 0, ackTick: 0, commands }), 'unreliable');
    });
    f.loop.runUntil(f.loop.now + 1500);
    stop();
    expect(flood.client.state).toBe('kicked');
    expect(flood.client.reason).toMatch(/invalid messages/);
    expect(f.server.inputStats().find((s) => s.car === flood.client.car)?.rejected).toBe(
      RATES.strikesToKick * 16,
    );
    f.loop.runWhile(() => f.server.phase !== 'results', 30000);
    f.loop.runUntil(f.loop.now + 500);
    expect(good.client.state).toBe('results');
  });
});
