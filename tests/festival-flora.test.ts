import { describe, expect, it } from 'vitest';
import { trackPoint } from '../src/simulation/track.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import {
  regionStructures,
  StructureGrid,
  TREE_SPECIES,
} from '../src/simulation/open-world/placement.ts';
import { TILE_SIZE } from '../src/simulation/open-world/terrain-tiles.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import {
  decodeRole,
  encodeRole,
  FLORA_ROLE,
  floraRole,
  floraZone,
  CHERRY_SEED,
} from '../src/rendering/open-world/flora-roles.ts';
import { FLORA, FLORA_CLEARANCE, planFloraChunk } from '../src/rendering/open-world/flora.ts';
import { buildTileData, TILE_TREE_STRIDE } from '../src/rendering/open-world/tile-data.ts';
import { TERRAIN_EXTENT } from '../src/rendering/open-world/terrain.ts';
import { tileRoles } from '../src/rendering/open-world/vegetation.ts';

const world = openWorld();
const grid = new StructureGrid(regionStructures(world));
const clearance = (x: number, z: number) => {
  const p = trackPoint(),
    net = world.network,
    lateral = net.nearest(x, z, p),
    e = net.edges[net.edgeOf[net.lastSegment]];
  return Math.abs(lateral) - (e.spec.halfWidth + e.spec.shoulder);
};

describe('festival planting roles (presentation only)', () => {
  it('carries a role through the instance tint without changing the tint', () => {
    for (const role of Object.values(FLORA_ROLE))
      for (const green of [0, 0.62, 0.97, 1.3]) {
        const decoded = decodeRole(encodeRole(green, role));
        expect(decoded.role).toBe(role);
        expect(decoded.green).toBeCloseTo(green, 5);
      }
  });
  it('assigns Japanese roles deterministically from the tile data, one per placed tree', () => {
    const counts = new Map<number, number>();
    let roadsideCherries = 0,
      roadside = 0;
    // Forest and farmland tiles around Thornwood, Ashvale and the lower Varda woods.
    for (const [x, z] of [
      [1250, 2728],
      [-2292, 1190],
      [-760, 760],
      [-2045, 2046],
      [700, -1100],
    ]) {
      const ix = Math.floor((x + TERRAIN_EXTENT / 2) / TILE_SIZE),
        iz = Math.floor((z + TERRAIN_EXTENT / 2) / TILE_SIZE);
      const data = buildTileData(world, grid, {
        type: 'tile',
        id: 1,
        x0: -TERRAIN_EXTENT / 2 + ix * TILE_SIZE,
        z0: -TERRAIN_EXTENT / 2 + iz * TILE_SIZE,
        size: TILE_SIZE,
        res: 64,
        trees: 1,
      });
      const roles = tileRoles({ data, level: 0, ix, iz });
      expect(roles.length).toBe(data.trees.length / TILE_TREE_STRIDE);
      expect(Array.from(tileRoles({ data, level: 0, ix, iz }))).toEqual(Array.from(roles));
      roles.forEach((role, k) => {
        counts.set(role, (counts.get(role) ?? 0) + 1);
        const i = k * TILE_TREE_STRIDE,
          species = data.trees[i + 3];
        // Shrubs stay shrubs (no trunk collider), trees stay trees.
        if (species === TREE_SPECIES.SHRUB)
          expect([FLORA_ROLE.SHRUB, FLORA_ROLE.AZALEA]).toContain(role);
        else expect([FLORA_ROLE.SHRUB, FLORA_ROLE.AZALEA]).not.toContain(role);
        const x = data.trees[i],
          z = data.trees[i + 1];
        if (
          species !== TREE_SPECIES.SHRUB &&
          floraZone(x, z, CHERRY_SEED) > 0.56 &&
          clearance(x, z) < 12
        ) {
          roadside++;
          if (role === FLORA_ROLE.CHERRY) roadsideCherries++;
        }
      });
    }
    for (const role of [
      FLORA_ROLE.BROADLEAF,
      FLORA_ROLE.CHERRY,
      FLORA_ROLE.MAPLE,
      FLORA_ROLE.CEDAR,
      FLORA_ROLE.PINE,
    ])
      expect(counts.get(role) ?? 0, `role ${role}`).toBeGreaterThan(0);
    // Cherries line the roads inside the cherry zones (015, 050, 096).
    if (roadside > 10) expect(roadsideCherries / roadside).toBeGreaterThan(0.5);
  });
  it('keeps a pine/cedar decision for conifers above the cherry line', () => {
    const role = floraRole({
      x: -2300,
      z: 2400,
      y: 470,
      species: TREE_SPECIES.CONIFER,
      height: 20,
      road: 0,
      town: 0,
    });
    expect([FLORA_ROLE.CEDAR, FLORA_ROLE.PINE, FLORA_ROLE.BROADLEAF]).toContain(role);
  });
});

describe('festival ground flora (decorative, no colliders)', () => {
  it('plants susuki, flowers and bamboo deterministically, off the roads and buildings, on the ground', () => {
    const totals = { susuki: 0, flowers: 0, bamboo: 0 };
    // A sweep of chunks across meadows, farmland and forest edges.
    for (let cx = -24; cx <= 24; cx += 6)
      for (let cz = -24; cz <= 24; cz += 6) {
        const plan = planFloraChunk(world, grid, cx, cz);
        const again = planFloraChunk(world, grid, cx, cz);
        expect(again.susuki.length).toBe(plan.susuki.length);
        expect(again.bamboo.length).toBe(plan.bamboo.length);
        for (const [kind, list] of Object.entries(plan) as [
          keyof typeof totals,
          typeof plan.susuki,
        ][]) {
          totals[kind] += list.length;
          for (const p of list.filter((_, i) => i % 7 === 0)) {
            expect(p.x).toBeGreaterThanOrEqual(cx * FLORA.chunk);
            expect(p.x).toBeLessThan((cx + 1) * FLORA.chunk);
            const min = kind === 'bamboo' ? FLORA_CLEARANCE.bamboo : FLORA_CLEARANCE.ground;
            expect(clearance(p.x, p.z)).toBeGreaterThanOrEqual(min);
            expect(grid.blocks(p.x, p.z, 2)).toBe(false);
            expect(Math.abs(p.y - carvedGroundHeight(world.carver, p.x, p.z))).toBeLessThan(0.2);
          }
        }
      }
    expect(totals.susuki).toBeGreaterThan(200);
    expect(totals.flowers).toBeGreaterThan(20);
    expect(totals.bamboo).toBeGreaterThan(5);
  });
});
