import { defineCircuit, type CatalogueCircuit } from './builder.ts';
import { REAL_WORLD_SPECS } from './real-world.ts';
import { UNCONVENTIONAL_SPECS } from './unconventional.ts';
import { CATALOGUE_CIRCUIT_IDS, type CatalogueCircuitId } from './venue-data.ts';

/** Every catalogue layout by id (WP29-WP30). Order follows CATALOGUE_CIRCUIT_IDS. */
const all = new Map<string, CatalogueCircuit>(
  [...REAL_WORLD_SPECS, ...UNCONVENTIONAL_SPECS].map((spec) => [spec.id, defineCircuit(spec)]),
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
