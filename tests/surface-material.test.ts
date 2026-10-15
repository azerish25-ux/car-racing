import { describe, expect, it } from 'vitest';
import { SURFACE, surfaceSample, Track } from '../src/simulation/track.ts';
import {
  advanceSinkage,
  groundDrag,
  MATERIAL,
  MATERIALS,
  materialGrip,
  rollingCoefficient,
  sinkageTarget,
  surfaceMaterial,
  TERRAIN_MATERIAL,
} from '../src/simulation/surface-material.ts';
import { BIKE } from '../src/simulation/bike.ts';

describe('ground material table', () => {
  it('keeps the circuit surface ids and their former grip and rigid resistance', () => {
    for (const [name, id] of Object.entries(SURFACE)) expect(MATERIALS[id].id, name).toBe(id);
    expect(surfaceMaterial(MATERIAL.ASPHALT)).toMatchObject({ grip: 1, rolling: 0.015 });
    expect(surfaceMaterial(MATERIAL.GRASS).grip).toBe(0.53);
    expect(surfaceMaterial(MATERIAL.GRAVEL).grip).toBe(0.4);
    expect(surfaceMaterial(99)).toBe(MATERIALS[0]);
    for (const m of MATERIALS) {
      expect(m.grip).toBeGreaterThan(0);
      expect(m.rolling).toBeGreaterThan(0);
      expect(Object.isFrozen(m)).toBe(true);
    }
  });
  it('orders dry friction from asphalt through loose ground to ice', () => {
    const grip = (id: number) => surfaceMaterial(id).grip;
    expect(grip(MATERIAL.ASPHALT)).toBeGreaterThan(grip(MATERIAL.DIRT));
    expect(grip(MATERIAL.DIRT)).toBeGreaterThan(grip(MATERIAL.GRASS));
    expect(grip(MATERIAL.GRASS)).toBeGreaterThan(grip(MATERIAL.SNOW));
    expect(grip(MATERIAL.SNOW)).toBeGreaterThan(grip(MATERIAL.ICE));
  });
  it('makes wet paint and grass far slicker than wet asphalt, and ice near 0 °C', () => {
    const wet = (id: number) => materialGrip(surfaceMaterial(id), 2, 20),
      loss = (id: number) => wet(id) / surfaceMaterial(id).grip;
    expect(loss(MATERIAL.ASPHALT)).toBe(1);
    expect(loss(MATERIAL.PAINT)).toBeLessThan(0.9);
    expect(loss(MATERIAL.GRASS)).toBeLessThan(0.9);
    expect(wet(MATERIAL.GRASS)).toBeLessThan(wet(MATERIAL.PAINT) * 0.7);
    expect(wet(MATERIAL.PAINT)).toBeLessThan(wet(MATERIAL.ASPHALT) * 0.9);
    const ice = surfaceMaterial(MATERIAL.ICE);
    expect(materialGrip(ice, 0, 0)).toBeLessThan(materialGrip(ice, 0, -15) * 0.7);
  });
  it('sinks monotonically with load up to the material depth, approaching it exactly', () => {
    const gravel = surfaceMaterial(MATERIAL.GRAVEL);
    expect(sinkageTarget(surfaceMaterial(MATERIAL.ASPHALT), 5000, 0.05)).toBe(0);
    expect(sinkageTarget(gravel, 3000, 0.08)).toBeGreaterThan(sinkageTarget(gravel, 1500, 0.08));
    expect(sinkageTarget(gravel, 1e7, 0.08)).toBe(gravel.maxSinkage);
    for (const dt of [1 / 240, 1 / 30, 10]) {
      const z = advanceSinkage(0, 0.04, 20, dt);
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThanOrEqual(0.04);
    }
  });
  it('adds compaction resistance and bulldozing that grows with speed', () => {
    const gravel = surfaceMaterial(MATERIAL.GRAVEL);
    expect(rollingCoefficient(gravel, 0.03, 0.25)).toBeGreaterThan(gravel.rolling);
    const slow = groundDrag(gravel, 0.03, 0.36, 5, 0, 0),
      fast = groundDrag(gravel, 0.03, 0.36, 40, 0, 0);
    expect(fast).toBeGreaterThan(slow * 1.5);
    expect(groundDrag(gravel, 0, 0.36, 40, 0, 0)).toBe(0);
  });
  it('drags a tyre through standing water, less once it planes', () => {
    const asphalt = surfaceMaterial(MATERIAL.ASPHALT);
    const shallow = groundDrag(asphalt, 0, 0.36, 50, 1, 0),
      deep = groundDrag(asphalt, 0, 0.36, 50, 2, 0),
      planing = groundDrag(asphalt, 0, 0.36, 50, 2, 1);
    expect(deep).toBeCloseTo(2 * shallow, 9);
    expect(groundDrag(asphalt, 0, 0.36, 100, 1, 0)).toBeCloseTo(4 * shallow, 9);
    expect(planing).toBeLessThan(deep * 0.5);
  });
  it('serves terrain tiles and the motorcycle from the same table', () => {
    expect(surfaceMaterial(TERRAIN_MATERIAL.mud).name).toBe('mud');
    expect(surfaceMaterial(TERRAIN_MATERIAL.sand).loose).toBe(true);
    // A bike's friction circle on a material: μ_tyre · material friction.
    const snow = BIKE.mu * materialGrip(surfaceMaterial(MATERIAL.SNOW), 0, -5);
    expect(snow).toBeLessThan(BIKE.mu * 0.4);
  });
  it('feeds the circuit sample its material grip and rigid resistance', () => {
    const track = new Track('clear', true);
    const p = track.points[200];
    // Far outside the road: grass or gravel, with the table's values.
    const out = track.sample(
      p.x + p.nx * (p.width + 8),
      p.z + p.nz * (p.width + 8),
      surfaceSample(),
    );
    expect([SURFACE.GRASS, SURFACE.GRAVEL]).toContain(out.surface);
    expect(out.grip).toBe(surfaceMaterial(out.surface).grip);
    expect(out.resistance).toBe(surfaceMaterial(out.surface).rolling);
  });
});
