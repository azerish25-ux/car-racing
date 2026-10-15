import { describe, expect, it } from 'vitest';
import { CareerController, type CareerHost, type FestivalStart } from '../src/career/controller.ts';
import { buyVehicle } from '../src/career/economy.ts';
import {
  FESTIVAL_LOANER_STAKES,
  FESTIVAL_RULES,
  festivalEvents,
  festivalKey,
  festivalRunKey,
  settleFestival,
  validateFestivalResult,
} from '../src/career/festival.ts';
import { disciplineEvents, purchaseReasons } from '../src/career/ladder.ts';
import { disciplineStatus, liveRegistry, venueKind } from '../src/career/registry.ts';
import { CAREER_KEY, newCareer, validateCareer, type CareerSave } from '../src/career/save.ts';
import { FESTIVAL_SAVE_KEY } from '../src/session/festival-save.ts';
import { controls } from '../src/simulation/config.ts';
import type { FestivalResult } from '../src/simulation/open-world/festival-result.ts';
import { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { SOLVANE } from '../src/simulation/open-world/region-data.ts';
import { careerHub } from '../src/ui/career-hub.ts';

/** The career's festival discipline (career/festival.ts): the region is a
 * career venue, festival results are paid once per run id, unlocks follow
 * registry rules, and the hub's festival tab lists events and discoveries. */
const live = liveRegistry();
const region = live.festival![0];

/** A real result: the player's own driving (a route driver on the player's
 * pedals, not the festival autopilot) through a speed trap. */
function ownTrapRun(session = 'test-session'): FestivalResult {
  const sim = new OpenWorldSimulation({ vehicle: 'rs5', session, tileBudget: 24 });
  sim.command({ type: 'start', event: 'coast-trap' });
  const event = sim.events.find((e) => e.spec.id === 'coast-trap')!;
  const driver = new RouteDriver(sim.player, event.path, 0.9);
  sim.setInput({ ...controls(), throttle: 0.2 });
  for (let i = 0; i < 120 * 60; i++) {
    driver.update(1 / 120, sim.cars);
    sim.step(1 / 120);
    const r = sim.takeResult();
    if (r) return r;
  }
  throw new Error('no trap result');
}
const result = ownTrapRun();
function owning(...ids: string[]): CareerSave {
  let save = newCareer();
  save.credits = 1e6;
  for (const id of ids) save = buyVehicle(save, live, id);
  return save;
}

describe('festival region as a career venue', () => {
  it('registers the region as a festival venue with every authored event, and opens the discipline', () => {
    expect(region.id).toBe(SOLVANE.id);
    expect(region.events.map((e) => e.id)).toEqual(SOLVANE.events.map((e) => e.id));
    const venue = live.venues.find((v) => v.id === region.id)!;
    expect(venueKind(venue)).toBe('festival');
    const status = disciplineStatus(live, 'festival');
    expect(status.state).toBe('open');
    expect(status.venues.map((v) => v.id)).toEqual([region.id]);
    // Festival events are open-world events, never circuit sessions.
    expect(disciplineEvents(live, newCareer(), 'festival')).toEqual([]);
    // The road-only motorcycle can be bought for the festival now.
    expect(purchaseReasons(live, live.vehicles.find((v) => v.id === 'nr900')!)).toEqual([]);
  });
  it('derives unlocks from the event kind, discovery and the machine', () => {
    const save = newCareer(),
      none = festivalEvents(live, save, new Set());
    expect(none).toHaveLength(region.events.length);
    for (const e of none) {
      expect(e.status).toBe('locked');
      expect(e.reasons.join(' ')).toContain('Discover it first');
      expect(e.loaner).toBe(true);
      expect(e.stakes).toBe(FESTIVAL_LOANER_STAKES);
    }
    const all = new Set(region.events.map((e) => e.id));
    const found = festivalEvents(live, save, all);
    for (const e of found) {
      const need = FESTIVAL_RULES[e.event.kind].reputation;
      expect(e.status, e.event.id).toBe(need > 0 ? 'locked' : 'open');
      if (need) expect(e.reasons.join(' ')).toContain(`${need} festival reputation`);
    }
    const seasoned = { ...owning('rs5'), reputation: { ...save.reputation, festival: 40 } };
    const open = festivalEvents(live, seasoned, all);
    expect(open.every((e) => e.status === 'open')).toBe(true);
    expect(open[0].vehicle).toBe('rs5');
    expect(open[0].loaner).toBe(false);
  });
});

describe('festival results into the career economy', () => {
  it('produces a typed, valid result from the session (version 2 with a run id)', () => {
    expect(result.completed).toBe(true);
    expect(result.assisted).toBe(false);
    expect(result.runId).toBe('test-session:1');
    expect(validateFestivalResult(result)).not.toBeNull();
    expect(validateFestivalResult({ ...result, version: 1 })).toBeNull();
    expect(validateFestivalResult({ ...result, runId: '' })).toBeNull();
    expect(validateFestivalResult({ ...result, stars: 7 })).toBeNull();
    expect(validateFestivalResult({ ...result, position: 9, entrants: 1 })).toBeNull();
    expect(validateFestivalResult('garbage')).toBeNull();
  });
  it('pays a festival run exactly once per run id, with reputation for new stars only', () => {
    const save = owning('rs5');
    const first = settleFestival(save, live, result);
    expect(first.payout.paid).toBe(true);
    expect(first.payout.total).toBeGreaterThan(0);
    expect(first.save.credits).toBe(save.credits + first.payout.total);
    expect(first.save.paidSessions).toContain(festivalRunKey(result.runId));
    const key = festivalKey(region.id, 'coast-trap');
    expect(first.save.festival[key]).toMatchObject({ stars: result.stars, runs: 1, bestValue: result.trapKmh });
    expect(first.payout.lines.map((l) => l.label).join(' ')).toContain('First completion');
    expect(first.payout.reputation).toBe(result.stars * 2 + 1);
    // The same run delivered again (another event, a reload): nothing changes.
    const again = settleFestival(first.save, live, structuredClone(result));
    expect(again.save).toBe(first.save);
    expect(again.payout.paid).toBe(false);
    expect(again.payout.reason).toContain('already been paid');
    // A new run of the same event pays completion again, but no reputation
    // without a new star.
    const next = settleFestival(first.save, live, { ...result, runId: 'test-session:2' });
    expect(next.payout.paid).toBe(true);
    expect(next.payout.reputation).toBe(0);
    expect(next.save.festival[key].runs).toBe(2);
    expect(next.payout.lines.map((l) => l.label).join(' ')).not.toContain('First completion');
  });
  it('settles without paying: autopilot, unfinished, not your machine, locked event', () => {
    const save = owning('rs5');
    const cases: [Partial<FestivalResult>, string][] = [
      [{ assisted: true }, 'autopilot'],
      [{ completed: false }, 'Not completed'],
      [{ vehicleId: 'sc7' }, 'not a festival machine in your career garage'],
    ];
    cases.forEach(([change, reason], i) => {
      const run = { ...result, ...change, runId: `refused:${i}` };
      const settled = settleFestival(save, live, run);
      expect(settled.payout.paid).toBe(false);
      expect(settled.payout.reason).toContain(reason);
      expect(settled.save.credits).toBe(save.credits);
      // Settled: buying the machine later does not make this run payable.
      expect(settled.save.paidSessions).toContain(festivalRunKey(run.runId));
    });
    const race = { ...result, eventId: 'coast-to-summit', eventKind: 'road-race' as const, position: 1, entrants: 6, runId: 'refused:race' };
    const locked = settleFestival(save, live, race);
    expect(locked.payout.paid).toBe(false);
    expect(locked.payout.reason).toContain(`${FESTIVAL_RULES['road-race'].reputation} festival reputation`);
  });
  it('pays the loaned machine at the recovery rate when the career lent it', () => {
    const save = newCareer();
    const unpaid = settleFestival(save, live, { ...result, runId: 'loan:0' });
    expect(unpaid.payout.paid).toBe(false);
    const loaned = settleFestival(save, live, { ...result, runId: 'loan:1' }, { loaner: 'rs5' });
    const owned = settleFestival(owning('rs5'), live, { ...result, runId: 'own:1' });
    expect(loaned.payout.paid).toBe(true);
    expect(loaned.payout.total).toBeLessThan(owned.payout.total);
    expect(loaned.payout.reputation).toBeLessThanOrEqual(1);
  });
  it('consumes festival-result events through the controller, once per run, and lists discoveries', async () => {
    const data = new Map<string, unknown>();
    const toasts: string[] = [];
    let modal = '';
    const started: FestivalStart[] = [];
    const host = {
      store: {
        read: async (k: string) => structuredClone(data.get(k)),
        write: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
        writeWithBackup: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
      },
      toast: (m: string) => toasts.push(m),
      modal: (html: string) => (modal = html),
      modalRoot: () => ({ querySelector: () => null }) as unknown as HTMLElement,
      state: () => 'menu',
      pause: () => undefined,
      festival: (start: FestivalStart) => started.push(start),
    } as unknown as CareerHost;
    data.set(FESTIVAL_SAVE_KEY, { version: 1, discovered: ['coast-trap', 'pass-zone'], best: {}, vehicle: 'rs5' });
    const career = new CareerController(host, live);
    await career.load({});
    await career.transact((s) => buyVehicle({ ...s, credits: 1e6 }, live, 'rs5'));
    const credits = career.save.credits;
    const bus = new EventTarget();
    const stop = career.listen(bus);
    bus.dispatchEvent(new CustomEvent('festival-result', { detail: result }));
    bus.dispatchEvent(new CustomEvent('festival-result', { detail: structuredClone(result) }));
    await career.transact((s) => s);
    const paid = career.save.credits - credits;
    expect(paid).toBeGreaterThan(0);
    expect(career.save.ledger.filter((l) => l.label.startsWith('Festival ·'))).toHaveLength(1);
    expect((data.get(CAREER_KEY) as CareerSave).paidSessions).toContain(festivalRunKey(result.runId));
    expect(toasts.some((t) => t.includes('Coast'))).toBe(true);
    stop();
    // The hub's festival tab: discoveries and every event, with its state.
    career.action('career:discipline:festival:events');
    expect(modal).toContain('Discovered 2 of');
    for (const e of region.events) expect(modal).toContain(`data-festival-event="${e.id}"`);
    expect(modal).toContain('UNDISCOVERED');
    expect(modal).toContain(`career:start:${festivalKey(region.id, 'coast-trap')}`);
    // START from the career: the festival in the active machine, to the event.
    career.action(`career:start:${festivalKey(region.id, 'coast-trap')}`);
    expect(started.at(-1)).toEqual({ vehicle: 'rs5', travel: 'coast-trap', loaner: false });
    career.action(`career:start:festival.${region.id}.roam`);
    expect(started.at(-1)).toEqual({ vehicle: 'rs5', travel: null, loaner: false });
    // An undiscovered event is not started (the reason is shown instead).
    career.action(`career:start:${festivalKey(region.id, 'quarry-drift')}`);
    expect(started).toHaveLength(2);
    expect(toasts.at(-1)).toContain('Discover it first');
  });
  it('migrates a version 1 career save to version 2 with empty festival records', () => {
    const v1 = { ...newCareer(), version: 1 } as Record<string, unknown>;
    delete v1.festival;
    const migrated = validateCareer(v1);
    expect(migrated.version).toBe(2);
    expect(migrated.festival).toEqual({});
    const hostile = validateCareer({
      ...newCareer(),
      festival: { 'festival.x.y': { stars: 9, bestTime: -3, bestValue: 'x', runs: 2 }, other: { stars: 1 } },
    });
    expect(hostile.festival).toEqual({
      'festival.x.y': { stars: 3, bestTime: null, bestValue: null, bestPosition: null, runs: 2 },
    });
    // Rendering the hub never needs the festival session itself.
    expect(careerHub(newCareer(), live, { page: 'events', discipline: 'festival' })).toContain('ENTER THE FESTIVAL');
  });
});
