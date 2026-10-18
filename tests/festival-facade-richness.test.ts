import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { regionStructures, StructureGrid } from '../src/simulation/open-world/placement.ts';
import {
  architecturePlan,
  SKIN,
  visualStructure,
} from '../src/rendering/open-world/japan-architecture.ts';
import {
  facadeFinish,
  facadeLayout,
  WALL_FINISH,
} from '../src/rendering/open-world/facade-layout.ts';
import { Buildings } from '../src/rendering/open-world/buildings.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { FestivalSignage } from '../src/rendering/open-world/festival-signage.ts';
import {
  URBAN_FACADE_GLSL,
  URBAN_REFLECTION_GLSL,
} from '../src/rendering/open-world/facade-richness.ts';

const world = openWorld();
const structures = regionStructures(world);
const plan = architecturePlan(world, structures);
const town = world.region.towns.find((t) => t.floors[1] > 3)!;
const area = (r: readonly number[]) => (r[2] - r[0]) * (r[3] - r[1]);

describe('City skyline: visual storeys above the colliders', () => {
  it('adds storeys only to city blocks and shops, on the same footprint', () => {
    let raised = 0;
    structures.forEach((s, i) => {
      const extra = plan.extraFloors[i];
      if (!extra) return;
      raised++;
      expect(plan.style[i]).toBe('urban');
      expect(['block', 'shop']).toContain(s.kind);
      const v = visualStructure(s, extra);
      // Same footprint and base: nothing overhangs the collider.
      for (const key of ['x', 'z', 'heading', 'hx', 'hz', 'base', 'style'] as const)
        expect(v[key]).toBe(s[key]);
      expect(v.height).toBeCloseTo(s.height + extra * 3.2, 6);
      expect((v.height - 0.6) / v.floors).toBeCloseTo(3.2, 6);
      expect(v.floors).toBeLessThanOrEqual(14);
    });
    expect(raised).toBeGreaterThan(120);
    // The colliders themselves never change.
    expect(regionStructures(world)).toEqual(structures);
  });
  it('rises toward the town centre and along the main streets (refs 030, 039, 089)', () => {
    const cx = (town.x0 + town.x1) / 2,
      cz = (town.z0 + town.z1) / 2;
    const p = trackPoint();
    const road = (s: (typeof structures)[number]) => {
      world.network.nearest(s.x, s.z, p);
      return world.network.edges[world.network.edgeOf[world.network.lastSegment]].road.id;
    };
    const mean = (keep: (s: (typeof structures)[number], r: number) => boolean) => {
      let floors = 0,
        n = 0;
      structures.forEach((s, i) => {
        if (plan.style[i] !== 'urban' || s.kind !== 'block') return;
        const r = Math.hypot(
          (s.x - cx) / ((town.x1 - town.x0) / 2),
          (s.z - cz) / ((town.z1 - town.z0) / 2),
        );
        if (!keep(s, r)) return;
        floors += s.floors + plan.extraFloors[i];
        n++;
      });
      return floors / n;
    };
    const main = (s: (typeof structures)[number]) => ['harbour', 'market'].includes(road(s));
    const centre = mean((s, r) => r < 0.4),
      edge = mean((s, r) => r > 0.9 && !main(s)),
      streets = mean((s) => main(s));
    expect(centre).toBeGreaterThan(edge + 2);
    expect(streets).toBeGreaterThan(edge + 1);
    const tall = structures.filter((s, i) => s.floors + plan.extraFloors[i] >= 8).length;
    expect(tall).toBeGreaterThan(100);
  });
  it('skins offices with ribbon windows and the tallest with curtain walls', () => {
    structures.forEach((s, i) => {
      if (plan.skin[i] === SKIN.punched) return;
      expect(plan.style[i]).toBe('urban');
      expect(s.kind).toBe('block');
    });
    expect(plan.skin.filter((k) => k === SKIN.ribbon).length).toBeGreaterThan(60);
    expect(plan.skin.filter((k) => k === SKIN.curtain).length).toBeGreaterThan(3);
  });
});

