import { describe, expect, it } from 'vitest';
import { SIMULATION_VERSION } from '../src/core/session-identity.ts';
import { encodeControl } from '../src/net/codec.ts';
import { NET_PROTOCOL_VERSION } from '../src/net/constants.ts';
import { joinIdentity } from '../src/net/identity.ts';
import { onlineFixture } from './net-helpers.ts';

describe('session lifecycle with content-version agreement (WP51)', () => {
  it('rejects clients whose physics version, content hashes or protocol differ, with a reason', () => {
    const f = onlineFixture({ capacity: 4, minPlayers: 4 });
    const cases = [
      f.connect('old physics', {
        identity: (id) => ({ ...id, simulationVersion: SIMULATION_VERSION + 1 }),
      }),
      f.connect('edited circuit', { identity: (id) => ({ ...id, circuitHash: '0badc0de' }) }),
      f.connect('edited car', { identity: (id) => ({ ...id, vehicleHashes: ['12345678'] }) }),
      f.connect('other rules', { identity: (id) => ({ ...id, rulesetHash: 'abcdef01' }) }),
      f.connect('old snapshots', {
        identity: (id) => ({ ...id, formatVersion: id.formatVersion - 1 }),
      }),
      f.connect('wrong class', { vehicle: 'tc1' }),
      f.connect('ok'),
    ];
    // A raw client speaking another network protocol version.
    const raw = f.net.connect({ latencyMs: 10, jitterMs: 0, loss: 0, duplicate: 0, reorder: 0 });
    f.server.accept(raw.server);
    let rawReply = '';
    raw.client.onMessage = (data) => (rawReply = new TextDecoder().decode(data.subarray(1)));
    raw.client.send(
      encodeControl({
        kind: 'join',
        net: NET_PROTOCOL_VERSION + 5,
        name: 'future',
        vehicle: 'apx01',
        identity: joinIdentity(f.session, 'apx01'),
      }),
      'reliable',
    );
    f.loop.runUntil(2000);
    const reasons = cases.map(({ client }) => [client.state, client.reason]);
    expect(reasons.slice(0, 6).map(([state]) => state)).toEqual(Array(6).fill('rejected'));
    expect(reasons[0][1]).toMatch(/simulation version 2 does not match the server's version 1/);
    expect(reasons[1][1]).toMatch(/content mismatch: circuit aurel content 0badc0de differs/);
    expect(reasons[2][1]).toMatch(/vehicle apx01 content 12345678 differs/);
    expect(reasons[3][1]).toMatch(/ruleset formula-grand-prix content abcdef01 differs/);
    expect(reasons[4][1]).toMatch(/snapshot format v10 does not match/);
    expect(reasons[5][1]).toMatch(/not eligible for FORMULA GRAND PRIX/);
    expect(reasons[6][0]).toBe('lobby');
    expect(rawReply).toMatch(/network protocol v6 is not supported/);
    expect(f.server.stats.rejectedJoins).toHaveLength(7);
    expect(f.lobby.members.map((m) => m.name)).toEqual(['ok']);
    // Ready check: one of four drivers is not enough to start.
    expect(f.server.phase).toBe('lobby');
  });
  it('runs lobby → grid → race → results → teardown and delivers the record digest', () => {
    const f = onlineFixture({ capacity: 2, raceSeconds: 1 });
    const a = f.connect('Alpha'),
      b = f.connect('Bravo');
    const seen: string[][] = [[], []];
    f.loop.every(50, () => {
      for (const [i, c] of [a.client, b.client].entries())
        if (seen[i][seen[i].length - 1] !== c.state) seen[i].push(c.state);
    });
    f.loop.runWhile(() => f.server.phase !== 'teardown', 30000);
    f.loop.runUntil(f.loop.now + 1000);
    expect(f.server.stats.phases.map((p) => p.phase)).toEqual([
      'lobby',
      'grid',
      'race',
      'results',
      'teardown',
    ]);
    for (const s of seen) expect(s).toEqual(['connecting', 'lobby', 'grid', 'race', 'results']);
    for (const { client } of [a, b]) {
      expect(client.results?.recordDigest).toBe(f.server.record?.digest);
      expect(client.results?.classification).toHaveLength(2);
      expect(client.grid?.identity).toEqual(f.server.identity);
      expect(client.gridIncompatibility()).toBeNull();
      expect(client.config.transport.open).toBe(false);
    }
    expect(f.server.results?.reason).toBe('time-limit');
    // Teardown stops the tick loop: the world no longer advances.
    const tick = f.server.world?.tick;
    f.loop.runUntil(f.loop.now + 5000);
    expect(f.server.world?.tick).toBe(tick);
    // Late joiners are refused once the session is past the lobby.
    const late = f.connect('Late');
    f.loop.runUntil(f.loop.now + 1000);
    expect(late.client.state).toBe('rejected');
    expect(late.client.reason).toMatch(/already started/);
  });
  it('does not start until every member is ready', () => {
    const f = onlineFixture({ capacity: 2 });
    f.connect('Ready');
    const waiting = f.connect('Slow', { autoReady: false });
    f.loop.runUntil(3000);
    expect(f.server.phase).toBe('lobby');
    expect(f.lobby.readyCheck().reasons).toEqual(['Waiting for Slow']);
    waiting.client.setReady(true);
    f.loop.runUntil(3200);
    expect(f.server.phase).toBe('grid');
    f.loop.runUntil(5000);
    expect(f.server.phase).toBe('race');
  });
});
