import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS,
  DEFAULT_SETUP,
  VEHICLE,
  validateOptions,
} from '../src/simulation/config.ts';
import { envelopeBrakingSpeed, envelopeCornerSpeed } from '../src/simulation/ai.ts';
import { R, RACE_BASE, carBase, F } from '../src/simulation/protocol.ts';
import { FORMULA_APX01, TOURING_TC1, VEHICLE_IDS, vehicleAt } from '../src/simulation/vehicles.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { Simulation } from '../src/simulation/world.ts';

describe('WP08 per-entry vehicle definitions', () => {
  it('keeps the global VEHICLE as the Formula definition', () => {
    expect(VEHICLE).toBe(FORMULA_APX01.spec);
    expect(new Vehicle(0).definition).toBe(FORMULA_APX01);
  });
  it('validates per-entry vehicle ids and ignores malformed lists', () => {
    expect(
      validateOptions({ ...DEFAULT_OPTIONS, opponents: 1, vehicles: ['tc1', 'apx01'] }).vehicles,
    ).toEqual(['tc1', 'apx01']);
    expect(
      validateOptions({ ...DEFAULT_OPTIONS, opponents: 1, vehicles: ['tc1'] }).vehicles,
    ).toBeUndefined();
    expect(
      validateOptions({ ...DEFAULT_OPTIONS, opponents: 1, vehicles: ['tc1', 'nope'] }).vehicles,
    ).toBeUndefined();
  });
  it('gives a touring car no wing setup, hybrid or DRS', () => {
    const car = new Vehicle(
      0,
      'medium',
      { ...DEFAULT_SETUP, rearWing: 1, brakeBias: 0.6 },
      'sport',
      TOURING_TC1,
    );
    expect(car.setup.rearWing).toBe(DEFAULT_SETUP.rearWing);
    expect(car.setup.brakeBias).toBe(0.6);
    expect(car.battery).toBe(0);
    expect(car.body.inertia.y).toBe(TOURING_TC1.spec.inertia[1]);
    expect(car.tires[0].nominalRadius).toBe(TOURING_TC1.spec.wheelRadius);
  });
  it('handles a class without downforce in the AI braking envelope', () => {
    const env = TOURING_TC1.ai;
    const v = envelopeBrakingSpeed(20, 100, 1, 0, env.brakingMargin, env);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeCloseTo(Math.sqrt(400 + 2 * env.brakingBase * env.brakingMargin * 100), 9);
    expect(envelopeCornerSpeed(0.01, 1, 0, env)).toBeLessThan(envelopeCornerSpeed(0.01, 1, 1));
  });
  it('races a mixed field whose identities survive into snapshots', () => {
    const vehicles = ['tc1', 'apx01', 'tc1', 'apx01'];
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 3, vehicles });
    sim.autoPlayer = true;
    const start = sim.cars.map((c) => c.s);
    let peakTouring = 0,
      peakFormula = 0;
    for (let i = 0; i < 120 * 70; i++) {
      sim.step(1 / 120);
      for (const c of sim.cars)
        if (c.definition === TOURING_TC1) peakTouring = Math.max(peakTouring, c.speed);
        else peakFormula = Math.max(peakFormula, c.speed);
    }
    const frame = sim.makeFrame();
    sim.writeFrame(frame);
    for (let id = 0; id < 4; id++) {
      expect(vehicleAt(frame[carBase(id) + RACE_BASE + R.VEHICLE]).id).toBe(vehicles[id]);
      expect(frame[carBase(id) + F.MASS]).toBeGreaterThan(sim.cars[id].spec.dryMass - 1);
      expect(sim.cars[id].retired).toBe(false);
      // Every car made real progress around the lap under AI control.
      const travelled = (sim.cars[id].s - start[id] + sim.track.length) % sim.track.length;
      expect(travelled + sim.race.laps[id].completed * sim.track.length).toBeGreaterThan(1500);
    }
    expect(VEHICLE_IDS.indexOf('tc1')).toBeGreaterThan(0);
    expect(peakTouring).toBeLessThan(peakFormula);
    expect(peakTouring).toBeLessThan(TOURING_TC1.ai.topSpeed + 1);
  }, 120000);
});
