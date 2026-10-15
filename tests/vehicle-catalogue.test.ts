import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vehicleHash } from '../src/core/session-identity.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { validateVehicleDefinition } from '../src/simulation/content-validation.ts';
import { BASELINE } from '../src/simulation/vehicle-catalogue/builder.ts';
import {
  CATALOGUE,
  CATALOGUE_BANDS,
  CATALOGUE_BRIEFS,
} from '../src/simulation/vehicle-catalogue/index.ts';
import { classInfo, vehiclesByClass } from '../src/simulation/vehicle-classes.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import {
  FORMULA_APX01,
  TOURING_TC1,
  VEHICLES,
  VEHICLE_IDS,
  vehicleAt,
  vehicleIndex,
} from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

interface Report {
  vehicles: Record<
    string,
    {
      hash: string;
      comparison: {
        metric: string;
        within: boolean;
        coarseWithin: boolean;
        timestepDrift: number;
      }[];
      aero: { clA: number; cdA: number };
    }
  >;
}
const report = JSON.parse(readFileSync('docs/vehicle-calibration.json', 'utf8')) as Report;

describe('WP30 destination catalogue', () => {
  it('pins the shared baselines the builder cannot import', () => {
    expect(BASELINE.frontSpring).toBe(DEFAULT_SETUP.frontSpring);
    expect(BASELINE.rearSpring).toBe(DEFAULT_SETUP.rearSpring);
    expect(BASELINE.frontRide).toBe(DEFAULT_SETUP.frontRide);
    expect(BASELINE.rearRide).toBe(DEFAULT_SETUP.rearRide);
    expect(BASELINE.frontWing).toBe(DEFAULT_SETUP.frontWing);
    expect(BASELINE.rearWing).toBe(DEFAULT_SETUP.rearWing);
    expect(BASELINE.fuel).toBe(new Vehicle(0).fuel);
  });
  it('adds at least fourteen valid machines across the families', () => {
    const ids = Object.keys(CATALOGUE);
    expect(ids.length).toBeGreaterThanOrEqual(14);
    for (const def of Object.values(CATALOGUE)) {
      expect(validateVehicleDefinition(def), def.id).toEqual([]);
      expect(CATALOGUE_BRIEFS[def.id].length, def.id).toBeGreaterThan(80);
      expect(classInfo(def.classId).family).not.toBe('other');
    }
    const families = new Set(Object.values(CATALOGUE).map((d) => classInfo(d.classId).family));
    for (const f of [
      'formula',
      'historic',
      'prototype',
      'gt',
      'touring',
      'club',
      'rally',
      'rallycross',
      'offroad',
      'kart',
      'road',
    ])
      expect(families.has(f as never) || f === 'touring', f).toBe(true);
    const drivetrains = new Set(Object.values(VEHICLES).map((d) => d.drivetrain));
    expect([...drivetrains].sort()).toEqual(['awd', 'fwd', 'rwd']);
  });
  it('keeps APX-01 and TC-1 content identical and appends to the snapshot index', () => {
    // Content hashes from before the catalogue: records and replays stay valid.
    expect(vehicleHash(FORMULA_APX01)).toBe('eb95ef70');
    expect(vehicleHash(TOURING_TC1)).toBe('b2abb13d');
    expect(VEHICLE_IDS.slice(0, 2)).toEqual(['apx01', 'tc1']);
    expect(VEHICLE_IDS.slice(2)).toEqual(Object.keys(CATALOGUE));
    for (const id of VEHICLE_IDS) expect(vehicleAt(vehicleIndex(id)).id).toBe(id);
    const hashes = VEHICLE_IDS.map((id) => vehicleHash(VEHICLES[id]));
    expect(new Set(hashes).size).toBe(hashes.length);
  });
  it('derives wheel centres from weight distribution and placement from CG height', () => {
    for (const def of Object.values(CATALOGUE)) {
      const [fr, , rr] = def.wheelPositions;
      expect(fr[2] - rr[2]).toBeCloseTo(def.spec.wheelbase, 3);
      // Body origin is the centre of mass: it lies between the axles.
      expect(fr[2]).toBeGreaterThan(0);
      expect(rr[2]).toBeLessThan(0);
      expect(def.restHeight!).toBeGreaterThan(def.spec.wheelRadius * 0.9);
      expect(def.stations.floorY).toBeLessThan(0);
    }
  });
  it('records every machine inside its design bands at both timesteps', () => {
    // The only accepted exception predates the catalogue (APX-01 measures
    // 319.8 km/h against a 320 km/h floor; its physics must not change).
    const known = new Set(['apx01:topSpeed']);
    for (const id of VEHICLE_IDS) {
      const entry = report.vehicles[id];
      expect(entry, `${id} missing from docs/vehicle-calibration.json`).toBeDefined();
      expect(entry.hash, `${id} calibration is stale: run npm run test:vehicles`).toBe(
        vehicleHash(VEHICLES[id]),
      );
      for (const c of entry.comparison) {
        if (known.has(`${id}:${c.metric}`)) continue;
        expect(c.within && c.coarseWithin, `${id} ${c.metric}`).toBe(true);
        expect(c.timestepDrift, `${id} ${c.metric} drift`).toBeLessThan(0.1);
      }
      if (id in CATALOGUE_BANDS) expect(entry.comparison).toHaveLength(4);
    }
  });
  it('groups the registry by class for presentation', () => {
    const groups = vehiclesByClass(Object.values(VEHICLES));
    expect(groups[0].classId).toBe('formula');
    expect(groups.flatMap((g) => g.vehicles)).toHaveLength(VEHICLE_IDS.length);
    for (let i = 1; i < groups.length; i++)
      expect(groups[i].info.order).toBeGreaterThan(groups[i - 1].info.order);
  });
  it('drives a field of different catalogue machines without numerical failure', () => {
    const vehicles = ['gt10m', 'rl2', 'sk125', 'dx8'];
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 3, vehicles });
    sim.autoPlayer = true;
    const start = sim.cars.map((c) => c.s);
    for (let i = 0; i < 120 * 30; i++) sim.step(1 / 120);
    sim.cars.forEach((c, i) => {
      expect(c.retired, vehicles[i]).toBe(false);
      expect(Number.isFinite(c.body.position.x + c.body.position.y + c.body.position.z)).toBe(true);
      const travelled = (c.s - start[i] + sim.track.length) % sim.track.length;
      expect(
        travelled + sim.race.laps[i].completed * sim.track.length,
        vehicles[i],
      ).toBeGreaterThan(400);
    });
  }, 120000);
});
