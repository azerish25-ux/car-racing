import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { EVENTS, eventSession } from '../src/simulation/events.ts';
import { Simulation } from '../src/simulation/world.ts';

describe('Service eligibility follows the loaded session rules', () => {
  for (const id of [
    'valley-ridge-mx-moto-2',
    'arena-nord-supercross',
    'valley-ridge-supermoto',
    'kestrel-rallycross-heat',
    'pinewood-special-stage',
  ])
    it(`${id}: weather and tyre wear cannot send an entrant to an unavailable service bay`, () => {
      const event = EVENTS.find((candidate) => candidate.id === id);
      expect(event, `Missing production event ${id}`).toBeDefined();
      const sim = new Simulation(eventSession(event!, DEFAULT_OPTIONS)),
        car = sim.cars[0];
      expect(sim.race.ruleset.service.pitStops).toBe(false);
      car.place(sim.track, sim.track.length * 0.45);
      sim.track.water.fill(0.8);
      for (const tire of car.tires) tire.wear = 0.8;
      const before = car.tires.map((tire) => ({ ...tire }));
      sim.ai[0].brain.update(0.5, car, sim.cars, sim.track, sim.race);
      expect(car.pitRequested).toBe(false);
      sim.requestPit('wet');
      expect(car.pitRequested).toBe(false);
      expect(car.tires).toEqual(before);
      expect(car.inPit).toBe(false);
      expect(car.pitStops).toBe(0);
    });

  for (const vehicle of ['apx01', 'gpr1', 'sm450'])
    it(`${vehicle}: permitted practice retains the actual weather stop request`, () => {
      const sim = new Simulation({
          ...DEFAULT_OPTIONS,
          mode: 'practice',
          ruleset: 'open-practice',
          opponents: 0,
          vehicles: [vehicle],
        }),
        car = sim.cars[0];
      car.place(sim.track, sim.track.length * 0.45);
      sim.track.water.fill(0.8);
      expect(sim.race.ruleset.service.pitStops).toBe(true);
      sim.ai[0].brain.update(0.5, car, sim.cars, sim.track, sim.race);
      expect(car.pitRequested).toBe(true);
      expect(car.nextCompound).toBe('intermediate');
      sim.requestPit('wet');
      expect(car.pitRequested).toBe(false);
      sim.requestPit('wet');
      expect(car.pitRequested).toBe(true);
      expect(car.nextCompound).toBe('wet');
    });
});
