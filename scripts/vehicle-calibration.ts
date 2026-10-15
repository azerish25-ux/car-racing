// Vehicle calibration laboratory (masterplan §7.2, WP17). Every registered
// vehicle definition runs the unchanged production solver on the isolated
// analytic runway and skidpad; only inputs are scripted. Each metric is
// measured at two fixed timesteps to expose numerical fragility, and compared
// with independently chosen target bands from the vehicle's design brief (not
// with a freshly generated baseline of itself). Writes
// docs/vehicle-calibration.json; --strict exits 1 when a metric is out of band.
// --only=id,id measures just those definitions (authoring loop) and writes
// nothing, so the committed report always covers the whole registry.
import { readFileSync, writeFileSync } from 'node:fs';
import { clamp, G } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import { CATALOGUE_BANDS } from '../src/simulation/vehicle-catalogue/index.ts';
import { vehicleHash } from '../src/core/session-identity.ts';
import { DynamicsTrack } from './dynamics-fixtures.ts';
import { BIKE_TARGETS, measureBike } from './bike-calibration.ts';
import {
  nearEdgeTable,
  PRE_GROWTH_IDS,
  withNearEdgeTable,
  type CalibrationReport,
} from './calibration-margins.ts';

const strict = process.argv.includes('--strict');
const only = process.argv
  .find((a) => a.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',');
type Band = readonly [number, number];
/** Design-brief target bands. Formula: public F1 figures (reference-targets.ts).
 * TC-1: an original 1.3 t front-drive touring saloon on slicks. Catalogue
 * vehicles carry their bands beside their sheets (vehicle-catalogue/). */
