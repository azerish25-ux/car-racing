import { describe, expect, it } from 'vitest';
import { Bike, BIKE, NOVICE } from '../src/simulation/bike.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { Track } from '../src/simulation/track.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
const DT = 1 / 240;
const control = { lean: 0, throttle: 0, frontBrake: 0, rearBrake: 0, rider: 0, drive: 0 };
const cruising = (speed = 40) => {
  const b = new Bike(NOVICE, BIKE);
  b.speed = speed;
  return b;
};

describe('Road-racing engine braking shares the real rear contact budget', () => {
  it('changes the integrated force, speed, load transfer and motion in the SAME solver step', () => {
    const free = cruising(),
      coast = cruising();
    free.step(control, DT);
    coast.step({ ...control, engineBrake: 420 }, DT);
    expect(coast.speed).toBeLessThan(free.speed);
    expect(coast.longitudinal).toBeCloseTo((coast.speed - 40) / DT, 10);
    expect(coast.frontLoad).toBeGreaterThan(free.frontLoad);
    expect(coast.rearLoad).toBeLessThan(free.rearLoad);
    expect(coast.engineBrakeForce).toBeCloseTo(coast.rearBrakeForce, 10);
    expect(coast.z).toBeCloseTo(coast.speed * DT, 10);
  });
  it('does not give engine braking a second rear grip allowance under trail braking', () => {
    const b = cruising(30);
    b.lean = 0.62;
    for (let i = 0; i < 20; i++) {
      b.step({ ...control, lean: 0.62, frontBrake: 0.25, rearBrake: 0.4, engineBrake: 8000 }, DT);
      expect(b.rearUse).toBeLessThanOrEqual(1.02);
      expect(b.engineBrakeForce).toBeLessThanOrEqual(b.rearBrakeForce);
      expect(b.state).toBe('riding');
    }
  });
  it('leaves absent, disabled and invalid drivetrain demand identical to the original freewheel', () => {
    const baseline = cruising();
    baseline.step(control, DT);
    for (const engineBrake of [undefined, 0, -1, NaN, Infinity]) {
      const b = cruising();
      b.step({ ...control, engineBrake }, DT);
      expect(b.speed).toBe(baseline.speed);
      expect(b.longitudinal).toBe(baseline.longitudinal);
      expect(b.engineBrakeForce).toBe(0);
    }
  });
  it('does not apply coast drag on the throttle or at walking speed', () => {
    for (const [speed, throttle] of [
      [40, 0.6],
      [2, 0],
    ]) {
      const a = cruising(speed),
        b = cruising(speed);
      a.step({ ...control, throttle }, DT);
      b.step({ ...control, throttle, engineBrake: 5000 }, DT);
      expect(b.speed).toBe(a.speed);
      expect(b.engineBrakeForce).toBe(0);
    }
  });
  it('does not heat a rear brake disc with drivetrain pumping work', () => {
    const track = new Track();
    const car = new BikeVehicle(
      0,
      'medium',
      { ...DEFAULT_SETUP, engineBrakeMap: 3 },
      'sport',
      VEHICLES.gpr1,
    );
    car.place(track, 120);
    car.dynamics.speed = 40;
    car.gear = 3;
    car.autoShift = false;
    car.input.throttle = 0;
    car.input.brake = 0;
    car.input.clutch = 0;
    car.tires.forEach((t) => {
      t.discTemp = 80;
    });
    car.step(DT, track);
    expect(car.dynamics.engineBrakeForce).toBeGreaterThan(0);
    expect(car.tires[2].discTemp).toBeLessThan(80);
    expect(car.dynamics.rearUse).toBeLessThanOrEqual(1.02);
    expect(car.dynamics.longitudinal).toBeCloseTo((car.dynamics.speed - 40) / DT, 7);
  });
});
