import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vehicleHash } from '../src/core/session-identity.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { validateVehicleDefinition } from '../src/simulation/content-validation.ts';
import { BIKE_ADDITIONS } from '../src/simulation/bike-definitions.ts';
import {
  CATALOGUE,
  CATALOGUE_BANDS,
  CATALOGUE_BRIEFS,
} from '../src/simulation/vehicle-catalogue/index.ts';
import { classInfo, VEHICLE_CLASSES } from '../src/simulation/vehicle-classes.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES, VEHICLE_IDS } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { BIKE_TARGETS } from '../scripts/bike-calibration.ts';
import { EVENTS, RULESETS } from '../src/simulation/events.ts';
import { CLASS_PRICES } from '../src/career/ladder.ts';
import { floorEnvelope } from '../src/simulation/ai.ts';
import { BASELINE } from '../src/simulation/vehicle-catalogue/builder.ts';
import { combustionTorque, EngineState } from '../src/simulation/powertrain.ts';
import { vehicleDynamics } from '../src/simulation/vehicle-dynamics.ts';
import {
  bandMargins,
  MIN_GROWTH_MARGIN,
  nearEdgeBlock,
  nearEdgeTable,
  PRE_GROWTH_IDS,
  type CalibrationReport,
} from '../scripts/calibration-margins.ts';

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
describe('calibration margins and trade-offs', () => {
  const metric = (id: string, name: string) =>
    report.vehicles[id].comparison.find((c) => c.metric === name)!.measured;
  it('keeps every growth machine clear of its band edges at both timesteps', () => {
    expect([...PRE_GROWTH_IDS]).toEqual(Object.keys(FROZEN));
    const frozen = new Set(PRE_GROWTH_IDS);
    for (const m of bandMargins(report as unknown as CalibrationReport)) {
      if (frozen.has(m.id)) continue;
      expect(m.margin, `${m.id} ${m.metric} ${m.edge}`).toBeGreaterThanOrEqual(MIN_GROWTH_MARGIN);
    }
  });
  it('publishes the near-edge list generated from the calibration report', () => {
    const doc = readFileSync('docs/production/CONTENT_PIPELINE.md', 'utf8');
    expect(nearEdgeBlock(doc)).toBe(
      nearEdgeTable(report as unknown as CalibrationReport, new Set(PRE_GROWTH_IDS)),
    );
  });
  it('keeps the road hot hatch below its racing counterpart in grip', () => {
    expect(metric('rh3', 'lateral80G')).toBeLessThan(metric('hh2', 'lateral80G'));
  });
  it('trades GP-R2 braking against GP-R1 launch and top speed', () => {
    expect(metric('gpr2', 'braking100Distance')).toBeLessThan(metric('gpr1', 'braking100Distance'));
    expect(metric('gpr2', 'topSpeed')).toBeLessThan(metric('gpr1', 'topSpeed'));
    expect(metric('gpr2', 'accel0to100')).toBeGreaterThan(metric('gpr1', 'accel0to100'));
  });
  it('simulates the turbo lag every brief claims', () => {
    const claimed: string[] = [];
    for (const [id, brief] of Object.entries(CATALOGUE_BRIEFS)) {
      if (!/turbo lag|turbo response|arrives late/i.test(brief)) continue;
      claimed.push(id);
      const def = VEHICLES[id],
        engine = vehicleDynamics(def).engine,
        rpm = def.spec.downshiftRPM + 500;
      expect(engine.turbo, id).not.toBeNull();
      // Lift, then a full-throttle step at a working engine speed: the boost
      // share arrives over the spool time, not at once.
      const steady = new EngineState();
      for (let i = 0; i < 400; i++) steady.advance(engine, 1, rpm, 0.01);
      const lagged = new EngineState();
      for (let i = 0; i < 400; i++) lagged.advance(engine, 0, rpm, 0.01);
      lagged.advance(engine, 1, rpm, 0.1);
      const omega = (rpm * Math.PI) / 30;
      const ratio =
        combustionTorque(engine, def.spec, lagged, rpm, omega) /
        combustionTorque(engine, def.spec, steady, rpm, omega);
      expect(ratio, id).toBeLessThan(0.85);
      expect(ratio, id).toBeGreaterThan(0.3);
    }
    expect(claimed.sort()).toEqual(['gb4', 'hf86', 'pr3', 'rr4']);
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
describe('XF-2 AI envelope with a damaged floor', () => {
  /** Mean deceleration (m/s²) of a full stop from 100 km/h at a floor health. */
  function stop(health: number) {
    const def = VEHICLES.xf2,
      dt = 1 / 240,
      v0 = 100 / 3.6;
    const track = new DynamicsTrack('runway');
    const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
    car.place(track, 0);
    car.input.brake = 1;
    for (let i = 0; i < 480; i++) car.step(dt, track);
    car.body.velocity.set(0, 0, v0);
    car.speed = v0;
    for (const tire of car.tires) tire.omega = v0 / tire.radius;
    car.gear = 2;
    car.clutch.engineOmega =
      (v0 / def.spec.wheelRadius) * def.spec.gearRatios[3] * def.spec.finalDrive;
    car.floorHealth = health;
    const z0 = car.body.position.z;
    for (let i = 0; i < 2400 && car.speed > 0.2; i++) car.step(dt, track);
    return (v0 * v0) / (2 * (car.body.position.z - z0));
  }
  it('plans braking inside what the car can do as the fan floor loses its seal', () => {
    const def = VEHICLES.xf2,
      v = 100 / 3.6;
    for (const health of [1, 0.25, 0.1]) {
      const env = floorEnvelope(def.ai, health);
      // The AI's downforce term and its damage scaling (ai.ts).
      const aero =
        ((0.45 + 0.55 * health) * env.downforceReference) /
        (def.spec.dryMass + (def.fuelLoad ?? BASELINE.fuel));
      const planned = (env.brakingBase + env.brakingAero * aero * v * v) * env.brakingMargin;
      expect(planned, `floor ${health}`).toBeLessThan(stop(health));
    }
    // An intact floor plans on the full fitted envelope; other cars are untouched.
    expect(floorEnvelope(def.ai, 1).brakingBase).toBeCloseTo(def.ai.brakingBase, 9);
    expect(floorEnvelope(VEHICLES.apx01.ai, 0.1)).toBe(VEHICLES.apx01.ai);
  }, 60000);
  it('takes the fan share of the envelope from the fan-off calibration fit', () => {
    const share = (
      report.vehicles.xf2 as unknown as { fanEnvelopeShare: { lateral: number; braking: number } }
    ).fanEnvelopeShare;
    expect(VEHICLES.xf2.ai.fanBase!.lateral).toBeCloseTo(share.lateral, 1);
    expect(VEHICLES.xf2.ai.fanBase!.braking).toBeCloseTo(share.braking, 1);
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
