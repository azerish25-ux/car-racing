import { RoadNetwork } from './road-network.ts';
import { SOLVANE, type RegionDefinition } from './region-data.ts';
import { TerrainCarver, TerrainTileCache } from './terrain-tiles.ts';
import { TerrainField } from './terrain-field.ts';

/** The static festival world: natural terrain, road network and the carved
 * ground both physics and rendering read. Building it is deterministic and
 * takes a few hundred milliseconds; each thread that needs it builds its own
 * copy from the same region data. */
export class OpenWorld {
  readonly field: TerrainField;
  readonly network: RoadNetwork;
  readonly carver: TerrainCarver;
  readonly buildMs: number;
  constructor(readonly region: RegionDefinition = SOLVANE) {
    const start = performance.now();
    this.field = new TerrainField(region);
    this.network = new RoadNetwork(region, this.field);
    this.carver = new TerrainCarver(this.field, this.network);
    this.buildMs = performance.now() - start;
  }
  /** A physics tile cache over this world's carved ground. */
  tileCache(budget = 64) {
    return new TerrainTileCache(this.carver, budget);
  }
}
const cache = new Map<string, OpenWorld>();
/** Shared world per region within one thread (tests and scripts reuse it). */
export function openWorld(region: RegionDefinition = SOLVANE) {
  const key = `${region.id}@${region.version}:${region.seed}`;
  let world = cache.get(key);
  if (!world) cache.set(key, (world = new OpenWorld(region)));
  return world;
}
