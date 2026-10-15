import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS, startingGrid } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { Effects } from '../src/rendering/effects.ts';
import { EffectPlayback } from '../src/rendering/effect-playback.ts';
import {
  REVIEW_START_SLOTS,
  RaceReviewEvents,
  raceReviewFrame,
  readRaceReviewFrame,
} from '../src/rendering/race-review.ts';

function disposeEffects(effects: Effects) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  effects.group.traverse((object) => {
    if (object instanceof T.Mesh || object instanceof T.Points) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

// The hosted review (e2e/29 '27H.6 wet-following') records this exact session:
// the menu's default circuit, seed and setup, five laps, eight cars, rain, full
// wets, the workload's paddock START slot and the AI driving the player. The
// browser worker reproduces it tick for tick, so its wet-following intervals
// are known here. Hosted software rendering has exceeded the recorder's one-
// second continuity gate near the launch, and run 38685156128 finished both
// views unqualified when the mid-field session followed a wet car for longer
// than 3.4 s only during the launch. The thresholds are unchanged: this only
// requires following that a recorder could observe after the launch.
describe('hosted wet-following session', () => {
  it('follows a wet car after the launch at a sub-second recorder cadence', () => {
    const cars = 8,
      slot = REVIEW_START_SLOTS['wet-following'];
    expect(slot).toBeDefined();
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'race',
      laps: 5,
      opponents: cars - 1,
      weather: 'rain',
      compound: 'wet',
      grid: startingGrid(cars, slot!),
    });
    sim.autoPlayer = true;
    // Presented every 0.9 s (inside the 1 s gate) at four phases, starting
    // 15 s after the green: following that ends with the launch never counts.
    const period = 108,
      from = Math.ceil((sim.race.greenAt + 15) * 120),
      frame = sim.makeFrame(),
      recorders = [0, 27, 54, 81].map((phase) => {
        const effects = new Effects();
        return {
          phase,
          effects,
          playback: new EffectPlayback(effects),
          events: new RaceReviewEvents(),
          noSpray: new RaceReviewEvents(),
          sample: raceReviewFrame(),
          leaderSpray: 0,
        };
      });
    try {
      for (
        let tick = 1;
        tick <= 150 * 120 && !recorders.every((r) => r.events.qualified('wet-following'));
        tick++
      ) {
        sim.step(1 / 120);
        let written = false;
        for (const r of recorders) {
          const offset = tick - from - r.phase;
          if (offset < 0 || offset % period) continue;
          if (!written) sim.writeFrame(frame);
          written = true;
          r.playback.update(frame, true, true);
          readRaceReviewFrame(frame, 0, 0, 0, r.sample);
          r.sample.sprayParticles = r.effects.activeSprayCountFor(r.sample.leader);
          r.leaderSpray = Math.max(r.leaderSpray, r.sample.sprayParticles);
          r.events.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], r.sample);
          r.noSpray.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], {
            ...r.sample,
            sprayParticles: 0,
          });
        }
      }
      expect(sim.cars.every((car) => car.body.position.finite() && !car.retired)).toBe(true);
      for (const r of recorders) {
        expect(
          r.events.qualified('wet-following'),
          `phase ${r.phase}: longest post-launch following ${r.events.wetFollowingSeconds.toFixed(2)} s`,
        ).toBe(true);
        expect(r.events.wetFollowingSeconds).toBeGreaterThanOrEqual(3);
        expect(r.leaderSpray).toBeGreaterThan(0);
        expect(r.noSpray.qualified('wet-following')).toBe(false);
      }
    } finally {
      for (const r of recorders) disposeEffects(r.effects);
    }
  }, 120000);
});

// Production simulation and particle observations only; no GPU pixels or human
// handling claim. Render sampling never changes the 120 Hz physics/controller.
describe('wet review prepared before the physical grid release', () => {
  it.each([
    { name: '2 Hz', intervals: [60] },
    { name: '1.5 Hz', intervals: [80] },
    { name: 'irregular subsecond sampling', intervals: [40, 75, 110, 85, 55] },
  ])(
    'qualifies real following with $name without relaxing its three-second gate',
    ({ intervals }) => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'race',
        laps: 5,
        opponents: 7,
        weather: 'rain',
        compound: 'wet',
        // Start third, in line directly behind a real wet car of equal pace
        // (car 4 shares car 0's skill). From pole the calibrated field no longer
        // passes the player within the minute, so following must come from the
        // grid rather than an overtake.
        grid: [4, 2, 0, 3, 1, 5, 6, 7],
      });
      sim.autoPlayer = true;
      const frame = sim.makeFrame(),
        events = new RaceReviewEvents(),
        noSpray = new RaceReviewEvents(),
        sample = raceReviewFrame(),
        effects = new Effects(),
        playback = new EffectPlayback(effects);
      try {
        const prepared = frame.slice();
        // Repeated held frames cannot manufacture grid movement or following.
        for (let held = 0; held < 20; held++) {
          playback.update(frame, true, true);
          readRaceReviewFrame(frame, 0, effects.activeSprayCountFor(0), 0, sample);
          events.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], sample);
        }
        expect(frame[H.TIME]).toBe(0);
        expect(frame[H.TICK]).toBe(0);
        expect(events.qualified('wet-following')).toBe(false);
        expect(frame).toEqual(prepared);
        let nextSample = 0,
          index = 0,
          maximumLeaderSpray = 0;
        for (let tick = 0; tick < 60 * 120; tick++) {
          sim.step(1 / 120);
          if (tick < nextSample) continue;
          nextSample += intervals[index++ % intervals.length];
          sim.writeFrame(frame);
          const before = frame.slice();
          playback.update(frame, true, true);
          readRaceReviewFrame(frame, 0, 0, 0, sample);
          sample.sprayParticles = effects.activeSprayCountFor(sample.leader);
          maximumLeaderSpray = Math.max(maximumLeaderSpray, sample.sprayParticles);
          events.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], sample);
          // The same real wet field cannot qualify when its leader's emitted spray
          // is absent. Do not confuse a wet-weather label with observed following.
          noSpray.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], {
            ...sample,
            sprayParticles: 0,
          });
          expect(frame).toEqual(before);
          if (events.qualified('wet-following')) break;
        }
        expect(sim.cars).toHaveLength(8);
        expect(sim.cars.every((car) => car.body.position.finite() && !car.retired)).toBe(true);
        expect(maximumLeaderSpray).toBeGreaterThan(0);
        expect(events.summary('wet-following')).toMatchObject({
          qualified: true,
          gridLaunched: true,
          visualAccepted: false,
        });
        expect(events.wetFollowingSeconds).toBeGreaterThanOrEqual(3);
        expect(sim.race.time).toBeLessThan(60);
        expect(noSpray.qualified('wet-following')).toBe(false);
      } finally {
        disposeEffects(effects);
      }
    },
    30000,
  );
});
