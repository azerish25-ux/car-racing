import { clamp } from '../core/math.ts';

/** GP rideability tuning: roll the pumping torque away over the first 12%
 * of throttle travel. This is a control-map choice, not a measured MotoGP
 * engine coefficient. Full closed-throttle torque still comes from the
 * selected engine-brake map, current gear and engine speed. */
export const GP_ENGINE_BRAKE_RELEASE_THROTTLE = 0.12;

export function gpEngineBrakingGain(throttle: number): number {
  if (!Number.isFinite(throttle)) return 0;
  const t = clamp(throttle / GP_ENGINE_BRAKE_RELEASE_THROTTLE, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}
