import { LANDING_RULES } from '../simulation/offroad/riding-feedback.ts';
import {
  B,
  BIKE_BASE,
  F,
  O,
  OFFROAD_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';

/** Warn only about a held brake on a genuinely slow airborne wheel. A wheel
 * coasting below road speed or invalid/old telemetry must not trigger advice.
 * Existing snapshot channels make the cue behave identically during replay. */
export function motocrossBrakeHeldInFlight(frame: Float32Array) {
  const base = carBase(0),
    o = base + OFFROAD_BASE,
    speed = frame[base + F.SPEED];
  if (
    !(frame[o + O.AIRBORNE] > 0.5) ||
    !(frame[o + O.AIR_TIME] > 0.2) ||
    !Number.isFinite(speed) ||
    speed <= LANDING_RULES.rollingHopSpeed
  )
    return false;
  return [0, 2].some((wheel) => {
    const w = base + WHEEL_BASE + wheel * WHEEL_STRIDE,
      omega = frame[w + W.OMEGA],
      radius = frame[w + W.RADIUS],
      pedal = frame[base + (wheel === 0 ? F.BRAKE : BIKE_BASE + B.REAR_BRAKE)];
    return (
      [omega, radius, pedal].every(Number.isFinite) &&
      radius > 0.1 &&
      radius < 0.6 &&
      pedal > 0.15 &&
      omega * radius < speed * 0.45
    );
  });
}
