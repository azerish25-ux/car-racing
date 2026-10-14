import { describe, expect, it } from 'vitest';
import { TERRAIN, TerrainTile, lineCost } from '../src/simulation/terrain.ts';

const flat = () => new TerrainTile(0, 0, 80, 80, () => 0, 'loam', 0.3);
/** One lap's worth of wheel passes along a straight line x = 10 m. */
function lap(tile: TerrainTile, x = 10) {
  for (let z = 0.1; z < 19.9; z += TERRAIN.cell) tile.deform(x, z, 1400, 0.3, 0.02);
}
describe('WP37/WP38 bounded deformable dirt', () => {
  it('ruts change contact height, resistance and line cost together', () => {
    const tile = flat();
    for (let i = 0; i < 10; i++) lap(tile);
    const rut = tile.contact(10, 10),
      fresh = tile.contact(14, 10);
    expect(rut.height).toBeLessThan(fresh.height);
    expect(rut.depth).toBeGreaterThan(0.005);
    // The rendered displacement uses the same field: visual = physical.
    expect(-rut.height).toBeCloseTo(rut.depth, 9);
    expect(rut.resistance).toBeGreaterThan(fresh.resistance);
    expect(rut.compaction).toBeGreaterThan(0);
    // A rut edge costs more to the AI than either the rut floor or fresh dirt.
    expect(lineCost(tile, 10 + TERRAIN.cell * 1.1, 10)).toBeGreaterThan(lineCost(tile, 14, 10));
  });
  it('fifty laps stay bounded in depth and memory', () => {
    const tile = flat();
    for (let i = 0; i < 50; i++) lap(tile);
    expect(Math.max(...tile.depth)).toBeLessThanOrEqual(TERRAIN.maxDepth);
    expect(Math.max(...tile.compaction)).toBeLessThanOrEqual(TERRAIN.maxCompaction);
    expect(tile.checkpointBytes).toBeLessThan(80 * 12 * 2);
    expect(tile.depth.every(Number.isFinite)).toBe(true);
  });
  it('checkpoint/restore reproduces the field exactly for seek, flashback and late join', () => {
    const tile = flat();
    for (let i = 0; i < 5; i++) lap(tile);
    const cp = tile.checkpoint(),
      snapshot = Float32Array.from(tile.depth);
    for (let i = 0; i < 5; i++) lap(tile, 12);
    tile.restore(cp);
    expect(Array.from(tile.depth)).toEqual(Array.from(snapshot));
    expect(tile.sequence).toBe(cp.sequence);
    // Deterministic: the same authoritative inputs give the same field.
    const again = flat();
    for (let i = 0; i < 5; i++) lap(again);
    expect(Array.from(again.depth)).toEqual(Array.from(snapshot));
    tile.reset();
    expect(tile.depth.every((d) => d === 0)).toBe(true);
    expect(tile.contact(10, 10).height).toBe(0);
  });
  it('wet sand deforms more than hardpack', () => {
    const sand = new TerrainTile(0, 0, 80, 80, () => 0, 'sand', 0.8),
      hard = new TerrainTile(0, 0, 80, 80, () => 0, 'hardpack', 0.1);
    lap(sand);
    lap(hard);
    expect(sand.contact(10, 10).depth).toBeGreaterThan(hard.contact(10, 10).depth * 3);
  });
});
