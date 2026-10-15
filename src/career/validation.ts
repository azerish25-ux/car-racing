import { DEFAULT_OPTIONS } from '../simulation/config.ts';
import { eventSession, type EventDefinition } from '../simulation/events.ts';
import { FESTIVAL_RULES, festivalEvents } from './festival.ts';
import { allTiers, disciplineEvents, licenceAvailability, purchaseReasons, vehiclePrice } from './ladder.ts';
import { LICENCE_IDS, LICENCE_TESTS } from './licences.ts';
import {
  DISCIPLINE_IDS,
  liveRegistry,
  vehicleDiscipline,
  venueKind,
  type CareerRegistry,
} from './registry.ts';
import { newCareer } from './save.ts';

/** Career content checks for `npm run validate:content`: tiers reference real
 * licences, every machine has a price, and every event or licence the career
 * would open for a fully progressed driver names only registered machines and
 * venues and loads through `load` (eventSession on the production content;
 * a test passing a synthetic registry passes a loader for that registry). */
export function validateCareerContent(
  registry: CareerRegistry = liveRegistry(),
  load: (definition: EventDefinition) => void = (definition) =>
    void eventSession(definition, DEFAULT_OPTIONS),
): string[] {
  const errors: string[] = [];
  const check = (label: string, definition: EventDefinition) => {
    const unknown = [definition.vehicles]
      .flat()
      .filter((id) => !registry.vehicles.some((v) => v.id === id));
    if (unknown.length)
      errors.push(`${label}: vehicle ${[...new Set(unknown)].join(', ')} not in the registry`);
    if (!registry.venues.some((v) => v.id === definition.circuit))
      errors.push(`${label}: venue ${definition.circuit} not in the registry`);
    try {
      load(definition);
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const ids = new Set<string>();
  for (const tier of allTiers(registry)) {
    if (ids.has(tier.id)) errors.push(`career tier ${tier.id}: duplicate id`);
    ids.add(tier.id);
    for (const need of tier.licences)
      if (!LICENCE_IDS.includes(need.id))
        errors.push(`career tier ${tier.id}: unknown licence ${need.id}`);
      else if (LICENCE_TESTS[need.id].discipline !== tier.discipline)
        errors.push(`career tier ${tier.id}: licence ${need.id} belongs to another discipline`);
    if (!(tier.payScale > 0 && tier.payScale <= 2))
      errors.push(`career tier ${tier.id}: pay scale out of range`);
  }
  for (const v of registry.vehicles)
    if (!(vehiclePrice(registry, v) > 0)) errors.push(`career: vehicle ${v.id} has no price`);
  const save = newCareer();
  save.credits = 1e9;
  for (const d of DISCIPLINE_IDS) save.reputation[d] = 100;
  for (const id of LICENCE_IDS) save.licences[id] = { medal: 'gold', best: 0, attempts: 1 };
  save.owned = registry.vehicles.map((v) => ({ id: v.id, source: 'purchase' as const }));
  const keys = new Set<string>();
  for (const d of DISCIPLINE_IDS)
    for (const event of disciplineEvents(registry, save, d)) {
      if (keys.has(event.key)) errors.push(`career event ${event.key}: duplicate key`);
      keys.add(event.key);
      if (event.status !== 'open' || !event.definition) continue;
      check(`career event ${event.key}`, event.definition);
    }
  for (const id of LICENCE_IDS) {
    const a = licenceAvailability(registry, save, id);
    if (a.status !== 'open' || !a.definition) continue;
    check(`career licence ${id}`, a.definition);
  }
  // Festival: each region is a festival venue, each event kind has an unlock
  // rule, keys are unique, every festival machine can be bought for it, and
  // a fully progressed driver who has discovered everything can enter all.
  for (const region of registry.festival ?? []) {
    const venue = registry.venues.find((v) => v.id === region.id);
    if (!venue || venueKind(venue) !== 'festival')
      errors.push(`career festival ${region.id}: not registered as a festival venue`);
    for (const e of region.events)
      if (!Object.hasOwn(FESTIVAL_RULES, e.kind))
        errors.push(`career festival ${region.id}/${e.id}: no unlock rule for kind ${e.kind}`);
  }
  const everything = new Set((registry.festival ?? []).flatMap((r) => r.events.map((e) => e.id)));
  for (const e of festivalEvents(registry, save, everything)) {
    if (keys.has(e.key)) errors.push(`career festival event ${e.key}: duplicate key`);
    keys.add(e.key);
    if (e.status !== 'open') errors.push(`career festival event ${e.key}: ${e.reasons.join('; ')}`);
  }
  if (registry.festival?.length)
    for (const v of registry.vehicles)
      if (vehicleDiscipline(v) === 'festival' && purchaseReasons(registry, v).length)
        errors.push(`career festival machine ${v.id}: ${purchaseReasons(registry, v).join(' ')}`);
  return errors;
}
