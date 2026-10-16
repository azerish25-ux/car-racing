import { describe, expect, it } from 'vitest';
import { sessionIdentity, vehicleHash, recordCategory } from '../src/core/session-identity.ts';
import { BIKE_STATES } from '../src/simulation/bike.ts';
import {
  GP_R1,
  SBK_1000,
  chassisLean,
  dynamicLean,
  validateBikeDefinition,
} from '../src/simulation/bike-definitions.ts';
import { BikeVehicle, createVehicle } from '../src/simulation/bike-vehicle.ts';
import { BikeAIDriver } from '../src/simulation/bike-ai.ts';
import { DEFAULT_OPTIONS, validateOptions, type SessionOptions } from '../src/simulation/config.ts';
import { validateContent } from '../src/simulation/content-validation.ts';
import { EVENTS, eventSession, sessionIncompatibilities } from '../src/simulation/events.ts';
import {
  B,
  BIKE_BASE,
  BIKE_STRIDE,
  CAR_STRIDE,
  F,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
  snapshotIncompatibility,
} from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { VEHICLE_IDS, vehicleAt } from '../src/simulation/vehicles.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;
const bikeSession = (options: Partial<SessionOptions> = {}, vehicle = 'gpr1') => {
  const opponents = options.opponents ?? 0;
  return new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    opponents,
    vehicles: Array.from({ length: opponents + 1 }, () => vehicle),
    ...options,
  });
};
const bike = (sim: Simulation, id = 0) => sim.cars[id] as BikeVehicle;

