import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  CHARLOTTETOWN,
  CHARLOTTETOWN_ROUTE,
  CHARLOTTETOWN_STATIONS,
  CHARLOTTETOWN_SOURCE,
  CHARLOTTETOWN_EVENT,
} from '../src/simulation/open-world/charlottetown/region.ts';
import {
  geographicToWorld,
  worldToGeographic,
  CHARLOTTETOWN_ORIGIN,
} from '../src/simulation/open-world/charlottetown/projection.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { resolveEvents } from '../src/simulation/open-world/festival-events.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { samplePolyline } from '../src/simulation/open-world/road-network.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { regionStructures, insideFootprint } from '../src/simulation/open-world/placement.ts';
import { controls } from '../src/simulation/config.ts';
import { charlottetownVehicle } from '../src/ui/charlottetown-map.ts';
import { festivalMachineChoice } from '../src/session/festival-save.ts';
import { festivalSaveKey, worldRegion } from '../src/simulation/open-world/regions.ts';
import { SurveyCity } from '../src/rendering/open-world/charlottetown/city.ts';
import { clearCameraBoom } from '../src/rendering/open-world/camera-clearance.ts';
import { worldToMap, mapToWorld } from '../src/ui/festival-map.ts';
const world = openWorld(CHARLOTTETOWN),
  events = resolveEvents(world);
const campus = events.find((e) => e.spec.id === CHARLOTTETOWN_EVENT)!;

