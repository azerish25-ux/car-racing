import { describe, expect, it } from 'vitest';
import { clamp, G, Vec3 } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MAX_SUBSTEP, Vehicle } from '../src/simulation/vehicle.ts';
import { TOURING_TC1, type VehicleDefinition, FORMULA_APX01 } from '../src/simulation/vehicles.ts';
import { DynamicsTrack, type RigKind } from '../scripts/dynamics-fixtures.ts';

const RATES = [60, 120, 240] as const;
/** Translational + rotational chassis energy, wheel spin energy and height. */
function energy(car: Vehicle) {
  const b = car.body,
    local = new Vec3().copy(b.omega);
  b.orientation.inverseRotate(b.omega, local);
  const spin =
    0.5 * (b.inertia.x * local.x ** 2 + b.inertia.y * local.y ** 2 + b.inertia.z * local.z ** 2);
  const wheels = car.tires.reduce((sum, t) => sum + 0.5 * t.inertia * t.omega ** 2, 0);
  return 0.5 * b.mass * b.velocity.length() ** 2 + spin + wheels + b.mass * G * b.position.y;
}
function rolling(def: VehicleDefinition, track: DynamicsTrack, speed: number) {
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', def);
  car.place(track, 0);
  car.input.brake = 1;
  for (let i = 0; i < 480; i++) car.step(1 / 240, track);
  car.input.brake = 0;
  car.body.velocity.set(0, 0, speed);
  car.speed = speed;
  for (const t of car.tires) t.omega = speed / t.radius;
  const spec = def.spec;
  let gear = spec.gearRatios.length - 2;
  while (
    gear > 1 &&
    ((speed / spec.wheelRadius) * spec.gearRatios[gear + 1] * spec.finalDrive * 30) / Math.PI <
      spec.downshiftRPM
  )
    gear--;
  car.gear = gear;
  car.clutch.engineOmega = (speed / spec.wheelRadius) * spec.gearRatios[gear + 1] * spec.finalDrive;
  return car;
}

describe('integrator stability at 60, 120 and 240 Hz', () => {
  it('caps the internal step: one 1/60 s call integrates four 1/240 s substeps', () => {
    expect(MAX_SUBSTEP).toBeCloseTo(1 / 240, 12);
    const track = new DynamicsTrack();
    const a = new Vehicle(0),
      b = new Vehicle(0);
    a.place(track, 0);
    b.place(track, 0);
    a.input.throttle = b.input.throttle = 0.4;
    for (let i = 0; i < 60; i++) a.step(1 / 60, track);
    for (let i = 0; i < 240; i++) b.step(1 / 240, track);
    expect(a.body.position.z).toBeCloseTo(b.body.position.z, 9);
    expect(() => a.step(0, track)).toThrow();
  });
  for (const def of [FORMULA_APX01, TOURING_TC1])
    it(`never injects energy when ${def.id} is dropped onto its springs and tyres`, () => {
      const finals: number[] = [];
      for (const hz of RATES) {
        const dt = 1 / hz,
          track = new DynamicsTrack();
        const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', def);
        car.place(track, 0);
        car.body.position.y += 0.3;
        car.input.brake = 1;
        const initial = energy(car),
          drop = car.body.mass * G * 0.3;
        let peak = -Infinity;
        for (let i = 0; i < hz * 6; i++) {
          car.step(dt, track);
          peak = Math.max(peak, energy(car));
        }
        expect(peak).toBeLessThan(initial + drop * 0.005);
        expect(car.body.velocity.length()).toBeLessThan(0.01);
        finals.push(car.body.position.y);
      }
      expect(Math.max(...finals) - Math.min(...finals)).toBeLessThan(0.001);
    }, 60000);
  it('coasts with monotonically falling energy (drag, rolling loss, dampers only)', () => {
    for (const hz of RATES) {
      const dt = 1 / hz,
        track = new DynamicsTrack();
      const car = rolling(FORMULA_APX01, track, 45);
      let previous = energy(car);
      for (let window = 0; window < 30; window++) {
        for (let i = 0; i < hz / 10; i++) car.step(dt, track);
        const now = energy(car);
        expect(now).toBeLessThan(previous);
        previous = now;
      }
    }
  }, 60000);
  it('gives the same stop and step-steer response at every rate', () => {
    const stops: number[] = [],
      yaws: number[] = [];
    for (const hz of RATES) {
      const dt = 1 / hz;
      let track = new DynamicsTrack();
      let car = rolling(FORMULA_APX01, track, 200 / 3.6);
      const start = car.body.position.z;
      car.input.brake = 1;
      for (let t = 0; t < 15 && car.speed > 0.2; t += dt) car.step(dt, track);
      stops.push(car.body.position.z - start);
      track = new DynamicsTrack();
      car = rolling(FORMULA_APX01, track, 30);
      for (let t = 0; t < 2; t += dt) {
        car.input.steer = 0.15;
        car.input.throttle = clamp((30 - car.speed) * 0.4 + 0.2, 0, 1);
        car.step(dt, track);
      }
      yaws.push(car.body.omega.y);
    }
    for (const s of stops) expect(Math.abs(s - stops[2]) / stops[2]).toBeLessThan(0.01);
    for (const y of yaws) expect(Math.abs(y - yaws[2]) / Math.abs(yaws[2])).toBeLessThan(0.02);
  }, 60000);
  for (const kind of ['high-kerb', 'sausage-kerb'] as RigKind[])
    it(`strikes a ${kind} with bounded loads at 60 Hz`, () => {
      const track = new DynamicsTrack(kind);
      const car = rolling(FORMULA_APX01, track, 20);
      let peakG = 0,
        peakLoad = 0;
      for (let t = 0; t < 3; t += 1 / 60) {
        car.step(1 / 60, track);
        peakG = Math.max(peakG, Math.abs(car.gVert));
        for (const tire of car.tires) peakLoad = Math.max(peakLoad, tire.load);
        expect(car.body.position.finite()).toBe(true);
      }
      expect(peakG).toBeLessThan(15);
      expect(peakLoad).toBeLessThan(40000);
      expect(car.body.position.y).toBeGreaterThan(0.4);
    }, 30000);
});
