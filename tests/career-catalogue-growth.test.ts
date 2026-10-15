import { describe, expect, it } from 'vitest';
import {
  championshipPrize,
  disciplineEvents,
  disciplineTiers,
  purchaseReasons,
  tierVehicles,
} from '../src/career/ladder.ts';
import { LICENCE_TESTS } from '../src/career/licences.ts';
import {
  DISCIPLINE_IDS,
  disciplineStatus,
  liveRegistry,
  vehicleDiscipline,
  vehicleFamily,
} from '../src/career/registry.ts';
import { newCareer, type CareerSave } from '../src/career/save.ts';
import { classInfo } from '../src/simulation/vehicle-classes.ts';

/** Career placement of the catalogue growth's machines (CONTENT_PIPELINE.md
 * §1.3): road-only machines belong to the festival, every open tier can race,
 * and a grid scored per class admits each class it lists. */
const live = liveRegistry();
const machine = (id: string) => live.vehicles.find((v) => v.id === id)!;
/** Full reputation and gold licences, owning only `ids` (the first active). */
function owning(...ids: string[]): CareerSave {
  const save = newCareer();
  save.credits = 1e7;
  for (const d of DISCIPLINE_IDS) save.reputation[d] = 100;
  for (const id of Object.keys(LICENCE_TESTS) as (keyof typeof LICENCE_TESTS)[])
    save.licences[id] = { medal: 'gold', best: 0, attempts: 1 };
  save.owned = ids.map((id) => ({ id, source: 'purchase' as const }));
  save.active[vehicleDiscipline(machine(ids[0]))] = ids[0];
  return save;
}

describe('road-only machines in the career', () => {
  it('files the road-only motorcycle under the festival, not the circuit bike ladder', () => {
    const nr900 = machine('nr900');
    expect(nr900.classId).toBe('road-bike');
    expect(classInfo('road-bike').raceRuleset).toBeUndefined();
    expect(vehicleFamily(nr900)).toBe('road');
    expect(vehicleDiscipline(nr900)).toBe('festival');
    const bikeTiers = disciplineTiers(live, 'road-bikes');
    expect(bikeTiers.map((t) => t.id)).not.toContain('road-bikes-open');
    expect(bikeTiers.flatMap((t) => tierVehicles(live, t)).map((v) => v.id)).not.toContain('nr900');
    const festival = disciplineTiers(live, 'festival').find((t) => t.id === 'festival-road')!;
    expect(tierVehicles(live, festival).map((v) => v.id)).toContain('nr900');
    // Circuit motorcycles still race on the circuit ladder.
    for (const id of ['gpr1', 'gpr2', 'sbk1000', 'ss600', 'cr750'])
      expect(vehicleDiscipline(machine(id)), id).toBe('road-bikes');
  });
  it('gives every tier of an open discipline a machine that can race', () => {
    for (const d of DISCIPLINE_IDS) {
      if (disciplineStatus(live, d).state !== 'open') continue;
      for (const t of disciplineTiers(live, d)) {
        const machines = tierVehicles(live, t);
        if (!machines.length) continue;
        expect(
          machines.some((v) => !purchaseReasons(live, v).length),
          `${d} tier ${t.id} (${t.classes.join(', ')})`,
        ).toBe(true);
      }
    }
  });
  it('never awards a championship prize the player cannot race', () => {
    for (const d of DISCIPLINE_IDS)
      for (const t of disciplineTiers(live, d)) {
        const prize = championshipPrize(live, d, t.id, []);
        if (prize) expect(purchaseReasons(live, machine(prize)), `${d} ${t.id}`).toEqual([]);
      }
    // The top motorcycle title has no tier above it to award from.
    const bikes = disciplineTiers(live, 'road-bikes');
    expect(championshipPrize(live, 'road-bikes', bikes.at(-1)!.id, [])).toBeNull();
  });
});
describe('authored events scored per class', () => {
  const key = 'circuit-cars.formula.event.aurel-historic-masters';
  it('admits each era of the historic masters grid in its own slot', () => {
    for (const [id, cls] of [
      ['hf86', 'historic-turbo'],
      ['hf76', 'historic-aero'],
      ['hf67', 'historic'],
    ] as const) {
      const event = disciplineEvents(live, owning(id), 'circuit-cars').find((e) => e.key === key);
      expect(event, `${id}: masters event listed`).toBeDefined();
      expect(event!.status, `${id}: ${event!.reasons.join('; ')}`).toBe('open');
      const vehicles = event!.definition!.vehicles as readonly string[];
      expect(vehicles[0]).toBe(id);
      expect(machine(id).classId).toBe(cls);
      // The player replaces one entrant of their own era: three of each.
      expect(vehicles).toHaveLength(9);
      for (const era of ['hf86', 'hf76', 'hf67'])
        expect(vehicles.slice(1).filter((v) => v === era).length, era).toBe(era === id ? 2 : 3);
    }
  });
  it('still keeps a single-class event to its class', () => {
    // A PR-3 owner cannot take the long-tail heritage grid (historic prototypes only).
    const event = disciplineEvents(live, owning('pr3'), 'circuit-cars').find(
      (e) => e.key === 'circuit-cars.endurance.event.vellamar-long-tail-sprint',
    )!;
    expect(event.status).toBe('locked');
    expect(event.reasons.join(' ')).toContain('is for historic-prototype machines');
    const own = disciplineEvents(live, owning('sp71'), 'circuit-cars').find(
      (e) => e.key === event.key,
    )!;
    expect(own.status).toBe('open');
    expect(own.definition!.vehicles[0]).toBe('sp71');
  });
});
