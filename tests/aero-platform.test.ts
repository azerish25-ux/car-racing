import { describe, expect, it } from 'vitest';
import { clamp, Random, Vec3 } from '../src/core/math.ts';
import {
  aero,
  floorCentre,
  FORMULA_AERO_DYNAMICS,
  lagHeight,
  plungeDamping,
  slipstreamOverlap,
  wakeFields,
  wakeOverlap,
} from '../src/simulation/aero.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { TOURING_TC1 } from '../src/simulation/vehicles.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

const forces = () => ({ front: 0, rear: 0, floor: 0, drag: 0, wake: 0 });
describe('aero platform: centre of pressure, convective lag, plunge damping', () => {
  it('moves the floor load forward as the nose drops or the floor nears the ground', () => {
    const a = FORMULA_AERO_DYNAMICS,
      reference = floorCentre(a, a.referencePitch, a.referenceHeight);
    expect(reference).toBeCloseTo(a.floorCentre, 12);
    expect(floorCentre(a, a.referencePitch - 0.01, a.referenceHeight)).toBeGreaterThan(reference);
    expect(floorCentre(a, a.referencePitch, a.referenceHeight - 0.02)).toBeGreaterThan(reference);
    expect(Math.abs(floorCentre(a, -5, -5))).toBeLessThanOrEqual(1.5);
  });
  it('lags ride height by length/V exactly and never overshoots', () => {
    expect(lagHeight(0.05, 0.03, 50, 0.5, 0.01)).toBeCloseTo(0.03 + 0.02 * Math.exp(-1), 12);
    for (const dt of [1 / 240, 1 / 30, 3]) {
      const h = lagHeight(0.05, 0.03, 60, 0.5, dt);
      expect(h).toBeGreaterThanOrEqual(0.03);
      expect(h).toBeLessThanOrEqual(0.05);
    }
    expect(lagHeight(0.05, 0.03, 60, 0, 0.01)).toBe(0.03);
  });
  it('opposes heave with a force proportional to airspeed', () => {
    expect(plungeDamping(60, 0.2, 3)).toBeLessThan(0);
    expect(plungeDamping(60, -0.2, 3)).toBeGreaterThan(0);
    expect(plungeDamping(80, 0.2, 3) / plungeDamping(40, 0.2, 3)).toBeCloseTo(2, 12);
  });
});

