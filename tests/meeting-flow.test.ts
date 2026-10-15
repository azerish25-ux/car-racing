import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CareerSession } from '../src/career/controller.ts';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { EVENTS, eventSession } from '../src/simulation/events.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { Track } from '../src/simulation/track.ts';
import { weatherKeyframes } from '../src/simulation/weather.ts';
import { MeetingFlow, type FinishedSession, type MeetingHost } from '../src/ui/meeting-flow.ts';
import { meetingFromEvent } from '../src/ui/offroad-meeting.ts';

const MOTO1 = EVENTS.find((e) => e.id === 'valley-ridge-mx-moto-1')!;
const TRACK = new Track(
  'clear',
  false,
  weatherKeyframes('clear'),
  circuitDefinition('valley-ridge-mx'),
);

/** A fake application: it records what the meeting drew, focused and
 * started, and starts sessions the way main.ts start() does (the meeting
 * hears of every start before it runs). */
function harness() {
  const calls: string[] = [];
  const starts: { options: SessionOptions; career: CareerSession | null }[] = [];
  let html = '';
  const host: MeetingHost = {
    modal: (h) => {
      html = h;
      calls.push('modal');
    },
    focus: (selector) => void calls.push(`focus ${selector}`),
    closeModal: () => void calls.push('close'),
    toast: (message) => void calls.push(`toast ${message}`),
    start: async (options, career) => {
      flow.sessionStarting();
      starts.push({ options, career });
    },
    riderName: (id) => (id === 0 ? 'YOU' : `RIDER ${id}`),
    resultsExtra: () => '<p class="career-payout">PAID</p>',
  };
  const flow = new MeetingFlow(host);
  return { flow, calls, starts, html: () => html };
}
/** A finished session's frame: car `order[k]` placed k-th, best laps in that order. */
function frame(order: number[]) {
  const cars = order.length,
    f = new Float32Array(HEADER + CAR_STRIDE * cars);
  f[H.CARS] = cars;
  order.forEach((id, k) => {
    f[carBase(id) + F.RANK] = k + 1;
    f[carBase(id) + F.FINISH] = 300 + k;
    f[carBase(id) + F.BEST_LAP] = 80 + k;
  });
  return f;
}
const session = (mode: SessionOptions['mode'], grid?: number[]): FinishedSession => ({
  mode,
  grid,
  demonstration: false,
  sessionId: `${mode}-1`,
  track: TRACK,
});
function open(career: CareerSession | null = null) {
  const h = harness();
  const race = eventSession(MOTO1, DEFAULT_OPTIONS),
    m = meetingFromEvent(MOTO1, EVENTS);
  h.flow.open(m.name, race, career, m.id, m.moto2Weather);
  return h;
}
/** Open a meeting and finish its qualifying session. */
async function qualified(career: CareerSession | null = null) {
  const h = open(career);
  h.flow.action('meeting:qualifying');
  await Promise.resolve();
  const cars = h.starts[0].options.opponents + 1;
  // The player qualifies on pole: every gate is free at their turn.
  const order = Array.from({ length: cars }, (_, k) => k);
  expect(h.flow.record(frame(order), session('qualifying')).recorded).toBe(true);
  return { ...h, cars, order };
}

