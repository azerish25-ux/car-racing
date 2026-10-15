import { describe, it, expect } from 'vitest';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { AUREL, VELLAMAR, circuitDefinition, CIRCUIT_IDS } from '../src/simulation/circuits.ts';
import { validateOptions, DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { TAU } from '../src/core/math.ts';
import { terrainFor, vellamarCoastZ } from '../src/rendering/terrain.ts';
import { venuePlan, AUREL_VENUE, VELLAMAR_VENUE } from '../src/rendering/venue-plan.ts';
import { serviceSitePlan } from '../src/rendering/venue-service-plan.ts';
import { districtPlan } from '../src/rendering/venue-districts.ts';
import { landmarkSitePlan } from '../src/rendering/venue-landmark.ts';
import { grovePlan, vegetationPlan } from '../src/rendering/landscape.ts';
import { GRANDSTANDS } from '../src/rendering/grandstand.ts';
import { CIRCUIT_MENU_LABELS, minimapFrame } from '../src/ui/interface.ts';

describe('circuit definitions', () => {
  it('keeps Aurel byte-identical to its original analytic profile', () => {
    const track = new Track();
    expect(track.circuit).toBe(AUREL);
    for (const p of track.points.slice(0, -1)) {
      const theta = (p.s / track.length) * TAU;
      expect(p.y).toBe(1.5 * Math.sin(theta) + 0.65 * Math.sin(3 * theta));
      expect(p.bank).toBe(0.018 * Math.sin(2 * theta));
      expect(p.width).toBe(8 + 0.6 * Math.sin(theta) ** 2);
      expect(p.gradient).toBe(
        ((1.5 * Math.cos(theta) + 1.95 * Math.cos(3 * theta)) * TAU) / track.length,
      );
    }
    expect(venuePlan(track)).toBe(AUREL_VENUE);
    expect(GRANDSTANDS).toBe(AUREL_VENUE.grandstands);
  });
  it('builds Vellamar as a closed 4.00 km coastal-mountain lap on the shared paddock template', () => {
    const track = new Track('clear', false, undefined, VELLAMAR);
    expect(track.length).toBeGreaterThan(3950);
    expect(track.length).toBeLessThan(4050);
    const first = track.points[0],
      last = track.points.at(-1)!;
    expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeLessThan(1e-9);
    let low = Infinity,
      high = -Infinity;
    for (const p of track.points) {
      low = Math.min(low, p.y);
      high = Math.max(high, p.y);
      expect(Math.abs(p.gradient)).toBeLessThan(0.08);
      expect(Math.abs(p.bank)).toBeLessThanOrEqual(VELLAMAR.maxBank + 1e-12);
      expect(p.width).toBeGreaterThanOrEqual(7.6);
      expect(p.width).toBeLessThanOrEqual(8.1);
      // Pit/grid template: gentle straight over [L - 250, 350].
      if (p.s > track.length - 250 || p.s < 350) {
        expect(Math.abs(p.curvature)).toBeLessThan(1 / 200);
        expect(Math.abs(p.y - 2)).toBeLessThan(0.6);
      }
    }
    expect(high - low).toBeGreaterThan(38);
    // Authored banking actually exists in the sweeps.
    const banked = track.points.filter((p) => Math.abs(p.bank) > 0.06).length;
    expect(banked).toBeGreaterThan(20);
    // Non-adjacent sections keep a clear infield (no overlapping scenery corridors).
    const pts = track.points;
    let clearance = Infinity;
    for (let i = 0; i < pts.length; i += 6)
      for (let j = i + 6; j < pts.length; j += 6) {
        const ds = Math.min(Math.abs(pts[i].s - pts[j].s), track.length - Math.abs(pts[i].s - pts[j].s));
        if (ds < 160) continue;
        clearance = Math.min(clearance, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
      }
    expect(clearance).toBeGreaterThan(90);
  });
  it('validates the circuit option and defaults unknown values to Aurel', () => {
    expect(validateOptions({ ...DEFAULT_OPTIONS }).circuit).toBe('aurel');
    expect(validateOptions({ ...DEFAULT_OPTIONS, circuit: 'vellamar' }).circuit).toBe('vellamar');
    expect(validateOptions({ ...DEFAULT_OPTIONS, circuit: 'toString' }).circuit).toBe('aurel');
    expect(circuitDefinition('nope')).toBe(AUREL);
    // Aurel and Vellamar lead the registry; catalogue layouts follow (WP29).
    expect(CIRCUIT_IDS.slice(0, 2)).toEqual(['aurel', 'vellamar']);
    expect(new Set(CIRCUIT_IDS).size).toBe(CIRCUIT_IDS.length);
  });
  it('labels the menu with the real lap lengths', () => {
    for (const id of CIRCUIT_IDS) {
      const km = new Track('clear', false, undefined, circuitDefinition(id)).length / 1000;
      expect(CIRCUIT_MENU_LABELS[id]).toContain(`${km.toFixed(2)} km`);
    }
  });
  it('keeps Aurel on its original minimap scale and fits Vellamar inside the map', () => {
    expect(minimapFrame(new Track())).toEqual({ cx: 0, cz: 0, scale: 0.24 });
    const track = new Track('clear', false, undefined, VELLAMAR),
      frame = minimapFrame(track);
    for (const p of track.points) {
      const x = 125 + (p.x - frame.cx) * frame.scale,
        z = 125 - (p.z - frame.cz) * frame.scale * (0.23 / 0.24);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(250);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(240);
    }
  });
  it('drives the production simulation on Vellamar with finite state', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: 'vellamar', opponents: 3 });
    expect(sim.track.circuit).toBe(VELLAMAR);
    sim.autoPlayer = true;
    for (let i = 0; i < 120 * 20; i++) sim.step(1 / 120);
    for (const car of sim.cars) {
      expect(car.body.position.finite()).toBe(true);
      expect(car.speed).toBeGreaterThan(5);
    }
  });
});

