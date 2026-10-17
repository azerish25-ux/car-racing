import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { FLAG, MARSHAL } from '../src/simulation/marshal.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { SAFETY_CAR, SC_PHASE } from '../src/simulation/safety-car.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;
const OBSTRUCTION_SECONDS = SAFETY_CAR.scAfter + MARSHAL.stationaryDelay + 2;

/** Exercise the production race/marshal controllers and snapshot writer with
 * real venue/vehicle definitions. Motion is held here so recovery cannot clear
 * the obstruction; this is a rule-eligibility test, not a dynamics race run. */
function field(options: Partial<SessionOptions>, machine: string) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: 2,
    vehicles: [machine, machine, machine],
    ...options,
  });
  while (sim.race.time < sim.race.greenAt + MARSHAL.startGrace + 0.25)
    sim.race.step(DT);
  expect(sim.race.phase).toBe(PHASE.RACING);
  expect(sim.race.safetyCar.phase).toBe(SC_PHASE.NONE);
  const station = sim.track.length * 0.35;
  sim.cars[0].place(sim.track, station - 100);
  sim.cars[1].place(sim.track, station);
  sim.cars[2].place(sim.track, station + sim.track.length * 0.5);
  for (const car of sim.cars) car.speed = 15;
  return sim;
}

function holdObstruction(sim: Simulation) {
  sim.cars[1].speed = 0;
  const phases = new Set<number>();
  let doubleYellowSeconds = 0;
  for (let tick = 0; tick < OBSTRUCTION_SECONDS / DT; tick++) {
    sim.race.step(DT);
    phases.add(sim.race.safetyCar.phase);
    if (sim.race.control.flags[0] === FLAG.DOUBLE_YELLOW) doubleYellowSeconds += DT;
  }
  return { phases, doubleYellowSeconds, frame: sim.makeFrame() };
}

describe('motocross race-control eligibility', () => {
  for (const [circuit, machine] of [
    ['valley-ridge-mx', 'mx250'],
    ['arena-nord-sx', 'mx450'],
  ] as const)
    it(`${circuit}: sustained hazards retain local flags without a VSC or pace car`, () => {
      const sim = field({ circuit, ruleset: 'motocross-moto' }, machine);
      // A contact still produces the existing local single-yellow warning.
      sim.cars[1].impact = 0.6;
      sim.race.step(DT);
      expect(sim.race.control.flags[0]).toBe(FLAG.YELLOW);
      expect(sim.race.control.flags[2]).toBe(FLAG.GREEN);
      expect(sim.race.control.targetSpeed(0, 5)).toBe(MARSHAL.yellowSpeed);
      sim.cars[1].impact = 0;

      const result = holdObstruction(sim);
      expect(result.doubleYellowSeconds).toBeGreaterThan(SAFETY_CAR.scAfter);
      expect(result.phases).toEqual(new Set([SC_PHASE.NONE]));
      expect(sim.race.safetyCar.deployments).toBe(0);
      expect(sim.race.control.neutralised).toBe(0);
      expect(sim.race.control.hasObstruction).toBe(true);
      expect(result.frame[H.SC_PHASE]).toBe(SC_PHASE.NONE);
      expect(result.frame[H.SC_SPEED]).toBe(0);
      expect(result.frame[H.FLAG]).toBe(FLAG.DOUBLE_YELLOW);
      expect(result.frame[carBase(0) + F.LOCAL_FLAG]).toBe(FLAG.DOUBLE_YELLOW);
      expect(result.frame[carBase(0) + F.CAUTION_SPEED]).toBe(MARSHAL.doubleYellowSpeed);
      expect(result.frame[carBase(2) + F.LOCAL_FLAG]).toBe(FLAG.GREEN);

      // Clearing the real hazard also clears its warning through the existing
      // marshal delay, without inventing a global restart phase.
      sim.cars[1].speed = 15;
      for (let tick = 0; tick < (MARSHAL.clearDelay + 0.1) / DT; tick++) sim.race.step(DT);
      expect(sim.race.control.hasIncident).toBe(false);
      expect(sim.race.control.flags[0]).toBe(FLAG.GREEN);
      expect(sim.race.safetyCar.phase).toBe(SC_PHASE.NONE);
    });

  for (const [circuit, ruleset, machine] of [
    ['aurel', 'formula-grand-prix', 'apx01'],
    ['aurel', 'gp-motorcycle', 'gpr1'],
    ['valley-ridge-mx', 'supermoto-moto', 'sm450'],
  ] as const)
    it(`${ruleset}: an omitted eligibility setting preserves VSC and safety-car deployment`, () => {
      const sim = field({ circuit, ruleset }, machine);
      expect(sim.race.ruleset.safetyCar).toBeUndefined();
      const result = holdObstruction(sim);
      expect(result.doubleYellowSeconds).toBeGreaterThan(SAFETY_CAR.scAfter);
      expect(result.phases.has(SC_PHASE.VSC)).toBe(true);
      expect(result.phases.has(SC_PHASE.DEPLOYED)).toBe(true);
      expect(sim.race.safetyCar.deployments).toBe(1);
      expect(sim.race.control.neutralised).toBe(SC_PHASE.DEPLOYED);
      expect(result.frame[H.SC_PHASE]).toBe(SC_PHASE.DEPLOYED);
      expect(result.frame[H.SC_SPEED]).toBeGreaterThan(0);
    });

  it('practice still excludes global neutralisation while reporting an obstruction', () => {
    const sim = field(
      { mode: 'practice', ruleset: 'open-practice', circuit: 'valley-ridge-mx' },
      'mx250',
    );
    const result = holdObstruction(sim);
    expect(result.doubleYellowSeconds).toBeGreaterThan(SAFETY_CAR.scAfter);
    expect(result.phases).toEqual(new Set([SC_PHASE.NONE]));
    expect(sim.race.control.hasObstruction).toBe(true);
    expect(result.frame[H.FLAG]).toBe(FLAG.DOUBLE_YELLOW);
  });
});
