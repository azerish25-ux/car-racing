import { describe, expect, it } from 'vitest';
import { PracticeProgramme } from '../src/simulation/practice-programme.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import { LapTracker } from '../src/simulation/race.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { CHANNELS } from '../src/storage/telemetry-schema.ts';
import { drivingAcademy, programmeHud } from '../src/ui/driving-academy.ts';
const o = carBase(0);
function session() {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  const frame = sim.makeFrame(),
    programme = new PracticeProgramme();
  programme.start();
  programme.observe(frame);
  const lap = (seconds: number, valid = 1, assisted = 0) => {
    frame[H.TICK] += 30;
    frame[H.TIME] += seconds;
    frame[o + F.LAPS]++;
    frame[o + F.LAST_LAP] = seconds;
    frame[o + F.LAST_LAP_VALID] = valid;
    frame[o + F.LAST_LAP_ASSISTED] = assisted;
    programme.observe(frame);
  };
  return { sim, frame, programme, lap };
}
describe('five measured attempts, never manufactured progress', () => {
  it('locks a clean banker and uses inclusive gold/silver/bronze thresholds for exactly five attempts', () => {
    const { programme, lap } = session();
    for (const seconds of [100, 100, 102, 105, 106]) lap(seconds);
    expect(programme.progress().attempts.map((item) => item.grade)).toEqual([
      'banker',
      'gold',
      'silver',
      'bronze',
      'miss',
    ]);
    expect(programme.progress()).toMatchObject({ target: 100, clean: 5, finished: true });
    lap(80);
    expect(programme.progress().attempts).toHaveLength(5);
  });
  it('cannot turn an invalid or assisted lap into a banker or clean award', () => {
    const { programme, lap } = session();
    lap(50, 0);
    lap(40, 1, 1);
    lap(100);
    lap(30, 0);
    lap(20, 1, 1);
    expect(programme.progress().attempts.map((item) => item.grade)).toEqual([
      'invalid',
      'assisted',
      'banker',
      'invalid',
      'assisted',
    ]);
    expect(programme.progress()).toMatchObject({ target: 100, clean: 1 });
  });
  it('uses completed-lap evidence, not the new lap validity reset or current-lap penalty', () => {
    const { frame, programme, lap } = session();
    frame[o + F.LAP_VALID] = 0;
    frame[o + F.PENALTY] = 10; // current out-lap
    frame[H.TICK]++;
    programme.observe(frame);
    frame[o + F.LAP_VALID] = 1;
    lap(100, 0); // invalid completed lap, new lap is already valid
    expect(programme.progress().attempts[0].grade).toBe('invalid');
    frame[o + F.LAP_VALID] = 0;
    lap(105, 1); // completed lap clean, next lap now invalid
    expect(programme.progress().attempts[1].grade).toBe('banker');
  });
  it('does not award repeated snapshots, rewind, malformed timing, or a missed crossing', () => {
    const { frame, programme, lap } = session();
    lap(100);
    for (let i = 0; i < 100; i++) programme.observe(frame);
    expect(programme.progress().attempts).toHaveLength(1);
    const oldTick = frame[H.TICK];
    frame[H.TICK] = 0;
    frame[o + F.LAPS] = 0;
    programme.observe(frame);
    expect(programme.progress().attempts).toHaveLength(1);
    frame[H.TICK] = oldTick + 30;
    frame[o + F.LAPS] = 3;
    programme.observe(frame);
    expect(programme.progress().attempts[1].reason).toContain('Snapshot gap');
    frame[H.TICK]++;
    frame[o + F.LAPS] = 4;
    frame[o + F.LAST_LAP] = NaN;
    programme.observe(frame);
    expect(programme.progress().attempts).toHaveLength(2);
  });
  it('does not consume grid/finished frames and stops cleanly for session replacement', () => {
    const { frame, programme, lap } = session();
    frame[H.PHASE] = 0;
    lap(10);
    expect(programme.progress().attempts).toHaveLength(0);
    frame[H.PHASE] = 3;
    lap(10);
    expect(programme.progress().attempts).toHaveLength(0);
    programme.stop();
    frame[H.PHASE] = 2;
    lap(10);
    expect(programme.progress().attempts).toHaveLength(0);
    programme.start();
    programme.observe(frame);
    lap(100);
    expect(programme.progress().target).toBe(100);
  });
  it('returns an immutable progress copy and labels replay without creating awards', () => {
    const { programme, lap } = session();
    lap(100);
    const copy = programme.progress();
    copy.attempts[0].seconds = 1;
    expect(programme.progress().attempts[0].seconds).toBe(100);
    expect(programmeHud(programme.progress(), true)).toContain('AWARDS PAUSED');
    expect(programmeHud(programme.progress(), false)).toContain('1/5');
    const html = drivingAcademy(programme.progress(), 'full', true);
    expect(html.match(/data-grade=/g)).toHaveLength(5);
    expect(html).toContain('do not earn medals');
    expect(html).not.toContain('REFERENCE REVIEW');
    expect(html).toContain('data-action="academy:start"');
  });
});
describe('authoritative physics-worker participation and validity metadata', () => {
  it('marks actual auto and pit assistance, not just a UI toggle, including AI opponents', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 1 });
    sim.step(1 / 120);
    expect(sim.race.laps[0].assisted).toBe(false);
    expect(sim.race.laps[1].assisted).toBe(true);
    sim.autoPlayer = true;
    sim.step(1 / 120);
    sim.autoPlayer = false;
    expect(sim.race.laps[0].assisted).toBe(true);
    sim.race.laps[0].assisted = false;
    sim.requestPit();
    sim.step(1 / 120);
    expect(sim.race.laps[0].assisted).toBe(true);
  });
  it('preserves a completed assisted lap and penalty delta while clearing the next lap metadata', () => {
    const tracker = new LapTracker(256, 250);
    tracker.penalty = 5;
    tracker.update(2, 1, false); // out-lap penalty must not contaminate the next measured lap
    let time = 1;
    for (let s = 4; s <= 254; s += 2) {
      if (s === 30) {
        tracker.assisted = true;
        tracker.penalty += 10;
      }
      tracker.update(s, (time += 0.5), false);
    }
    tracker.update(2, (time += 1), false);
    expect(tracker.completed).toBe(1);
    expect(tracker.lastAssisted).toBe(true);
    expect(tracker.assisted).toBe(false);
    expect(tracker.lastPenalty).toBe(10);
    for (let s = 4; s <= 254; s += 2) tracker.update(s, (time += 0.5), false);
    tracker.update(2, time + 1, false);
    expect(tracker.lastAssisted).toBe(false);
    expect(tracker.lastPenalty).toBe(0);
  });
  it('serializes valid/assisted evidence, excludes penalized laps, and keeps replay metadata discrete', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
    sim.race.laps[0].lastValid = true;
    sim.race.laps[0].lastPenalty = 0;
    const a = sim.makeFrame();
    expect(a[o + F.LAST_LAP_VALID]).toBe(1);
    sim.race.time += 1;
    sim.race.laps[0].lastAssisted = true;
    sim.race.laps[0].lastPenalty = 5;
    const b = sim.makeFrame();
    expect(b[o + F.LAST_LAP_VALID]).toBe(0);
    expect(b[o + F.LAST_LAP_ASSISTED]).toBe(1);
    const presented = new PresentedFrame();
    expect(presented.sample(a, b, 0.5)[o + F.LAST_LAP_ASSISTED]).toBe(0);
    expect(presented.sample(a, b, 1)[o + F.LAST_LAP_ASSISTED]).toBe(1);
    const replay = new ReplayRecorder(1, 2);
    replay.append(a);
    replay.append(b);
    const ra = replay.makeFrame(),
      rb = replay.makeFrame();
    replay.sample(replay.duration / 2, ra, rb);
    expect(ra[o + F.LAST_LAP_VALID]).toBe(1);
    expect(rb[o + F.LAST_LAP_ASSISTED]).toBe(1);
  });
});

it('keeps completed-lap evidence out of the existing 228-column CSV contract', () => {
  expect(CHANNELS).toHaveLength(228);
  expect(CHANNELS).not.toContain('last_lap_valid');
  expect(CHANNELS).not.toContain('last_lap_assisted');
});