describe('slipstream and dirty air as separate channels', () => {
  const leader = new Vec3(),
    forward = new Vec3(0, 0, 1);
  it('tows further and narrower than the turbulent wake', () => {
    const at = (x: number, z: number) => new Vec3(x, 0, -z);
    expect(slipstreamOverlap(at(0, 80), leader, forward, 70)).toBeGreaterThan(
      wakeOverlap(at(0, 80), leader, forward, 70),
    );
    expect(slipstreamOverlap(at(1.6, 15), leader, forward, 70)).toBeLessThan(
      wakeOverlap(at(1.6, 15), leader, forward, 70),
    );
    expect(slipstreamOverlap(at(0, -10), leader, forward, 70)).toBe(0);
    for (const edge of [1.5, 5, 70, 100])
      expect(
        Math.abs(
          slipstreamOverlap(at(0, edge - 1e-6), leader, forward, 70) -
            slipstreamOverlap(at(0, edge + 1e-6), leader, forward, 70),
        ),
      ).toBeLessThan(1e-5);
  });
  it('keeps the 101 m proximity cull exact for the slipstream too', () => {
    const rng = new Random(17);
    const r = () => rng.next() * 2 - 1;
    for (let i = 0; i < 20000; i++) {
      const a = new Vec3(r() * 300, r() * 5, r() * 300),
        b = new Vec3(r() * 300, r() * 5, r() * 300),
        f = new Vec3(r(), r() * 0.1, r());
      if (a.distanceSq(b) >= 101 * 101) expect(slipstreamOverlap(a, b, f, 80, f)).toBe(0);
    }
  });
  it('cuts drag with the tow and downforce with the wake, independently', () => {
    const clean = forces(),
      towed = forces(),
      dirty = forces();
    aero(70, DEFAULT_SETUP, 0.05, 0.07, 1, 1, 1, 0, 0, clean, 0, undefined, undefined, 0);
    aero(70, DEFAULT_SETUP, 0.05, 0.07, 1, 1, 1, 0, 0, towed, 0, undefined, undefined, 0.8);
    aero(70, DEFAULT_SETUP, 0.05, 0.07, 1, 1, 1, 0.8, 0, dirty, 0, undefined, undefined, 0);
    expect(towed.drag).toBeLessThan(clean.drag * 0.9);
    expect(towed.front).toBe(clean.front);
    expect(dirty.front).toBeLessThan(clean.front * 0.7);
    expect(dirty.drag).toBe(clean.drag);
  });
  it('scales each leader’s dirty air and tow by its body', () => {
    const track = new DynamicsTrack();
    const behind = new Vehicle(0),
      formula = new Vehicle(1),
      saloon = new Vehicle(2, 'medium', DEFAULT_SETUP, 'sport', TOURING_TC1);
    for (const car of [behind, formula, saloon]) car.place(track, 0);
    behind.body.position.set(0, 0.5, -20);
    for (const leader of [formula, saloon]) {
      leader.speed = 60;
      leader.forward.set(0, 0, 1);
    }
    behind.forward.set(0, 0, 1);
    wakeFields(behind, [behind, formula]);
    const formulaWake = behind.wake;
    wakeFields(behind, [behind, saloon]);
    expect(behind.wake).toBeLessThan(formulaWake * 0.5);
    expect(behind.slipstream).toBeGreaterThan(0.3);
    expect(behind.slipstream).toBeLessThanOrEqual(1);
  });
});

describe('porpoising-safe floor near its stall region', () => {
  it('damps a heave disturbance at 60, 120 and 240 Hz alike', () => {
    const run = (dt: number) => {
      const track = new DynamicsTrack();
      const setup = {
        ...DEFAULT_SETUP,
        frontRide: 0.045,
        rearRide: 0.045,
        frontSpring: 90000,
        rearSpring: 90000,
      };
      const car = new Vehicle(0, 'medium', setup, 'raw');
      car.place(track, 0);
      car.input.brake = 1;
      for (let i = 0; i < 480; i++) car.step(1 / 240, track);
      car.input.brake = 0;
      const speed = 75;
      car.body.velocity.set(0, 0, speed);
      for (const t of car.tires) t.omega = speed / t.radius;
      car.gear = 7;
      car.clutch.engineOmega =
        (speed / car.spec.wheelRadius) * car.spec.gearRatios[8] * car.spec.finalDrive;
      const hold = (time: number) => {
        for (let t = 0; t < time; t += dt) {
          car.input.throttle = clamp((speed - car.speed) * 0.5 + 0.55, 0, 1);
          car.step(dt, track);
        }
      };
      hold(3);
      car.body.velocity.y -= 0.6;
      let early = 0,
        late = 0;
      for (let t = 0; t < 3; t += dt) {
        car.input.throttle = clamp((speed - car.speed) * 0.5 + 0.55, 0, 1);
        car.step(dt, track);
        if (t < 0.5) early = Math.max(early, Math.abs(car.body.velocity.y));
        if (t > 2.5) late = Math.max(late, Math.abs(car.body.velocity.y));
      }
      return { early, late, height: car.frontRideHeight };
    };
    const results = [1 / 60, 1 / 120, 1 / 240].map(run);
    for (const r of results) {
      expect(r.late).toBeLessThan(r.early * 0.1);
      expect(r.height).toBeGreaterThan(0);
    }
    expect(Math.abs(results[0].height - results[2].height)).toBeLessThan(0.002);
  }, 60000);
});