describe('WP34 motorcycles in real sessions', () => {
  it('builds the bike adapter and bike AI for bike definitions only', () => {
    const sim = bikeSession({ opponents: 1 });
    expect(sim.cars[0]).toBeInstanceOf(BikeVehicle);
    expect(sim.ai[1]).toBeInstanceOf(BikeAIDriver);
    expect(
      createVehicle(0, 'medium', DEFAULT_OPTIONS.setup, 'sport', vehicleAt(0)),
    ).not.toBeInstanceOf(BikeVehicle);
    expect(createVehicle(0, 'medium', DEFAULT_OPTIONS.setup, 'sport', GP_R1)).toBeInstanceOf(
      Vehicle,
    );
    // Slim collision box, rider included in the mass, no hybrid store.
    expect(GP_R1.halfExtents[0]).toBeLessThan(0.4);
    expect(bike(sim).body.mass).toBeCloseTo(157 + 72 + GP_R1.bike!.fuel, 6);
    expect(bike(sim).battery).toBe(0);
  });
  it('laps a circuit under AI with lean, gears, tyre wear and valid timing', () => {
    const sim = bikeSession();
    sim.autoPlayer = true;
    let peakLean = 0,
      peakSpeed = 0,
      topGear = 0;
    for (let i = 0; i < 120 * 150; i++) {
      sim.step(DT);
      const b = bike(sim);
      peakLean = Math.max(peakLean, Math.abs(b.dynamics.lean));
      peakSpeed = Math.max(peakSpeed, b.speed);
      topGear = Math.max(topGear, b.gear);
    }
    const lap = sim.race.laps[0],
      b = bike(sim);
    expect(b.dynamics.crashes).toBe(0);
    expect(lap.completed).toBeGreaterThanOrEqual(2);
    expect(lap.best).toBeGreaterThan(55);
    expect(lap.best).toBeLessThan(72);
    expect(peakLean).toBeGreaterThan(0.6);
    expect(peakSpeed * 3.6).toBeGreaterThan(250);
    expect(topGear).toBeGreaterThanOrEqual(4);
    expect(b.tires[2].wear).toBeGreaterThan(0);
    expect(b.fuel).toBeLessThan(GP_R1.bike!.fuel);
  }, 60000);
  it('crash flows through race control: rider down, separation, remount, back on track', () => {
    const sim = bikeSession({ assist: 'raw' });
    sim.autoPlayer = true;
    for (let i = 0; i < 120 * 8; i++) sim.step(DT);
    const b = bike(sim);
    expect(b.speed).toBeGreaterThan(30);
    // The player asks for full lean and grabs the front brake with no aids.
    sim.autoPlayer = false;
    let crashed = false;
    for (let i = 0; i < 120 * 4 && !crashed; i++) {
      sim.setInput({ ...b.input, steer: 1, brake: 1, throttle: 0 });
      sim.step(DT);
      crashed = !b.riding;
    }
    expect(crashed).toBe(true);
    expect(b.dynamics.crashes).toBe(1);
    expect(sim.race.laps[0].valid).toBe(false);
    expect(sim.race.control.events.some((e) => e.code.startsWith('RIDER_DOWN'))).toBe(true);
    const states = new Set<string>();
    const frame = sim.makeFrame();
    let separatedRider = 0;
    for (let i = 0; i < 120 * 25 && !(states.has('remount') && b.riding); i++) {
      sim.setInput({ ...b.input, steer: 0, brake: 0, throttle: 1 });
      sim.step(DT);
      states.add(b.dynamics.state);
      if (b.dynamics.state === 'separated') {
        sim.writeFrame(frame);
        const o = carBase(0) + BIKE_BASE;
        separatedRider = Math.max(
          separatedRider,
          Math.hypot(
            frame[o + B.RIDER_X] - b.body.position.x,
            frame[o + B.RIDER_Z] - b.body.position.z,
          ),
        );
      }
    }
    expect([...states]).toEqual(expect.arrayContaining(['separated', 'remount', 'riding']));
    expect(b.riding).toBe(true);
    expect(separatedRider).toBeGreaterThan(0.5);
    // A momentarily unloaded/locked rear can have a high demand ratio, but
    // its last pre-crash sample must not heat the tyres through recovery.
    for (const tire of b.tires) {
      expect(tire.carcassTemp).toBeLessThan(140);
      expect(tire.surfaceTemp).toBeLessThan(160);
    }
    // Remounted on the racing surface, and it rides on.
    expect(Math.abs(b.lateral)).toBeLessThan(b.trackPosition.width);
    sim.autoPlayer = true;
    const s0 = sim.race.laps[0].distance;
    for (let i = 0; i < 120 * 10; i++) sim.step(DT);
    expect(sim.race.laps[0].distance - s0).toBeGreaterThan(300);
    expect(b.dynamics.crashes).toBe(1);
  }, 60000);
  it('a hard contact between bikes unseats a rider without non-finite state', () => {
    const sim = bikeSession({ opponents: 1 });
    const a = bike(sim, 0),
      other = bike(sim, 1),
      s = sim.track.length - 600;
    a.place(sim.track, s, 0);
    other.place(sim.track, s + 6, 0.1);
    a.dynamics.speed = 22;
    for (let i = 0; i < 120 * 2; i++) {
      sim.setInput({ ...a.input, throttle: 0.6, steer: 0, brake: 0 });
      sim.step(DT);
    }
    expect(a.dynamics.crashes + other.dynamics.crashes).toBeGreaterThan(0);
    for (const b of [a, other]) {
      expect(b.body.position.finite()).toBe(true);
      expect(Number.isFinite(b.dynamics.lean + b.dynamics.speed)).toBe(true);
    }
  });
  it('race control penalises a bike jump start like any entrant', () => {
    const sim = bikeSession({ mode: 'race', ruleset: 'gp-motorcycle', opponents: 1 });
    const b = bike(sim);
    for (let i = 0; i < 120 * 3; i++) {
      sim.setInput({ ...b.input, throttle: 1, brake: 0, steer: 0 });
      sim.step(DT);
    }
    expect(b.speed).toBeGreaterThan(0.8);
    expect(sim.race.laps[0].jumped).toBe(true);
    expect(sim.race.laps[0].penalty).toBe(5);
    expect(sim.race.control.events.some((e) => e.code === 'JUMP_START')).toBe(true);
  });
  it('rear brake is the secondary (clutch) input and decelerates on its own', () => {
    const run = (clutch: number) => {
      const sim = bikeSession({ assist: 'raw' });
      const b = bike(sim);
      b.dynamics.speed = 30;
      for (let i = 0; i < 60; i++) {
        sim.setInput({ ...b.input, throttle: 0, brake: 0, steer: 0, clutch });
        sim.step(DT);
      }
      return b;
    };
    const rolling = run(0),
      braking = run(1);
    expect(braking.rearBrake).toBe(1);
    expect(braking.dynamics.rearBrakeForce).toBeGreaterThan(500);
    expect(braking.dynamics.frontBrakeForce).toBe(0);
    expect(braking.speed).toBeLessThan(rolling.speed - 1.5);
  });
  it('services a bike in the pit lane and releases it', () => {
    const sim = bikeSession();
    sim.autoPlayer = true;
    for (let i = 0; i < 120 * 5; i++) sim.step(DT);
    sim.requestPit('soft');
    const b = bike(sim);
    let serviced = false;
    for (let i = 0; i < 120 * 160 && !(serviced && !b.inPit); i++) {
      sim.step(DT);
      if (b.pitStops > 0) serviced = true;
    }
    expect(serviced).toBe(true);
    expect(b.inPit).toBe(false);
    expect(b.tires[0].compound).toBe('soft');
    expect(b.tires[0].radius).toBe(GP_R1.bike!.frontWheelRadius);
    expect(b.dynamics.crashes).toBe(0);
  }, 60000);
});

