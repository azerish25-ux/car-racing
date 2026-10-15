import { sampleAeroMap } from './aero-map.ts';
import { smooth, Vec3 } from '../core/math.ts';
import { VEHICLE, type Setup } from './config.ts';
import { DRS } from './drs.ts';
const FORMULA_BODY = Object.freeze({ downforce: 1, drag: 1 });
/** Aero platform behaviour of one body (docs/production/PHYSICS_MODEL.md §4).
 * Floor centre of pressure (car-local z, m) at the reference attitude and its
 * migration per rad of pitch and per m of mean floor height; the underbody
 * flow's convective lag length (m: map inputs lag by length/V); plunge damping
 * area (m²: F = −½ρV·S·ż at each axle station, the quasi-steady lift of a
 * heaving floor, which keeps the lagged stall region from self-exciting); and
 * this body's dirty-air and slipstream strength as a leader. */
export interface AeroDynamics {
  readonly floorCentre: number;
  readonly floorCentrePitch: number;
  readonly floorCentreHeight: number;
  readonly referencePitch: number;
  readonly referenceHeight: number;
  readonly lagLength: number;
  readonly plungeArea: number;
  readonly wakeStrength: number;
  readonly towStrength: number;
}
/** Formula floor: the centre of pressure moves forward as the nose drops or
 * the floor approaches the ground (rake and heave sensitivity). */
export const FORMULA_AERO_DYNAMICS: AeroDynamics = Object.freeze({
  floorCentre: 0,
  floorCentrePitch: -4,
  floorCentreHeight: -1.5,
  referencePitch: -0.003,
  referenceHeight: 0.04,
  lagLength: 0.5,
  plungeArea: 3,
  wakeStrength: 1,
  towStrength: 1,
});
/** Saloon: almost no underbody load, a large drag wake that tows well. */
export const TOURING_AERO_DYNAMICS: AeroDynamics = Object.freeze({
  floorCentre: 0,
  floorCentrePitch: 0,
  floorCentreHeight: 0,
  referencePitch: 0,
  referenceHeight: 0.1,
  lagLength: 0.4,
  plungeArea: 1.2,
  wakeStrength: 0.3,
  towStrength: 1.15,
});
/** Floor centre of pressure (car-local z, m) at the given attitude, bounded
 * to the floor's length. */
export function floorCentre(
  a: AeroDynamics,
  pitch: number,
  meanHeight: number,
  limit = 1.5,
) {
  const z =
    a.floorCentre +
    a.floorCentrePitch * (pitch - a.referencePitch) +
    a.floorCentreHeight * (meanHeight - a.referenceHeight);
  return Math.max(-limit, Math.min(limit, z));
}
/** Exact convective lag of a ride-height input: τ = length/V. */
export function lagHeight(current: number, measured: number, speed: number, length: number, dt: number) {
  if (length <= 0) return measured;
  return measured + (current - measured) * Math.exp((-Math.max(0.5, Math.abs(speed)) * dt) / length);
}
/** Quasi-steady plunge damping force (N, along body up) at a station moving
 * with vertical speed `heave` (m/s). */
