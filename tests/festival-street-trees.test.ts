import { describe, expect, it } from 'vitest';
import { openWorld } from '../src/simulation/open-world/world.ts';
import {
  regionStructures,
  StructureGrid,
  treesForTile,
  trunkRadius,
  TREE_SPECIES,
  TREE_STRIDE,
} from '../src/simulation/open-world/placement.ts';
import {
  isStreetSpecies,
  streetTreeForm,
  streetTreePlan,
  STREET_TREE,
} from '../src/simulation/open-world/street-trees.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { roadCandidates } from '../src/simulation/open-world/road-network.ts';
import { TILE_SIZE } from '../src/simulation/open-world/terrain-tiles.ts';
import { RoadFurniture } from '../src/rendering/open-world/road-furniture.ts';
import { FLORA_ROLE, floraRole } from '../src/rendering/open-world/flora-roles.ts';

const world = openWorld(),
  net = world.network,
  structures = regionStructures(world),
  grid = new StructureGrid(structures),
  plan = streetTreePlan(world, structures),
  trees = plan.trees,
  ground = (x: number, z: number) => carvedGroundHeight(world.carver, x, z);
const count = (species: number) => {
  let n = 0;
  for (let i = 0; i < trees.length; i += TREE_STRIDE) if (trees[i + 3] === species) n++;
  return n;
};

describe('festival street trees (shared placement, colliders)', () => {
  it('plants the town streets, the Ashvale / castle cherry avenues and the temple maples, deterministically', () => {
    expect(Array.from(streetTreePlan(world, regionStructures(world)).trees)).toEqual(
      Array.from(trees),
    );
    // Shore streets (Harbour Front) and the avenues are cherry, inland town
    // streets zelkova/ginkgo.
    expect(count(TREE_SPECIES.STREET_CHERRY)).toBeGreaterThan(500);
    expect(count(TREE_SPECIES.STREET_ZELKOVA)).toBeGreaterThan(60);
    expect(count(TREE_SPECIES.STREET_MAPLE)).toBeGreaterThan(10);
    const town = world.region.towns.find((t) => t.id === 'port-ilse')!;
    let inTown = 0;
    for (let i = 0; i < trees.length; i += TREE_STRIDE)
      if (
        trees[i] > town.x0 &&
        trees[i] < town.x1 &&
        trees[i + 1] > town.z0 &&
        trees[i + 1] < town.z1
      )
        inTown++;
    expect(inTown).toBeGreaterThan(250);
  });
  it('keeps every trunk off every carriageway, other footprints, bridges and buildings', () => {
    const cands = roadCandidates();
    for (let i = 0; i < trees.length; i += TREE_STRIDE) {
      const x = trees[i],
        z = trees[i + 1],
        r = trunkRadius(trees[i + 3], trees[i + 2]);
      expect(r).toBeGreaterThan(0.15);
      const n = net.covering(x, z, ground(x, z), 4, cands);
      for (let k = 0; k < n; k++) {
        const e = net.edges[net.edgeOf[cands.segment[k]]];
        expect(cands.bridge[k]).toBe(0);
        // Trunk edge outside the drivable footprint (carriageway and the
        // flush shoulder / footway).
        expect(cands.distance[k] - e.spec.halfWidth - e.spec.shoulder - r).toBeGreaterThan(0.18);
      }
      expect(grid.blocks(x, z, 0.45)).toBe(false);
    }
  });
  it('is part of every tile, physics and render alike, and never thinned', () => {
    let found = 0;
    const tiles = new Set<string>();
    for (let i = 0; i < trees.length; i += TREE_STRIDE)
      tiles.add(`${Math.floor(trees[i] / TILE_SIZE)},${Math.floor(trees[i + 1] / TILE_SIZE)}`);
    for (const key of [...tiles].slice(0, 8)) {
      const [ix, iz] = key.split(',').map(Number);
      for (const density of [1, 0.3]) {
        const tile = treesForTile(world, ix, iz, grid, density);
        for (let i = 0; i < tile.length; i += TREE_STRIDE)
          if (isStreetSpecies(tile[i + 3])) {
            found++;
            expect(trunkRadius(tile[i + 3], tile[i + 2])).toBeGreaterThan(0);
          }
      }
    }
    expect(found).toBeGreaterThan(100);
    // Without structures (no plan) the natural planting is unchanged.
    const bare = treesForTile(world, 6, 12, null);
    for (let i = 0; i < bare.length; i += TREE_STRIDE)
      expect(isStreetSpecies(bare[i + 3])).toBe(false);
  });
  it('raises pruned crowns on a clear stem so cars and shopfronts read underneath', () => {
    for (const species of [
      TREE_SPECIES.STREET_CHERRY,
      TREE_SPECIES.STREET_ZELKOVA,
      TREE_SPECIES.STREET_MAPLE,
    ])
      for (const h of [5.8, 7, 8.5, 10]) {
        const { crownH, crownW, lift } = streetTreeForm(species, h),
          ratio = crownW / crownH;
        // Lowest drawn leaves (landscape.ts foliageReach maximum per tile).
        const reach = ratio >= 1.065 ? 0.82 : 1.12;
        expect(lift + (1.02 - 0.83 * reach) * crownH).toBeGreaterThanOrEqual(
          STREET_TREE.clearStem - 1e-6,
        );
        // Atlas silhouette: cherry wide lobes, maple round, zelkova upright.
        if (species === TREE_SPECIES.STREET_CHERRY) expect(ratio).toBeGreaterThan(1.065);
        else if (species === TREE_SPECIES.STREET_MAPLE) expect(ratio).toBeGreaterThan(0.93);
        else expect(ratio).toBeLessThan(0.93);
      }
    const role = (species: number) =>
      floraRole({ x: 1, z: 2, y: 5, species, height: 7, road: 1, town: 1 });
    expect(role(TREE_SPECIES.STREET_CHERRY)).toBe(FLORA_ROLE.CHERRY);
    expect(role(TREE_SPECIES.STREET_ZELKOVA)).toBe(FLORA_ROLE.GINKGO);
    expect(role(TREE_SPECIES.STREET_MAPLE)).toBe(FLORA_ROLE.MAPLE);
  });
  it('keeps clear of the roadside furniture (poles, lamps, signs)', () => {
    const furniture = new RoadFurniture(world, structures, ground);
    let close = 0;
    for (let i = 0; i < trees.length; i += TREE_STRIDE)
      for (const a of furniture.anchors)
        if (Math.abs(a.x - trees[i]) < 3 && Math.hypot(a.x - trees[i], a.z - trees[i + 1]) < 1.2)
          close++;
    expect(close).toBeLessThan(trees.length * 0.02);
    furniture.dispose();
  });
});