describe('WP34 snapshot v12 bike block', () => {
  it('round-trips lean, steer, rider pose and loads; cars carry zeros', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 1,
      vehicles: ['gpr1', 'gpr1'],
    });
    sim.autoPlayer = true;
    for (let i = 0; i < 120 * 12; i++) sim.step(DT);
    const frame = sim.makeFrame(),
      b = bike(sim);
    expect(frame.length).toBe(HEADER + 2 * CAR_STRIDE);
    expect(snapshotIncompatibility(frame, undefined, VEHICLE_IDS.length)).toBeNull();
    const o = carBase(0),
      k = o + BIKE_BASE;
    expect(vehicleAt(frame[o + RACE_BASE + R.VEHICLE]).id).toBe('gpr1');
    expect(frame[k + B.LEAN]).toBeCloseTo(b.dynamics.lean, 5);
    expect(frame[k + B.STEER]).toBeCloseTo(b.dynamics.steer, 5);
    expect(frame[k + B.RIDER_OFFSET]).toBeCloseTo(b.dynamics.riderOffset, 5);
    expect(frame[k + B.FRONT_LOAD]).toBeCloseTo(b.dynamics.frontLoad, 1);
    expect(frame[k + B.FORK]).toBeCloseTo(b.fork, 5);
    expect(BIKE_STATES[frame[k + B.STATE]]).toBe('riding');
    // Front tyre in wheel slots 0/1, rear in 2/3, so wheel consumers still work.
    const wheel = (i: number) => o + WHEEL_BASE + i * WHEEL_STRIDE;
    expect(frame[wheel(0) + W.LOAD]).toBeCloseTo(frame[wheel(1) + W.LOAD], 3);
    expect(frame[wheel(0) + W.STEER]).toBeCloseTo(b.dynamics.steer, 5);
    expect(frame[wheel(2) + W.COMPRESSION]).toBeCloseTo(b.shock, 5);
    // The chassis quaternion carries the (tyre-profile) chassis lean.
    const q = b.body.orientation;
    expect(frame[o + F.QW]).toBeCloseTo(q.w, 5);
    expect(chassisLean(b.dynamics.lean, GP_R1.bike!)).toBeGreaterThanOrEqual(
      Math.abs(b.dynamics.lean) * Math.sign(b.dynamics.lean),
    );
    // A four-wheel entrant writes a zero bike block even into a reused buffer.
    const cars = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
    const reused = new Float32Array(HEADER + CAR_STRIDE).fill(7);
    cars.writeFrame(reused);
    expect([...reused.subarray(BIKE_BASE + HEADER, HEADER + BIKE_BASE + BIKE_STRIDE)]).toEqual(
      new Array(BIKE_STRIDE).fill(0),
    );
  }, 30000);
  it('rejects unknown vehicle indices and old layouts', () => {
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[12] = 1;
    expect(snapshotIncompatibility(frame, 11)).toMatch(/not supported/);
    frame[carBase(0) + RACE_BASE + R.VEHICLE] = VEHICLE_IDS.length + 3;
    expect(snapshotIncompatibility(frame, undefined, VEHICLE_IDS.length)).toMatch(
      /unknown vehicle/,
    );
  });
  it('chassis lean inverts to the dynamics lean (tyre crown geometry)', () => {
    for (const lean of [-0.9, -0.3, 0, 0.4, 0.95])
      expect(dynamicLean(chassisLean(lean, GP_R1.bike!), GP_R1.bike!)).toBeCloseTo(lean, 6);
    expect(chassisLean(0.85, GP_R1.bike!) - 0.85).toBeGreaterThan(0.08);
  });
});

