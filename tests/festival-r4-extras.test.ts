import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { regionStructures } from '../src/simulation/open-world/placement.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { SnowWalls } from '../src/rendering/open-world/snow-walls.ts';
import { FestivalAttractions } from '../src/rendering/open-world/festival-attractions.ts';
import { SeasonParticles } from '../src/rendering/open-world/season-particles.ts';
import { applySeason } from '../src/rendering/open-world/season.ts';

const world = openWorld();
const point = () => ({
  s: 0,
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  tz: 1,
  nx: 1,
  nz: 0,
  curvature: 0,
  width: 0,
  bank: 0,
  gradient: 0,
});

describe('festival season extras', () => {
  it('builds winter snow walls only on high cut roads, clear of every carriageway', () => {
    const walls = new SnowWalls(world.network, (x, z) => world.field.height(x, z));
    expect(walls.stats.metres).toBeGreaterThan(500);
    const mesh = walls.root.children[0] as T.Mesh;
    const position = mesh.geometry.getAttribute('position');
    const p = point();
    for (let i = 0; i < position.count; i += 7) {
      expect(position.getY(i)).toBeGreaterThan(250);
      // The wall base and face stand outside the running surface.
      const lateral = Math.abs(world.network.nearest(position.getX(i), position.getZ(i), p));
      const edge = world.network.edges[world.network.edgeOf[world.network.lastSegment]];
      expect(lateral).toBeGreaterThan(edge.spec.halfWidth);
    }
    applySeason('summer');
    walls.update();
    expect(walls.root.visible).toBe(false);
    applySeason('winter');
    walls.update();
    expect(walls.root.visible).toBe(true);
    applySeason('summer');
    walls.dispose();
  });
  it('stands the Ferris wheel on open ground away from roads and buildings', () => {
    const structures = regionStructures(world);
    const attractions = new FestivalAttractions(world.network, structures, (x, z) =>
      carvedGroundHeight(world.carver, x, z),
    );
    expect(attractions.placed).toBe(true);
    const { x, z } = attractions.root.position;
    const p = point();
    expect(Math.abs(world.network.nearest(x, z, p))).toBeGreaterThan(45);
    for (const s of structures) expect(Math.hypot(s.x - x, s.z - z)).toBeGreaterThan(30);
    attractions.dispose();
  });
  it('draws falling flakes only outside summer and never on LOW', () => {
    const flakes = new SeasonParticles();
    const camera = new T.PerspectiveCamera();
    const light = new T.Color(1, 1, 1);
    applySeason('summer');
    flakes.update(camera, 'high', light);
    expect(flakes.root.count).toBe(0);
    applySeason('spring');
    flakes.update(camera, 'low', light);
    expect(flakes.root.count).toBe(0);
    flakes.update(camera, 'medium', light);
    expect(flakes.root.count).toBeGreaterThan(0);
    applySeason('summer');
    flakes.dispose();
  });
});
