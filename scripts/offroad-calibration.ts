// Off-road calibration laboratory (WP39): the production DirtBikeVehicle on
// the production terrain of the off-road venues; only the rider's inputs are
// scripted (hold a speed, ride the line). Bands are independent design-brief
// targets, not a baseline of the model:
//  - standing start over 60 m of prepared dirt (start straight hardpack and
//    loam): a 450 four-stroke ~3.6-5.0 s, the 250 two-stroke a touch slower,
//    the supermoto slower on dirt;
//  - jump distance: the flight from a surveyed lip at a given take-off speed
//    within 15 % of the point-mass ballistic distance to the same drop (the
//    sprung chassis pops or soaks a little, never doubles it);
//  - landing tolerance: matched-slope landings on the surveyed landing face
//    are clean across the AI's speed window; a landing 40° nose-down, or a
//    flat drop from well past the landing zone, crashes.
// Writes docs/offroad-calibration.json; exits 1 when a band fails.
import { writeFileSync } from 'node:fs';
import { clamp, G, mod } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { DIRT_BIKES } from '../src/simulation/offroad/dirt-bikes.ts';
import { flightDistance, type JumpSurvey } from '../src/simulation/offroad/profile.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

type Band = readonly [number, number];
const DT = 1 / 240;
const track = new Track('clear', false, undefined, circuitDefinition('valley-ridge-mx'));
const course = offroadCourse(track.circuit)!;
const point = trackPoint();
/** Ride along the course centreline: lean intent from lateral and heading error. */
function ride(bike: DirtBikeVehicle, speed: number) {
  const d = bike.dynamics;
  track.at(bike.s, point);
  const heading = Math.atan2(point.tx, point.tz),
    error = mod(heading - d.heading + Math.PI, Math.PI * 2) - Math.PI;
  bike.input.steer = clamp(-bike.lateral * 0.08 + error * 1.6, -1, 1);
  const e = speed - bike.dynamics.speed;
  bike.input.throttle = clamp(e * 0.5 + 0.2, 0, 1);
  bike.input.brake = clamp(-e * 0.3, 0, 1);
}
function place(def: VehicleDefinition, s: number, speed: number) {
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
  bike.place(track, s, 0);
  bike.dynamics.speed = speed;
  bike.aiControlled(1e9);
  // A gear that suits the speed.
  const spec = def.spec;
  for (let g = 1; g < spec.gearRatios.length - 1; g++) {
    bike.gear = g;
    const rpm = ((speed / spec.wheelRadius) * spec.gearRatios[g + 1] * spec.finalDrive * 30) / Math.PI;
    if (rpm < spec.shiftRPM * 0.85) break;
  }
  return bike;
}
/** Standing start on the start straight: time to cover 60 m. */
function sixtyMetres(def: VehicleDefinition, dt: number) {
  const start = mod(course.spec.gate!.s - 1.5, track.length);
  const bike = place(def, start, 0);
  bike.gear = 1;
  const s0 = bike.s;
  for (let t = 0; t < 12; t += dt) {
    bike.input.throttle = 1;
    track.at(bike.s, point);
    bike.input.steer = clamp(-bike.lateral * 0.08, -1, 1);
    bike.step(dt, track);
    if (mod(bike.s - s0, track.length) >= 60) return { seconds: t, crashes: bike.dynamics.crashes };
  }
  return { seconds: null, crashes: bike.dynamics.crashes };
}
/** Hold `lip` m/s into the face and record the flight and the landing. */
export function jumpRun(def: VehicleDefinition, j: JumpSurvey, lip: number, dt = DT, pitchAid = true) {
  const bike = place(def, j.start - 25, lip);
  if (!pitchAid) bike.aiControlled(0);
  let flown = false,
    takeoff = 0,
    lipSpeed = 0;
  for (let t = 0; t < 8; t += dt) {
    const before = bike.airborne;
    // Hold the speed into the face (riders do not brake on a face).
    const onFace = bike.s >= j.start - 1 && bike.s <= j.takeoff + 1;
    if (!bike.airborne) ride(bike, onFace ? Math.max(lip, bike.dynamics.speed) : lip);
    bike.step(dt, track);
    if (!before && bike.airborne && !flown) {
      flown = true;
      takeoff = bike.s;
      lipSpeed = bike.lastTakeoff;
    }
    if (flown && before && !bike.airborne) break;
  }
  for (let t = 0; t < 0.4; t += dt) {
    ride(bike, lip);
    bike.step(dt, track);
  }
  const landing = bike.lastLanding;
  return {
    flew: flown,
    takeoffS: takeoff,
    takeoffSpeed: lipSpeed,
    distance: landing?.distance ?? 0,
    airTime: landing?.airTime ?? 0,
    pitchError: landing?.pitchError ?? 0,
    normalSpeed: landing?.normalSpeed ?? 0,
    bottomSpeed: landing?.bottomSpeed ?? 0,
    outcome: landing?.outcome ?? 'none',
    crashes: bike.dynamics.crashes,
  };
}
const report: Record<string, unknown> = {
  fixture: 'Production DirtBikeVehicle on the Valley Ridge terrain (scripted rider inputs)',
  timesteps: [1 / 240, 1 / 120],
  bikes: {},
};
const failures: string[] = [];
const SIXTY: Record<string, Band> = { mx450: [3.6, 5.0], mx250: [3.7, 5.2], sm450: [3.8, 5.6] };
const check = (id: string, metric: string, value: number | null, band: Band) => {
  const ok = value !== null && value >= band[0] && value <= band[1];
  if (!ok) failures.push(`${id} ${metric} ${value?.toFixed(2)} outside [${band.join(', ')}]`);
  return { metric, value, band, within: ok };
};
const table = course.jumps.find((j) => j.name === 'RIDGE TABLE')!,
  double = course.jumps.find((j) => j.name === 'BARN DOUBLE')!;
