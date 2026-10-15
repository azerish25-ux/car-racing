import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vehicleHash } from '../src/core/session-identity.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { validateVehicleDefinition } from '../src/simulation/content-validation.ts';
import { BIKE_ADDITIONS } from '../src/simulation/bike-definitions.ts';
import { CATALOGUE, CATALOGUE_BANDS } from '../src/simulation/vehicle-catalogue/index.ts';
import { classInfo, VEHICLE_CLASSES } from '../src/simulation/vehicle-classes.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES, VEHICLE_IDS } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { BIKE_TARGETS } from '../scripts/bike-calibration.ts';
import { EVENTS, RULESETS } from '../src/simulation/events.ts';
import { CLASS_PRICES } from '../src/career/ladder.ts';

/** Catalogue growth to the 48-model destination (CONTENT_PIPELINE.md §1.3,
 * §1.4): every machine validates, keeps a unique content hash, carries a
 * design brief and bands, and existing machines are bit-identical. */
const report = JSON.parse(readFileSync('docs/vehicle-calibration.json', 'utf8')) as {
  vehicles: Record<string, { hash: string; comparison: { metric: string; measured: number }[] }>;
};
/** Content hashes before the growth programme: records and replays of these
 * machines stay valid only while their definitions are untouched. */
const FROZEN: Readonly<Record<string, string>> = {
  apx01: 'eb95ef70',
  tc1: 'b2abb13d',
  gpr1: '9bdbbf3b',
  sbk1000: 'cb3f914d',
  jf2: 'a3c619ff',
  hf67: 'ceea2a89',
  hy9: '3f9538dd',
  pr2: 'e5131c47',
  gt8f: 'be481770',
  gt10m: 'c34be414',
  gs4: '057ce977',
  tc2: '2ab58890',
  cr1: '222c4adb',
  rl2: '1a36759d',
  rcx6: '54a04230',
  dx8: '6008b76e',
  sk125: '80898ca1',
  eh3: '4a82c15d',
  sc7: '253c52dd',
};
/** Off-road two-wheelers belong to the dirt-bike programme, not this catalogue. */
const DIRT_BIKE_CLASSES = new Set(['motocross', 'supermoto', 'enduro', 'supercross', 'dirt-bike']);
const roadMachines = Object.values(VEHICLES).filter((v) => !DIRT_BIKE_CLASSES.has(v.classId));
describe('catalogue growth (cars and road bikes)', () => {
  it('reaches the 48-model destination with valid, uniquely hashed machines', () => {
    expect(roadMachines.length).toBeGreaterThanOrEqual(48);
    for (const def of roadMachines) {
      expect(validateVehicleDefinition(def), def.id).toEqual([]);
      expect(classInfo(def.classId).family, def.id).not.toBe('other');
    }
    const hashes = VEHICLE_IDS.map((id) => vehicleHash(VEHICLES[id]));
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(new Set(roadMachines.map((d) => d.name)).size).toBe(roadMachines.length);
  });
  it('keeps every machine that existed before the growth bit-identical', () => {
    for (const [id, hash] of Object.entries(FROZEN))
      expect(vehicleHash(VEHICLES[id]), `${id} changed`).toBe(hash);
    // Appended after the existing registry: snapshot indices are unchanged.
    expect(VEHICLE_IDS.slice(0, Object.keys(FROZEN).length)).toEqual(Object.keys(FROZEN));
  });
  it('gives every catalogue machine and added bike a brief, bands and a calibration record', () => {
    for (const id of Object.keys(CATALOGUE)) expect(CATALOGUE_BANDS[id], id).toBeDefined();
    for (const id of Object.keys(BIKE_ADDITIONS)) expect(BIKE_TARGETS[id], id).toBeDefined();
    for (const def of roadMachines) {
      const entry = report.vehicles[def.id];
      expect(entry, `${def.id}: run npm run test:vehicles`).toBeDefined();
      expect(entry.comparison.length, def.id).toBe(4);
    }
  });
  it('registers every new class with a family, a price and a race ruleset or none', () => {
    for (const [id, info] of Object.entries(VEHICLE_CLASSES)) {
      expect(Object.hasOwn(CLASS_PRICES, id), `${id} has no career price`).toBe(true);
      if (!info!.raceRuleset) continue;
      expect(RULESETS[info!.raceRuleset], `${id} ruleset`).toBeDefined();
      expect(RULESETS[info!.raceRuleset].allowedClasses, id).toContain(id);
    }
    // Road-only classes have no circuit race.
    expect(classInfo('road').raceRuleset).toBeUndefined();
    expect(classInfo('road-bike').raceRuleset).toBeUndefined();
    // Every machine of a racing class appears in at least one built-in event.
    const entered = new Set(EVENTS.flatMap((e) => [e.vehicles].flat()));
    for (const def of roadMachines)
      if (classInfo(def.classId).raceRuleset) expect(entered.has(def.id), def.id).toBe(true);
  });
});
describe('fan-assisted floor (XF-2)', () => {
  it('holds the car down at rest and loses suction when the floor lifts', () => {
    const def = VEHICLES.xf2;
    expect(def.fan).toBeDefined();
    const track = new DynamicsTrack();
    const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
    car.place(track, 0);
    car.input.brake = 1;
    for (let i = 0; i < 480; i++) car.step(1 / 240, track);
    // Speed-independent: full suction while parked on the seal.
    expect(car.speed).toBeLessThan(0.5);
    expect(car.fanForce).toBeGreaterThan(def.fan!.force * 0.9);
    // Lift the car well above the seal: the skirts leak, suction is gone.
    car.body.position.y += 0.2;
    car.step(1 / 240, track);
    car.step(1 / 240, track);
    expect(car.fanForce).toBeLessThan(def.fan!.force * 0.2);
    // No other machine carries a fan.
    expect(
      Object.values(VEHICLES)
        .filter((v) => v.fan)
        .map((v) => v.id),
    ).toEqual(['xf2']);
  });
});
describe('new machines on track', () => {
  it('drives a field of the new chassis types without numerical failure', () => {
    const vehicles = ['xf2', 'bg2', 'dk100', 'rp6'];
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
      ).toBeGreaterThan(300);
    });
  }, 120000);
});
