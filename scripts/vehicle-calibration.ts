// Vehicle calibration laboratory (masterplan §7.2, WP17). Every registered
// vehicle definition runs the unchanged production solver on the isolated
// analytic runway and skidpad; only inputs are scripted. Each metric is
// measured at two fixed timesteps to expose numerical fragility, and compared
// with independently chosen target bands from the vehicle's design brief (not
// with a freshly generated baseline of itself). Writes
// docs/vehicle-calibration.json; --strict exits 1 when a metric is out of band.
import { writeFileSync } from 'node:fs';
import { clamp, G } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import { DynamicsTrack } from './dynamics-fixtures.ts';
import { BIKE_TARGETS, measureBike } from './bike-calibration.ts';

const strict = process.argv.includes('--strict');
type Band = readonly [number, number];
/** Design-brief target bands. Formula: public F1 figures (reference-targets.ts).
 * TC-1: an original 1.3 t front-drive touring saloon on slicks. */
const TARGETS: Record<string, Record<string, Band>> = {
  apx01: {
    accel0to100: [2.3, 3.2],
    topSpeed: [320, 360],
    braking100Distance: [15, 32],
    lateral80G: [1.8, 3.2],
  },
  tc1: {
    accel0to100: [4.8, 7.5],
    topSpeed: [205, 255],
    braking100Distance: [26, 42],
    lateral80G: [1.0, 1.45],
  },
};

