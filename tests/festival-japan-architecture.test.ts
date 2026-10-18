import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { regionStructures, StructureGrid } from '../src/simulation/open-world/placement.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { architecturePlan, LOT } from '../src/rendering/open-world/japan-architecture.ts';
import {
  facadeFinish,
  facadeLayout,
  WALL_FINISH,
} from '../src/rendering/open-world/facade-layout.ts';
import { Buildings } from '../src/rendering/open-world/buildings.ts';
import { FestivalSignage } from '../src/rendering/open-world/festival-signage.ts';

const world = openWorld();
const structures = regionStructures(world);
const plan = architecturePlan(world, structures);
const area = (r: readonly number[]) => (r[2] - r[0]) * (r[3] - r[1]);

describe('Japanese reading of the festival structures', () => {
  it('is deterministic, cached and never changes a collision footprint', () => {
    const again = regionStructures(world);
    expect(again).toEqual(structures);
    expect(architecturePlan(world, structures)).toBe(plan);
    const fresh = architecturePlan(world, again);
    expect(fresh.style).toEqual(plan.style);
    expect(Array.from(fresh.front)).toEqual(Array.from(plan.front));
    expect([...fresh.konbiniFloor]).toEqual([...plan.konbiniFloor]);
    expect(fresh.landmarks).toEqual(plan.landmarks);
  });
  it('draws the village traditionally and the harbour town as a city', () => {
    const count = (style: string) => plan.style.filter((s) => s === style).length;
    expect(count('minka')).toBeGreaterThan(15);
    expect(count('machiya')).toBeGreaterThan(15);
    expect(count('urban')).toBeGreaterThan(500);
    expect(count('temple')).toBe(1);
    structures.forEach((s, i) => {
      if (s.kind === 'hangar' || s.kind === 'warehouse' || s.kind === 'lighthouse')
        expect(plan.style[i]).toBe('legacy');
      if (s.kind === 'block') expect(['urban', 'konbini']).toContain(plan.style[i]);
    });
  });
  it('faces each building toward its nearest road', () => {
    const p = trackPoint();
    structures.forEach((s, i) => {
      world.network.nearest(s.x, s.z, p);
      const toward = (p.x - s.x) * -Math.sin(s.heading) + (p.z - s.z) * Math.cos(s.heading);
      expect(Math.sign(toward) || 1).toBe(plan.front[i]);
    });
  });
  it('puts every stand-alone store car park on clear, level, off-road ground', () => {
    const grid = new StructureGrid(structures);
    const p = trackPoint();
    const stores = plan.style.flatMap((s, i) => (s === 'konbini' ? [i] : []));
    expect(stores.length).toBeGreaterThan(0);
    for (const i of stores) {
      const s = structures[i],
        side = plan.lotSide.get(i)!;
      expect(Math.abs(side)).toBe(1);
      const c = Math.cos(s.heading),
        n = Math.sin(s.heading);
      let low = Infinity,
        high = -Infinity;
      for (let a = 0; a <= LOT.length; a += 1)
        for (let b = -s.hz; b <= s.hz; b += 1) {
          const lx = side * (s.hx + LOT.offset + a);
          const x = s.x + c * lx - n * b,
            z = s.z + n * lx + c * b;
          expect(grid.blocks(x, z, 0)).toBe(false);
          const lateral = Math.abs(world.network.nearest(x, z, p));
          const edge = world.network.edges[world.network.edgeOf[world.network.lastSegment]];
          expect(lateral).toBeGreaterThan(edge.spec.halfWidth + edge.spec.shoulder);
          const y = carvedGroundHeight(world.carver, x, z);
          low = Math.min(low, y);
          high = Math.max(high, y);
        }
      expect(high - low).toBeLessThan(0.8);
    }
  });
  it('sites the visual-only castle on an open hilltop far from roads and buildings', () => {
    expect(plan.landmarks.length).toBeGreaterThan(0);
    const grid = new StructureGrid(structures);
    const p = trackPoint();
    for (const site of plan.landmarks) {
      expect(Math.abs(world.network.nearest(site.x, site.z, p))).toBeGreaterThan(80);
      for (let a = -40; a <= 40; a += 10)
        for (let b = -40; b <= 40; b += 10)
          expect(grid.blocks(site.x + a, site.z + b, 0)).toBe(false);
      // The base starts at or below the lowest ground of its footprint.
      for (const a of [-10, 0, 10])
        for (const b of [-10, 0, 10])
          expect(site.y).toBeLessThanOrEqual(
            carvedGroundHeight(world.carver, site.x + a, site.z + b),
          );
    }
  });
});

