import { describe, expect, it } from 'vitest';
import { ContactMeter } from '../src/career/contact.ts';
import { CareerController, type CareerHost, type CareerSession } from '../src/career/controller.ts';
import { licenceCourse } from '../src/career/course.ts';
import { settleLicence } from '../src/career/economy.ts';
import { licenceAvailability } from '../src/career/ladder.ts';
import { LICENCE_TESTS, LicenceAttempt, sampleFrame } from '../src/career/licences.ts';
import { liveRegistry } from '../src/career/registry.ts';
import { newCareer } from '../src/career/save.ts';
import { AUREL } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP, type SessionOptions } from '../src/simulation/config.ts';
import { eventSession } from '../src/simulation/events.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { backupKey } from '../src/storage/data.ts';

/** End to end without a renderer: the licence session the career builds,
 * run by the production simulation, measured from its own snapshots. */
describe('a career licence session measured from real snapshots', () => {
  it('scores the cornering line from a practice session the career builds', () => {
    const registry = liveRegistry();
    const a = licenceAvailability(registry, newCareer(), 'cornering');
    expect(a.status).toBe('open');
    const options = eventSession(a.definition!, { ...DEFAULT_OPTIONS });
    expect(options).toMatchObject({ mode: 'practice', opponents: 0, vehicles: [a.vehicle] });
    const sim = new Simulation(options);
    // The AI driver stands in for a player here; it drives the racing line.
    sim.autoPlayer = true;
    const vehicle = registry.vehicles.find((v) => v.id === a.vehicle)!;
    const attempt = new LicenceAttempt(
      LICENCE_TESTS.cornering,
      licenceCourse(LICENCE_TESTS.cornering, sim.track, vehicle),
    );
    const contact = new ContactMeter();
    let outcome = null;
    for (let tick = 0; tick < 120 * 240 && !outcome; tick++) {
      sim.step(1 / 120);
      if (tick % 2) continue; // 60 Hz snapshots, as the worker posts
      const frame = sim.makeFrame();
      contact.observe(frame);
      outcome = attempt.observe(sampleFrame(frame));
    }
    expect(outcome).not.toBeNull();
    expect(outcome!.valid).toBe(true);
    // The production AI follows its line closely: a measured, medal-grade value.
    expect(outcome!.value!).toBeGreaterThanOrEqual(0);
    expect(outcome!.value!).toBeLessThan(LICENCE_TESTS.cornering.thresholds.bronze);
    expect(outcome!.medal).not.toBeNull();
    expect(contact.energy).toBe(0);
    // Driven by the AI, so the career records the attempt but awards nothing.
    const settled = settleLicence(newCareer(), outcome!, 'ai-session', true);
    expect(settled.save.licences.cornering).toEqual({ medal: null, best: null, attempts: 1 });
    expect(settled.payout.paid).toBe(false);
  }, 120000);
  it('scores trail braking from the lean channel of a real bike session, once a bike can race', () => {
    const registry = liveRegistry();
    const a = licenceAvailability(registry, newCareer(), 'lean');
    // Data-driven: runs whenever the registries carry a raceable bike and the
    // snapshot publishes the motorcycle block.
    if (a.status !== 'open') return expect(a.reasons.length).toBeGreaterThan(0);
    const options = eventSession(a.definition!, { ...DEFAULT_OPTIONS });
    const sim = new Simulation(options);
    sim.autoPlayer = true;
    const vehicle = registry.vehicles.find((v) => v.id === a.vehicle)!;
    const attempt = new LicenceAttempt(
      LICENCE_TESTS.lean,
      licenceCourse(LICENCE_TESTS.lean, sim.track, vehicle),
    );
    let outcome = null,
      lean = 0;
    for (let tick = 0; tick < 120 * 240 && !outcome; tick++) {
      sim.step(1 / 120);
      if (tick % 2) continue;
      const sample = sampleFrame(sim.makeFrame());
      lean = Math.max(lean, Math.abs(sample.lean ?? 0));
      outcome = attempt.observe(sample);
    }
    // The lean is read from the bike block at BIKE_BASE + B.LEAN of the car.
    expect(lean).toBeGreaterThan(0.3);
    expect(outcome).not.toBeNull();
    expect(outcome!.valid).toBe(true);
    expect(outcome!.value!).toBeGreaterThanOrEqual(0);
    expect(outcome!.value!).toBeLessThanOrEqual(100);
  }, 120000);
});

