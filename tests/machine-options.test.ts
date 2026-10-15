import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import { sessionIncompatibilities } from '../src/simulation/events.ts';
import { machineOptions } from '../src/ui/interface.ts';

describe('WP22 machine choice resolves to a valid or explained session', () => {
  const resolve = (
    mode: typeof DEFAULT_OPTIONS.mode,
    machine: string,
    compound = DEFAULT_OPTIONS.compound,
  ) => {
    const base = { ...DEFAULT_OPTIONS, mode, compound };
    return validateOptions({ ...base, ...machineOptions(base, machine) });
  };
  it('touring and mixed races load under their own rulesets', () => {
    expect(sessionIncompatibilities(resolve('race', 'tc1', 'soft'))).toEqual([]);
    expect(resolve('race', 'tc1', 'soft').compound).toBe('medium');
    expect(resolve('race', 'mixed').ruleset).toBe('open-exhibition');
    expect(sessionIncompatibilities(resolve('practice', 'tc1'))).toEqual([]);
    expect(sessionIncompatibilities(resolve('race', 'apx01'))).toEqual([]);
  });
  it('an unsupported combination is explained, not silently changed', () => {
    expect(sessionIncompatibilities(resolve('endurance', 'tc1')).join()).toMatch(/not eligible/);
  });
  it('motorcycle grids load under the bike rules and never mix with cars (WP36)', () => {
    for (const machine of ['gpr1', 'sbk1000', 'bikes']) {
      const race = resolve('race', machine);
      expect(race.ruleset).toBe('gp-motorcycle');
      expect(sessionIncompatibilities(race)).toEqual([]);
      for (const mode of ['practice', 'qualifying', 'time-trial'] as const)
        expect(sessionIncompatibilities(resolve(mode, machine))).toEqual([]);
    }
    expect(resolve('race', 'bikes').vehicles?.slice(0, 2)).toEqual(['gpr1', 'sbk1000']);
    expect(resolve('race', 'gpr1', 'intermediate').compound).toBe('wet');
    expect(sessionIncompatibilities(resolve('endurance', 'gpr1')).join()).toMatch(/not eligible/);
  });
  it('races each further bike class under its own ruleset; the road bike only practises', () => {
    expect(resolve('race', 'gpr2').ruleset).toBe('gp-motorcycle');
    for (const machine of ['ss600', 'cr750']) {
      const race = resolve('race', machine);
      expect(race.ruleset).toBe('motorcycle-class-sprint');
      expect(sessionIncompatibilities(race)).toEqual([]);
    }
    expect(sessionIncompatibilities(resolve('race', 'nr900')).join()).toMatch(/not eligible/);
    expect(sessionIncompatibilities(resolve('practice', 'nr900'))).toEqual([]);
    expect(sessionIncompatibilities(resolve('time-trial', 'nr900'))).toEqual([]);
    // A supersport and a classic racer never share a single-class grid.
    const mixed = validateOptions({
      ...DEFAULT_OPTIONS,
      opponents: 1,
      ruleset: 'motorcycle-class-sprint',
      vehicles: ['ss600', 'cr750'],
    });
    expect(sessionIncompatibilities(mixed).join()).toMatch(/single-class/);
  });
});
