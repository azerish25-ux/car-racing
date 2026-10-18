import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { resolveEvents } from '../src/simulation/open-world/festival-events.ts';
import { insideFootprint, regionStructures } from '../src/simulation/open-world/placement.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { architecturePlan } from '../src/rendering/open-world/japan-architecture.ts';
import { FestivalSignage } from '../src/rendering/open-world/festival-signage.ts';
import { FestivalTownLife, TOWN_LIFE } from '../src/rendering/open-world/town-life.ts';
import { parkedSites } from '../src/rendering/open-world/parked-cars.ts';
import {
  DIPPED_BEAM,
  dippedBeamIntensity,
  dippedBeamTexture,
} from '../src/rendering/open-world/headlight-beam.ts';
import { ParkedCars, TRAFFIC_SHAPES } from '../src/rendering/traffic-cars.ts';
import { SPECTATOR_FEET } from '../src/rendering/open-world/festival-crowd.ts';

const world = openWorld();
const structures = regionStructures(world);
const plan = architecturePlan(world, structures);
const p = trackPoint();
/** The renderer's ground query: road surface on a road, carved ground off it. */
const height = (x: number, z: number) => {
  const net = world.network,
    l = net.nearest(x, z, p),
    e = net.edges[net.edgeOf[net.lastSegment]];
  if (Math.abs(l) < e.spec.halfWidth + e.spec.shoulder)
    return net.surfaceHeight(p, l, e.spec.halfWidth, e.spec.crown);
  return carvedGroundHeight(world.carver, x, z);
};
/** Lateral clearance (m) of a point outside the nearest road's lanes. */
const outsideLanes = (x: number, z: number) => {
  const net = world.network,
    l = net.nearest(x, z, p),
    e = net.edges[net.edgeOf[net.lastSegment]];
  return Math.abs(l) - e.spec.halfWidth;
};

describe('festival dipped beam', () => {
  it('cuts off above the lamp horizontal and steps up on the kerb side', () => {
    // Hot spot just under the cut-off, glare-limited above it.
    expect(dippedBeamIntensity(-2, -1.5)).toBeGreaterThan(0.8);
    expect(dippedBeamIntensity(4, 0.5)).toBeLessThan(DIPPED_BEAM.glare * 1.2);
    expect(dippedBeamIntensity(4, 4)).toBeLessThan(DIPPED_BEAM.glare * 1.2);
    // Kerb side (left, negative azimuth) is lit higher than the oncoming side.
    expect(dippedBeamIntensity(-8, 0.3)).toBeGreaterThan(dippedBeamIntensity(8, 0.3) * 10);
    // Foreground pool below, nothing steeper than the reflector throws.
    expect(dippedBeamIntensity(0, -9)).toBeGreaterThan(0.25);
    expect(dippedBeamIntensity(0, -30)).toBeLessThan(0.01);
    const texture = dippedBeamTexture(32, 128);
    expect(texture.image.width).toBe(32);
    texture.dispose();
  });
  it('keeps a white van 7 m ahead under display white at the night exposure', () => {
    // Hot-spot illuminance on a vertical white panel (albedo 0.8) at 7 m,
    // through the festival night exposure (1.12) and ACES filmic.
    const radiance = ((DIPPED_BEAM.peak / 49) * 0.8) / Math.PI;
    const x = (radiance * 1.12) / 0.6;
    const aces = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    expect(aces).toBeLessThan(0.97);
    // Above the cut-off (the van's glasshouse) it is an order dimmer.
    expect(((radiance * DIPPED_BEAM.glare) / 1) * 1.12).toBeLessThan(0.05);
  });
});