describe('career controller: session hook and results flow', () => {
  function harness() {
    const data = new Map<string, unknown>();
    const calls: { options: SessionOptions; career: CareerSession }[] = [];
    const modals: string[] = [];
    const ui = { extra: '', paused: 0 };
    const track = new Track('clear', false, undefined, AUREL);
    const host: CareerHost = {
      store: {
        async read(key) {
          return structuredClone(data.get(key));
        },
        async write(key, value) {
          data.set(key, structuredClone(value));
        },
        async writeWithBackup(key, value) {
          if (data.has(key)) data.set(backupKey(key), data.get(key));
          data.set(key, structuredClone(value));
        },
      },
      modal: (html) => modals.push(html),
      modalRoot: () => ({ querySelector: () => null }) as unknown as HTMLElement,
      toast: () => {},
      setResultsExtra: (html) => {
        ui.extra = html;
      },
      start: (options, career) => calls.push({ options, career }),
      pause: () => ui.paused++,
      state: () => 'menu',
      track: () => track,
      setup: () => ({ ...DEFAULT_SETUP }),
      assist: () => 'sport',
    };
    const career = new CareerController(host);
    const settle = () => career.transact((s) => s);
    return { career, calls, modals, ui, data, settle };
  }
  const finishFrame = (position: number) => {
    const frame = new Float32Array(HEADER + CAR_STRIDE * 8);
    frame[H.CARS] = 8;
    for (let id = 0; id < 8; id++) {
      const o = carBase(id);
      frame[o + F.RANK] = id === 0 ? position : id < position ? id : id + 1;
      frame[o + F.FINISH] = 300 + id;
      frame[o + F.BEST_LAP] = 90 + id;
    }
    return frame;
  };
  it('starts an invitational through eventSession and pays its result once', async () => {
    const h = harness();
    await h.career.load({});
    h.career.action('career:buy:tc1');
    await h.settle();
    expect(h.career.save.owned).toEqual([{ id: 'tc1', source: 'purchase' }]);
    await h.career.transact((s) => ({
      ...s,
      licences: { braking: { medal: 'bronze', best: 6, attempts: 1 } },
    }));
    h.career.action('career:start:circuit-cars.club.inv.aurel');
    await h.settle();
    expect(h.calls).toHaveLength(1);
    const { options, career } = h.calls[0];
    expect(options).toMatchObject({ mode: 'race', circuit: 'aurel', ruleset: 'touring-sprint' });
    expect(options.vehicles![0]).toBe('tc1');
    expect(options.grid!.indexOf(0)).toBe(4);
    expect(career).toMatchObject({ kind: 'race', vehicle: 'tc1', round: -1 });
    const credits = h.career.save.credits;
    h.career.begin(career, 'race-1');
    expect(h.career.finish(finishFrame(2), options.grid)).toBe(true);
    expect(h.ui.extra).toContain('CAREER PAYMENT');
    expect(h.ui.extra).toContain('Saving to your career');
    await h.settle();
    expect(h.ui.extra).toContain('Paid to your career wallet.');
    const paid = h.career.save.credits - credits;
    expect(paid).toBeGreaterThan(0);
    expect(h.ui.extra).toContain('Objective: Gain two places from your grid slot');
    expect(h.data.get('career')).toMatchObject({ credits: h.career.save.credits });
    // The same session cannot be paid twice, even if finish runs again.
    h.career.finish(finishFrame(2), options.grid);
    await h.settle();
    expect(h.career.save.credits - credits).toBe(paid);
    expect(h.ui.extra).toContain('already been paid');
    // A non-career session is not the career's to settle.
    h.career.begin(null, 'other');
    expect(h.career.finish(finishFrame(1), undefined)).toBe(false);
    expect(h.career.restartContext()).toBeNull();
  });
  it('runs a braking licence from briefing to a saved medal, measured from snapshots', async () => {
    const h = harness();
    await h.career.load({});
    h.career.action('career:licence:braking');
    expect(h.modals.at(-1)).toContain('Braking marker');
    h.career.action('career:licenceGo');
    expect(h.calls[0].options).toMatchObject({ mode: 'practice', opponents: 0 });
    expect(h.calls[0].career).toMatchObject({ kind: 'licence', licence: 'braking', setup: null });
    h.career.begin(h.calls[0].career, 'licence-1');
    // The course is paced for the machine the licence lends (the cheapest club car).
    const loaned = h.career.registry.vehicles.find((v) => v.id === h.calls[0].career.vehicle)!;
    expect(h.calls[0].options.vehicles![0]).toBe(loaned.id);
    const c = licenceCourse(
      LICENCE_TESTS.braking,
      new Track('clear', false, undefined, AUREL),
      loaned,
    );
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.CARS] = 1;
    const o = carBase(0);
    const feed = (t: number, s: number, speed: number) => {
      frame[H.TIME] = t;
      frame[o + F.S] = s;
      frame[o + F.SPEED] = speed;
      frame[o + F.QW] = 1;
      frame[o + F.VZ] = speed;
      h.career.observe(frame, false);
    };
    let t = 0;
    for (let s = c.gate - 60; s < c.gate + 2; s += 1) feed((t += 0.03), s, c.gateSpeed + 2);
    expect(h.career.hudText()).toContain('BRAKE');
    const stop = c.marker + 1.2;
    for (let s = c.gate + 2; s < stop; s += 1)
      feed((t += 0.03), s, Math.max(1, (c.gateSpeed * (stop - s)) / (stop - c.gate)));
    feed((t += 0.03), stop, 0);
    expect(h.ui.paused).toBe(1);
    expect(h.modals.at(-1)).toContain('Gold.');
    await h.settle();
    expect(h.modals.at(-1)).toContain('Paid to your career wallet.');
    expect(h.career.save.licences.braking).toMatchObject({ medal: 'gold', attempts: 1 });
    expect(h.career.save.reputation['circuit-cars']).toBe(8);
    // The attempt is measured once; further frames change nothing.
    feed((t += 0.03), stop, 0);
    await h.settle();
    expect(h.career.save.licences.braking!.attempts).toBe(1);
  });
  it('runs a tier championship round by round with the existing points table', async () => {
    const h = harness();
    await h.career.load({});
    h.career.action('career:buy:tc1');
    await h.career.transact((s) => ({
      ...s,
      reputation: { ...s.reputation, 'circuit-cars': 20 },
      licences: { braking: { medal: 'bronze', best: 6, attempts: 1 } },
    }));
    const key = 'circuit-cars.club.championship';
    h.career.action(`career:start:${key}`);
    await h.settle();
    const first = h.calls.at(-1)!;
    expect(first.career).toMatchObject({ kind: 'race', round: 0 });
    const season = h.career.save.championships[key].season;
    expect(season.rounds.length).toBeGreaterThanOrEqual(4);
    expect(first.options.circuit).toBe(season.rounds[0].circuit);
    h.career.begin(first.career, 'round-1');
    h.career.finish(finishFrame(1), first.options.grid);
    await h.settle();
    expect(h.career.save.championships[key].season.results).toHaveLength(1);
    expect(h.career.save.championships[key].season.results[0].order[0]).toBe(0);
    // A restart of the recorded round pays as a race but cannot record it twice.
    h.career.begin(first.career, 'round-1-again');
    h.career.finish(finishFrame(1), first.options.grid);
    await h.settle();
    expect(h.career.save.championships[key].season.results).toHaveLength(1);
    h.career.action(`career:start:${key}`);
    await h.settle();
    const second = h.calls.at(-1)!;
    expect(second.career.round).toBe(1);
    expect(second.options.circuit).toBe(season.rounds[1].circuit);
    expect(second.options.weather).toBe(season.rounds[1].weather);
  });
  it('keeps a season in its machine when the active machine changes mid-season', async () => {
    const h = harness();
    await h.career.load({});
    await h.career.transact((s) => ({
      ...s,
      credits: 100000,
      reputation: { ...s.reputation, 'circuit-cars': 20 },
      licences: { braking: { medal: 'bronze', best: 6, attempts: 1 } },
    }));
    // Two club-tier machines: tc1 (active, first bought) and tc2.
    h.career.action('career:buy:tc1');
    h.career.action('career:buy:tc2');
    await h.settle();
    expect(h.career.save.owned.map((o) => o.id)).toEqual(['tc1', 'tc2']);
    expect(h.career.save.active['circuit-cars']).toBe('tc1');
    const key = 'circuit-cars.club.championship';
    for (const round of [0, 1]) {
      h.career.action(`career:start:${key}`);
      await h.settle();
      const call = h.calls.at(-1)!;
      expect(call.career).toMatchObject({ round, vehicle: 'tc1' });
      h.career.begin(call.career, `season-r${round + 1}`);
      h.career.finish(finishFrame(2), call.options.grid);
      await h.settle();
    }
    expect(h.career.save.championships[key].season.results).toHaveLength(2);
    // The player makes tc2 the active circuit machine in the Garage.
    h.career.action('career:active:circuit-cars:tc2');
    await h.settle();
    expect(h.career.save.active['circuit-cars']).toBe('tc2');
    // The card still offers round 3, and starting it races round 3 in tc1.
    h.career.action('career:page:events');
    expect(h.modals.at(-1)).toContain('START ROUND 3');
    expect(h.modals.at(-1)).toContain('ABANDON SEASON');
    h.career.action(`career:start:${key}`);
    await h.settle();
    const third = h.calls.at(-1)!;
    expect(third.career).toMatchObject({ round: 2, vehicle: 'tc1' });
    expect(third.options.vehicles![0]).toBe('tc1');
    const season = h.career.save.championships[key];
    expect(season.vehicle).toBe('tc1');
    expect(season.season.results).toHaveLength(2);
    expect(third.options.circuit).toBe(season.season.rounds[2].circuit);
    // Abandoning is an explicit, confirmed choice that names the loss.
    h.career.action(`career:abandon:${key}`);
    expect(h.modals.at(-1)).toContain('2 of');
    expect(h.modals.at(-1)).toContain(`career:abandonConfirm:${key}`);
    expect(h.career.save.championships[key]).toBeDefined();
    h.career.action(`career:abandonConfirm:${key}`);
    await h.settle();
    expect(h.career.save.championships[key]).toBeUndefined();
    h.career.action(`career:start:${key}`);
    await h.settle();
    expect(h.calls.at(-1)!.career).toMatchObject({ round: 0, vehicle: 'tc2' });
  });
});
