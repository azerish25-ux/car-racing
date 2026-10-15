import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import {
  classPositions,
  EVENTS,
  eventSession,
  RULESETS,
  sessionIncompatibilities,
} from '../src/simulation/events.ts';
import { VEHICLES, VEHICLE_IDS } from '../src/simulation/vehicles.ts';
import { classInfo } from '../src/simulation/vehicle-classes.ts';
import { eventCard } from '../src/ui/event-cards.ts';
import {
  machineChoices,
  machineOptions,
  machineSelectOptions,
  MULTICLASS_FIELD,
} from '../src/ui/machine-options.ts';
import { sessionIdentity } from '../src/core/session-identity.ts';

const resolve = (
  mode: typeof DEFAULT_OPTIONS.mode,
  machine: string,
  compound = DEFAULT_OPTIONS.compound,
) => {
  const base = { ...DEFAULT_OPTIONS, mode, compound };
  return validateOptions({ ...base, ...machineOptions(base, machine) });
};
describe('WP22/WP30 data-driven machine choice', () => {
  it('lists every four-wheel machine once, grouped by class in order', () => {
    const groups = machineChoices();
    const values = groups.flatMap((g) => g.options.map((o) => o.value));
    for (const id of VEHICLE_IDS)
      expect(
        values.filter((v) => v === id),
        id,
      ).toHaveLength(1);
    expect(values).toContain('mixed');
    expect(values).toContain('multiclass');
    expect(groups[0].label).toBe(classInfo('formula').name);
    expect(groups.at(-1)!.label).toBe('Mixed classes');
    const html = machineSelectOptions();
    expect(html.match(/<optgroup /g)).toHaveLength(groups.length);
    expect(html).toContain('<option value="apx01" selected>');
    expect(html).toContain('GT-10M Mid-Engine GT · RWD');
  });
  it('fills a single-class grid under the class ruleset, with its tyres', () => {
    for (const id of VEHICLE_IDS) {
      const def = VEHICLES[id];
      const race = resolve('race', id, 'soft');
      const info = classInfo(def.classId);
      if (!info.raceRuleset) {
        // Road cars have no circuit race: explained, not silently changed.
        expect(sessionIncompatibilities(race).join(), id).toMatch(/not eligible/);
        continue;
      }
      expect(sessionIncompatibilities(race), id).toEqual([]);
      if (id !== 'apx01') expect(race.vehicles!.every((v) => v === id)).toBe(true);
      expect(RULESETS[race.ruleset ?? 'formula-grand-prix'].tires.allowed).toContain(race.compound);
      expect(sessionIncompatibilities(resolve('practice', id)), id).toEqual([]);
      expect(sessionIncompatibilities(resolve('time-trial', id)), id).toEqual([]);
    }
    expect(resolve('race', 'gt8f').ruleset).toBe('gt-sprint');
    expect(resolve('race', 'sk125').ruleset).toBe('kart-sprint');
  });
  it('runs prototypes and GTs in timed multi-class endurance, explains the rest', () => {
    const hyper = resolve('endurance', 'hy9');
    expect(hyper.ruleset).toBe('multi-class-endurance');
    expect(hyper.durationSeconds).toBeGreaterThanOrEqual(120);
    expect(sessionIncompatibilities(hyper)).toEqual([]);
    const field = resolve('race', 'multiclass');
    expect(new Set(field.vehicles!.map((v) => VEHICLES[v].classId)).size).toBeGreaterThan(2);
    expect(field.vehicles!.slice(0, MULTICLASS_FIELD.length)).toEqual([...MULTICLASS_FIELD]);
    expect(sessionIncompatibilities(field)).toEqual([]);
    expect(sessionIncompatibilities(resolve('endurance', 'sk125')).join()).toMatch(/not eligible/);
  });
});
describe('WP30 class rulesets and catalogue events', () => {
  it('rejects mixed classes on a single-class grid but allows them in multi-class', () => {
    const mixed = validateOptions({
      ...DEFAULT_OPTIONS,
      opponents: 1,
      ruleset: 'gt-sprint',
      vehicles: ['gt8f', 'gs4'],
    });
    expect(sessionIncompatibilities(mixed).join()).toMatch(/single-class/);
    const endurance = validateOptions({
      ...DEFAULT_OPTIONS,
      mode: 'endurance',
      opponents: 2,
      ruleset: 'multi-class-endurance',
      durationSeconds: 600,
      vehicles: ['hy9', 'pr2', 'gt8f'],
    });
    expect(sessionIncompatibilities(endurance)).toEqual([]);
  });
  it('resolves every catalogue event and states per-class scoring', () => {
    const catalogueEvents = EVENTS.filter((e) => e.version === 1 && RULESETS[e.ruleset]);
    expect(catalogueEvents.length).toBeGreaterThanOrEqual(8);
    for (const event of EVENTS) {
      const options = eventSession(event, DEFAULT_OPTIONS);
      expect(validateOptions(options).vehicles).toHaveLength(event.opponents + 1);
    }
    const multi = EVENTS.find((e) => e.ruleset === 'multi-class-endurance')!;
    expect(eventCard(multi, 0)).toMatch(/in each class/);
    for (const cls of ['gt', 'hypercar', 'touring', 'kart', 'rallycross'])
      expect(
        EVENTS.some((e) => {
          const ids = typeof e.vehicles === 'string' ? [e.vehicles] : e.vehicles;
          return ids.some((id) => VEHICLES[id].classId === cls);
        }),
        cls,
      ).toBe(true);
  });
  it('classifies within each class', () => {
    const vehicles = ['hy9', 'gt8f', 'pr2', 'hy9', 'gt10m'];
    // Overall order: car 3, 1, 0, 4, 2.
    expect(classPositions([3, 1, 0, 4, 2], vehicles)).toEqual([2, 1, 1, 1, 2]);
  });
  it('gives every machine a distinct recorded identity', () => {
    const ids = VEHICLE_IDS.filter((id) => id !== 'apx01');
    const identity = sessionIdentity({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: ids.length - 1,
      vehicles: ids,
    });
    expect(new Set(identity.vehicleHashes).size).toBe(ids.length);
  });
});
