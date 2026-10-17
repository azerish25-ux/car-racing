import { describe, expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { DirtBikeAIDriver, jumpHoldSpeed } from '../src/simulation/offroad/ai.ts';
import { MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { LANDING_RULES } from '../src/simulation/offroad/riding-feedback.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { LapTracker } from '../src/simulation/race.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

function tripleApproach(vehicle: 'mx250' | 'mx450', runUp = 12, heading = 0, speedOffset = 0) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear', circuit: 'valley-ridge-mx',
    opponents: 0, vehicles: [vehicle], seed: 41003,
  });
  for (let i = 0; i < 120 * 6; i++) sim.step(1 / 120);
  const jump = offroadCourse(sim.track.circuit)!.jumps.find((j) => j.name === 'SKY TRIPLE')!,
    bike = sim.cars[0] as DirtBikeVehicle,
    speed = jumpHoldSpeed(jump) + speedOffset;
  bike.place(sim.track, jump.start - runUp);
  bike.dynamics.speed = speed;
  bike.dynamics.heading += heading;
  for (let gear = 1; gear < bike.spec.gearRatios.length - 1; gear++) {
    bike.gear = gear;
    const rpm = speed / bike.spec.wheelRadius * bike.spec.gearRatios[gear + 1] *
      bike.spec.finalDrive * 30 / Math.PI;
    if (rpm < bike.spec.shiftRPM * 0.85) break;
  }
  sim.autoPlayer = true;
  return { sim, bike, jump, ai: sim.ai[0] as DirtBikeAIDriver };
}

function wetBeachedRider() {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS, mode: 'practice', weather: 'rain', circuit: 'valley-ridge-mx',
    opponents: 1, vehicles: ['mx250', 'mx450'], seed: 41003,
  });
  for (let i = 0; i < 120 * 6; i++) sim.step(1 / 120);
  const bike = sim.cars[0] as DirtBikeVehicle,
    traffic = sim.cars[1] as DirtBikeVehicle;
  // This real wet face holds the driven bike still. Moving the other
  // rider controls production traffic braking without assigning AI input.
  bike.place(sim.track, 315.4, -1.52);
  bike.gear = 2;
  sim.autoPlayer = true;
  return { sim, bike, traffic, ai: sim.ai[0] as DirtBikeAIDriver };
}

describe('motocross committed jump handoff', () => {
  it.each(['mx250', 'mx450'] as const)(
    'allows a real %s clear to settle without treating touchdown as a beached gap rider',
    (vehicle) => {
      const { sim, bike, jump } = tripleApproach(vehicle);
      let flew = false, landing: DirtBikeVehicle['lastLanding'] = null,
        samples = 0, maxBrake = 0, minTarget = Infinity;
      for (let i = 0; i < 120 * 6; i++) {
        sim.step(1 / 120);
        flew ||= bike.airborne && bike.s > jump.start;
        if (!landing && flew && !bike.airborne && bike.lastLanding) landing = bike.lastLanding;
        if (!landing) continue;
        const age = bike.clock - landing.time;
        if (age > 1 / 120 && age < LANDING_RULES.settleSeconds) {
          samples++;
          maxBrake = Math.max(maxBrake, bike.input.brake);
          minTarget = Math.min(minTarget, bike.aiTarget);
        }
        if (age >= LANDING_RULES.settleSeconds) break;
      }
      expect(flew).toBe(true);
      expect(landing).not.toBeNull();
      expect(landing!.s).toBeGreaterThan(jump.takeoff + 0.5);
      expect(landing!.s).toBeLessThan(jump.end);
      expect(landing!.airTime).toBeGreaterThan(1);
      expect(samples).toBeGreaterThan(20);
      // The old inside-gap branch immediately asked for 4 m/s and nearly
      // full braking after this unchanged physical touchdown.
      expect(minTarget).toBeGreaterThan(10);
      expect(maxBrake).toBeLessThan(0.05);
      expect(bike.dynamics.crashes).toBe(0);
    },
  );

  it.each([
    ['mx250', -1], ['mx250', 1], ['mx450', -1], ['mx450', 1],
  ] as const)('aborts the %s clear once when heading recovery brakes from side %s', (vehicle, side) => {
    const { sim, bike, jump, ai } = tripleApproach(vehicle, 16, side * 0.6, -0.5);
    let flew = false, landing: DirtBikeVehicle['lastLanding'] = null;
    for (let i = 0; i < 120 * 6; i++) {
      sim.step(1 / 120);
      flew ||= bike.airborne && bike.s > jump.start;
      if (!landing && flew && !bike.airborne && bike.lastLanding) landing = bike.lastLanding;
      if (landing && bike.clock - landing.time > 0.5) break;
    }
    // The final heading guard used to brake after the planner's abort
    // check, then resume its locked clear at an unreachable lip speed.
    // Both mirrored physical approaches crashed at 10.7–11.1 m/s takeoff.
    expect(ai.decisions.aborts).toBe(1);
    expect(landing).not.toBeNull();
    expect(landing!.takeoffSpeed).toBeLessThan(6);
    expect(landing!.distance).toBeLessThan(3.5);
    expect(landing!.outcome).toBe('bottomed');
    expect(bike.s).toBeGreaterThan(jump.takeoff + 3);
    expect(bike.dynamics.crashes).toBe(0);
  });
});

