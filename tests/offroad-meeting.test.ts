import { describe, expect, it } from 'vitest';
import { CareerController, type CareerHost, type CareerSession } from '../src/career/controller.ts';
import { disciplineEvents } from '../src/career/ladder.ts';
import { liveRegistry } from '../src/career/registry.ts';
import { newCareer } from '../src/career/save.ts';
import { qualifyingGrid, raceResult } from '../src/core/championship.ts';
import {
  DEFAULT_OPTIONS,
  DEFAULT_SETUP,
  validateOptions,
  type SessionOptions,
} from '../src/simulation/config.ts';
import { EVENTS, eventSession, rulesetFor } from '../src/simulation/events.ts';
import {
  confirmGates,
  createMeeting,
  meetingClassification,
  motoOptions,
  pickMeetingGates,
  playerGateChoices,
  qualifyingOptions,
  recordMoto,
  recordQualifying,
  type MotoMeeting,
} from '../src/simulation/offroad/meeting.ts';
import { gateSlots } from '../src/simulation/offroad/session.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Track } from '../src/simulation/track.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { Simulation } from '../src/simulation/world.ts';
import { backupKey } from '../src/storage/data.ts';
import { careerHub } from '../src/ui/career-hub.ts';
import { eventCard } from '../src/ui/event-cards.ts';
import { meetingFromEvent, meetingScreen } from '../src/ui/offroad-meeting.ts';

const MOTO1 = EVENTS.find((e) => e.id === 'valley-ridge-mx-moto-1')!;
const name = (id: number) => (id === 0 ? 'YOU' : `RIDER ${id}`);
const meeting = (options: Partial<SessionOptions> = {}) =>
  createMeeting(
    'vr',
    'VALLEY RIDGE MOTOCROSS · TWO-MOTO MEETING',
    { ...eventSession(MOTO1, DEFAULT_OPTIONS), ...options },
    'changeable',
  );
const PREFERENCE = [4, 5, 3, 6, 2, 7, 1, 8, 0, 9, 10, 11];

describe('two-moto meeting: the session sequence', () => {
  it('runs qualifying, the gate pick in qualifying order, two motos and combined points', () => {
    let m = meeting();
    expect(m.stage).toBe('qualifying');
    const q = qualifyingOptions(m);
    expect(q).toMatchObject({ mode: 'qualifying', circuit: 'valley-ridge-mx', opponents: 9 });
    expect(rulesetFor(q).id).toBe('qualifying');
    expect(q.vehicles).toEqual(m.base.vehicles);
    // Qualifying: the player qualifies third; car 9 set no time.
    const order = [4, 2, 0, 1, 3, 5, 6, 7, 8, 9];
    m = recordQualifying(m, order, [80, 81, 79.5, 82, 79, 83, 84, 85, 86, 0]);
    expect(m.stage).toBe('gate-pick');
    // Riders ahead pick the best gates first; the player picks from what is left.
    expect(playerGateChoices(m, PREFERENCE)).toEqual(PREFERENCE.slice(2));
    const auto = pickMeetingGates(m, PREFERENCE);
    expect(auto.slice(0, 3)).toEqual([
      { car: 4, turn: 1, slot: 4 },
      { car: 2, turn: 2, slot: 5 },
      { car: 0, turn: 3, slot: 3 },
    ]);
    // A taken gate cannot be chosen; a free one can, and everyone behind adapts.
    expect(pickMeetingGates(m, PREFERENCE, 4).find((p) => p.car === 0)!.slot).toBe(3);
    const picks = pickMeetingGates(m, PREFERENCE, 9);
    expect(picks.find((p) => p.car === 0)!.slot).toBe(9);
    expect(picks.find((p) => p.car === 1)!.slot).toBe(3);
    m = confirmGates(m, picks);
    expect(m.stage).toBe('moto');
    const moto1 = motoOptions(m);
    expect(moto1).toMatchObject({
      mode: 'race',
      ruleset: 'motocross-moto',
      grid: order,
      weather: 'clear',
    });
    expect(moto1.gates![0]).toBe(9);
    m = recordMoto(m, {
      order: [0, 4, 2, 1, 3, 5, 6, 7, 8, 9],
      finished: [0, 4, 2, 1, 3, 5, 6, 7, 8],
    });
    const moto2 = motoOptions(m);
    expect(moto2.weather).toBe('changeable');
    expect(moto2.gates).toEqual(moto1.gates);
    expect(moto2.seed).not.toBe(moto1.seed);
    // Moto 2: rider 4 wins; points 25+22 each for 0 and 4, the last moto breaks the tie.
    m = recordMoto(m, {
      order: [4, 0, 2, 1, 3, 5, 6, 7, 8, 9],
      finished: [4, 0, 2, 1, 3, 5, 6, 7, 8, 9],
    });
    expect(m.stage).toBe('results');
    const table = meetingClassification(m);
    expect(table.slice(0, 2).map((r) => [r.id, r.total, r.overall])).toEqual([
      [4, 47, 1],
      [0, 47, 2],
    ]);
    // A rider who did not finish moto 1 scored nothing in it.
    expect(table.find((r) => r.id === 9)!.results[0]).toEqual({ position: 0, points: 0 });
    expect(() => motoOptions(m)).toThrow();
  });
  it('rejects formats and classifications that are not a meeting', () => {
    const rally = EVENTS.find((e) => e.id === 'pinewood-special-stage')!;
    expect(() => createMeeting('x', 'X', eventSession(rally, DEFAULT_OPTIONS))).toThrow(/two-moto/);
    const m = meeting();
    expect(() => recordQualifying(m, [0, 1, 2], [1, 2, 3])).toThrow();
    expect(() => recordMoto(m, { order: [0], finished: [0] })).toThrow();
    // Gate picks survive option validation only when they are distinct slots.
    const options = validateOptions({ ...m.base, gates: [0, 1, 2, 3, 4, 5, 6, 7, 8, 8] });
    expect(options.gates).toBeUndefined();
    expect(validateOptions({ ...m.base, gates: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] }).gates).toEqual([
      9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);
  });
  it('lines every rider up on the gate the meeting picked', () => {
    let m = meeting({ opponents: 3, vehicles: ['mx450', 'mx250', 'mx450', 'mx250'] });
    m = recordQualifying(m, [2, 0, 3, 1], [70, 71, 0, 72]);
    const track = new Track('clear', false, undefined, circuitDefinition('valley-ridge-mx'));
    const slots = gateSlots(track, offroadCourse(track.circuit)!, 4);
    m = confirmGates(m, pickMeetingGates(m, slots.preference, slots.preference.at(-1)));
    const sim = new Simulation(motoOptions(m));
    expect(sim.offroad!.entrants.map((e) => e.slot)).toEqual(m.gates);
    // Without a meeting's pick the session picks in grid order, as before.
    const own = new Simulation({ ...motoOptions(m), gates: undefined });
    expect(own.offroad!.entrants.map((e) => e.slot)).not.toEqual(m.gates);
  });
});

