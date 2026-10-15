import { describe, expect, it } from 'vitest';
import { clamp, G, Vec3 } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  damperForce,
  defaultSuspension,
  geometricLoad,
  HubSolver,
  hubRate,
  kinematicCamber,
  resolveSuspension,
  roadInclination,
  springForce,
} from '../src/simulation/suspension.ts';
import { FORMULA_APX01, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

const TYRE = 330000;
function solver(tyreDamping = 0, definition = defaultSuspension()) {
  const hub = new HubSolver(resolveSuspension(definition, DEFAULT_SETUP, TYRE, tyreDamping, 0.17));
  hub.tyreRate.fill(TYRE);
  hub.contact.fill(1);
  return hub;
}
function settle(hub: HubSolver, compression: readonly number[], dt = 1 / 240, steps = 2400) {
  for (let i = 0; i < 4; i++) {
    hub.compression[i] = compression[i];
    hub.rate[i] = 0;
    hub.contact[i] = compression[i] > 0 ? 1 : 0;
  }
  for (let n = 0; n < steps; n++) hub.solve(dt);
}

describe('massless-hub suspension with series tyre stiffness', () => {
  it('reproduces the setup ride rates at the contact patch (wheel and tyre in series)', () => {
    const hub = solver();
    settle(hub, [0.02, 0.02, 0.02, 0.02]);
    expect(hub.tyreForce[0]).toBeCloseTo(DEFAULT_SETUP.frontSpring * 0.02, 3);
    expect(hub.tyreForce[2]).toBeCloseTo(DEFAULT_SETUP.rearSpring * 0.02, 3);
    // The hub takes only part of the compression; the tyre deflects the rest.
    expect(hub.travel[0]).toBeLessThan(0.02);
    expect(hub.travel[0]).toBeCloseTo(
      (0.02 * TYRE) / (TYRE + hubRate(DEFAULT_SETUP.frontSpring, TYRE)),
      6,
    );
  });
  it('reproduces the former spring + anti-roll-bar loads in roll', () => {
    const hub = solver();
    settle(hub, [0.03, 0.01, 0.025, 0.015]);
    const f = DEFAULT_SETUP.frontSpring,
      a = DEFAULT_SETUP.frontARB;
    expect(hub.tyreForce[0]).toBeCloseTo(f * 0.03 + a * 0.02, 2);
    expect(hub.tyreForce[1]).toBeCloseTo(f * 0.01 - a * 0.02, 2);
    const r = DEFAULT_SETUP.rearSpring,
      b = DEFAULT_SETUP.rearARB;
    expect(hub.tyreForce[2]).toBeCloseTo(r * 0.025 + b * 0.01, 2);
  });
  it('has asymmetric bump/rebound damping with a continuous digressive knee', () => {
    const [h] = resolveSuspension(defaultSuspension(), DEFAULT_SETUP, TYRE, 0, 0.17);
    expect(damperForce(h, 0.05)).toBeGreaterThan(0);
    expect(-damperForce(h, -0.05)).toBeGreaterThan(damperForce(h, 0.05));
    for (const knee of [h.bumpKnee, -h.reboundKnee])
      expect(Math.abs(damperForce(h, knee + 1e-9) - damperForce(h, knee - 1e-9))).toBeLessThan(
        1e-3,
      );
    const low = damperForce(h, h.bumpKnee) / h.bumpKnee,
      high = (damperForce(h, h.bumpKnee + 0.5) - damperForce(h, h.bumpKnee)) / 0.5;
    expect(high).toBeLessThan(low);
  });
  it('rises in rate with a progressive spring and hits a quadratic bump stop', () => {
    const progressive = defaultSuspension({ front: { progression: 0.4 } });
    const [linear] = resolveSuspension(defaultSuspension(), DEFAULT_SETUP, TYRE, 0, 0.17);
    const [rising] = resolveSuspension(progressive, DEFAULT_SETUP, TYRE, 0, 0.17);
    expect(springForce(rising, 0.05)).toBeGreaterThan(springForce(linear, 0.05));
    expect(springForce(rising, 0.01) / 0.01).toBeLessThan(springForce(rising, 0.05) / 0.05);
    const below = springForce(linear, linear.stopGap - 1e-4),
      beyond = springForce(linear, linear.stopGap + 0.01);
    expect(beyond - below).toBeGreaterThan(linear.wheelRate * 0.0101 + 1);
  });
  it('stays stable with a very stiff tyre at long timesteps (implicit hub)', () => {
    for (const dt of [1 / 240, 1 / 60, 1 / 30]) {
      const hub = new HubSolver(
        resolveSuspension(defaultSuspension(), DEFAULT_SETUP, 5e6, 2000, 0.17),
      );
      hub.tyreRate.fill(5e6);
      hub.contact.fill(1);
      hub.compression.fill(0.03);
      hub.rate.fill(0);
      let previous = 0;
      for (let n = 0; n < 200; n++) {
        hub.solve(dt);
        // Monotone, bounded approach to the static split: no ringing.
        expect(hub.travel[0]).toBeGreaterThanOrEqual(previous - 1e-12);
        expect(hub.travel[0]).toBeLessThanOrEqual(0.03 + 1e-12);
        expect(hub.tyreForce[0]).toBeLessThanOrEqual(5e6 * 0.03 + 1e-6);
        previous = hub.travel[0];
      }
    }
  });
  it('never lets the tyre pull the road', () => {
    const hub = solver(800);
    settle(hub, [0.03, 0.03, 0.03, 0.03]);
    hub.compression.fill(0.002);
    hub.rate.fill(-3);
    hub.solve(1 / 240);
    for (const force of hub.tyreForce) expect(force).toBeGreaterThanOrEqual(0);
  });
});

describe('suspension kinematics and geometric load transfer', () => {
  it('gains negative camber in bump on both sides, and the road sees body roll', () => {
    // Right wheel (side -1): negative camber leans its top toward +lateral.
    expect(kinematicCamber(-0.03, 0.4, 0.02, -1)).toBeCloseTo(0.038, 12);
    expect(kinematicCamber(-0.03, 0.4, 0.02, 1)).toBeCloseTo(-0.038, 12);
    // A chassis rolled to the right (lateral axis tilted up) tips its wheels right.
    expect(roadInclination(0.04, Math.sin(0.03))).toBeCloseTo(0.01, 12);
  });
  it('splits load transfer without changing its moment', () => {
    const axle = { ...defaultSuspension().front, rollCentreHeight: 0.05, antiBrake: 0.02 };
    expect(geometricLoad(defaultSuspension().front, 0.83, 1.8, -3000, 4000, 0)).toBeCloseTo(0, 12);
    const outer = geometricLoad(axle, -0.83, 1.8, 0, 5000, 0),
      inner = geometricLoad(axle, 0.83, 1.8, 0, 3000, 0);
    expect(outer).toBeGreaterThan(0);
    expect(inner).toBeLessThan(0);
    expect(-0.83 * outer + 0.83 * inner).toBeCloseTo(-0.05 * 8000, 9);
    // Braking at the front axle lifts the nose (anti-dive), at the rear pulls it down.
    expect(geometricLoad(axle, 0.83, 1.8, -4000, 0, 0)).toBeGreaterThan(0);
    expect(geometricLoad(axle, 0.83, -1.6, -4000, 0, 0)).toBeLessThan(0);
  });
  it('rolls the production car less with roll centres while total load transfer is kept', () => {
    const measure = (definition: VehicleDefinition) => {
      const track = new DynamicsTrack('skidpad');
      const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
      car.place(track, 0);
      car.input.brake = 1;
      for (let i = 0; i < 480; i++) car.step(1 / 240, track);
      car.input.brake = 0;
      const speed = 22;
      car.body.velocity.set(0, 0, speed);
      for (const t of car.tires) t.omega = speed / t.radius;
      car.gear = 2;
      const target = { x: 0, z: 0 },
        local = new Vec3(),
        point = new Vec3(),
        sample = { ...track.points[0] };
      let roll = 0,
        transfer = 0,
        n = 0;
      for (let i = 0; i < 240 * 14; i++) {
        track.at(car.s + 8 + car.speed * 0.3, sample);
        target.x = sample.x;
        target.z = sample.z;
        point.set(target.x - car.body.position.x, 0, target.z - car.body.position.z);
        car.body.orientation.inverseRotate(point, local);
        car.input.steer = clamp(
          Math.atan2(2 * car.spec.wheelbase * local.x, local.x ** 2 + local.z ** 2) /
            car.spec.maxSteer,
          -1,
          1,
        );
        car.input.throttle = clamp((speed - car.speed) * 0.4 + 0.12, 0, 1);
        car.step(1 / 240, track);
        if (i > 240 * 8) {
          const lateral = new Vec3();
          car.body.orientation.rotate(lateral.set(1, 0, 0), lateral);
          roll += lateral.y;
          const loads = car.tires.map((t) => t.load);
          transfer += loads[0] + loads[2] - loads[1] - loads[3];
          n++;
        }
      }
      return { roll: roll / n, transfer: transfer / n, weight: car.body.mass * G };
    };
    const elastic = measure(
      Object.freeze({ ...FORMULA_APX01, dynamics: { suspension: defaultSuspension() } }),
    );
    const geometric = measure(
      Object.freeze({
        ...FORMULA_APX01,
        dynamics: {
          suspension: defaultSuspension({
            front: { rollCentreHeight: 0.08 },
            rear: { rollCentreHeight: 0.08 },
          }),
        },
      }),
    );
    expect(Math.abs(geometric.roll)).toBeLessThan(Math.abs(elastic.roll) * 0.85);
    expect(Math.abs(geometric.transfer - elastic.transfer)).toBeLessThan(
      0.1 * Math.abs(elastic.transfer),
    );
  }, 30000);
});