describe('festival town life', () => {
  const signage = new FestivalSignage(world, structures, plan);
  const life = new FestivalTownLife(world, structures, plan, height, signage.lights, [
    ...signage.fixtures,
  ]);
  it('dresses the towns within a bounded budget', () => {
    const s = life.stats;
    expect(s.bicycles).toBeGreaterThan(150);
    expect(s.bollards).toBeGreaterThan(150);
    expect(s.fences).toBeGreaterThan(100);
    expect(s.signals).toBeGreaterThan(12);
    expect(s.manholes).toBeGreaterThan(100);
    expect(s.busStops).toBeGreaterThan(3);
    expect(s.coinParks).toBeGreaterThan(0);
    expect(s.spectators).toBeGreaterThan(10);
    expect(s.pools).toBeGreaterThan(500);
    expect(s.triangles).toBeLessThan(600_000);
  });
  it('stands nothing on a carriageway or inside a building', () => {
    const m = new T.Matrix4(),
      at = new T.Vector3();
    let checked = 0;
    life.root.traverse((node) => {
      if (!(node instanceof T.InstancedMesh)) return;
      for (let i = 0; i < node.count; i++) {
        node.getMatrixAt(i, m);
        // Spectators stand on their feet (bind space), the kit on its origin.
        if (node.name === 'Festival spectators') at.copy(SPECTATOR_FEET).applyMatrix4(m);
        else at.setFromMatrixPosition(m);
        expect(outsideLanes(at.x, at.z), node.name).toBeGreaterThan(0.1);
        expect(
          structures.some((s) => insideFootprint(s, at.x, at.z, 0)),
          node.name,
        ).toBe(false);
        expect(Math.abs(at.y - height(at.x, at.z))).toBeLessThan(0.05);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(1000);
  });
  it('culls by chunk and tier: LOW keeps signals only, pools only at night', () => {
    const camera = new T.PerspectiveCamera();
    camera.position.set(560, 7, -2600);
    const visible = (kind: string) =>
      life.root.children.filter((c) => c.visible && c.name.includes(kind)).length;
    life.update(camera, 0, 'low', 0);
    expect(life.root.children.filter((c) => c.visible && !c.name.includes('signals'))).toHaveLength(
      0,
    );
    life.update(camera, 0, 'medium', 0);
    expect(visible('bicycle')).toBeGreaterThan(0);
    expect(visible('light pools')).toBe(0);
    life.update(camera, 1, 'medium', 0);
    expect(visible('light pools')).toBeGreaterThan(0);
    camera.position.set(-3000, 50, 3000);
    life.update(camera, 1, 'ultra', 0);
    expect(life.root.children.filter((c) => c.visible)).toHaveLength(0);
    expect(TOWN_LIFE.range.medium).toBeLessThan(TOWN_LIFE.range.ultra);
  });
});

describe('festival parked cars', () => {
  const signage = new FestivalSignage(world, structures, plan);
  const life = new FestivalTownLife(world, structures, plan, height, signage.lights, []);
  const sites = parkedSites(
    world,
    structures,
    plan,
    resolveEvents(world),
    life.parkingBays,
    height,
  );
  it('parks in store lots, coin parks and the hub meet, off every carriageway', () => {
    expect(sites.filter((s) => s.name.startsWith('store'))).toHaveLength(2);
    expect(sites.some((s) => s.name.startsWith('coin park'))).toBe(true);
    const meet = sites.find((s) => s.name === 'Kestrel hub meet');
    expect(meet?.spots.length).toBeGreaterThan(10);
    let cars = 0;
    for (const site of sites)
      for (const spot of site.spots) {
        const shape = TRAFFIC_SHAPES[spot.body];
        expect(shape.length).toBeLessThan(5.1);
        // Each corner of the car clears the lanes and every building.
        for (const [a, b] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const s = Math.sin(spot.yaw),
            c = Math.cos(spot.yaw),
            lx = (a * shape.width) / 2,
            lz = (b * shape.length) / 2,
            x = spot.x + c * lx + s * lz,
            z = spot.z - s * lx + c * lz;
          expect(outsideLanes(x, z), site.name).toBeGreaterThan(0);
          expect(
            structures.some((st) => insideFootprint(st, x, z, 0)),
            site.name,
          ).toBe(false);
        }
        expect(Math.abs(spot.y - height(spot.x, spot.z))).toBeLessThan(0.1);
        cars++;
      }
    expect(cars).toBeGreaterThan(30);
    const parked = new ParkedCars(sites);
    expect(parked.stats.cars).toBe(cars);
    parked.update(new T.PerspectiveCamera(), 1, 300);
    parked.dispose();
  });
});

describe('festival temple site', () => {
  it('stands on level ground beside a road, gate facing it', () => {
    const temple = structures.find((s) => s.kind === 'chapel')!;
    const c = Math.cos(temple.heading),
      n = Math.sin(temple.heading);
    let low = Infinity,
      high = -Infinity;
    for (let a = -temple.hx; a <= temple.hx; a += 1)
      for (let b = -temple.hz; b <= temple.hz; b += 1) {
        const y = carvedGroundHeight(
          world.carver,
          temple.x + c * a - n * b,
          temple.z + n * a + c * b,
        );
        low = Math.min(low, y);
        high = Math.max(high, y);
      }
    expect(high - low).toBeLessThan(1.2);
    // The road runs along its long side within a few metres of the wall.
    const lateral = Math.abs(world.network.nearest(temple.x, temple.z, p));
    const e = world.network.edges[world.network.edgeOf[world.network.lastSegment]];
    expect(lateral - temple.hz - e.spec.halfWidth - e.spec.shoulder).toBeLessThan(6);
    expect(Math.abs(p.tx * c + p.tz * n)).toBeGreaterThan(0.95);
  });
});