describe('WP36 bike identity, rules and content', () => {
  it('gives every bike its own identity hash and record category', () => {
    expect(vehicleHash(GP_R1)).not.toBe(vehicleHash(SBK_1000));
    const id = sessionIdentity({
      ...DEFAULT_OPTIONS,
      ruleset: 'gp-motorcycle',
      opponents: 1,
      vehicles: ['gpr1', 'sbk1000'],
    });
    expect(id.vehicleHashes[0]).not.toBe(id.vehicleHashes[1]);
    expect(recordCategory({ circuit: 'aurel', vehicles: ['sbk1000'] }).vehicle).toBe('sbk1000');
  });
  it('rejects mixed car and bike grids, admits all-bike grids', () => {
    const mixed = validateOptions({
      ...DEFAULT_OPTIONS,
      ruleset: 'open-exhibition',
      opponents: 1,
      vehicles: ['apx01', 'gpr1'],
    });
    expect(sessionIncompatibilities(mixed).join(' ')).toMatch(/Cars and motorcycles cannot share/);
    const practice = validateOptions({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 1,
      vehicles: ['tc1', 'sbk1000'],
    });
    expect(sessionIncompatibilities(practice).join(' ')).toMatch(/cannot share a grid/);
    const formula = validateOptions({ ...DEFAULT_OPTIONS, opponents: 0, vehicles: ['gpr1'] });
    expect(sessionIncompatibilities(formula).join(' ')).toMatch(/not eligible for FORMULA/);
    const grid = validateOptions({
      ...DEFAULT_OPTIONS,
      ruleset: 'gp-motorcycle',
      opponents: 3,
      vehicles: ['gpr1', 'sbk1000', 'gpr1', 'sbk1000'],
    });
    expect(sessionIncompatibilities(grid)).toEqual([]);
    for (const mode of ['practice', 'qualifying', 'time-trial'] as const)
      expect(
        sessionIncompatibilities(
          validateOptions({ ...DEFAULT_OPTIONS, mode, opponents: 0, vehicles: ['gpr1'] }),
        ),
      ).toEqual([]);
    const event = EVENTS.find((e) => e.ruleset === 'gp-motorcycle')!;
    const session = eventSession(event, DEFAULT_OPTIONS);
    expect(session.vehicles?.every((v) => v === 'gpr1')).toBe(true);
  });
  it('validates bike content and names what is wrong', () => {
    expect(validateContent()).toEqual([]);
    const broken = {
      ...GP_R1,
      bike: { ...GP_R1.bike!, cgToFront: 0.2, maxLean: 2 },
      halfExtents: [0.9, 0.5, 1] as const,
    };
    const errors = validateBikeDefinition(broken).join('\n');
    expect(errors).toMatch(/cgToFront \+ cgToRear/);
    expect(errors).toMatch(/maxLean/);
    expect(errors).toMatch(/slim collision box/);
  });
});

describe('WP35 seeded AI bike race', () => {
  it('finishes a mixed GP/superbike race with bounded incidents and no stuck rider', () => {
    const vehicles = ['gpr1', 'sbk1000', 'gpr1', 'sbk1000', 'gpr1', 'sbk1000'];
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit: 'vellamar',
      mode: 'race',
      ruleset: 'gp-motorcycle',
      laps: 2,
      opponents: vehicles.length - 1,
      vehicles,
      seed: 3303,
    });
    sim.autoPlayer = true;
    const stopped = new Float64Array(vehicles.length);
    let longestStop = 0;
    for (let i = 0; i < 120 * 400 && sim.race.phase !== PHASE.FINISHED; i++) {
      sim.step(DT);
      if (sim.race.phase !== PHASE.RACING) continue;
      sim.cars.forEach((c, id) => {
        stopped[id] = c.speed < 1 && !c.finishTime && !c.inPit ? stopped[id] + DT : 0;
        longestStop = Math.max(longestStop, stopped[id]);
      });
    }
    expect(sim.race.phase).toBe(PHASE.FINISHED);
    const crashes = sim.cars.reduce((n, c) => n + (c as BikeVehicle).dynamics.crashes, 0);
    expect(crashes).toBeLessThanOrEqual(3);
    for (const c of sim.cars) {
      expect(c.retired).toBe(false);
      expect(c.finishTime).toBeGreaterThan(0);
      expect(sim.race.laps[c.id].completed).toBe(2);
    }
    // Nobody is ever parked: a crash costs seconds, not the race.
    expect(longestStop).toBeLessThan(20);
    // GP prototypes are quicker than superbikes over the same laps.
    const best = (id: number) => sim.race.laps[id].best || Infinity;
    const gp = Math.min(best(0), best(2), best(4)),
      sbk = Math.min(best(1), best(3), best(5));
    expect(gp).toBeLessThan(sbk);
  }, 120000);
});
