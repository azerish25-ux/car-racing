import { clamp, mod } from '../../core/math.ts';
import { circuitDefinition, type CircuitId } from '../circuits.ts';
import { DEFAULT_SETUP } from '../config.ts';
import { Track, trackPoint } from '../track.ts';
import type { VehicleDefinition } from '../vehicles.ts';
import { DirtBikeVehicle } from './dirt-bike-vehicle.ts';
import type { JumpSurvey } from './profile.ts';
import { offroadCourse } from './venues.ts';

/** Headless off-road rig (calibration laboratory and tests): the production
 * DirtBikeVehicle on a production terrain venue; only the rider's inputs are
 * scripted — hold a speed along the course centreline, never brake on a
 * face — and the flight and landing are read from the adapter. */
const tracks = new Map<string, Track>();
export function rigTrack(venue: CircuitId) {
  let track = tracks.get(venue);
  if (!track) tracks.set(venue, (track = new Track('clear', false, undefined, circuitDefinition(venue))));
  return track;
}
const point = trackPoint();
/** Ride the centreline at `speed`: lean intent from lateral and heading error. */
export function rideLine(bike: DirtBikeVehicle, track: Track, speed: number) {
  const d = bike.dynamics;
  track.at(bike.s, point);
  const heading = Math.atan2(point.tx, point.tz),
    error = mod(heading - d.heading + Math.PI, Math.PI * 2) - Math.PI;
  bike.input.steer = clamp(-bike.lateral * 0.08 + error * 1.6, -1, 1);
  const e = speed - d.speed;
  bike.input.throttle = clamp(e * 0.5 + 0.2, 0, 1);
  bike.input.brake = clamp(-e * 0.3, 0, 1);
}
export function rigBike(def: VehicleDefinition, track: Track, s: number, speed: number) {
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
  bike.place(track, s, 0);
  bike.dynamics.speed = speed;
  // The rider aids (and the airborne pitch aid) of an AI rider.
  bike.aiControlled(1e9);
  const spec = def.spec;
  for (let g = 1; g < spec.gearRatios.length - 1; g++) {
    bike.gear = g;
    const rpm = ((speed / spec.wheelRadius) * spec.gearRatios[g + 1] * spec.finalDrive * 30) / Math.PI;
    if (rpm < spec.shiftRPM * 0.85) break;
  }
  return bike;
}
export interface JumpRunResult {
  flew: boolean;
  takeoffSpeed: number;
  distance: number;
  airTime: number;
  pitchError: number;
  normalSpeed: number;
  bottomSpeed: number;
  outcome: string;
  crashes: number;
  landingS: number;
}
/** Approach jump `j` holding `lip` m/s (riders do not brake on a face) and
 * report the flight and the landing judgement. */
export function jumpRun(
  def: VehicleDefinition,
  venue: CircuitId,
  j: JumpSurvey,
  lip: number,
  dt = 1 / 240,
  runUp = 12,
): JumpRunResult {
  const track = rigTrack(venue);
  const bike = rigBike(def, track, j.start - runUp, lip);
  let flew = false,
    takeoffSpeed = 0;
  for (let t = 0; t < 6; t += dt) {
    const before = bike.airborne;
    const onFace = bike.s >= j.start - 1 && bike.s <= j.takeoff + 1;
    if (!bike.airborne) rideLine(bike, track, onFace ? Math.max(lip, bike.dynamics.speed) : lip);
    bike.step(dt, track);
    if (!before && bike.airborne && !flew) {
      flew = true;
      takeoffSpeed = bike.lastTakeoff;
    }
    if (flew && before && !bike.airborne) break;
    if (!bike.riding) break;
  }
  for (let t = 0; t < 0.4 && bike.riding; t += dt) {
    rideLine(bike, track, lip);
    bike.step(dt, track);
  }
  const landing = bike.lastLanding;
  return {
    flew,
    takeoffSpeed,
    distance: landing?.distance ?? 0,
    airTime: landing?.airTime ?? 0,
    pitchError: landing?.pitchError ?? 0,
    normalSpeed: landing?.normalSpeed ?? 0,
    bottomSpeed: landing?.bottomSpeed ?? 0,
    outcome: landing?.outcome ?? (bike.riding ? 'none' : 'crash-ground'),
    crashes: bike.dynamics.crashes,
    landingS: landing?.s ?? 0,
  };
}
/** Standing start from the gate line on a venue: seconds to cover `metres`. */
export function standingStart(def: VehicleDefinition, venue: CircuitId, metres = 60, dt = 1 / 240) {
  const track = rigTrack(venue),
    course = offroadCourse(track.circuit)!;
  const bike = rigBike(def, track, mod(course.spec.gate!.s - 1.5, track.length), 0);
  bike.gear = 1;
  const s0 = bike.s;
  for (let t = 0; t < 12; t += dt) {
    track.at(bike.s, point);
    bike.input.throttle = 1;
    bike.input.brake = 0;
    bike.input.steer = clamp(-bike.lateral * 0.08, -1, 1);
    bike.step(dt, track);
    if (mod(bike.s - s0, track.length) >= metres) return { seconds: t, crashes: bike.dynamics.crashes };
  }
  return { seconds: null, crashes: bike.dynamics.crashes };
}
