import { describe, expect, it } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import { MSG, encodeControl } from '../src/net/codec.ts';
import { LIMITS, RATES } from '../src/net/constants.ts';
import { runOnlineSlice } from '../src/net/slice.ts';
import { onlineFixture } from './net-helpers.ts';

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
