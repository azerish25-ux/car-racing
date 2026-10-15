import { defineCircuit, type CatalogueCircuit } from './builder.ts';
import { ENDURANCE_SPECS } from './endurance.ts';
import { INDUSTRIAL_SPECS } from './industrial.ts';
import { MOTORCYCLE_GP_SPECS } from './motorcycle-gp.ts';
import { NIGHT_AND_STREET_SPECS } from './night-and-street.ts';
import { REAL_WORLD_CLASSIC_SPECS } from './real-world-classics.ts';
import { REAL_WORLD_SPECS } from './real-world.ts';
import { UNCONVENTIONAL_SPECS } from './unconventional.ts';
import { CATALOGUE_CIRCUIT_IDS, type CatalogueCircuitId } from './venue-data.ts';

/** Every authored catalogue layout spec (WP29-WP30 and catalogue wave 2). */
export const CATALOGUE_SPECS = Object.freeze([
  ...REAL_WORLD_SPECS,
  ...UNCONVENTIONAL_SPECS,
  ...MOTORCYCLE_GP_SPECS,
  ...ENDURANCE_SPECS,
  ...REAL_WORLD_CLASSIC_SPECS,
  ...NIGHT_AND_STREET_SPECS,
  ...INDUSTRIAL_SPECS,
]);
/** Every catalogue layout by id. Order follows CATALOGUE_CIRCUIT_IDS. */
const all = new Map<string, CatalogueCircuit>(
  CATALOGUE_SPECS.map((spec) => [spec.id, defineCircuit(spec)]),
);
for (const id of CATALOGUE_CIRCUIT_IDS)
  if (!all.has(id)) throw new Error(`Circuit catalogue is missing ${id}`);
if (all.size !== CATALOGUE_CIRCUIT_IDS.length) throw new Error('Circuit catalogue has extra ids');
export const CATALOGUE_CIRCUITS: Readonly<Record<CatalogueCircuitId, CatalogueCircuit>> =
  Object.freeze(
    Object.fromEntries(CATALOGUE_CIRCUIT_IDS.map((id) => [id, all.get(id)!])) as Record<
      CatalogueCircuitId,
      CatalogueCircuit
    >,
  );
export type { CatalogueCircuit } from './builder.ts';
