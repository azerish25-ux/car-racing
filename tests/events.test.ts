import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import {
  DEFAULT_RULESET,
  EVENTS,
  eventSession,
  rulesetFor,
  sessionIncompatibilities,
} from '../src/simulation/events.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

describe('WP09 event and ruleset definitions', () => {
  it('routes all five legacy modes through validated rulesets', () => {
    for (const mode of ['race', 'practice', 'time-trial', 'qualifying', 'endurance'] as const) {
      const options = validateOptions({ ...DEFAULT_OPTIONS, mode });
      expect(rulesetFor(options).id).toBe(DEFAULT_RULESET[mode]);
      expect(sessionIncompatibilities(options)).toEqual([]);
    }
    expect(rulesetFor({ mode: 'endurance' }).tires.mandatoryCompoundChange).toBe(true);
    expect(rulesetFor({ mode: 'race' }).tires.mandatoryCompoundChange).toBe(false);
  });
  it('rejects incompatible combinations before loading, with reasons', () => {
    const touringInFormula = validateOptions({
      ...DEFAULT_OPTIONS,
      opponents: 1,
      vehicles: ['tc1', 'apx01'],
    });
    expect(sessionIncompatibilities(touringInFormula).join()).toMatch(/not eligible/);
    const timedWithoutClock = validateOptions({
      ...DEFAULT_OPTIONS,
      mode: 'endurance',
      ruleset: 'timed-endurance',
    });
    expect(sessionIncompatibilities(timedWithoutClock).join()).toMatch(/duration/);
    const softTouring = validateOptions({
      ...DEFAULT_OPTIONS,
      opponents: 0,
      ruleset: 'touring-sprint',
      vehicles: ['tc1'],
      compound: 'soft',
    });
    expect(sessionIncompatibilities(softTouring).join()).toMatch(/soft tyres/);
    const wrongMode = validateOptions({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      ruleset: 'touring-sprint',
    });
    expect(sessionIncompatibilities(wrongMode).join()).toMatch(/does not run practice/);
  });
  it('resolves every built-in event into a loadable session', () => {
    for (const event of EVENTS) {
      const options = eventSession(event, DEFAULT_OPTIONS);
      expect(options.vehicles).toHaveLength(event.opponents + 1);
      expect(validateOptions(options)).toMatchObject({ ruleset: event.ruleset });
    }
    expect(() => eventSession({ ...EVENTS[0], vehicles: 'apx01' }, DEFAULT_OPTIONS)).toThrow(
      /eligible/,
    );
  });
  it('a touring sprint has no DRS and no mandatory stop', () => {
    const sim = new Simulation(eventSession({ ...EVENTS[0], opponents: 1 }, DEFAULT_OPTIONS));
    expect(sim.race.ruleset.drs).toBe(false);
    expect(sim.cars.every((c) => c.definition.id === 'tc1')).toBe(true);
  });
  it('classifies a timed race on the leader’s first crossing after the clock', () => {
    const sim = new Simulation(
      validateOptions({
        ...DEFAULT_OPTIONS,
        mode: 'endurance',
        ruleset: 'timed-endurance',
        durationSeconds: 120,
        laps: 30,
        opponents: 1,
      }),
    );
    sim.autoPlayer = true;
    for (let i = 0; i < 120 * 600 && sim.race.phase !== PHASE.FINISHED; i++) sim.step(1 / 120);
    expect(sim.race.phase).toBe(PHASE.FINISHED);
    const leader = sim.race.order[0];
    const winner = sim.cars[leader];
    // Finished after the clock, well short of the 30-lap distance.
    expect(winner.finishTime).toBeGreaterThan(sim.race.greenAt + 120);
    expect(sim.race.laps[leader].completed).toBeLessThan(30);
    expect(sim.race.laps[leader].completed).toBeGreaterThanOrEqual(1);
  }, 120000);
});
