import { describe, expect, it } from 'vitest';
import { trackPoint } from '../src/simulation/track.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { regionStructures, StructureGrid } from '../src/simulation/open-world/placement.ts';
import { gridHeight, TILE_SIZE } from '../src/simulation/open-world/terrain-tiles.ts';
import { FAR_CANOPY, planCanopyTile } from '../src/rendering/open-world/far-canopy.ts';
import { planRockTile, ROCKS } from '../src/rendering/open-world/rocks.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { buildTileData } from '../src/rendering/open-world/tile-data.ts';
import {
  fillGroundWindow,
  GROUND_COVER,
  sampleGroundWindow,
  WINDOW_TEXELS,
} from '../src/rendering/open-world/ground-cover.ts';
import { TERRAIN_EXTENT } from '../src/rendering/open-world/terrain.ts';

const world = openWorld();
const grid = new StructureGrid(regionStructures(world));
const clearance = (x: number, z: number) => {
  const p = trackPoint(),
    net = world.network,
    lateral = net.nearest(x, z, p),
    e = net.edges[net.edgeOf[net.lastSegment]];
  return Math.abs(lateral) - (e.spec.halfWidth + e.spec.shoulder);
};
/** The ground window around (x, z) as the renderer fills it. */
function windowAround(x: number, z: number) {
  const half = Math.floor(GROUND_COVER.window / 2),
    x0 = (Math.floor(x / TILE_SIZE) - half) * TILE_SIZE,
    z0 = (Math.floor(z / TILE_SIZE) - half) * TILE_SIZE;
  const tiles = [];
  for (let tz = 0; tz < GROUND_COVER.window; tz++)
    for (let tx = 0; tx < GROUND_COVER.window; tx++)
      tiles.push(
        buildTileData(world, grid, {
          type: 'tile',
          id: 1,
          x0: x0 + tx * TILE_SIZE,
          z0: z0 + tz * TILE_SIZE,
          size: TILE_SIZE,
          res: 64,
          trees: 0,
        }),
      );
  const out = new Float32Array(WINDOW_TEXELS * WINDOW_TEXELS * 4);
  fillGroundWindow(out, tiles);
  return { out, x0, z0 };
}

describe('festival ground cover (grass carpet and understory)', () => {
  it('aligns the render tiles with the physics tiles', () => {
    expect((TERRAIN_EXTENT / 2) % TILE_SIZE).toBe(0);
  });
  it('stands every clump on the carved physics ground and keeps it off the road', () => {
    // A meadow road (Saltmarsh farm road) and a forest road (Thornwood).
    for (const [cx, cz] of [
      [1540, -65],
      [1262, 2708],
    ]) {
      const { out, x0, z0 } = windowAround(cx, cz);
      let onRoad = 0,
        grassy = 0;
      for (let k = 0; k < 400; k++) {
        const x = cx - 90 + ((k * 37) % 180) + 0.31,
          z = cz - 90 + ((k * 53) % 180) + 0.17;
        const s = sampleGroundWindow(out, x0, z0, x, z);
        expect(Math.abs(s.height - carvedGroundHeight(world.carver, x, z))).toBeLessThan(0.02);
        const clear = clearance(x, z);
        // The edge channel tracks the real clearance near the road (4 m cells).
        if (Math.abs(clear) < 8) expect(Math.abs(s.edge - clear)).toBeLessThan(2);
        // Grass needs edge > 0.2 m in the shader: never on the carriageway or shoulder.
        if (clear < -0.5) {
          onRoad++;
          expect(s.edge).toBeLessThan(0.2);
        }
        if (s.grass > 0.5) grassy++;
      }
      expect(onRoad).toBeGreaterThan(0);
      expect(grassy).toBeGreaterThan(100);
    }
  });
  it('bares the ground in town and on the beach', () => {
    const town = windowAround(900, -2400);
    const s = sampleGroundWindow(town.out, town.x0, town.z0, 900.5, -2400.5);
    expect(s.grass).toBeLessThan(0.05);
  });
});

