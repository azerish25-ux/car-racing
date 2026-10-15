import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import { Lobby, LobbyDirectory, type LobbyConfig } from '../src/net/lobby.ts';

const formula: LobbyConfig = {
  name: 'Aurel GP',
  options: validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', seed: 11 }),
  capacity: 4,
  fieldSize: 6,
  minPlayers: 2,
};
const exhibition: LobbyConfig = {
  name: 'Mixed',
  options: validateOptions({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    ruleset: 'open-exhibition',
    seed: 12,
  }),
  capacity: 3,
};
const make = (config: LobbyConfig, hooks = {}) => {
  const result = Lobby.create('L', config, hooks);
  if (!result.ok) throw new Error(result.reasons.join('; '));
  return result.lobby;
};
const driver = (n: number, vehicle = 'apx01') => ({
  player: `u${n}`,
  name: `Driver ${n}`,
  vehicle,
});

describe('lobbies (WP53)', () => {
  it('validates configurations against rulesets and limits', () => {
    const bad = Lobby.create('x', { ...formula, name: '', capacity: 0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reasons.join('|')).toMatch(/name.*\|Capacity/);
    const touringAi = Lobby.create('x', { ...formula, aiVehicle: 'tc1' });
    expect(touringAi.ok).toBe(false);
    if (!touringAi.ok)
      expect(touringAi.reasons.join(' ')).toMatch(/not eligible for FORMULA GRAND PRIX/);
    const tyres = Lobby.create('x', {
      ...formula,
      options: validateOptions({ ...formula.options, ruleset: 'touring-sprint', compound: 'soft' }),
    });
    expect(tyres.ok).toBe(false);
    if (!tyres.ok) expect(tyres.reasons.join(' ')).toMatch(/soft tyres are not permitted/);
    expect(Lobby.create('x', { ...formula, fieldSize: 2 }).ok).toBe(false);
  });
  it('joins up to capacity, enforces class compatibility, and runs the ready check', () => {
    const lobby = make(formula);
    expect(lobby.join(driver(1))).toEqual({ ok: true });
    expect(lobby.host).toBe('u1');
    expect(lobby.join(driver(1))).toEqual({ ok: false, reason: 'Already in this lobby' });
    const touring = lobby.join(driver(2, 'tc1'));
    expect(touring.ok).toBe(false);
    if (!touring.ok) expect(touring.reason).toMatch(/TC-1.*not eligible for FORMULA GRAND PRIX/i);
    expect(lobby.join(driver(9, 'warp-car'))).toEqual({
      ok: false,
      reason: 'Unknown vehicle warp-car',
    });
    let check = lobby.readyCheck();
    expect(check.ok).toBe(false);
    expect(check.reasons.join(' ')).toMatch(/Needs 2 driver/);
    for (const n of [2, 3, 4]) expect(lobby.join(driver(n)).ok).toBe(true);
    expect(lobby.join(driver(5))).toEqual({ ok: false, reason: 'Lobby is full' });
    lobby.setReady('u1', true);
    lobby.setReady('u2', true);
    check = lobby.readyCheck();
    expect(check.reasons).toEqual(['Waiting for Driver 3, Driver 4']);
    lobby.setReady('u3', true);
    lobby.setReady('u4', true);
    expect(lobby.readyCheck()).toEqual({ ok: true, reasons: [] });
    // Members fill the grid in join order, AI fills to the field size.
    const options = lobby.sessionOptions();
    expect(options.opponents).toBe(5);
    expect(options.vehicles).toEqual(['apx01', 'apx01', 'apx01', 'apx01', 'apx01', 'apx01']);
    expect(lobby.leave('u1')).toBe(true);
    expect(lobby.host).toBe('u2');
    lobby.locked = true;
    expect(lobby.join(driver(6)).ok).toBe(false);
    expect(lobby.setReady('u2', false).ok).toBe(false);
  });
  it('admits mixed classes where the ruleset allows them', () => {
    const lobby = make(exhibition);
    expect(lobby.join(driver(1, 'tc1')).ok).toBe(true);
    expect(lobby.join(driver(2, 'apx01')).ok).toBe(true);
    expect(lobby.sessionOptions().vehicles).toEqual(['tc1', 'apx01', 'apx01']);
  });
  it('kicks and bans through moderation hooks; only the host may moderate', () => {
    const events: string[] = [];
    const lobby = make(formula, {
      onKick: (e: { player: string; by: string; reason: string }) =>
        events.push(`kick ${e.player} by ${e.by}: ${e.reason}`),
      onBan: (e: { player: string; by: string }) => events.push(`ban ${e.player} by ${e.by}`),
      isBanned: (player: string) => player === 'u99',
    });
    for (const n of [1, 2, 3]) lobby.join(driver(n));
    expect(lobby.kick('u2', 'u3', 'no').ok).toBe(false);
    expect(lobby.kick('u1', 'u1', 'self').ok).toBe(false);
    expect(lobby.kick('u1', 'u2', 'abuse')).toEqual({ ok: true });
    expect(lobby.join(driver(2)).ok).toBe(true);
    expect(lobby.ban('u1', 'u2', 'again')).toEqual({ ok: true });
    expect(lobby.join(driver(2))).toEqual({ ok: false, reason: 'Banned from this lobby' });
    expect(lobby.join(driver(99))).toEqual({ ok: false, reason: 'Banned from this lobby' });
    expect(lobby.kick('server', 'u3', 'platform').ok).toBe(true);
    expect(events).toEqual(['kick u2 by u1: abuse', 'ban u2 by u1', 'kick u3 by server: platform']);
  });
  it('directory: create, list with filters, join, leave and rate limiting', () => {
    let now = 0;
    const directory = new LobbyDirectory({}, () => now, { perSecond: 2, burst: 4 });
    const a = directory.create('host1', formula),
      b = directory.create('host2', {
        ...exhibition,
        options: { ...exhibition.options, circuit: 'vellamar' },
      });
    expect(a.ok && b.ok).toBe(true);
    expect(directory.list().map((l) => l.name)).toEqual(['Aurel GP', 'Mixed']);
    expect(directory.list({ circuit: 'vellamar' }).map((l) => l.ruleset)).toEqual([
      'open-exhibition',
    ]);
    expect(directory.list({ ruleset: 'formula-grand-prix' })).toHaveLength(1);
    const id = a.ok ? a.lobby.id : '';
    expect(directory.join(id, driver(1)).ok).toBe(true);
    expect(directory.join('nope', driver(2))).toEqual({ ok: false, reason: 'No such lobby' });
    expect(directory.list({ open: true })).toHaveLength(2);
    // A burst of requests from one player is cut off, then refills.
    const outcomes = Array.from({ length: 6 }, () => directory.join(id, driver(7)).ok || 'x');
    expect(directory.join(id, driver(7))).toEqual({ ok: false, reason: 'Rate limited' });
    expect(outcomes.filter((o) => o === true)).toHaveLength(1);
    now += 2000;
    expect(directory.leave(id, 'u7').ok).toBe(true);
    expect(directory.leave(id, 'u1').ok).toBe(true);
    // An empty, unstarted lobby is removed.
    expect(directory.get(id)).toBeUndefined();
    expect(directory.list()).toHaveLength(1);
  });
});
