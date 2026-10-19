import { clamp } from '../../core/math.ts';

/** Passive tangential contact impulse for a wheel whose rim and ground
 * speeds differ. Positive impulse moves the chassis forward and slows an
 * overspeed wheel; negative impulse spins up an underspeed wheel by taking
 * momentum from the chassis. SI units throughout.
 *
 * The effective inverse mass includes the wheel's rotational inertia. The
 * impulse stops at rolling equality, or at the remaining tyre-friction
 * budget supplied by the caller. Consequently every pickup dissipates
 * kinetic energy; spinning the engine in flight cannot create free energy.
 * This is an incremental landing correction, not a second brake solver. */
export function wheelPickupImpulse(
  speed: number,
  spin: number,
  radius: number,
  inertia: number,
  mass: number,
  availableImpulse: number,
) {
  if (
    ![speed, spin, radius, inertia, mass, availableImpulse].every(Number.isFinite) ||
    radius <= 0 ||
    inertia <= 0 ||
    mass <= 0 ||
    availableImpulse < 0
  )
    throw new RangeError('Invalid wheel-pickup contact');
  if (availableImpulse === 0) return 0;
  const difference = spin * radius - speed,
    inverseMass = 1 / mass + (radius * radius) / inertia;
  return clamp(difference / inverseMass, -availableImpulse, availableImpulse);
}