const TARGETS: Record<string, Record<string, Band>> = {
  ...Object.fromEntries(Object.entries(CATALOGUE_BANDS).map(([id, bands]) => [id, { ...bands }])),
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
/** (speed, deceleration) samples every 0.1 s of a full ABS stop. */
function brakingCurve(def: VehicleDefinition, dt: number, kmh: number) {
  const track = new DynamicsTrack('runway');
  const car = rolling(def, track, dt, kmh / 3.6);
  car.input.brake = 1;
  const samples: (readonly [number, number])[] = [];
  const window = Math.round(0.1 / dt);
  let previous = car.speed;
  for (let tick = 1; tick * dt < 30 && car.speed > 12; tick++) {
    car.step(dt, track);
    if (tick % window) continue;
    if (tick * dt > 0.4) samples.push([(previous + car.speed) / 2, (previous - car.speed) / 0.1]);
    previous = car.speed;
  }
  return samples;
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
/** Steady straight-line aero at `kmh` (or 90% of top speed if lower):
 * ClA, CdA and the front axle's share of downforce. */
function aeroAt(def: VehicleDefinition, dt: number, kmh: number) {
  const track = new DynamicsTrack();
  const speed = kmh / 3.6;
  const car = rolling(def, track, dt, speed);
  let downforce = 0,
    front = 0,
    drag = 0,
    fan = 0,
    n = 0;
  const L = def.spec.wheelbase,
    rearAxle = def.wheelPositions[2][2];
  for (let t = 0; t < 4; t += dt) {
    car.input.throttle = clamp((speed - car.speed) * 0.8 + 0.3, 0, 1);
    car.step(dt, track);
    if (t < 2) continue;
    const a = car.aero,
      total = a.front + a.rear + a.floor;
    downforce += total;
    front +=
      (a.front * (def.aero.frontZ - rearAxle) +
        a.rear * (def.aero.rearZ - rearAxle) +
        a.floor * -rearAxle) /
      L;
    drag += a.drag;
    fan += car.fanForce;
    n++;
  }
  const q = 0.5 * def.spec.airDensity * car.speed * car.speed;
  return {
    speedKmh: car.speed * 3.6,
    clA: downforce / n / q,
    cdA: drag / n / q,
    balance: downforce > 0 ? front / downforce : null,
    // Speed-independent fan suction (N), reported apart from ClA.
    ...(def.fan ? { fanN: fan / n } : {}),
  };
}
const ENVELOPE_SPEEDS = [60, 80, 110, 150];
/** Lateral and braking envelope fits (the AI's base + aero·v² model). */
function envelopeFits(def: VehicleDefinition, dt: number, topSpeedKmh: number) {
  // Braking envelope: deceleration along one full stop from high speed.
  const stops = brakingCurve(def, dt, Math.min(250, topSpeedKmh * 0.9));
  const lat = ENVELOPE_SPEEDS.map((kmh) => [kmh / 3.6, lateral(def, dt, kmh) * G] as const);
  return { lat, lateralFit: fit(lat), brakingFit: fit(stops) };
}
/** A fan-assisted floor's share of the base limits: the fan-on fit less the
 * same fit with the fan removed (CapabilityEnvelope.fanBase; the AI scales
 * it with floor health as the solver scales the suction). */
function fanShare(
  def: VehicleDefinition,
  dt: number,
  topSpeedKmh: number,
  on: ReturnType<typeof envelopeFits>,
) {
  const bare: VehicleDefinition = { ...def };
  delete (bare as { fan?: unknown }).fan;
  const off = envelopeFits(bare, dt, topSpeedKmh);
  return {
    lateralFanOff: off.lateralFit,
    brakingFanOff: off.brakingFit,
    lateral: on.lateralFit.base - off.lateralFit.base,
    braking: on.brakingFit.base - off.brakingFit.base,
  };
}
function measure(def: VehicleDefinition, dt: number) {
  const accel = acceleration(def, dt);
  const brake = braking(def, dt, 100);
  const fits = envelopeFits(def, dt, accel.topSpeedKmh),
    lat = fits.lat;
  return {
    accel0to100: accel.to100s,
    topSpeed: accel.topSpeedKmh,
    braking100Distance: brake.distanceM,
    braking100PeakG: brake.peakG,
    lateral80G: lat[1][1] / G,
    lateralFit: fits.lateralFit,
    brakingFit: fits.brakingFit,
    aero: aeroAt(def, dt, Math.min(200, accel.topSpeedKmh * 0.9)),
    ...(def.fan ? { fanShare: fanShare(def, dt, accel.topSpeedKmh, fits) } : {}),
  };
}
const report: Record<string, unknown> = {
  fixture: 'Production Vehicle per definition on isolated analytic runway/skidpad',
  timesteps: [1 / 240, 1 / 120],
  vehicles: {},
};
let outside = 0;
for (const def of Object.values(VEHICLES)) {
  if (only && !only.includes(def.id)) continue;
  // Motorcycles run their own adapter on the same runway (bike-calibration.ts).
  const run = def.dynamicsKind === 'bike' ? measureBike : measure;
  const fine = run(def, 1 / 240),
    coarse = run(def, 1 / 120);
  const targets = TARGETS[def.id] ?? BIKE_TARGETS[def.id] ?? {};
  const comparison = Object.entries(targets).map(([metric, band]) => {
    const value = fine[metric as keyof typeof fine] as number | null,
      other = coarse[metric as keyof typeof coarse] as number | null;
    const within = value !== null && value >= band[0] && value <= band[1];
    const coarseWithin = other !== null && other >= band[0] && other <= band[1];
    // Timestep agreement: a fragile solver changes results with dt.
    const drift = value !== null && other !== null ? Math.abs(value - other) / Math.abs(value) : 1;
    if (!within || !coarseWithin) outside++;
    return {
      metric,
      measured: value,
      coarseDt: other,
      band,
      within,
      coarseWithin,
      timestepDrift: drift,
    };
  });
  // Four-wheel runs also fit the braking envelope and measure the aero map;
  // the bike adapter reports lateral fit only.
  const braking = 'brakingFit' in fine ? fine.brakingFit : null,
    aero = 'aero' in fine ? fine.aero : null,
    fan = 'fanShare' in fine ? fine.fanShare : null;
  (report.vehicles as Record<string, unknown>)[def.id] = {
    name: def.name,
    version: def.version,
    hash: vehicleHash(def),
    comparison,
    lateralEnvelopeFit: fine.lateralFit,
    ...(braking ? { brakingEnvelopeFit: braking } : {}),
    ...(aero ? { aero } : {}),
    ...(fan ? { fanEnvelopeShare: fan } : {}),
    aiEnvelope: def.ai,
  };
  console.log(`${def.name} (${def.id} v${def.version})`);
  for (const c of comparison)
    console.log(
      `  ${c.within && c.coarseWithin ? 'OK ' : 'OUT'} ${c.metric.padEnd(20)} ${c.measured?.toFixed(2)} / ${c.coarseDt?.toFixed(2)} [${c.band.join(', ')}] dt-drift ${(c.timestepDrift * 100).toFixed(1)}%`,
    );
  console.log(
    `  lateral fit: base ${fine.lateralFit.base.toFixed(2)} m/s², aero ${fine.lateralFit.aero.toExponential(2)}` +
      (braking
        ? ` · braking fit: base ${braking.base.toFixed(2)}, aero ${braking.aero.toExponential(2)}`
        : ''),
  );
  if (fan)
    console.log(
      `  fan share of the base limits: lateral ${fan.lateral.toFixed(2)} m/s², braking ${fan.braking.toFixed(2)} m/s²`,
    );
  if (aero)
    console.log(
      `  aero @${aero.speedKmh.toFixed(0)} km/h: ClA ${aero.clA.toFixed(2)} m², CdA ${aero.cdA.toFixed(2)} m², front ${aero.balance === null ? '—' : (aero.balance * 100).toFixed(1) + '%'}`,
    );
}
if (!only) {
  writeFileSync('docs/vehicle-calibration.json', JSON.stringify(report, null, 2) + '\n');
  // The near-edge disclosure (CONTENT_PIPELINE.md §1.3) is generated here.
  const doc = 'docs/production/CONTENT_PIPELINE.md';
  const table = nearEdgeTable(report as unknown as CalibrationReport, new Set(PRE_GROWTH_IDS));
  writeFileSync(doc, withNearEdgeTable(readFileSync(doc, 'utf8'), table));
  console.log(`\n${table}`);
}
if (strict && outside) process.exitCode = 1;
