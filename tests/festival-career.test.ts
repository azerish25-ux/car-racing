import { describe, expect, it } from 'vitest';
import { CareerController, type CareerHost, type FestivalStart } from '../src/career/controller.ts';
import { buyVehicle } from '../src/career/economy.ts';
import {
  FESTIVAL_LOANER_STAKES,
  FESTIVAL_RULES,
  eventReputation,
  festivalEvents,
  festivalKey,
  festivalLoaner,
  festivalMachine,
  festivalRunKey,
  settleFestival,
  validateFestivalResult,
} from '../src/career/festival.ts';
import { disciplineEvents, purchaseReasons, recoveryEvent } from '../src/career/ladder.ts';
import {
  disciplineStatus,
  liveRegistry,
  vehicleDiscipline,
  venueKind,
  type CareerRegistry,
} from '../src/career/registry.ts';
import { CAREER_KEY, newCareer, validateCareer, type CareerSave } from '../src/career/save.ts';
import { FESTIVAL_SAVE_KEY, festivalMachineChoice } from '../src/session/festival-save.ts';
import { controls } from '../src/simulation/config.ts';
import { festivalDefaultVehicle } from '../src/simulation/open-world/festival-machines.ts';
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
      // Entered from CAREER (so even the machine it does not own is its run).
      const settled = settleFestival(save, live, run, { loaner: null, career: true });
      expect(settled.payout.paid).toBe(false);
      expect(settled.payout.reason).toContain(reason);
      expect(settled.save.credits).toBe(save.credits);
      // Settled: buying the machine later does not make this run payable.
      expect(settled.save.paidSessions).toContain(festivalRunKey(run.runId));
    });
    // Outside the career in a machine the career does not own: not a career
    // run at all, so nothing is settled, written or said.
    const outside = settleFestival(save, live, { ...result, vehicleId: 'sc7', runId: 'outside:1' });
    expect(outside.ignored).toBe(true);
    expect(outside.save).toBe(save);
    expect(outside.payout.paid).toBe(false);
    // ...but a run in an owned machine is the career's wherever it started.
    expect(settleFestival(save, live, { ...result, runId: 'outside:2' }).payout.paid).toBe(true);
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
  it('keeps loaned runs apart: a later run in your own machine still earns the stars, first completion and reputation', () => {
    const key = festivalKey(region.id, 'coast-trap'),
      three = { ...result, stars: 3 };
    // Never loaned: the full-rate reference.
    const direct = settleFestival(owning('rs5'), live, { ...three, runId: 'direct:1' });
    expect(direct.payout.reputation).toBe(eventReputation(3, true));
    // A new career in the loaned machine first, then buys one and runs again.
    const loan = settleFestival(newCareer(), live, { ...three, vehicleId: 'eh3', runId: 'loan:1' }, { loaner: 'eh3', career: true });
    expect(loan.payout.paid).toBe(true);
    expect(loan.payout.reputation).toBe(1);
    expect(loan.save.festival[key]).toMatchObject({ stars: 0, runs: 0, reputation: 1, loaner: { stars: 3, runs: 1 } });
    // Another loaned run of the same event: no new star, no second first
    // completion, no reputation.
    const again = settleFestival(loan.save, live, { ...three, vehicleId: 'eh3', runId: 'loan:2' }, { loaner: 'eh3', career: true });
    expect(again.payout.reputation).toBe(0);
    expect(again.payout.lines.map((l) => l.label).join(' ')).not.toContain('First completion');
    expect(again.payout.lines.find((l) => l.label.includes('no star above'))!.amount).toBe(0);
    const bought = buyVehicle({ ...again.save, credits: 1e6 }, live, 'rs5');
    const own = settleFestival(bought, live, { ...three, runId: 'own:1' });
    expect(own.payout.paid).toBe(true);
    // The star money and the first completion are paid at the full rate, as
    // on the career that never borrowed...
    const labels = (p: typeof own.payout) => p.lines.map((l) => [l.label, l.amount]);
    expect(labels(own.payout)).toEqual(labels(direct.payout));
    expect(own.payout.total).toBe(direct.payout.total);
    expect(own.payout.lines.find((l) => l.label.startsWith('New stars'))!.amount).toBeGreaterThan(0);
    // ...and the event's reputation in all is what it gives, never more.
    expect(own.payout.reputation).toBe(eventReputation(3, true) - 1);
    expect(own.save.reputation.festival).toBe(direct.save.reputation.festival);
    expect(own.save.festival[key]).toMatchObject({ stars: 3, runs: 1, reputation: eventReputation(3, true), loaner: { stars: 3, runs: 2 } });
    // Afterwards neither kind of run pays reputation for the same stars.
    expect(settleFestival(own.save, live, { ...three, runId: 'own:2' }).payout.reputation).toBe(0);
    // The records survive validation as written.
    expect(validateCareer(own.save).festival[key]).toEqual(own.save.festival[key]);
  });
  it('lends a car for the festival, not the cheapest machine (the road motorcycle)', () => {
    const loaner = festivalLoaner(live)!;
    expect(loaner.id).toBe(festivalDefaultVehicle());
    expect(loaner.dynamicsKind).toBe('four-wheel');
    expect(festivalMachine(live, newCareer())).toMatchObject({ vehicle: { id: loaner.id }, loaner: true });
    for (const e of festivalEvents(live, newCareer(), new Set())) expect(e.vehicle).toBe(loaner.id);
    // Without the festival's default machine: the cheapest car of the tier;
    // with only a motorcycle: the motorcycle.
    const without = { ...live, vehicles: live.vehicles.filter((v) => v.id !== loaner.id) };
    const car = festivalLoaner(without)!;
    expect(car.dynamicsKind).toBe('four-wheel');
    expect(car.id).not.toBe(loaner.id);
    const bikesOnly = { ...live, vehicles: live.vehicles.filter((v) => vehicleDiscipline(v) !== 'festival' || v.id === 'nr900') };
    expect(festivalLoaner(bikesOnly)?.id).toBe('nr900');
  });
  it('drives the career loan without saving it as the festival machine', () => {
    // A career start on the loan: driven, but the festival save keeps the
    // player's own machine.
    expect(festivalMachineChoice({ vehicle: 'eh3', loaner: true }, 'rs5')).toEqual({ drive: 'eh3', save: 'rs5' });
    // A machine of the player's own choice is saved.
    expect(festivalMachineChoice({ vehicle: 'nr900' }, 'rs5')).toEqual({ drive: 'nr900', save: 'nr900' });
    // No choice (the Formula default): the saved machine, or the default.
    expect(festivalMachineChoice({ vehicle: 'apx01' }, 'rs5')).toEqual({ drive: 'rs5', save: 'rs5' });
    expect(festivalMachineChoice({ loaner: true, vehicle: 'eh3' }, 'gone')).toEqual({ drive: 'eh3', save: festivalDefaultVehicle() });
  });
  it('lists festival events as coming, with the reason, when no festival region is a venue', () => {
    const noVenue: CareerRegistry = { ...live, venues: live.venues.filter((v) => venueKind(v) !== 'festival') };
    expect(disciplineStatus(noVenue, 'festival').state).toBe('coming');
    const events = festivalEvents(noVenue, newCareer(), new Set(region.events.map((e) => e.id)));
    expect(events).toHaveLength(region.events.length);
    for (const e of events) {
      expect(e.status).toBe('coming');
      expect(e.reasons.length).toBeGreaterThan(0);
      expect(e.reasons).toEqual(disciplineStatus(noVenue, 'festival').reasons);
    }
    // The festival has no circuit recovery event to offer instead.
    expect(recoveryEvent(noVenue, newCareer(), 'festival')).toBeNull();
    expect(disciplineEvents(noVenue, newCareer(), 'festival')).toEqual([]);
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
  it('leaves festival runs outside the career alone: no career written, no career toast', async () => {
    const data = new Map<string, unknown>();
    const toasts: string[] = [];
    const host = {
      store: {
        read: async (k: string) => structuredClone(data.get(k)),
        write: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
        writeWithBackup: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
      },
      toast: (m: string) => toasts.push(m),
      modal: () => undefined,
      modalRoot: () => ({ querySelector: () => null }) as unknown as HTMLElement,
      state: () => 'menu',
      pause: () => undefined,
    } as unknown as CareerHost;
    const career = new CareerController(host, live);
    await career.load({});
    const before = toasts.length;
    expect(data.has(CAREER_KEY)).toBe(false);
    // FESTIVAL from SESSION select in the festival's default machine, which
    // a new career does not own: every kind of result is ignored.
    career.beginFestival({ loaner: null, career: false });
    for (const [i, change] of [{}, { assisted: true }, { completed: false }].entries()) {
      const payout = await career.festivalResult({ ...result, ...change, vehicleId: festivalDefaultVehicle(), runId: `outside:${i}` });
      expect(payout?.paid).toBe(false);
    }
    expect(data.has(CAREER_KEY)).toBe(false);
    expect(toasts.length).toBe(before);
    career.endFestival();
    // Entered from CAREER on the loan: the run is the career's, so the
    // reason it was not paid is shown and the run is settled.
    career.beginFestival({ loaner: festivalDefaultVehicle(), career: true });
    await career.festivalResult({ ...result, vehicleId: festivalDefaultVehicle(), runId: 'career:1', assisted: true });
    expect(toasts.at(-1)).toContain('autopilot');
    expect((data.get(CAREER_KEY) as CareerSave).paidSessions).toContain(festivalRunKey('career:1'));
  });
  it('gives star results a text alternative in the hub and plain words in the ledger', () => {
    const paid = settleFestival(owning('rs5'), live, { ...result, stars: 2, runId: 'stars:1' });
    const label = paid.save.ledger.at(-1)!.label;
    expect(label).toContain('2 of 3 stars');
    expect(label).not.toMatch(/[★☆]/);
    for (const line of paid.payout.lines) expect(line.label).not.toMatch(/[★☆]/);
    const html = careerHub(paid.save, live, {
      page: 'events',
      discipline: 'festival',
      festival: { discovered: ['coast-trap'] },
    });
    expect(html).toContain('role="img" aria-label="2 of 3 stars">★★☆</span>');
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
      // Written before the reputation count: its stars and completion paid.
      'festival.x.y': { stars: 3, bestTime: null, bestValue: null, bestPosition: null, runs: 2, reputation: 7 },
    });
    const lent = validateCareer({
      ...newCareer(),
      festival: { 'festival.x.y': { stars: 0, runs: 0, reputation: 99, loaner: { stars: 2, bestTime: 30, runs: -4 } } },
    });
    expect(lent.festival['festival.x.y']).toEqual({
      stars: 0,
      bestTime: null,
      bestValue: null,
      bestPosition: null,
      runs: 0,
      reputation: 7,
      loaner: { stars: 2, bestTime: 30, bestValue: null, bestPosition: null, runs: 0 },
    });
    // Rendering the hub never needs the festival session itself.
    expect(careerHub(newCareer(), live, { page: 'events', discipline: 'festival' })).toContain('ENTER THE FESTIVAL');
  });
});
