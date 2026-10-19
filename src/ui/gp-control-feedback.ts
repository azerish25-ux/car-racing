import { gpBrakeEfficiency } from '../simulation/gp-brake-fade.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { SURFACE } from '../simulation/track.ts';
import { vehicleAt } from '../simulation/vehicles.ts';

export interface GPControlFeedback {
  action: string;
  detail: string;
  tone: 'caution';
}

/** Actionable feedback from the two recorded tyre contacts. The transport's
 * wheel 1/3 are duplicates; W.SLIP is a clipped demand ratio on these bikes,
 * and W.ANGLE is handlebar steer. Neither is an observed slip angle or a
 * numerical grip meter. No force, score, assist, timer or replay state changes.
 * REF 015/017/027/035/045: concise riding context beside the existing dash;
 * thresholds and advice are original game tuning, not measured from photos. */
export function gpControlFeedback(frame: Float32Array): GPControlFeedback | null {
  const o = carBase(0),
    b = o + BIKE_BASE,
    front = o + WHEEL_BASE,
    rear = front + 2 * WHEEL_STRIDE;
  if (
    frame.length <= b + B.INTERVENTION ||
    frame[H.CARS] < 1 ||
    frame[H.PHASE] !== 2 ||
    vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE])).classId !== 'gp-bike' ||
    frame[b + B.STATE] !== 0 ||
    frame[o + F.RETIRED] ||
    frame[o + F.FINISH] ||
    frame[o + F.IN_PIT]
  )
    return null;
  const speed = frame[o + F.SPEED],
    brake = frame[o + F.BRAKE],
    throttle = frame[o + F.THROTTLE],
    lean = Math.abs(frame[b + B.LEAN]),
    frontLoad = frame[b + B.FRONT_LOAD],
    rearLoad = frame[b + B.REAR_LOAD],
    totalLoad = frontLoad + rearLoad;
  if (
    ![speed, brake, throttle, lean, frontLoad, rearLoad].every(Number.isFinite) ||
    speed < 4 ||
    frontLoad < 0 ||
    rearLoad < 0 ||
    totalLoad < 100
  )
    return null;
  const feedback = (action: string, detail: string): GPControlFeedback => ({
    action,
    detail,
    tone: 'caution',
  });

  for (const [offset, end] of [
    [front, 'FRONT'],
    [rear, 'REAR'],
  ] as const)
    if (frame[offset + W.PUNCTURED] > 0)
      return feedback(`${end} PUNCTURE`, 'Slow down · return to the pits');

  // Loads distinguish an actually unloading axle from ordinary suspension
  // movement on a hill. Pitch confirms a wheel lift before naming the front.
  if (speed > 8 && brake > 0.15 && rearLoad / totalLoad < 0.07)
    return feedback('LIGHT REAR', 'Ease front brake before turn-in');
  if (speed > 8 && throttle > 0.2 && frontLoad / totalLoad < 0.07 && frame[b + B.PITCH] > 0.03)
    return feedback('FRONT LIFT', 'Roll off gently · settle the front');

  // Read the same fade curve as the GP brake solver. Ambient weather or a
  // generic temperature warning cannot establish a loss of braking torque.
  if (brake > 0.08 && gpBrakeEfficiency(frame[front + W.DISC_TEMP]) < 0.96)
    return feedback('FRONT BRAKE HOT', 'Reduced braking · slow earlier');
  if (frame[b + B.REAR_BRAKE] > 0.08 && gpBrakeEfficiency(frame[rear + W.DISC_TEMP]) < 0.96)
    return feedback('REAR BRAKE HOT', 'Ease rear brake · let it cool');

  for (const [offset, end, load] of [
    [front, 'FRONT', frontLoad],
    [rear, 'REAR', rearLoad],
  ] as const) {
    if (load < totalLoad * 0.07) continue;
    const surface = frame[offset + W.SURFACE],
      water = frame[offset + W.WATER];
    if (surface === SURFACE.GRASS || surface === SURFACE.GRAVEL)
      return feedback(
        `${end} ON ${surface === SURFACE.GRASS ? 'GRASS' : 'GRAVEL'}`,
        end === 'FRONT' ? 'Ease braking · steer gently' : 'Ease power · rejoin smoothly',
      );
    if (
      water > 0.05 &&
      (surface === SURFACE.KERB || surface === SURFACE.PAINT) &&
      (lean > 0.25 || (end === 'FRONT' ? brake > 0.12 : throttle > 0.2))
    )
      return feedback(
        `${end} ON WET ${surface === SURFACE.KERB ? 'KERB' : 'PAINT'}`,
        end === 'FRONT' ? 'Ease braking · keep inputs smooth' : 'Pick up bike · add power gently',
      );
  }
  if (throttle > 0.35 && lean > 0.35 && frame[b + B.INTERVENTION] > 0.3)
    return feedback('POWER LIMITED', 'TC/WC active · roll on smoothly');
  return null;
}