describe('Vellamar venue and terrain', () => {
  const track = new Track('clear', false, undefined, VELLAMAR);
  const terrain = terrainFor(track);
  it('keeps terrain below the road and apron, with sea south of the coast and mountains inland', () => {
    const p = trackPoint();
    for (let s = 0; s < track.length; s += 23) {
      track.at(s, p);
      expect(terrain.height(p.x, p.z)).toBeLessThan(p.y - 0.9);
    }
    expect(terrain.seaLevel).toBe(0);
    for (const x of [-400, 0, 400]) {
      expect(terrain.height(x, vellamarCoastZ(x) - 120)).toBeLessThan(-2);
      expect(terrain.height(x, 1600)).toBeGreaterThan(80);
    }
  });
  it('resolves every authored site clear of the circuit and above the waterline', () => {
    expect(venuePlan(track)).toBe(VELLAMAR_VENUE);
    const services = serviceSitePlan(track);
    expect(services.map((site) => [site.s, site.side])).toEqual(
      VELLAMAR_VENUE.serviceZones.map((zone) => [zone.s, zone.side]),
    );
    const districts = districtPlan(track, services);
    expect(districts.map((d) => d.id)).toEqual(VELLAMAR_VENUE.districts.map((d) => d.id));
    for (const d of districts) expect(d.clearance).toBeGreaterThanOrEqual(25);
    const lighthouse = landmarkSitePlan(track, services, districts);
    expect(lighthouse.clearance).toBeGreaterThanOrEqual(40);
    expect(terrain.height(lighthouse.x, lighthouse.z)).toBeGreaterThan(1.5);
    const near = vegetationPlan(track);
    const { groves, treeline } = grovePlan(track);
    expect(near.length).toBeGreaterThan(400);
    expect(groves.length).toBeGreaterThan(250);
    for (const tree of [...groves, ...treeline])
      expect(terrain.height(tree.x, tree.z)).toBeGreaterThanOrEqual(0.6);
  });
});

import manifest from '../src/rendering/pit-building-frontage.manifest.json' with { type: 'json' };
import { pitBuildingLayout } from '../src/rendering/pit-building-layout.ts';
import { A21_BAY_TOLERANCE } from '../src/rendering/pit-building-frontage.ts';
describe('shared paddock template', () => {
  const deviation = (track: Track) => {
    let position = 0,
      yaw = 0;
    pitBuildingLayout(track).forEach((site, i) =>
      site.bays.forEach((a, b) => {
        const e = manifest.layout[i].bays[b];
        position = Math.max(position, Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z));
        yaw = Math.max(yaw, Math.abs(e.yaw - a.yaw));
      }),
    );
    return { position, yaw };
  };
  it('places the authored A21 frontage exactly on Aurel and rigidly within tolerance on Vellamar', () => {
    const aurel = deviation(new Track());
    expect(aurel.position).toBeLessThan(1e-4);
    expect(aurel.yaw).toBeLessThan(1e-4);
    const vellamar = deviation(new Track('clear', false, undefined, VELLAMAR));
    expect(vellamar.position).toBeLessThanOrEqual(A21_BAY_TOLERANCE.position);
    expect(vellamar.yaw).toBeLessThanOrEqual(A21_BAY_TOLERANCE.yaw);
  });
});

import * as T from 'three';
import { installShoreline, shoreWeight } from '../src/rendering/sea.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';
describe('Vellamar shoreline', () => {
  it('limits the beach band to the seaward strip', () => {
    expect(shoreWeight(-500, -420)).toBe(1);
    expect(shoreWeight(-420 + 60, -420)).toBe(1);
    expect(shoreWeight(-420 + 100, -420)).toBeCloseTo(0.5, 6);
    expect(shoreWeight(-420 + 140, -420)).toBe(0);
    expect(shoreWeight(0, -420)).toBe(0);
  });
  it('composes after the terrain finish and extends its program key', () => {
    const material = new T.MeshStandardMaterial();
    installCircuitFinish(material, 'terrain');
    const inland = material.customProgramCacheKey();
    installShoreline(material, 0);
    expect(material.customProgramCacheKey()).toBe(`${inland}:shoreline-v1:0`);
    const shader = {
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
      uniforms: {},
    } as unknown as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    const f = shader.fragmentShader;
    expect(shader.vertexShader).toContain('attribute float shore;');
    // Terrain finish first, shoreline after it, both before lighting.
    expect(f.indexOf('float dryLand')).toBeGreaterThan(0);
    expect(f.indexOf('float beach')).toBeGreaterThan(f.indexOf('float dryLand'));
    expect(f.indexOf('float beach')).toBeLessThan(f.indexOf('#include <lights_fragment_begin>'));
  });
});
