import { sampleAeroMap } from './aero-map.ts';
import { smooth, Vec3 } from '../core/math.ts';
import { VEHICLE, type Setup } from './config.ts';
import { DRS } from './drs.ts';
const FORMULA_BODY = Object.freeze({ downforce: 1, drag: 1 });
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
    (1 - 0.16 * wake) *
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