describe('two-moto meeting: screens and entry points', () => {
  const stages = (): MotoMeeting[] => {
    const a = meeting(),
      b = recordQualifying(a, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], Array(10).fill(80)),
      c = confirmGates(b, pickMeetingGates(b, PREFERENCE)),
      d = recordMoto(c, {
        order: [1, 0, 2, 3, 4, 5, 6, 7, 8, 9],
        finished: [1, 0, 2, 3, 4, 5, 6, 7, 8, 9],
      }),
      e = recordMoto(d, {
        order: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        finished: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      });
    return [a, b, c, d, e];
  };
  it('shows each stage with the action that runs its next real session', () => {
    const [a, b, c, d, e] = stages();
    const view = { name, preference: PREFERENCE, playerSlot: null };
    expect(meetingScreen(a, view)).toContain('data-action="meeting:qualifying"');
    const pick = meetingScreen(b, view);
    expect(pick).toContain('data-action="meeting:gate:4" aria-pressed="true"');
    expect(pick).toContain('CONFIRM GATE · START MOTO 1');
    expect(meetingScreen(b, { ...view, playerSlot: 7 })).toContain(
      'data-action="meeting:gate:7" aria-pressed="true"',
    );
    expect(meetingScreen(c, view)).toContain('START MOTO 1');
    const between = meetingScreen(d, view);
    expect(between).toContain('START MOTO 2');
    expect(between).toContain('Standings after moto 1');
    const done = meetingScreen(e, { ...view, extra: '<p class="career-payout">PAID</p>' });
    expect(done).toContain('data-stage="results"');
    expect(done).toContain('Overall winner.');
    expect(done).toContain('career-payout');
    for (const html of [pick, between, done]) expect(html).toContain('data-action="menu"');
  });
  it('is reachable from the EVENTS card and from career moto events', () => {
    const index = EVENTS.indexOf(MOTO1);
    expect(eventCard(MOTO1, index)).toContain(`data-action="meeting:event:${index}"`);
    const moto2 = EVENTS.find((e) => e.id === 'valley-ridge-mx-moto-2')!;
    expect(eventCard(moto2, EVENTS.indexOf(moto2))).not.toContain('meeting:event');
    const rally = EVENTS.find((e) => e.id === 'pinewood-special-stage')!;
    expect(eventCard(rally, EVENTS.indexOf(rally))).not.toContain('meeting:event');
    expect(meetingFromEvent(MOTO1, EVENTS)).toEqual({
      id: 'valley-ridge-mx-moto-1:meeting',
      name: 'VALLEY RIDGE MOTOCROSS · TWO-MOTO MEETING',
      moto2Weather: 'changeable',
    });
    const registry = liveRegistry();
    const html = careerHub(newCareer(), registry, { page: 'events', discipline: 'off-road' });
    const recovery = disciplineEvents(registry, newCareer(), 'off-road').find(
      (e) => e.kind === 'recovery',
    )!;
    expect(html).toContain(`data-action="career:meeting:${recovery.key}"`);
  });
  it('pays a career meeting once, on its combined classification', async () => {
    const data = new Map<string, unknown>();
    const meetings: { options: SessionOptions; career: CareerSession; name: string }[] = [];
    const ui = { extra: '' };
    const host: CareerHost = {
      store: {
        read: async (key) => structuredClone(data.get(key)),
        write: async (key, value) => void data.set(key, structuredClone(value)),
        writeWithBackup: async (key, value) => {
          if (data.has(key)) data.set(backupKey(key), data.get(key));
          data.set(key, structuredClone(value));
        },
      },
      modal: () => undefined,
      modalRoot: () => ({ querySelector: () => null }) as unknown as HTMLElement,
      toast: () => undefined,
      setResultsExtra: (html) => void (ui.extra = html),
      start: () => undefined,
      meeting: (options, career, title) => meetings.push({ options, career, name: title }),
      pause: () => undefined,
      state: () => 'menu',
      track: () => new Track(),
      setup: () => ({ ...DEFAULT_SETUP }),
      assist: () => 'sport',
    };
    const career = new CareerController(host);
    await career.load({});
    const recovery = disciplineEvents(career.registry, career.save, 'off-road').find(
      (e) => e.kind === 'recovery',
    )!;
    career.action(`career:meeting:${recovery.key}`);
    expect(meetings).toHaveLength(1);
    expect(meetings[0].career).toMatchObject({ meeting: 'part', round: -1 });
    expect(meetings[0].name).toMatch(/TWO-MOTO MEETING$/);
    const cars = meetings[0].options.opponents + 1;
    const frame = new Float32Array(HEADER + CAR_STRIDE * cars);
    frame[H.CARS] = cars;
    for (let id = 0; id < cars; id++) {
      frame[carBase(id) + F.RANK] = id + 1;
      frame[carBase(id) + F.FINISH] = 200 + id;
    }
    const credits = career.save.credits;
    // Qualifying and moto 1 are the meeting's, not paid on their own.
    career.begin({ ...meetings[0].career, meeting: 'part' }, 'moto-1');
    expect(career.finish(frame, undefined)).toBe(true);
    await career.transact((s) => s);
    expect(career.save.credits).toBe(credits);
    expect(ui.extra).toBe('');
    // The final moto settles the meeting: P2 overall although it won moto 2.
    career.begin({ ...meetings[0].career, meeting: 'final' }, 'moto-2');
    expect(
      career.finish(frame, undefined, { position: 2, cars, classified: true, gridSlot: 0 }),
    ).toBe(true);
    await career.transact((s) => s);
    expect(career.save.credits).toBeGreaterThan(credits);
    expect(career.save.results[recovery.key].bestPosition).toBe(2);
  });
});