export function plungeDamping(airspeed: number, heave: number, area: number, density = VEHICLE.airDensity) {
  return -0.5 * density * Math.abs(airspeed) * area * heave;
}
export interface AeroForces {
  front: number;
  rear: number;
  floor: number;
  drag: number;
  wake: number;
}
export function groundEffect(frontHeight: number, rearHeight: number) {
  const h = (frontHeight + rearHeight) * 0.5;
  return (0.3 + 0.7 * smooth(0.012, 0.044, h)) * Math.exp(-Math.max(0, h - 0.075) * 7);
}
export function aero(
  speed: number,
  setup: Setup,
  frontHeight: number,
  rearHeight: number,
  frontHealth: number,
  rearHealth: number,
  floorHealth: number,
  wake: number,
  yawSlip: number,
  out: AeroForces,
  /** DRS flap opening, 0 closed to 1 fully open. */
  drs = 0,
  /** Body scaling of the shared map; the Formula car is { downforce: 1, drag: 1 }. */
  body: { downforce: number; drag: number } = FORMULA_BODY,
  wheelbase: number = VEHICLE.wheelbase,
  /** Slipstream (tow) fraction for the drag reduction; defaults to `wake`. */
  tow: number = wake,
) {
  const q = 0.5 * VEHICLE.airDensity * speed * speed * 1.3,
    yawLoss = Math.exp(-Math.abs(yawSlip) * 0.85),
    pitch = Math.atan2(frontHeight - rearHeight, wheelbase);
  sampleAeroMap(frontHeight, rearHeight, pitch, out);
  out.front *= q * (0.85 + setup.frontWing * 0.8) * frontHealth * (1 - 0.43 * wake) * yawLoss;
  out.rear *=
    q *
    (1.05 + setup.rearWing * 0.9) *
    rearHealth *
    (1 - 0.2 * wake) *
    yawLoss *
    (1 - DRS.rearLoss * drs);
  out.floor *= q * 2.25 * floorHealth * yawLoss * (1 - 0.24 * wake);
  out.drag *=
    q *
    (0.76 + setup.frontWing * 0.14 + setup.rearWing * 0.23 + (1 - frontHealth) * 0.12) *
    (1 - 0.16 * tow) *
    (1 - DRS.dragLoss * drs);
  if (body !== FORMULA_BODY) {
    out.front *= body.downforce;
    out.rear *= body.downforce;
    out.floor *= body.downforce;
    out.drag *= body.drag;
  }
  out.wake = wake;
}
export function wakeOverlap(
  follower: Vec3,
  leader: Vec3,
  leaderForward: Vec3,
  leaderSpeed: number,
  followerForward?: Vec3,
) {
  const length = leaderForward.length();
  if (length < 1e-8 || leaderSpeed <= 20) return 0;
  const dx = follower.x - leader.x,
    dy = follower.y - leader.y,
    dz = follower.z - leader.z;
  const behind = -(dx * leaderForward.x + dy * leaderForward.y + dz * leaderForward.z) / length;
  if (behind <= 2 || behind >= 100) return 0;
  const horizontal = Math.hypot(leaderForward.x, leaderForward.z);
  if (horizontal < 1e-8) return 0;
  const lateral = Math.abs(dx * leaderForward.z - dz * leaderForward.x) / horizontal;
  const vertical = Math.abs(dy + (behind * leaderForward.y) / length);
  const radius = 1.3 + behind * 0.055;
  const alignment = followerForward
    ? smooth(
        0,
        0.85,
        followerForward.dot(leaderForward) / Math.max(1e-8, followerForward.length() * length),
      )
    : 1;
  return (
    Math.exp(-behind / 46) *
    smooth(2, 6, behind) *
    (1 - smooth(75, 100, behind)) *
    (1 - smooth(radius * 0.3, radius, lateral)) *
    (1 - smooth(0.6, 2.5, vertical)) *
    smooth(20, 55, leaderSpeed) *
    alignment
  );
}
/** Slipstream (tow) behind a leader: a longer, narrower drag-reducing
 * volume than the turbulent dirty-air wake, reaching its full value in the
 * leader's wheel tracks. Exactly zero beyond 100 m behind (the world's 101 m
 * proximity cull stays exact). */
export function slipstreamOverlap(
  follower: Vec3,
  leader: Vec3,
  leaderForward: Vec3,
  leaderSpeed: number,
  followerForward?: Vec3,
) {
  const length = leaderForward.length();
  if (length < 1e-8 || leaderSpeed <= 15) return 0;
  const dx = follower.x - leader.x,
    dy = follower.y - leader.y,
    dz = follower.z - leader.z;
  const behind = -(dx * leaderForward.x + dy * leaderForward.y + dz * leaderForward.z) / length;
  if (behind <= 1.5 || behind >= 100) return 0;
  const horizontal = Math.hypot(leaderForward.x, leaderForward.z);
  if (horizontal < 1e-8) return 0;
  const lateral = Math.abs(dx * leaderForward.z - dz * leaderForward.x) / horizontal;
  const vertical = Math.abs(dy + (behind * leaderForward.y) / length);
  const radius = 1.0 + behind * 0.022;
  const alignment = followerForward
    ? smooth(
        0.3,
        0.9,
        followerForward.dot(leaderForward) / Math.max(1e-8, followerForward.length() * length),
      )
    : 1;
  return (
    Math.exp(-behind / 70) *
    smooth(1.5, 5, behind) *
    (1 - smooth(70, 100, behind)) *
    (1 - smooth(radius * 0.4, radius, lateral)) *
    (1 - smooth(0.6, 2.5, vertical)) *
    smooth(15, 50, leaderSpeed) *
    alignment
  );
}