describe('motocross AI rejoining', () => {
  it.each([-1, 1])('slows a rider facing across the lane on side %s before driving onward', (side) => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      weather: 'clear',
      circuit: 'arena-nord-sx',
      opponents: 0,
      vehicles: ['mx450'],
      seed: 41003,
    });
    sim.autoPlayer = true;
    const bike = sim.cars[0] as DirtBikeVehicle,
      p = sim.track.at(35, trackPoint());
    bike.placeFree(
      sim.track,
      p.x + p.nx * side * 2.4,
      p.z + p.nz * side * 2.4,
      Math.atan2(p.tx, p.tz) + side * 0.9,
      0,
    );
    bike.dynamics.speed = 9;
    bike.dynamics.lean = -side * 0.25;
    bike.gear = 2;
    for (let i = 0; i < 60; i++) sim.step(1 / 120);
    // A normal 20+ m/s racing target previously accelerated a recovering
    // rider toward the opposite wall while the chassis was still leaning.
    expect(bike.aiTarget).toBeLessThanOrEqual(4.5);
    expect(bike.speed).toBeLessThan(7);
    expect(bike.input.throttle).toBe(0);
    expect(bike.input.brake).toBeGreaterThan(0.2);
    expect(bike.dynamics.crashes).toBe(0);
    expect(Math.abs(bike.lateral)).toBeLessThan(sim.track.boundaryAt(p, side));
  });

  it('holds one lane from the real stadium tabletop through its rollers and finish triple', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      weather: 'clear',
      circuit: 'arena-nord-sx',
      opponents: 0,
      vehicles: ['mx450'],
      seed: 41003,
    });
    sim.autoPlayer = true;
    const bike = sim.cars[0] as DirtBikeVehicle;
    bike.place(sim.track, 398, -1.5);
    bike.dynamics.speed = 10;
    bike.gear = 2;
    let greatestDrift = 0, greatestBank = 0;
    for (let i = 0; i < 660; i++) {
      sim.step(1 / 120);
      greatestDrift = Math.max(greatestDrift, Math.abs(bike.lateral + 1.5));
      greatestBank = Math.max(greatestBank, Math.abs(bike.dynamics.lean));
    }
    // Previously the next roller block requested the opposite side of the
    // lane while its tyres were hopping: >6 m drift and a wall crash. This
    // uses the production planner, tyre contact, jumps and collision solver.
    expect(greatestDrift).toBeLessThan(0.2);
    expect(greatestBank).toBeLessThan(0.05);
    expect(bike.s).toBeGreaterThan(469);
    expect(bike.speed).toBeGreaterThan(12);
    expect(bike.dynamics.crashes).toBe(0);
    expect(bike.airborne).toBe(true);
  });

  it.each([145.4, 448])('physically crosses timing gates during a long marshal recovery at %s m', (start) => {
    const track = rigTrack('arena-nord-sx'),
      bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', MX_450),
      lap = new LapTracker(track.length, track.length - 1);
    // Reach the approach's timing state through ordinary successive samples,
    // including the start line. No checkpoint or lap counter is assigned.
    let time = 0;
    for (let s = 0; s < start; s++) lap.update(s, time += 0.1, false);
    lap.update(start, time += 0.1, false);
    const gate = lap.nextGate;
    bike.place(track, start);
    bike.restart(track);
    expect(bike.dynamics.state).toBe('remount');
    let previous = bike.s, greatestStep = 0;
    for (let i = 0; i < 720; i++) {
      bike.step(1 / 120, track);
      const delta = mod(bike.s - previous + track.length / 2, track.length) - track.length / 2;
      greatestStep = Math.max(greatestStep, Math.abs(delta));
      lap.update(bike.s, time += 1 / 120, false);
      previous = bike.s;
      if (bike.riding) break;
    }
    expect(bike.riding).toBe(true);
    expect(greatestStep).toBeLessThan(0.15);
    expect(lap.nextGate).toBe(gate + 1);
    expect(lap.completed).toBe(0);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('helps a beached rider with the exact 4 m/s rolling target without waiting for the slower fallback', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear', circuit: 'arena-nord-sx',
      opponents: 0, vehicles: ['mx450'], seed: 41003,
    });
    // Pass the ordinary practice release and marshal assistance delay.
    for (let i = 0; i < 120 * 6; i++) sim.step(1 / 120);
    sim.autoPlayer = true;
    const bike = sim.cars[0] as DirtBikeVehicle;
    // The observed beached pose: stopped on the steep middle mound with
    // the front lifted and the rear still at its sagged contact height.
    // Starting upstream depended on the brake solver stopping within 15 cm
    // of this point; the planner then asked for 4.016 m/s instead of exactly 4.
    bike.place(sim.track, 145.45);
    bike.pitch = 1.1;
    bike.cgY =
      bike.contacts[2].height + bike.bikeSpec.cgToRear * Math.sin(bike.pitch) +
      (bike.bikeSpec.cgHeight + bike.compressionRear) * Math.cos(bike.pitch) -
      bike.compressionRear;
    bike.gear = 2;
    let held = false, startedPush = false, heldAt = 0, pushAfter = -1;
    for (let i = 0; i < 1800; i++) {
      sim.step(1 / 120);
      if (!held && bike.speed < 0.1 && bike.aiTarget === 4 && bike.input.throttle > 0.9) {
        held = true;
        heldAt = sim.race.raceTime;
      }
      if (held && !startedPush && bike.dynamics.state === 'remount') {
        startedPush = true;
        pushAfter = sim.race.raceTime - heldAt;
      }
    }
    expect(held).toBe(true);
    expect(startedPush).toBe(true);
    expect(pushAfter).toBeGreaterThanOrEqual(3.9);
    expect(pushAfter).toBeLessThan(4.1);
    expect(bike.s).toBeGreaterThan(147);
    expect(bike.dynamics.crashes).toBe(0);
  });
});