describe('two-moto meeting: production sessions', () => {
  it('chains real qualifying and two real motos into the combined classification', async () => {
    const DT = 1 / 120;
    // Long sessions yield to the test runner every simulated 10 s.
    const run = async (options: SessionOptions) => {
      const sim = new Simulation(options);
      sim.autoPlayer = true;
      for (let t = 0, k = 0; t < 900 && sim.race.phase !== PHASE.FINISHED; t += DT, k++) {
        sim.step(DT);
        if (k % 1200 === 1199) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(sim.race.phase).toBe(PHASE.FINISHED);
      const frame = sim.makeFrame();
      sim.writeFrame(frame);
      return { sim, frame };
    };
    let m = meeting({ opponents: 3, laps: 1, vehicles: ['mx450', 'mx250', 'mx450', 'mx250'] });
    const q = await run(qualifyingOptions(m));
    const grid = qualifyingGrid(q.frame);
    m = recordQualifying(
      m,
      grid,
      grid.map((_, id) => q.frame[carBase(id) + F.BEST_LAP]),
    );
    const slots = gateSlots(q.sim.track, offroadCourse(q.sim.track.circuit)!, 4);
    m = confirmGates(m, pickMeetingGates(m, slots.preference));
    // The pole sitter has the venue's best gate.
    expect(m.gates![grid[0]]).toBe(slots.preference[0]);
    for (let k = 0; k < 2; k++) {
      const options = motoOptions(m);
      const moto = await run(options);
      expect(moto.sim.offroad!.entrants.map((e) => e.slot)).toEqual(m.gates);
      const result = raceResult(moto.frame, options.grid!, true, `moto-${k + 1}`);
      m = recordMoto(m, {
        order: result.order,
        finished: result.order.filter((id) => !result.retired.includes(id)),
      });
    }
    const table = meetingClassification(m);
    expect(table).toHaveLength(4);
    expect(table.map((r) => r.overall)).toEqual([1, 2, 3, 4]);
    // Points come from the real moto results.
    for (const row of table) expect(row.total).toBe(row.results.reduce((a, r) => a + r.points, 0));
  }, 300000);
});
