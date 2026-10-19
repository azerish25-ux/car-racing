import { describe, expect, it } from 'vitest';
import { clamp } from '../src/core/math.ts';
import { InputLog, Resimulation } from '../src/core/flashback.ts';
import { controls, DEFAULT_OPTIONS, DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/ai.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { wheelPickupImpulse } from '../src/simulation/offroad/wheel-pickup.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 240;

/** A production surveyed takeoff. Only the rider's controls and initial
 * road speed are provided; no private method or invented contact is used. */
function launch(definition: VehicleDefinition = MX_450, assist: Assist = 'raw', ai = false) {
  const track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find((j) => j.name === 'RIDGE TABLE')!,
    speed = jumpHoldSpeed(jump),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
  bike.place(track, jump.start - 12);
  bike.dynamics.speed = speed;
  bike.aiControlled(1e6);
  for (let g = 1; g < definition.spec.gearRatios.length - 1; g++) {
    bike.gear = g;
    const rpm =
      ((speed / definition.spec.wheelRadius) *
        definition.spec.gearRatios[g + 1] *
        definition.spec.finalDrive *
        30) /
      Math.PI;
    if (rpm < definition.spec.shiftRPM * 0.85) break;
  }
  for (let i = 0; i < 6 / DT; i++) {
    if (!bike.airborne)
      rideLine(
        bike,
        track,
        bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
          ? Math.max(speed, bike.dynamics.speed)
          : speed,
      );
    bike.step(DT, track);
    if (bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      if (!ai) bike.aiControlled(0);
      Object.assign(bike.input, controls());
      return { bike, track };
    }
  }
  throw new Error('Surveyed RIDGE TABLE takeoff was not reached');
}

function airInputs(bike: DirtBikeVehicle, tapSeconds: number) {
  const wanted =
    (bike.landingTarget + 0.1 - bike.pitch - bike.riderBody * 0.06) /
      Math.max(0.12, bike.landingIn) -
    bike.pitchRate;
  return {
    ...controls(),
    throttle: clamp(wanted * 1.2, 0, 1),
    clutch: clamp(-wanted * 1.2, 0, 1),
    brake: Number(bike.airTime > 0.2 && bike.airTime < 0.2 + tapSeconds),
  };
}

function land(run: ReturnType<typeof launch>, tapSeconds = 0.4, dt = DT) {
  const bike = run.bike;
  while (bike.airborne && bike.airTime < 4) {
    Object.assign(bike.input, airInputs(bike, tapSeconds));
    bike.step(dt, run.track);
  }
  expect(bike.airborne).toBe(false);
  expect(bike.lastLanding!.airTime).toBeGreaterThan(0.8);
  Object.assign(bike.input, controls());
  return run;
}

describe('passive wheel contact impulse', () => {
  it('exchanges rim/chassis momentum, reduces slip and never adds kinetic energy', () => {
    for (const definition of [MX_250, MX_450])
      for (const front of [true, false])
        for (const speed of [0, 3, 12, 30])
          for (const rimSpeed of [0, 4, 12, 36])
            for (const budget of [0, 1, 10, 1e6]) {
              const radius = front
                  ? definition.bike!.frontWheelRadius
                  : definition.bike!.rearWheelRadius,
                inertia = front
                  ? definition.spec.wheelInertia
                  : definition.bike!.offroad!.spinInertia,
                mass = definition.spec.dryMass,
                spin = rimSpeed / radius,
                impulse = wheelPickupImpulse(speed, spin, radius, inertia, mass, budget),
                nextSpeed = speed + impulse / mass,
                nextSpin = spin - (impulse * radius) / inertia,
                beforeEnergy = 0.5 * mass * speed ** 2 + 0.5 * inertia * spin ** 2,
                afterEnergy = 0.5 * mass * nextSpeed ** 2 + 0.5 * inertia * nextSpin ** 2,
                beforeMomentum = mass * speed + (inertia * spin) / radius,
                afterMomentum = mass * nextSpeed + (inertia * nextSpin) / radius;
              expect(afterEnergy).toBeLessThanOrEqual(beforeEnergy + 1e-8);
              expect(afterMomentum).toBeCloseTo(beforeMomentum, 9);
              expect(Math.abs(nextSpin * radius - nextSpeed)).toBeLessThanOrEqual(
                Math.abs(rimSpeed - speed) + 1e-10,
              );
              expect(Math.abs(impulse)).toBeLessThanOrEqual(budget);
              expect(nextSpeed).toBeGreaterThanOrEqual(-1e-10);
              expect(nextSpin).toBeGreaterThanOrEqual(-1e-10);
            }
  });

  it('cannot couple a wheel without contact budget or a rolling wheel without mismatch', () => {
    expect(wheelPickupImpulse(20, 0, 0.355, 0.7, 184.5, 0)).toBe(0);
    expect(wheelPickupImpulse(20, 20 / 0.355, 0.355, 0.7, 184.5, 40)).toBe(0);
    expect(() => wheelPickupImpulse(20, NaN, 0.355, 0.7, 184.5, 4)).toThrow(RangeError);
    expect(() => wheelPickupImpulse(20, 0, 0.355, 0, 184.5, 4)).toThrow(RangeError);
  });

  it('uses finite grip over time and converges to the same rolling state at different substeps', () => {
    const run = (dt: number, force: number) => {
      let speed = 20,
        spin = 0;
      for (let i = 0; i < Math.round(0.4 / dt); i++) {
        const impulse = wheelPickupImpulse(speed, spin, 0.355, 0.7, 184.5, force * dt);
        speed += impulse / 184.5;
        spin -= (impulse * 0.355) / 0.7;
      }
      return { speed, spin, slip: speed - spin * 0.355 };
    };
    const full = run(1 / 240, 800),
      light = run(1 / 240, 80);
    expect(Math.abs(full.slip)).toBeLessThan(1e-9);
    expect(light.slip).toBeGreaterThan(10);
    expect(full.speed).toBeLessThan(20);
    expect(full.speed).toBeGreaterThan(19);
    for (const dt of [1 / 120, 1 / 480]) {
      expect(run(dt, 800).speed).toBeCloseTo(full.speed, 10);
      expect(run(dt, 800).spin).toBeCloseTo(full.spin, 10);
    }
  });
});

describe('motocross wheel pickup on actual surveyed landings', () => {
  it.each([MX_250, MX_450])(
    '$id retains stopped front-wheel rotation through touchdown and picks it up only under load',
    (definition) => {
      const run = land(launch(definition)),
        { bike, track } = run;
      expect(bike.frontSpin).toBe(0);
      expect(bike.tires[0].omega).toBe(0);
      expect(bike.tires[0].slip).toBe(1);
      expect(bike.dynamics.speed).toBeGreaterThan(8);
      let unloaded = 0,
        pickup = 0,
        largestStep = 0,
        timeToRolling = 0;
      for (let i = 0; i < 0.3 / DT; i++) {
        const beforeSpin = bike.frontSpin,
          previousLoad = bike.forceFront;
        bike.step(DT, track);
        if (previousLoad === 0 && bike.tires[0].slip > 0) {
          expect(bike.frontSpin).toBe(beforeSpin);
          unloaded++;
        }
        if (bike.tires[0].fx < -1 && bike.tires[0].slip > 0) pickup++;
        largestStep = Math.max(largestStep, Math.abs(bike.tires[0].omega - beforeSpin));
        if (
          !timeToRolling &&
          Math.abs(bike.tires[0].omega * bike.tires[0].radius - bike.dynamics.speed) < 0.01
        )
          timeToRolling = (i + 1) * DT;
        expect(bike.tires[0].omega).toBeGreaterThanOrEqual(0);
      }
      // The 250's nose reaches this downslope sooner. The 450 supplies a
      // real rear-first contact window to test the unloaded front wheel.
      if (definition === MX_450) expect(unloaded).toBeGreaterThan(0);
      expect(pickup).toBeGreaterThan(1);
      expect(largestStep).toBeLessThan(20);
      expect(timeToRolling).toBeGreaterThan(3 * DT);
      expect(timeToRolling).toBeLessThan(0.2);
      expect(bike.dynamics.crashes).toBe(0);
      expect(bike.riding).toBe(true);
    },
  );

  it.each(['sport', 'raw'] as const)(
    '%s preserves all airborne motion and changes ground exit only through bounded contact',
    (assist) => {
      const run = land(launch(MX_450, assist)),
        // Same physical definition through the untouched general adapter;
        // no whip input is used, isolating the MX-only wheel-pickup gate.
        reference = land(launch({ ...MX_450, id: 'pickup-reference' }, assist));
      expect(run.bike.lastLanding).toEqual(reference.bike.lastLanding);
      expect(run.bike.dynamics.speed).toBe(reference.bike.dynamics.speed);
      expect(run.bike.cgY).toBe(reference.bike.cgY);
      expect(run.bike.dynamics.x).toBe(reference.bike.dynamics.x);
      expect(run.bike.dynamics.z).toBe(reference.bike.dynamics.z);
      expect(reference.bike.tires[0].omega * reference.bike.tires[0].radius).toBeCloseTo(
        reference.bike.dynamics.speed,
        9,
      );
      expect(run.bike.tires[0].omega).toBe(0);
      for (let i = 0; i < 0.3 / DT; i++) {
        run.bike.step(DT, run.track);
        reference.bike.step(DT, reference.track);
      }
      const speedChange = run.bike.dynamics.speed - reference.bike.dynamics.speed;
      // The overspeed rear can donate its stored angular momentum while
      // the locked front consumes some. Either way the change is small and
      // occurs on the ground; no launch or flight path was manipulated.
      expect(Math.abs(speedChange)).toBeGreaterThan(0.005);
      expect(Math.abs(speedChange)).toBeLessThan(0.8);
      expect(run.bike.dynamics.crashes).toBe(0);
    },
  );

  it('keeps a real pickup and its ground exit stable when the contact substep is halved', () => {
    const normal = land(launch(), 0.4, DT),
      finer = land(launch(), 0.4, DT / 2);
    for (let i = 0; i < 0.3 / DT; i++) {
      normal.bike.step(DT, normal.track);
      finer.bike.step(DT / 2, finer.track);
      finer.bike.step(DT / 2, finer.track);
    }
    expect(Math.abs(normal.bike.dynamics.speed - finer.bike.dynamics.speed)).toBeLessThan(0.03);
    expect(Math.abs(normal.bike.s - finer.bike.s)).toBeLessThan(0.06);
    expect(
      Math.abs(normal.bike.lastLanding!.normalSpeed - finer.bike.lastLanding!.normalSpeed),
    ).toBeLessThan(0.2);
    for (const { bike } of [normal, finer]) {
      expect(bike.dynamics.crashes).toBe(0);
      expect(bike.tires[0].slip).toBe(0);
      expect(bike.tires[0].omega * bike.tires[0].radius).toBeCloseTo(bike.dynamics.speed, 9);
    }
  });

  it('keeps AI and the supermoto touchdown on their calibrated rolling path', () => {
    const ai = land(launch(MX_450, 'sport', true)),
      supermoto = land(launch(SM_450));
    for (const { bike } of [ai, supermoto]) {
      expect(bike.tires[0].omega * bike.tires[0].radius).toBeCloseTo(bike.dynamics.speed, 9);
      expect(bike.tires[2].omega * bike.tires[2].radius).toBeCloseTo(bike.dynamics.speed, 9);
      expect(bike.tires[0].slip).toBe(0);
    }
    const player = land(launch());
    expect(player.bike.tires[0].slip).toBe(1);
    player.bike.aiControlled(1e6);
    player.bike.step(DT, player.track);
    expect(player.bike.tires[0].slip).toBe(0);
    expect(player.bike.tires[0].omega * player.bike.tires[0].radius).toBeCloseTo(
      player.bike.dynamics.speed,
      9,
    );
    player.bike.place(player.track, 35);
    expect(player.bike.frontSpin).toBe(0);
    expect(player.bike.rearSpin).toBe(0);
  });

  it('reconstructs the real manual landing and its wheel channels through the input journal', () => {
    const options = {
      ...DEFAULT_OPTIONS,
      circuit: 'valley-ridge-mx' as const,
      ruleset: 'motocross-moto' as const,
      mode: 'race' as const,
      opponents: 0,
      laps: 1,
      seed: 78312,
      vehicles: ['mx450'],
    };
    const sim = new Simulation(options),
      bike = sim.cars[0] as DirtBikeVehicle,
      log = new InputLog();
    sim.autoPlayer = true;
    log.autopilot(0, true);
    let manual = false,
      touchdownTick = 0,
      observedPickup = false;
    for (let i = 0; i < 40 * 120; i++) {
      if (!manual && bike.airborne && bike.airTime > 0.2 && bike.lastTakeoff > 6.5) {
        manual = true;
        sim.autoPlayer = false;
        log.autopilot(sim.tick, false);
      }
      if (manual) {
        const input = bike.airborne ? airInputs(bike, 0.4) : controls();
        sim.setInput(input);
        log.input(sim.tick, input);
      }
      const wasFlying = bike.airborne;
      sim.step(1 / 120);
      if (manual && wasFlying && !bike.airborne) touchdownTick = sim.tick;
      observedPickup ||= manual && !bike.airborne && bike.tires[0].slip > 0.3;
      if (touchdownTick && sim.tick >= touchdownTick + 3) break;
    }
    expect(manual).toBe(true);
    expect(touchdownTick).toBeGreaterThan(0);
    expect(observedPickup).toBe(true);
    const replay = new Resimulation(options, log.entries, sim.tick);
    while (!replay.run()) void 0;
    expect(replay.simulation.makeFrame()).toEqual(sim.makeFrame());
    const replayBike = replay.simulation.cars[0] as DirtBikeVehicle;
    expect(replayBike.frontSpin).toBe(bike.frontSpin);
    expect(replayBike.rearSpin).toBe(bike.rearSpin);
    expect(replayBike.lastLanding).toEqual(bike.lastLanding);
  });
});
