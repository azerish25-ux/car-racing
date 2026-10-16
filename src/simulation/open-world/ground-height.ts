import { gridHeight, TILE_STEP, type TerrainCarver } from './terrain-tiles.ts';

/** Point query on the same 4 m triangles used by the physics terrain.
 * Building one cell avoids generating a whole 256 m tile for occasional
 * camera, roadside-prop or planting queries. Road surfaces must still use
 * their analytic height: the carved road bed lies below the asphalt. */
export function carvedGroundHeight(carver: TerrainCarver, x: number, z: number) {
  const x0 = Math.floor(x / TILE_STEP) * TILE_STEP,
    z0 = Math.floor(z / TILE_STEP) * TILE_STEP;
  const { heights } = carver.build(x0, z0, TILE_STEP, 1);
  return gridHeight(heights, 2, (x - x0) / TILE_STEP, (z - z0) / TILE_STEP, TILE_STEP);
}