describe('Ribbon and curtain-wall facades', () => {
  it('partition the wall exactly and keep every band clear of corners and floor lines', () => {
    let bands = 0;
    structures.forEach((s, i) => {
      if (plan.skin[i] === SKIN.punched) return;
      const v = visualStructure(s, plan.extraFloors[i]);
      const variant = plan.skin[i] === SKIN.curtain ? 'curtain' : 'ribbon';
      for (let side = 0; side < 4; side++) {
        const length = side % 2 ? v.hz * 2 : v.hx * 2,
          layout = facadeLayout(v, length, side, variant)!;
        const sum =
          layout.wall.reduce((n, r) => n + area(r), 0) +
          layout.openings.reduce((n, o) => n + (o.u1 - o.u0) * (o.v1 - o.v0), 0);
        expect(sum).toBeCloseTo(length * v.height, 5);
        for (const o of layout.openings) {
          if (!o.lites) continue;
          bands++;
          expect(o.u0).toBeGreaterThanOrEqual(0.29);
          expect(length - o.u1).toBeGreaterThanOrEqual(0.29);
          expect(o.v0 - o.row0).toBeGreaterThan(0.1);
          expect(o.row1 - o.v1).toBeGreaterThan(0.1);
          const lite = (o.u1 - o.u0) / o.lites;
          expect(lite).toBeGreaterThan(0.9);
          expect(lite).toBeLessThan(2.3);
        }
      }
    });
    expect(bands).toBeGreaterThan(1000);
  });
  it('blank side walls only beside a neighbour and only up to its roof', () => {
    const grid = new StructureGrid(structures);
    let party = 0,
      above = 0;
    structures.forEach((s, i) => {
      for (const [slot, side] of [
        [0, -1],
        [1, 1],
      ] as const) {
        const rows = plan.partyRows[i * 2 + slot];
        if (!rows) continue;
        party++;
        expect(plan.style[i]).toBe('urban');
        const c = Math.cos(s.heading),
          n = Math.sin(s.heading),
          lx = side * (s.hx + 2.5);
        expect(grid.blocks(s.x + c * lx, s.z + n * lx, 1.5 + s.hz)).toBe(true);
        const v = visualStructure(s, plan.extraFloors[i]);
        const layout = facadeLayout(v, v.hz * 2, side > 0 ? 1 : 3, 'urban', 1, rows)!;
        for (const o of layout.openings)
          expect(o.row0 === 0 || o.row0 >= (rows - 0.01) * ((v.height - 0.6) / v.floors)).toBe(
            true,
          );
        if (layout.openings.some((o) => o.row0 > 0)) above++;
      }
    });
    expect(party).toBeGreaterThan(200);
    // Towers rising above their neighbours keep windows up there.
    expect(above).toBeGreaterThan(30);
  });
  it('assign the office finishes by palette identity', () => {
    for (const color of WALL_FINISH.largeTile) expect(facadeFinish(color)).toBe(7);
    for (const color of WALL_FINISH.precast) expect(facadeFinish(color)).toBe(8);
    for (const color of WALL_FINISH.panel) expect(facadeFinish(color)).toBe(9);
  });
});

describe('Facade richness geometry and shading data', () => {
  it('tags city panes and walls with stable shader data within the triangle budget', () => {
    const buildings = new Buildings(structures, plan);
    let cityPanes = 0,
      tops = 0;
    buildings.root.traverse((o) => {
      if (!(o instanceof T.Mesh) || !o.name.startsWith('Buildings')) return;
      const facade = o.geometry.getAttribute('facade');
      for (let k = 0; k < facade.count; k += 4) {
        const arch = Math.floor(facade.getY(k) / 16 + 0.01),
          z = facade.getZ(k),
          w = facade.getW(k);
        if (arch !== 2) continue;
        if (Math.abs(z + 4) < 0.1) {
          // Room ids sit at 1/256 bucket centres; the tag is an integer.
          const bucket = facade.getX(k) * 256;
          expect(Math.abs(bucket - Math.floor(bucket) - 0.5)).toBeLessThan(1e-3);
          expect(Math.abs(w - Math.round(w))).toBeLessThan(1e-4);
          cityPanes++;
        } else if (Math.abs(z + 3) < 0.1 && w >= 16) tops++;
      }
    });
    expect(cityPanes).toBeGreaterThan(5000);
    expect(tops).toBeGreaterThan(5000);
    expect(buildings.stats.triangles).toBeLessThan(1_300_000);
    buildings.dispose();
  });
  it('injects the glazing and reflection functions the facade material calls', () => {
    for (const fn of ['owRoom', 'owNeighbour', 'owCityPane', 'owCityWall', 'owFrosted'])
      expect(URBAN_FACADE_GLSL).toContain(`${fn}(`);
    expect(URBAN_REFLECTION_GLSL).toContain('USE_ENVMAP');
  });
  it('hangs denser signage: tenant columns, flat boards, LED screens and village gardens', () => {
    const signage = new FestivalSignage(world, structures, plan);
    expect(signage.stats.columns).toBeGreaterThan(200);
    expect(signage.stats.signs).toBeGreaterThan(1200);
    expect(signage.stats.screens).toBeGreaterThan(3);
    expect(signage.stats.screens).toBeLessThan(40);
    expect(signage.stats.lanterns).toBeGreaterThan(220);
    const screens = signage.screens.mesh!;
    const position = screens.geometry.getAttribute('position');
    for (let k = 0; k < position.count; k++) expect(position.getY(k)).toBeGreaterThan(10);
    signage.dispose();
  });
});