describe('motocross stationary drive effort', () => {
  it('pauses effort during passing traffic and assists only after four seconds of actual drive', () => {
    const { sim, bike, traffic, ai } = wetBeachedRider();
    let effort = 0, brakeTime = 0, movement = 0;
    let firstPush: { time: number; effort: number; throttle: number; brake: number } | null = null;
    for (let i = 0; i < 120 * 14; i++) {
      const blocked = Math.floor(i / 240) % 2 === 1,
        stationary = bike.riding && !bike.airborne && bike.speed < 0.5;
      traffic.place(sim.track, 315.4 + (blocked ? 2.8 : 40), -1.52);
      sim.step(1 / 120);
      if (!firstPush) {
        if (stationary && bike.aiTarget > 0.5 && bike.input.throttle > 0.2 && bike.input.brake < 0.1) {
          effort += 1 / 120;
        }
        if (stationary && bike.input.brake > 0.9) brakeTime += 1 / 120;
        movement = Math.max(movement, Math.abs(bike.s - 315.4));
        if (ai.decisions.pushes) firstPush = {
          time: i / 120, effort, throttle: bike.input.throttle, brake: bike.input.brake,
        };
      }
    }
    // Previously each two-second traffic pause erased the preceding drive
    // effort: this rider never got help despite over seven seconds driving.
    expect(firstPush).not.toBeNull();
    expect(firstPush!.time).toBeGreaterThan(8);
    expect(firstPush!.time).toBeLessThan(9);
    expect(firstPush!.effort).toBeGreaterThanOrEqual(3.9);
    expect(firstPush!.effort).toBeLessThan(4.1);
    expect(firstPush!.throttle).toBeGreaterThan(0.2);
    expect(firstPush!.brake).toBeLessThan(0.1);
    expect(brakeTime).toBeGreaterThan(3.5);
    expect(movement).toBeLessThan(0.05);
    expect(ai.decisions.pushes).toBe(1);
    expect(bike.s).toBeGreaterThan(330);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('keeps a continuously brake-held traffic queue stationary without assistance', () => {
    const { sim, bike, traffic, ai } = wetBeachedRider();
    let maxThrottle = 0, minBrake = 1, movement = 0;
    for (let i = 0; i < 120 * 14; i++) {
      traffic.place(sim.track, 318.2, -1.52);
      sim.step(1 / 120);
      movement = Math.max(movement, Math.abs(bike.s - 315.4));
      // Allow the normal traffic planner its first evaluation.
      if (i >= 120) {
        maxThrottle = Math.max(maxThrottle, bike.input.throttle);
        minBrake = Math.min(minBrake, bike.input.brake);
      }
    }
    expect(maxThrottle).toBeLessThan(0.01);
    expect(minBrake).toBeGreaterThan(0.9);
    expect(movement).toBeLessThan(0.05);
    expect(ai.decisions.pushes).toBe(0);
    expect(bike.riding).toBe(true);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('discards earlier effort when a real external push moves the bike', () => {
    const { sim, bike, traffic, ai } = wetBeachedRider();
    let lastMotion = -1, maxSpeed = 0, firstPush = -1, positionBeforePush = 0;
    for (let i = 0; i < 120 * 10; i++) {
      if (i === 240) {
        const p = bike.trackPosition;
        bike.body.velocity.x += p.tx * 2;
        bike.body.velocity.z += p.tz * 2;
      }
      traffic.place(sim.track, 355.4, -1.52);
      sim.step(1 / 120);
      if (i >= 240 && bike.speed >= 0.5) lastMotion = i / 120;
      maxSpeed = Math.max(maxSpeed, bike.speed);
      if (ai.decisions.pushes) {
        firstPush = i / 120;
        positionBeforePush = bike.s;
        break;
      }
    }
    expect(maxSpeed).toBeGreaterThan(1);
    expect(positionBeforePush - 315.4).toBeGreaterThan(0.3);
    expect(lastMotion).toBeGreaterThan(2);
    expect(firstPush - lastMotion).toBeGreaterThanOrEqual(3.9);
    expect(firstPush - lastMotion).toBeLessThan(4.1);
    expect(ai.decisions.pushes).toBe(1);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('starts a fresh drive-effort interval after an actual manual remount', () => {
    const { sim, bike, traffic, ai } = wetBeachedRider();
    let returnedAt = -1, firstPush = -1, sawRemount = false, effort = 0;
    for (let i = 0; i < 120 * 14; i++) {
      if (i === 240) bike.restart(sim.track);
      const stationary = bike.riding && !bike.airborne && bike.speed < 0.5;
      traffic.place(sim.track, 355.4, -1.52);
      sim.step(1 / 120);
      if (i >= 240 && !bike.riding) sawRemount = true;
      if (sawRemount && returnedAt < 0 && bike.riding) {
        returnedAt = i / 120;
        bike.place(sim.track, 315.4, -1.52);
      }
      if (returnedAt >= 0 && stationary && bike.aiTarget > 0.5 &&
        bike.input.throttle > 0.2 && bike.input.brake < 0.1) effort += 1 / 120;
      if (ai.decisions.pushes) {
        firstPush = i / 120;
        break;
      }
    }
    expect(sawRemount).toBe(true);
    expect(returnedAt - 2).toBeGreaterThan(4.9);
    expect(returnedAt - 2).toBeLessThan(5.1);
    expect(firstPush - returnedAt).toBeGreaterThan(4);
    expect(firstPush - returnedAt).toBeLessThan(4.3);
    expect(effort).toBeGreaterThanOrEqual(3.9);
    expect(effort).toBeLessThan(4.1);
    expect(ai.decisions.pushes).toBe(1);
    expect(bike.dynamics.crashes).toBe(0);
  });
});
