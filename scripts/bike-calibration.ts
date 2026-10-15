// Motorcycle measurements for the vehicle calibration laboratory (WP33/WP17).
// The production BikeVehicle adapter and its dynamics core run unchanged on
// the isolated analytic runway; only the rider's inputs are scripted. Bands
// are independent design-brief targets for each class (not a baseline of the
// model itself): a ~300 hp / 157 kg prototype class with wings and a ~215 hp
// / 200 kg production-based superbike, both on racing slicks with rider aids.
// Braking from 100 km/h is stoppie-limited (CG geometry: ~1.0-1.15 g plus drag).
import { clamp, G } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { isDirtBike } from '../src/simulation/offroad/dirt-bikes.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';
import { DynamicsTrack } from './dynamics-fixtures.ts';

type Band = readonly [number, number];
export const BIKE_TARGETS: Record<string, Record<string, Band>> = {
  gpr1: {
    accel0to100: [2.4, 3.4],
    topSpeed: [335, 365],
    braking100Distance: [30, 42],
    lateral80G: [1.15, 1.5],
  },
  sbk1000: {
    accel0to100: [2.7, 3.8],
    topSpeed: [285, 320],
    braking100Distance: [32, 45],
    lateral80G: [1.1, 1.45],
  },
  // Off-road machines (WP37) on the same asphalt runway: knobby tyres, short
  // gearing and a ~120-150 km/h top end; the supermoto on treaded road tyres.
  // Acceleration is wheelie-limited: with the rider seated the combined CG
  // stands ~0.86 m over a 1.48 m wheelbase (g·b/h ≈ 8.3 m/s²), and the anti-
  // wheelie aid keeps a margin under that, so 0-100 km/h takes 4-5 s.
  mx450: {
    accel0to100: [3.4, 5.4],
    topSpeed: [118, 145],
    braking100Distance: [40, 62],
    lateral80G: [0.75, 1.1],
  },
  mx250: {
    accel0to100: [3.6, 5.6],
    topSpeed: [118, 145],
    braking100Distance: [40, 62],
    lateral80G: [0.75, 1.1],
  },
  sm450: {
    accel0to100: [3.4, 5.2],
    topSpeed: [138, 165],
    braking100Distance: [34, 50],
    lateral80G: [0.95, 1.3],
  },
};
function rider(def: VehicleDefinition, track: DynamicsTrack) {
  // Off-road machines run their own adapter (long travel, flight, posture).
  const bike = isDirtBike(def)
    ? new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', def)
    : new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
  bike.place(track, 0);
  return bike;
}
function acceleration(def: VehicleDefinition, dt: number) {
  const track = new DynamicsTrack();
  const bike = rider(def, track);
  bike.input.throttle = 1;
  let to100: number | null = null,
    peak = 0,
    sinceGain = 0;
  for (let t = 0; t < 120 && sinceGain < 4; t += dt) {
    bike.step(dt, track);
    if (to100 === null && bike.speed * 3.6 >= 100) to100 = t;
    if (bike.speed > peak + 0.01) {
      peak = bike.speed;
      sinceGain = 0;
    } else sinceGain += dt;
  }
  return { to100s: to100, topSpeedKmh: peak * 3.6, crashes: bike.dynamics.crashes };
}
function rolling(def: VehicleDefinition, track: DynamicsTrack, kmh: number, dt: number) {
  const bike = rider(def, track);
  bike.input.throttle = 1;
  // Accelerate to the test speed, then hold it on part throttle.
  for (let t = 0; t < 30 && bike.speed * 3.6 < kmh; t += dt) bike.step(dt, track);
  return bike;
}
function braking(def: VehicleDefinition, dt: number, kmh: number) {
  const track = new DynamicsTrack('runway');
  const bike = rolling(def, track, kmh, dt);
  const start = bike.dynamics.z;
  bike.input.throttle = 0;
  bike.input.brake = 1;
  bike.input.clutch = 1; // rear brake on the secondary input
  let peakG = 0,
    previous = bike.speed,
    ticks = 0;
  for (; ticks * dt < 20 && bike.speed > 0.2; ticks++) {
    bike.step(dt, track);
    if (ticks % 10 === 9) {
      peakG = Math.max(peakG, (previous - bike.speed) / (10 * dt) / G);
      previous = bike.speed;
    }
  }
  return { distanceM: bike.dynamics.z - start, peakG, crashes: bike.dynamics.crashes };
}
/** Constant-speed lean ramp: peak filtered lateral acceleration the rider aid holds. */
function lateral(def: VehicleDefinition, dt: number, kmh: number) {
  const track = new DynamicsTrack();
  const speed = kmh / 3.6;
  const bike = rolling(def, track, kmh, dt);
  let intent = 0,
    filtered = 0,
    peak = 0;
  for (let t = 0; t < 30 && bike.riding; t += dt) {
    intent = Math.min(1, intent + 0.15 * dt);
    bike.input.steer = intent;
    bike.input.throttle = clamp((speed - bike.speed) * 0.6 + 0.25, 0, 1);
    bike.step(dt, track);
    filtered += (Math.abs(bike.gLat) - filtered) * Math.min(1, dt / 0.25);
    peak = Math.max(peak, filtered);
    if (intent >= 1 && t > 12) break;
  }
  return { peakG: peak, crashes: bike.dynamics.crashes };
}
export function measureBike(def: VehicleDefinition, dt: number) {
  const accel = acceleration(def, dt);
  const brake = braking(def, dt, 100);
  const lat = lateral(def, dt, 80);
  return {
    accel0to100: accel.to100s,
    topSpeed: accel.topSpeedKmh,
    braking100Distance: brake.distanceM,
    braking100PeakG: brake.peakG,
    lateral80G: lat.peakG,
    crashes: accel.crashes + brake.crashes + lat.crashes,
    lateralFit: { base: lat.peakG * G, aero: 0 },
  };
}