describe('Japanese facade variants', () => {
  it('assign new wall finishes by palette identity without disturbing the originals', () => {
    for (const color of WALL_FINISH.tile) expect(facadeFinish(color)).toBe(3);
    for (const color of WALL_FINISH.timber) expect(facadeFinish(color)).toBe(4);
    for (const color of WALL_FINISH.concrete) expect(facadeFinish(color)).toBe(5);
    for (const color of WALL_FINISH.siding) expect(facadeFinish(color)).toBe(6);
    expect(facadeFinish(0x8c4f3a)).toBe(1);
    expect(facadeFinish(0xb3a891)).toBe(2);
  });
  it('keep openings clear of corners and floor bands, without European shutters', () => {
    let openings = 0;
    structures.forEach((s, i) => {
      const variant =
        plan.style[i] === 'urban'
          ? 'urban'
          : plan.style[i] === 'minka' || plan.style[i] === 'machiya'
            ? 'traditional'
            : null;
      if (!variant) return;
      for (let side = 0; side < 4; side++) {
        const length = side % 2 ? s.hz * 2 : s.hx * 2,
          layout = facadeLayout(s, length, side, variant);
        if (!layout) continue;
        const sum =
          layout.wall.reduce((n, r) => n + area(r), 0) +
          layout.openings.reduce((n, o) => n + (o.u1 - o.u0) * (o.v1 - o.v0), 0);
        expect(sum).toBeCloseTo(length * s.height, 5);
        for (const o of layout.openings) {
          expect(o.kind).not.toBe('shuttered');
          expect(o.u0).toBeGreaterThan(0.28);
          expect(length - o.u1).toBeGreaterThan(0.28);
          expect(o.v0 - o.row0).toBeGreaterThan(0.5);
          expect(o.row1 - o.v1).toBeGreaterThan(0.29);
          expect(o.u1 - o.u0).toBeGreaterThan(0.9);
          expect(o.v1 - o.v0).toBeGreaterThan(1);
          const half = (o.u1 - o.u0) * 0.57,
            centre = (o.u0 + o.u1) / 2;
          expect(centre - half - o.cell0).toBeGreaterThanOrEqual(0.14);
          expect(o.cell1 - centre - half).toBeGreaterThanOrEqual(0.14);
          openings++;
        }
      }
    });
    expect(openings).toBeGreaterThan(1000);
  });
});

describe('Japanese buildings and signage geometry', () => {
  it('bakes finite, merged district meshes including the temple, stores and castle', () => {
    const buildings = new Buildings(structures, plan);
    expect(buildings.stats.buildings).toBe(structures.length);
    let meshes = 0;
    buildings.root.traverse((o) => {
      if (!(o instanceof T.Mesh) || o instanceof T.InstancedMesh || !o.name.startsWith('Buildings'))
        return;
      meshes++;
      for (const name of ['position', 'normal', 'uv', 'facade'])
        expect((o.geometry.getAttribute(name).array as Float32Array).every(Number.isFinite)).toBe(
          true,
        );
      // Every triangle is wound to face along its shading normal (front
      // faces are not culled from outside), sampled across the district.
      const position = o.geometry.getAttribute('position'),
        normal = o.geometry.getAttribute('normal'),
        index = o.geometry.index!;
      const a = new T.Vector3(),
        b = new T.Vector3(),
        c = new T.Vector3(),
        n = new T.Vector3();
      for (let t = 0; t < index.count; t += 3 * 37) {
        a.fromBufferAttribute(position, index.getX(t));
        b.fromBufferAttribute(position, index.getX(t + 1));
        c.fromBufferAttribute(position, index.getX(t + 2));
        n.fromBufferAttribute(normal, index.getX(t));
        const g = b.sub(a).cross(c.sub(a));
        if (g.lengthSq() < 1e-10) continue;
        expect(g.normalize().dot(n)).toBeGreaterThan(0.2);
      }
    });
    // One merged mesh per 512 m district, not one per building.
    expect(meshes).toBeLessThan(40);
    expect(buildings.stats.triangles).toBeLessThan(1_300_000);
    buildings.dispose();
  });
  it('places street furniture on the carved ground, off the road, within budget', () => {
    const signage = new FestivalSignage(world, structures, plan);
    expect(signage.stats.signs).toBeGreaterThan(300);
    expect(signage.stats.vending).toBeGreaterThan(100);
    expect(signage.stats.stores).toBeGreaterThan(5);
    expect(signage.stats.bays).toBeGreaterThan(5);
    expect(signage.stats.triangles).toBeLessThan(120_000);
    const p = trackPoint();
    let checked = 0;
    for (const node of signage.root.children) {
      const mesh = node as T.Mesh;
      const position = mesh.geometry.getAttribute('position');
      expect((position.array as Float32Array).every(Number.isFinite)).toBe(true);
      if (!mesh.name.includes('street')) continue;
      for (let k = 0; k < position.count; k += 7) {
        const x = position.getX(k),
          y = position.getY(k),
          z = position.getZ(k);
        const lateral = Math.abs(world.network.nearest(x, z, p));
        const edge = world.network.edges[world.network.edgeOf[world.network.lastSegment]];
        // Street-level items never stand in a driving lane.
        expect(lateral).toBeGreaterThan(edge.spec.halfWidth - 0.05);
        // Nothing sinks below the carved ground it stands on.
        const ground = carvedGroundHeight(world.carver, x, z);
        expect(y).toBeGreaterThan(ground - 0.6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    signage.dispose();
  });
});
