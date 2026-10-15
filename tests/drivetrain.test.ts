import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  carrierOmega,
  distributeDrive,
  drivenInertiaFactor,
  LOCKED,
  LOCKED_CAPACITY,
  lockingCapacity,
  lockingTorque,
  lsd,
  OPEN,
  type DrivelineSpec,
} from '../src/simulation/differential.ts';
import { makeTire, peakGrip } from '../src/simulation/tire.ts';
import { surfaceSample, SURFACE, type SurfaceSample } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import { TIRE_FAMILIES } from '../src/simulation/tire-families.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

/** Runway whose left (+X) half is wet grass-like low grip: a split-μ launch. */
class SplitTrack extends DynamicsTrack {
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    if (x > 0.3) out.grip = 0.35;
    return out;
  }
  override cast(...args: Parameters<DynamicsTrack['cast']>) {
    const d = super.cast(...args);
    if (args[0].x > 0.3) args[3].grip = 0.35;
    return d;
  }
}
const dt = 1 / 240;
function launch(def: VehicleDefinition, track: DynamicsTrack, seconds: number) {
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', def);
  car.place(track, 0);
  car.input.brake = 1;
  for (let t = 0; t < 1.5; t += dt) car.step(dt, track);
  car.input.brake = 0;
  car.input.throttle = 1;
  for (let t = 0; t < seconds; t += dt) car.step(dt, track);
  return car;
}
describe('WP17 differentials and all-wheel drive', () => {
  it('scales clutch-pack capacity with preload, ramp and setup; open has none', () => {
    const d = lsd(80, 0.4, 0.2);
    expect(lockingCapacity(OPEN, 1000, 0.5, 0.25)).toBe(0);
    expect(lockingCapacity(LOCKED, 0, 0.5, 0.25)).toBe(LOCKED_CAPACITY);
    // Default setup gives the sheet's ramps; power on drive, coast on overrun.
    expect(lockingCapacity(d, 1000, 0.5, 0.25)).toBeCloseTo(80 + 400, 9);
    expect(lockingCapacity(d, -1000, 0.5, 0.25)).toBeCloseTo(80 + 200, 9);
    expect(lockingCapacity(d, 1000, 1, 0.25)).toBeCloseTo(80 + 800, 9);
    expect(lockingCapacity(d, 1000, 0, 0.25)).toBe(80);
  });
  it('moves torque from the faster to the slower output, bounded by capacity', () => {
    const d = lsd(50, 0.3, 0.2);
    // b faster: torque added to a, magnitude limited to 50 + 0.3·400.
    const t = lockingTorque(d, 400, 10, 30, 1.5, dt, 0.5, 0.25);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeCloseTo(170, 9);
    expect(lockingTorque(d, 400, 30, 10, 1.5, dt, 0.5, 0.25)).toBeCloseTo(-170, 9);
    // Small difference: the equalizing impulse, not the capacity.
    expect(lockingTorque(d, 400, 10, 10.01, 1.5, dt, 0.5, 0.25)).toBeCloseTo(
      (0.01 * 1.5) / (2 * dt),
      9,
    );
    expect(lockingTorque(OPEN, 400, 0, 100, 1.5, dt, 0.5, 0.25)).toBe(0);
  });
  it('conserves drive torque through every layout and splits AWD by the centre', () => {
    const out = new Float64Array(4);
    const even = [50, 50, 50, 50];
    const layouts: [VehicleDefinition['drivetrain'], DrivelineSpec][] = [
      ['rwd', { rear: lsd(60, 0.4, 0.2) }],
      ['fwd', { front: OPEN }],
      ['awd', { centre: { ...OPEN, frontShare: 0.35 }, front: OPEN, rear: LOCKED }],
    ];
    for (const [drivetrain, line] of layouts) {
      distributeDrive(out, line, drivetrain, 1200, [50, 52, 49, 55], 1.4, dt, 0.5, 0.25);
      expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1200, 6);
    }
    distributeDrive(out, layouts[2][1], 'awd', 1000, even, 1.4, dt, 0.5, 0.25);
    expect(out[0] + out[1]).toBeCloseTo(350, 9);
    expect(out[2] + out[3]).toBeCloseTo(650, 9);
    distributeDrive(out, layouts[0][1], 'rwd', 1000, even, 1.4, dt, 0.5, 0.25);
    expect([out[0], out[1]]).toEqual([0, 0]);
    // A locked centre sends drive to the slower (gripping) axle.
    distributeDrive(
      out,
      { centre: { ...LOCKED, frontShare: 0.5 }, front: OPEN, rear: OPEN },
      'awd',
      1000,
      [60, 60, 40, 40],
      1.4,
      dt,
      0.5,
      0.25,
    );
    expect(out[2] + out[3]).toBeGreaterThan(out[0] + out[1]);
    expect(carrierOmega([10, 10, 20, 20], 0.25)).toBeCloseTo(17.5, 12);
    expect(drivenInertiaFactor(null)).toBe(1);
    expect(drivenInertiaFactor(0.5)).toBeCloseTo(2, 12);
  });
  it('a limited-slip axle out-launches an open one on split grip', () => {
    const base = VEHICLES.gt8f;
    const open: VehicleDefinition = { ...base, driveline: { rear: OPEN } };
    const track = new SplitTrack();
    const lsdCar = launch(base, track, 2.5),
      openCar = launch(open, new SplitTrack(), 2.5);
    expect(lsdCar.speed).toBeGreaterThan(openCar.speed * 1.15);
    // The open differential spins its low-grip wheel.
    expect(Math.abs(openCar.tires[3].omega - openCar.tires[2].omega)).toBeGreaterThan(
      Math.abs(lsdCar.tires[3].omega - lsdCar.tires[2].omega),
    );
  });
  it('all-wheel drive out-launches the same car driven through one axle', () => {
    const rally = VEHICLES.rl2;
    const rear: VehicleDefinition = {
      ...rally,
      drivetrain: 'rwd',
      driveline: { rear: rally.driveline!.rear },
    };
    const awd = launch(rally, new DynamicsTrack(), 1.6),
      rwd = launch(rear, new DynamicsTrack(), 1.6);
    expect(awd.speed).toBeGreaterThan(rwd.speed * 1.1);
    // Both axles carry drive in the AWD car.
    expect(Math.abs(awd.tires[0].fx)).toBeGreaterThan(500);
    expect(Math.abs(awd.tires[2].fx)).toBeGreaterThan(500);
  });
  it('gravel tyres keep grip a racing slick loses on loose surfaces', () => {
    const gravel = makeTire('medium', 155, 0.32, 1.4, 0.7, TIRE_FAMILIES.gravel.looseGrip);
    const slick = makeTire('medium', 155, 0.32, 1.4, 0.86);
    const loose = surfaceSample();
    loose.surface = SURFACE.GRAVEL;
    loose.grip = 0.4;
    const asphalt = surfaceSample();
    expect(peakGrip(gravel, 3000, loose, 20)).toBeGreaterThan(peakGrip(slick, 3000, loose, 20));
    expect(peakGrip(gravel, 3000, asphalt, 20)).toBeLessThan(peakGrip(slick, 3000, asphalt, 20));
    // Untagged tyres (APX-01, TC-1) see the surface grip unchanged.
    expect(slick.looseGrip).toBeUndefined();
  });
  it('the front-axle hybrid deploys only above its threshold speed', () => {
    const hy = VEHICLES.hy9;
    expect(hy.hybridAxle?.axle).toBe('front');
    const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', hy);
    const track = new DynamicsTrack();
    car.place(track, 0);
    car.input.throttle = 1;
    car.input.ers = 2;
    let slowPower = 0,
      fastPower = 0;
    for (let t = 0; t < 30; t += dt) {
      car.step(dt, track);
      if (car.speed < hy.hybridAxle!.minSpeed - 2) slowPower = Math.max(slowPower, car.motorPower);
      else if (car.speed > hy.hybridAxle!.minSpeed + 2)
        fastPower = Math.max(fastPower, car.motorPower);
    }
    expect(slowPower).toBe(0);
    expect(fastPower).toBeGreaterThan(50000);
  });
});
