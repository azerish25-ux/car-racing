import { SOLVANE, type RegionDefinition } from './region-data.ts';
import { CHARLOTTETOWN } from './charlottetown/region.ts';
export type OpenWorldRegionId = 'solvane' | 'charlottetown';
/** Workers and the renderer must resolve the same immutable region data. */
export function worldRegion(id: unknown): RegionDefinition {
  return id === 'charlottetown' ? CHARLOTTETOWN : SOLVANE;
}
export function festivalSaveKey(id: OpenWorldRegionId = 'solvane') {
  return id === 'solvane' ? 'festival:v1' : 'festival:charlottetown:v1';
}