describe('two-moto meeting flow: the results state belongs to the meeting', () => {
  it('runs qualifying as a real session and waits on its own screen after it', async () => {
    const h = open();
    expect(h.html()).toContain('data-stage="qualifying"');
    expect(h.flow.waiting).toBe(true);
    h.flow.action('meeting:qualifying');
    await Promise.resolve();
    expect(h.starts).toHaveLength(1);
    expect(h.starts[0].options.mode).toBe('qualifying');
    expect(h.flow.running).toBe('qualifying');
    // The meeting started this session itself: it is still open.
    expect(h.flow.state).not.toBeNull();
    const cars = h.starts[0].options.opponents + 1;
    h.flow.record(frame(Array.from({ length: cars }, (_, k) => k)), session('qualifying'));
    expect(h.flow.state!.stage).toBe('gate-pick');
    expect(h.flow.waiting).toBe(true);
  });
  it('returns to the meeting, not the plain results card, after Escape, the replay or telemetry', async () => {
    const h = await qualified();
    // main.ts modalClose / exitReplay / telemetryClose / closePhoto call
    // showResults(): the meeting screen is drawn again at its gate pick.
    for (let k = 0; k < 3; k++) {
      expect(h.flow.showResults()).toBe(true);
      expect(h.html()).toContain('data-stage="gate-pick"');
      expect(h.html()).toContain('CONFIRM GATE · START MOTO 1');
    }
    // With no meeting open the plain results card is the application's.
    const none = harness();
    expect(none.flow.showResults()).toBe(false);
    expect(none.calls).toEqual([]);
  });
  it('every way back to the results state in main.ts goes through showResults', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    // finish() draws the card once for the classification; everything that
    // later returns to the results state uses showResults().
    expect(main.match(/this\.ui\.results\(/g)).toHaveLength(2);
    expect(main).toContain('this.ui.results(frame);');
    expect(main).toMatch(
      /private showResults\(\) \{[^}]*if \(!this\.meetings\.showResults\(\)\) this\.ui\.results\(this\.current\);/,
    );
    for (const site of ['modalClose', 'telemetryClose'])
      expect(main.slice(main.indexOf(`case '${site}':`)).slice(0, 400)).toContain(
        'this.showResults()',
      );
    const exit = main.slice(main.indexOf('private exitReplay()'));
    expect(exit.slice(0, exit.indexOf('\n  }\n'))).toContain('this.showResults()');
    const photo = main.slice(main.indexOf('private closePhoto()'));
    expect(photo.slice(0, photo.indexOf('\n  }\n'))).toContain('this.showResults()');
  });
  it('never reruns a recorded meeting session on its own (RACE AGAIN shows the meeting)', async () => {
    const career = {
      kind: 'race',
      event: null,
      licence: null,
      vehicle: 'mx450',
      setup: null,
      round: -1,
      meeting: 'part',
    } satisfies CareerSession;
    const h = await qualified(career);
    h.flow.action('meeting:moto');
    await Promise.resolve();
    expect(h.starts).toHaveLength(2);
    expect(h.starts[1].career).toMatchObject({ meeting: 'part' });
    const grid = h.starts[1].options.grid!;
    h.flow.record(frame(h.order), session('race', grid));
    expect(h.flow.state!.stage).toBe('moto');
    expect(h.flow.state!.motos).toHaveLength(1);
    // Escape after moto 1, then RACE AGAIN: the meeting screen comes back
    // and no session starts (it would carry the meeting's career context
    // and be paid by nobody).
    expect(h.flow.restart()).toBe('meeting');
    expect(h.starts).toHaveLength(2);
    expect(h.html()).toContain('START MOTO 2');
    // The meeting goes on: moto 2 is the final and settles the career.
    h.flow.action('meeting:moto');
    await Promise.resolve();
    expect(h.starts[2].career).toMatchObject({ meeting: 'final' });
    const done = h.flow.record(frame(h.order), session('race', h.starts[2].options.grid));
    expect(done.outcome).toMatchObject({ cars: h.cars });
    expect(h.flow.showResults()).toBe(true);
    expect(h.html()).toContain('data-stage="results"');
    expect(h.html()).toContain('career-payout');
  });
  it('reruns a running meeting session as that session, and any other session ends the meeting', async () => {
    const h = await qualified();
    h.flow.action('meeting:moto');
    await Promise.resolve();
    // RESTART SESSION from the pause menu while moto 1 runs.
    expect(h.flow.restart()).toBe('rerun');
    h.flow.sessionStarting();
    expect(h.flow.running).toBe('moto');
    expect(h.flow.state).not.toBeNull();
    // A session the meeting did not start (a practice from the menu).
    h.flow.sessionStarting();
    expect(h.flow.state).toBeNull();
    expect(h.flow.showResults()).toBe(false);
    expect(h.flow.restart()).toBe('session');
  });
});

describe('two-moto meeting flow: the gate pick keeps focus', () => {
  it('refocuses the chosen gate after the screen is drawn again', async () => {
    const h = await qualified();
    h.calls.length = 0;
    h.flow.action('meeting:gate:7');
    expect(h.calls).toEqual(['modal', 'focus [data-action="meeting:gate:7"]']);
    expect(h.html()).toContain('data-action="meeting:gate:7" aria-pressed="true"');
    // Not a gate: nothing changes and nothing is focused.
    h.calls.length = 0;
    h.flow.action('meeting:gate:x');
    expect(h.calls).toEqual([]);
  });
  it('starts moto 1 from the chosen gate', async () => {
    const h = await qualified();
    h.flow.action('meeting:gate:7');
    h.flow.action('meeting:moto');
    await Promise.resolve();
    expect(h.starts[1].options.gates![0]).toBe(7);
  });
});