describe('festival woods and rocks', () => {
  const tileAt = (level: number, x: number, z: number) => {
    const size = TILE_SIZE * 2 ** level,
      ix = Math.floor((x + TERRAIN_EXTENT / 2) / size),
      iz = Math.floor((z + TERRAIN_EXTENT / 2) / size);
    const data = buildTileData(world, grid, {
      type: 'tile',
      id: 1,
      x0: -TERRAIN_EXTENT / 2 + ix * size,
      z0: -TERRAIN_EXTENT / 2 + iz * size,
      size,
      res: level <= 2 ? 64 : 32,
      trees: level <= 1 ? 1 : 0,
      colliders: level === 0,
    });
    return { data, ix, iz };
  };
  it('woods the hills and the massif flanks but keeps the Ashvale valley floor open', () => {
    const f = world.field;
    let hill = 0,
      hillForest = 0;
    for (let x = -3600; x <= 3600; x += 150)
      for (let z = -1800; z <= 3600; z += 150) {
        const h = f.height(x, z),
          slope = Math.hypot(f.height(x + 2, z) - h, f.height(x, z + 2) - h) / 2;
        if (slope > 0.12 && h > 60 && h < 500) {
          hill++;
          if (f.forestDensity(x, z) > 0.42) hillForest++;
        }
      }
    expect(hillForest / hill).toBeGreaterThan(0.45);
    // The valley floor and its village (Ashvale) stay farmed and open.
    for (const [x, z] of [
      [-480, 520],
      [-900, 980],
      [-60, -60],
    ])
      expect(world.field.forestDensity(x, z)).toBeLessThan(0.42);
  });
  it('plants far crowns on the forest weight of the drawn tile, on its surface and off the roads', () => {
    const { data, ix, iz } = tileAt(2, 1300, 2900);
    const crowns = planCanopyTile(data, 2, ix, iz);
    expect(Array.from(planCanopyTile(data, 2, ix, iz))).toEqual(Array.from(crowns));
    const n = crowns.length / FAR_CANOPY.stride;
    // Thornwood: a dense canopy over the 1 km tile.
    expect(n).toBeGreaterThan(4000);
    const size = TILE_SIZE * 4,
      x0 = -TERRAIN_EXTENT / 2 + ix * size,
      z0 = -TERRAIN_EXTENT / 2 + iz * size,
      step = size / 64;
    for (let k = 0; k < n; k += 37) {
      const o = k * FAR_CANOPY.stride,
        x = crowns[o],
        z = crowns[o + 2];
      expect(x).toBeGreaterThanOrEqual(x0);
      expect(x).toBeLessThan(x0 + size);
      const ground = gridHeight(data.heights, 65, (x - x0) / step, (z - z0) / step, step);
      expect(Math.abs(crowns[o + 1] + 0.3 - ground)).toBeLessThan(0.01);
      expect(clearance(x, z)).toBeGreaterThan(0);
      expect(crowns[o + 3]).toBeGreaterThan(4);
    }
  });
  it('sets rock outcrops on the steep high ground, half sunk and clear of the roads', () => {
    let total = 0;
    // Varda massif upper slopes.
    for (const [x, z] of [
      [-2900, 2300],
      [-2700, 2700],
      [-3100, 2500],
    ]) {
      const { data, ix, iz } = tileAt(0, x, z);
      const rocks = planRockTile(data, 0, ix, iz);
      total += rocks.length / ROCKS.stride;
      for (let o = 0; o < rocks.length; o += ROCKS.stride) {
        const rx = rocks[o],
          rz = rocks[o + 2];
        expect(clearance(rx, rz)).toBeGreaterThan(2.5);
        const ground = carvedGroundHeight(world.carver, rx, rz);
        // Sunk by 38 % of its height: the base below the ground.
        expect(rocks[o + 1]).toBeLessThan(ground);
        expect(rocks[o + 1]).toBeGreaterThan(ground - rocks[o + 4]);
      }
    }
    expect(total).toBeGreaterThan(30);
  });
});
