import { describe, expect, it } from 'vitest';
import { clamp } from '../src/core/math.ts';
import { DEFAULT_SETUP, VEHICLE } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

const DT = 1 / 240;
function rolling(track: DynamicsTrack, speed: number, assist: 'sport' | 'raw') {
  const car = new Vehicle(0, 'soft', DEFAULT_SETUP, assist);
  car.place(track, 0);
  car.input.brake = 1;
  for (let i = 0; i < 480; i++) car.step(DT, track);
  car.input.brake = 0;
  car.body.velocity.set(0, 0, speed);
  for (const t of car.tires) t.omega = speed / t.radius;
  car.gear = clamp(Math.ceil(speed / 12), 1, 8);
  car.clutch.engineOmega = Math.max(
    (VEHICLE.idleRPM * Math.PI) / 30,
    (speed / VEHICLE.wheelRadius) * VEHICLE.gearRatios[car.gear + 1] * VEHICLE.finalDrive,
  );
  return car;
}

describe('rollover resistance', () => {
  for (const assist of ['sport', 'raw'] as const)
    for (const kind of ['runway', 'sausage-kerb'] as const)
      it(`slides rather than overturning at full lock (${assist}, ${kind})`, () => {
        for (const speed of [20, 50, 90]) {
          const track = new DynamicsTrack(kind);
          const car = rolling(track, speed, assist);
          let minUp = 1;
          for (let i = 0; i < 240 * 4; i++) {
            car.input.steer = Math.min(1, i / 30);
            car.input.throttle = 0.6;
            car.step(DT, track);
            minUp = Math.min(minUp, car.up.y);
          }
          expect(minUp, `${speed} m/s`).toBeGreaterThan(0.95);
        }
      });

  it('rights an overturned, stationary car on the circuit', () => {
    const track = new DynamicsTrack('runway');
    const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport');
    car.place(track, 50);
    car.body.orientation.x = 1;
    car.body.orientation.y = car.body.orientation.z = car.body.orientation.w = 0;
    let recovered = false;
    for (let i = 0; i < 240 * 3 && !recovered; i++) {
      car.step(DT, track);
      recovered = car.recoverIfUpset(DT, track);
    }
    expect(recovered).toBe(true);
    for (let i = 0; i < 240; i++) car.step(DT, track);
    expect(car.up.y).toBeGreaterThan(0.99);
    expect(car.retired).toBe(false);
  });
});