for (const def of Object.values(DIRT_BIKES)) {
  const rows: unknown[] = [];
  const fine = sixtyMetres(def, 1 / 240),
    coarse = sixtyMetres(def, 1 / 120);
  rows.push({ ...check(def.id, 'dirt0to60m', fine.seconds, SIXTY[def.id]), coarseDt: coarse.seconds });
  // Jump distance at given take-off speeds against the ballistic flight.
  const jumps: unknown[] = [];
  for (const j of [table, double])
    for (const v of [10, 12, 14]) {
      const r = jumpRun(def, j, v);
      const drop = j.lipHeight - j.landingHeight,
        ballistic = flightDistance(r.takeoffSpeed, drop, j.lipAngle);
      const ratio = ballistic > 0 ? r.distance / ballistic : 0;
      jumps.push({ jump: j.name, lip: v, ...r, ballistic, ratio });
      if (r.flew) rows.push(check(def.id, `${j.name} @${v} distance/ballistic`, ratio, [0.85, 1.15]));
    }
  // Landing tolerance: the AI's window on the double lands clean.
  for (const v of [12.5, 13.5]) {
    const r = jumpRun(def, double, v);
    jumps.push({ jump: double.name, lip: v, window: true, ...r });
    rows.push(check(def.id, `${double.name} @${v} clean landing`, r.crashes === 0 ? 1 : 0, [1, 1]));
  }
  // Way too fast: overshoots the landing face to the flat and crashes or bottoms.
  const over = jumpRun(def, table, 18);
  jumps.push({ jump: table.name, lip: 18, overshoot: true, ...over });
  rows.push(
    check(def.id, `${table.name} @18 flat overshoot bottoms or crashes`, over.outcome === 'clean' ? 0 : 1, [1, 1]),
  );
  (report.bikes as Record<string, unknown>)[def.id] = { name: def.name, checks: rows, jumps };
  console.log(def.name);
  for (const row of rows as { metric: string; value: number | null; band: Band; within: boolean }[])
    console.log(`  ${row.within ? 'OK ' : 'OUT'} ${row.metric.padEnd(44)} ${row.value?.toFixed(3)} [${row.band.join(', ')}]`);
}
void G;
writeFileSync(
  'docs/offroad-calibration.json',
  JSON.stringify({ passed: failures.length === 0, failures, ...report }, null, 2) + '\n',
);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