describe('Charlottetown geographic source and route', () => {
  it('retains 62 route vertices, 100 stations and explicit non-photographic provenance', () => {
    expect(CHARLOTTETOWN_ROUTE).toHaveLength(62);
    expect(CHARLOTTETOWN_STATIONS).toHaveLength(100);
    expect(new Set(CHARLOTTETOWN_STATIONS.map((s) => `${s.x}:${s.z}`)).size).toBe(100);
    expect(CHARLOTTETOWN_SOURCE).toMatchObject({
      license: 'ODbL-1.0',
      imageryUsed: false,
      facadesVerified: false,
      elevationVerified: false,
    });
    expect(CHARLOTTETOWN_SOURCE.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('projects geographic metres without mirroring east and west', () => {
    const { longitude: lon, latitude: lat } = CHARLOTTETOWN_ORIGIN;
    const origin = geographicToWorld(lon, lat);
    expect(origin[0]).toBeCloseTo(0);
    expect(origin[1]).toBeCloseTo(0);
    const east = geographicToWorld(lon + 0.001, lat),
      north = geographicToWorld(lon, lat + 0.001);
    expect(east[0]).toBeLessThan(-76);
    expect(east[0]).toBeGreaterThan(-78);
    expect(north[1]).toBeGreaterThan(111);
    const round = worldToGeographic(...east);
    expect(round[0]).toBeCloseTo(lon + 0.001, 9);
    expect(round[1]).toBeCloseTo(lat, 9);
    expect(worldToMap(east[0], east[1], 1152)[0]).toBeGreaterThan(worldToMap(0, 0, 1152)[0]);
    expect(mapToWorld(...worldToMap(...east, 1152), 1152)[0]).toBeCloseTo(east[0], 7);
  });
  it('subdivides measured chords without spline overshoot and handles duplicate starts', () => {
    const result = samplePolyline(
      [
        [0, 0],
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      3,
    );
    expect(result.length).toBe(20);
    expect(result.xs[0]).toBe(0);
    expect(result.zs.at(-1)).toBe(10);
    for (let i = 0; i < result.xs.length; i++)
      expect(result.zs[i] === 0 || result.xs[i] === 10).toBe(true);
  });
  it('follows the four named streets without a phantom closing road or routing loops', () => {
    expect(campus.path.closed).toBe(false);
    expect(campus.path.length).toBeGreaterThan(1704);
    expect(campus.path.length).toBeLessThan(1708);
    const names = new Set(Array.from(campus.path.edge, (e) => world.network.edges[e].road.name));
    expect([...names]).toEqual(['Maloney Drive', 'Queen Street', 'Kent Street', 'Weymouth Street']);
    // OSRM coordinates were rounded; the current OSM centreline is within one metre.
    const a = campus.path.at(0, pathPoint()),
      b = campus.path.at(campus.path.length, pathPoint());
    expect(
      Math.hypot(a.x - CHARLOTTETOWN_ROUTE[0][0], a.z - CHARLOTTETOWN_ROUTE[0][1]),
    ).toBeLessThan(1);
    expect(
      Math.hypot(b.x - CHARLOTTETOWN_ROUTE.at(-1)![0], b.z - CHARLOTTETOWN_ROUTE.at(-1)![1]),
    ).toBeLessThan(1);
    expect(campus.path.length - campus.distance).toBeCloseTo(1, 6);
    const reverse = events.find((e) => e.spec.id === 'charlottetown-return')!;
    expect(reverse.path.length).toBeCloseTo(campus.path.length, 1);
  });
  it('keeps every inspection station on the route', () => {
    for (const [i, s] of CHARLOTTETOWN_STATIONS.entries()) {
      const out = { lateral: 0, distance: 0 };
      campus.path.locate(s.x, s.z, (campus.path.length * i) / 99, 40, out);
      expect(out.distance).toBeLessThan(1);
    }
  });
  it('retains actual campus geometry and labels estimates instead of inventing survey heights', () => {
    const survey = CHARLOTTETOWN.survey!;
    expect(survey.buildings).toHaveLength(836);
    expect(survey.trees).toHaveLength(130);
    const campus = survey.buildings.find((b) => b.id === 'osm-way-28344710')!;
    expect(campus.tags.operator).toMatch(/Holland/);
    expect(campus.footprint.length).toBeGreaterThan(60);
    for (const b of survey.buildings) {
      expect(b.height).toBeGreaterThan(0);
      expect(b.footprint.length).toBeGreaterThan(2);
      expect(['osm-height', 'osm-levels-estimate', 'estimated']).toContain(b.heightSource);
    }
    expect(world.field.height(0, 0)).toBe(12);
    expect(Math.abs(world.field.height(0, 500) - 12)).toBeLessThan(2);
  });
  it('uses separate save keys and never changes the original festival default', () => {
    expect(worldRegion(undefined).id).toBe('solvane');
    expect(worldRegion('charlottetown')).toBe(CHARLOTTETOWN);
    expect(festivalSaveKey('charlottetown')).not.toBe(festivalSaveKey('solvane'));
  });
});

describe('Charlottetown machine and playable event integration', () => {
  it.each([
    ['formula', 'apx01'],
    ['motogp', 'gpr1'],
    ['horizon', 'sc7'],
  ] as const)('selects the actual %s machine without a saved-road-car fallback', (mode, id) => {
    expect(charlottetownVehicle(mode)).toBe(id);
    expect(festivalMachineChoice({ vehicle: id, explicitFormula: true }, 'rh3').drive).toBe(id);
  });
  it.each(['apx01', 'gpr1', 'sc7'])(
    'drives %s on the real route and reaches the campus finish under production physics',
    (vehicle) => {
      const sim = new OpenWorldSimulation({
        region: CHARLOTTETOWN,
        vehicle,
        traffic: false,
        tileBudget: 24,
      });
      const before = { ...sim.player.body.position };
      sim.setInput({ ...controls(), throttle: 0.5 });
      for (let i = 0; i < 360; i++) sim.step(1 / 120);
      expect(sim.player.speed).toBeGreaterThan(5);
      expect(sim.player.up.y).toBeGreaterThan(0.95);
      expect(
        Math.hypot(sim.player.body.position.x - before.x, sim.player.body.position.z - before.z),
      ).toBeGreaterThan(8);
      expect(sim.status().road.name).toBe('Maloney Drive');
      sim.command({ type: 'autopilot', value: true });
      sim.command({ type: 'start', event: CHARLOTTETOWN_EVENT });
      let result = null;
      for (let i = 0; i < 240 * 120; i++) {
        sim.step(1 / 120);
        result = sim.takeResult();
        if (result) break;
      }
      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        regionId: 'charlottetown',
        vehicleId: vehicle,
        completed: true,
        abandoned: false,
        assisted: true,
      });
      expect(result!.offRouteSeconds).toBeLessThan(1);
      expect(result!.legalDistance).toBeGreaterThan(1700);
      expect(sim.status().road.name).toBe('Weymouth Street');
      expect(sim.status().streaming.resident).toBeLessThanOrEqual(24);
      sim.command({ type: 'continue' });
      expect(sim.status().mode).toBe('free');
      sim.command({ type: 'reset' });
      expect(sim.player.definition.id).toBe(vehicle);
    },
    60000,
  );
});

describe('Charlottetown scene and collision agreement', () => {
  it('collides with geographic concave footprints rather than invisible bounding-box yards', () => {
    const base = regionStructures(world)[0];
    const building = {
      ...base,
      x: 2,
      z: 2,
      hx: 2,
      hz: 2,
      heading: 0,
      base: 0,
      height: 8,
      footprint: [
        [0, 0],
        [4, 0],
        [4, 1],
        [1, 1],
        [1, 4],
        [0, 4],
      ] as const,
    };
    expect(insideFootprint(building, 2, 2)).toBe(false);
    expect(insideFootprint(building, 0.5, 2)).toBe(true);
    const out = { x: 0, y: 0, z: 0 };
    expect(clearCameraBoom({ x: 2, y: 2, z: 2 }, { x: 3, y: 2, z: 3 }, [building], out)).toBe(
      false,
    );
    expect(clearCameraBoom({ x: 2, y: 2, z: 2 }, { x: -2, y: 2, z: 2 }, [building], out)).toBe(
      true,
    );
    expect(out.x).toBeGreaterThan(1);
  });
  it('builds bounded, finite, disposable procedural geometry without DOM or external textures', () => {
    const city = new SurveyCity(world);
    expect(city.stats.buildings).toBe(836);
    expect(city.stats.windows).toBeGreaterThan(20000);
    expect(city.stats.triangles).toBeLessThan(1000000);
    expect(city.chunks.length).toBeLessThan(100);
    city.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        expect(o.geometry.boundingSphere!.radius).toBeGreaterThan(0);
        const a = o.geometry.getAttribute('position').array;
        for (const v of a) if (!Number.isFinite(v)) throw Error('Non-finite geographic vertex');
      }
    });
    const camera = new T.PerspectiveCamera();
    camera.position.set(...([0, 20, 0] as [number, number, number]));
    city.update(camera, 'high', 1, 0.8);
    expect(city.palette.materials.litGlass.emissiveIntensity).toBeGreaterThan(0.5);
    expect(city.palette.materials.asphalt.roughness).toBeLessThan(0.5);
    city.dispose();
    expect(city.root.children).toHaveLength(0);
  });
});