function standing(
  def: VehicleDefinition,
  track: DynamicsTrack,
  dt: number,
  assist: 'raw' | 'sport',
) {
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, assist, def);
  car.place(track, 0);
  car.input.brake = 1;
  for (let t = 0; t < 2; t += dt) car.step(dt, track);
  car.input.brake = 0;
  return car;
}
function rolling(def: VehicleDefinition, track: DynamicsTrack, dt: number, speed: number) {
  const car = standing(def, track, dt, 'raw');
  car.body.velocity.set(0, 0, speed);
  car.speed = speed;
  for (const tire of car.tires) tire.omega = speed / tire.radius;
  const spec = def.spec,
    top = spec.gearRatios.length - 2;
  // Highest gear that keeps the engine above its downshift point.
  let gear = top;
  while (
    gear > 1 &&
    ((speed / spec.wheelRadius) * spec.gearRatios[gear + 1] * spec.finalDrive * 30) / Math.PI <
      spec.downshiftRPM
  )
    gear--;
  car.gear = gear;
  car.clutch.engineOmega = Math.max(
    (spec.idleRPM * Math.PI) / 30,
    (speed / spec.wheelRadius) * spec.gearRatios[car.gear + 1] * spec.finalDrive,
  );
  return car;
}
function acceleration(def: VehicleDefinition, dt: number) {
  const track = new DynamicsTrack();
  const car = standing(def, track, dt, 'sport');
  car.input.throttle = 1;
  car.input.ers = 2;
  let to100: number | null = null,
    peak = 0,
    sinceGain = 0;
  for (let t = 0; t < 120 && sinceGain < 4; t += dt) {
    car.step(dt, track);
    if (to100 === null && car.speed * 3.6 >= 100) to100 = t;
    if (car.speed > peak + 0.01) {
      peak = car.speed;
      sinceGain = 0;
    } else sinceGain += dt;
  }
  return { to100s: to100, topSpeedKmh: peak * 3.6 };
}
function braking(def: VehicleDefinition, dt: number, kmh: number) {
  const track = new DynamicsTrack('runway');
  const car = standing(def, track, dt, 'sport');
  const fast = rolling(def, track, dt, kmh / 3.6);
  void car;
  const start = fast.body.position.z;
  fast.input.brake = 1;
  let peakG = 0,
    previous = fast.speed,
    ticks = 0;
  for (; ticks * dt < 20 && fast.speed > 0.2; ticks++) {
    fast.step(dt, track);
    if (ticks % 10 === 9) {
      peakG = Math.max(peakG, (previous - fast.speed) / (10 * dt) / G);
      previous = fast.speed;
    }
  }
  return { distanceM: fast.body.position.z - start, peakG };
}
/** Constant-speed ramp steer: peak filtered lateral acceleration. */
function lateral(def: VehicleDefinition, dt: number, kmh: number) {
  const track = new DynamicsTrack();
  const speed = kmh / 3.6;
  const car = rolling(def, track, dt, speed);
  let steer = 0,
    filtered = 0,
    peak = 0;
  for (let t = 0; t < 60; t += dt) {
    steer += 0.012 * dt;
    car.input.steer = steer;
    car.input.throttle = clamp((speed - car.speed) * 0.6 + 0.2, 0, 1);
    car.step(dt, track);
    filtered += (Math.abs(car.gLat) - filtered) * Math.min(1, dt / 0.25);
    peak = Math.max(peak, filtered);
    if (t > 2 && filtered < peak * 0.85) break;
    if (car.speed < speed * 0.8) break;
  }
  return peak;
}
/** Least-squares base + aero·v² through measured (v, a) pairs (m/s, m/s²). */
function fit(points: readonly (readonly [number, number])[]) {
  const n = points.length;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (const [v, a] of points) {
    const x = v * v;
    sx += x;
    sy += a;
    sxx += x * x;
    sxy += x * a;
  }
  const slope = Math.max(0, (n * sxy - sx * sy) / (n * sxx - sx * sx || 1));
  return { base: (sy - slope * sx) / n, aero: slope };
}
function measure(def: VehicleDefinition, dt: number) {
  const accel = acceleration(def, dt);
  const brake = braking(def, dt, 100);
  const speeds = [60, 80, 110, 150];
  const lat = speeds.map((kmh) => [kmh / 3.6, lateral(def, dt, kmh) * G] as const);
  return {
    accel0to100: accel.to100s,
    topSpeed: accel.topSpeedKmh,
    braking100Distance: brake.distanceM,
    braking100PeakG: brake.peakG,
    lateral80G: lat[1][1] / G,
    lateralFit: fit(lat),
  };
}
const report: Record<string, unknown> = {
  fixture: 'Production Vehicle per definition on isolated analytic runway/skidpad',
  timesteps: [1 / 240, 1 / 120],
  vehicles: {},
};
let outside = 0;
for (const def of Object.values(VEHICLES)) {
  // Motorcycles run their own adapter on the same runway (bike-calibration.ts).
  const run = def.dynamicsKind === 'bike' ? measureBike : measure;
  const fine = run(def, 1 / 240),
    coarse = run(def, 1 / 120);
  const targets = TARGETS[def.id] ?? BIKE_TARGETS[def.id] ?? {};
  const comparison = Object.entries(targets).map(([metric, band]) => {
    const value = fine[metric as keyof typeof fine] as number | null,
      other = coarse[metric as keyof typeof coarse] as number | null;
    const within = value !== null && value >= band[0] && value <= band[1];
    // Timestep agreement: a fragile solver changes results with dt.
    const drift = value !== null && other !== null ? Math.abs(value - other) / Math.abs(value) : 1;
    if (!within) outside++;
    return { metric, measured: value, coarseDt: other, band, within, timestepDrift: drift };
  });
  (report.vehicles as Record<string, unknown>)[def.id] = {
    name: def.name,
    version: def.version,
    comparison,
    lateralEnvelopeFit: fine.lateralFit,
    aiEnvelope: def.ai,
  };
  console.log(`${def.name} (${def.id} v${def.version})`);
  for (const c of comparison)
    console.log(
      `  ${c.within ? 'OK ' : 'OUT'} ${c.metric.padEnd(20)} ${c.measured?.toFixed(2)} [${c.band.join(', ')}] dt-drift ${(c.timestepDrift * 100).toFixed(1)}%`,
    );
  console.log(
    `  lateral fit: base ${fine.lateralFit.base.toFixed(2)} m/s², aero ${fine.lateralFit.aero.toExponential(2)}`,
  );
}
writeFileSync('docs/vehicle-calibration.json', JSON.stringify(report, null, 2) + '\n');
if (strict && outside) process.exitCode = 1;
