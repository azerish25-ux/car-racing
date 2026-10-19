import { describe, expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { AI_ENVELOPE, ENVELOPE_SAMPLES, envelopeProfile } from '../src/simulation/ai.ts';
import {
  BikeAIDriver,
  GP_APPROACH_SAMPLES,
  gpApproachSampleCount,
} from '../src/simulation/bike-ai.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import type { RaceDirector } from '../src/simulation/race.ts';
import { racingLineFor } from '../src/simulation/racing-line.ts';
import type { Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

class ApproachProbe extends BikeAIDriver {
  approachLimit(desired: number, track: Track, race: RaceDirector) {
    return this.limitSpeed(desired, track, race);
  }
}

describe('GP stopping-distance preview', () => {
  it('extends with speed and reduced deceleration while retaining a fixed work bound', () => {
    expect(gpApproachSampleCount(30, 10, 5245)).toBe(ENVELOPE_SAMPLES);
    const fast = gpApproachSampleCount(90, 10, 5245);
    const wet = gpApproachSampleCount(90, 5, 5245);
    expect(fast).toBeGreaterThan(ENVELOPE_SAMPLES);
    expect(wet).toBeGreaterThan(fast);
    expect(wet).toBeLessThanOrEqual(GP_APPROACH_SAMPLES);
    expect(gpApproachSampleCount(120, 0.01, 5245)).toBe(GP_APPROACH_SAMPLES);
    expect(gpApproachSampleCount(120, 0.01, 240)).toBe(ENVELOPE_SAMPLES);
    for (const speed of [NaN, Infinity, -Infinity, -1, 1e6]) {
      for (const deceleration of [NaN, Infinity, -Infinity, -1, 0, 1e6]) {
        const count = gpApproachSampleCount(speed, deceleration, 5245);
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(ENVELOPE_SAMPLES);
        expect(count).toBeLessThanOrEqual(GP_APPROACH_SAMPLES);
      }
    }
  });

  it('keeps the original envelope result and ignores unused buffer tails with an active count', () => {
    const curvature = [0, 0.002, 0.009, 0.018, 0.04];
    const corners = [100, 70, 44, 28, 18];
    const original = envelopeProfile(curvature, corners, 0.7, 1);
    expect(envelopeProfile(curvature, corners, 0.7, 1, AI_ENVELOPE, corners.length)).toBe(original);
    const longCurvature = new Float64Array(GP_APPROACH_SAMPLES).fill(NaN);
    const longCorners = new Float64Array(GP_APPROACH_SAMPLES).fill(NaN);
    longCurvature.set(curvature);
    longCorners.set(corners);
    expect(envelopeProfile(longCurvature, longCorners, 0.7, 1, AI_ENVELOPE, corners.length)).toBe(
      original,
    );
    // Reusing the same buffers for a shorter horizon cannot read old samples.
    expect(envelopeProfile(longCurvature, longCorners, 0.7, 1, AI_ENVELOPE, 3)).toBe(
      envelopeProfile(curvature.slice(0, 3), corners.slice(0, 3), 0.7, 1),
    );
  });

  const preview = (vehicle = 'gpr1') => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      circuit: 'poggio-alto',
      ruleset: 'gp-motorcycle',
      opponents: 0,
      vehicles: [vehicle],
    });
    const bike = sim.cars[0] as BikeVehicle;
    bike.place(sim.track, 150);
    bike.dynamics.speed = bike.speed = 90;
    bike.dynamics.grip = 1;
    bike.dynamics.frontGrip = bike.dynamics.rearGrip = 1;
    const driver = new ApproachProbe(bike, 0.96, 4417);
    return { sim, bike, driver };
  };

  it('keeps lower traffic or flag limits and reacts to the less capable rear contact', () => {
    const { sim, bike, driver } = preview();
    const dry = driver.approachLimit(100, sim.track, sim.race);
    expect(Number.isFinite(dry)).toBe(true);
    expect(dry).toBeGreaterThan(20);
    expect(driver.approachLimit(5, sim.track, sim.race)).toBe(5);
    bike.dynamics.grip = bike.dynamics.rearGrip = 0.35;
    const rearLow = driver.approachLimit(100, sim.track, sim.race);
    expect(rearLow).toBeLessThan(dry);
    bike.dynamics.grip = bike.dynamics.rearGrip = 0;
    const extreme = driver.approachLimit(100, sim.track, sim.race);
    expect(Number.isFinite(extreme)).toBe(true);
    expect(extreme).toBeGreaterThanOrEqual(0);
    expect(extreme).toBeLessThanOrEqual(rearLow);
  });

  it('leaves pit, off-track, reversed and other motorcycle plans with their own controllers', () => {
    const { sim, bike, driver } = preview();
    bike.inPit = true;
    expect(driver.approachLimit(73, sim.track, sim.race)).toBe(73);
    bike.inPit = false;
    bike.lateral = bike.trackPosition.width + 0.1;
    expect(driver.approachLimit(73, sim.track, sim.race)).toBe(73);
    bike.lateral = 0;
    bike.dynamics.heading += Math.PI;
    expect(driver.approachLimit(73, sim.track, sim.race)).toBe(73);
    for (const id of ['sbk1000', 'ss600', 'nr900', 'cr750']) {
      const other = preview(id);
      expect(other.driver.approachLimit(73, other.sim.track, other.sim.race)).toBe(73);
    }
  });

  it.each([
    ['gpr1', 'clear'],
    ['gpr2', 'clear'],
    ['gpr1', 'rain'],
    ['gpr2', 'rain'],
  ] as const)(
    '%s reaches the same hairpin entry under control in %s after a 324 km/h approach',
    (vehicle, weather) => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        circuit: 'poggio-alto',
        ruleset: 'gp-motorcycle',
        weather,
        compound: weather === 'rain' ? 'wet' : 'medium',
        opponents: 0,
        vehicles: [vehicle],
        seed: 4417,
      });
      sim.autoPlayer = true;
      sim.race.time = sim.race.greenAt + 1;
      const bike = sim.cars[0] as BikeVehicle;
      // Start on the actual final straight, after its preceding bends, and
      // use rain tyres in rain. A 324 km/h spawn in the previous chicane or
      // a forced pit entry would not measure this braking approach.
      const start = sim.track.length - 300;
      bike.place(sim.track, start, racingLineFor(sim.track).offsetAt(start));
      bike.dynamics.speed = bike.speed = 90;
      bike.gear = 6;
      bike.rpm = 15000;
      sim.ai[0] = new BikeAIDriver(bike, 0.96, 4417);
      let entrySpeed: number | undefined;
      let apexSpeed: number | undefined;
      for (let i = 0; i < 60 * 120; i++) {
        sim.step(1 / 120);
        const distance = mod(bike.s - start, sim.track.length);
        if (distance > 900 && entrySpeed === undefined) entrySpeed = bike.speed;
        if (distance > 950) {
          apexSpeed = bike.speed;
          break;
        }
      }
      expect(entrySpeed).toBeDefined();
      expect(apexSpeed).toBeDefined();
      expect(entrySpeed!).toBeLessThan(weather === 'rain' ? 25 : 33);
      expect(apexSpeed!).toBeLessThan(weather === 'rain' ? 20 : 24);
      expect(bike.dynamics.crashes).toBe(0);
      expect(bike.contacts[0].surface).toBeLessThanOrEqual(2);
      expect(bike.contacts[2].surface).toBeLessThanOrEqual(2);
    },
  );
});
