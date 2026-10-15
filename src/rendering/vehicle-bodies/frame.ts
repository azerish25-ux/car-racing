import { DEFAULT_SETUP } from '../../simulation/config.ts';
import { setupFor, type VehicleDefinition } from '../../simulation/vehicles.ts';
import { G } from '../../core/math.ts';

/** The car-local frame a body is authored in, derived from the simulated
 * definition so the exterior always matches the machine: axle stations,
 * tracks, wheel radius, hub heights at rest and the road plane (car frame:
 * +Z nose, +Y up, +X driver's left; origin at the centre of mass). */
export interface BodyFrame {
  frontAxle: number;
  rearAxle: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  radius: number;
  /** Hub heights at rest (car frame). */
  hubFront: number;
  hubRear: number;
  /** Road plane at rest (car frame y). */
  ground: number;
  /** z of a station: 0 front axle, 1 rear axle. */
  z(s: number): number;
  /** Car-frame y of a height above the road. */
  y(h: number): number;
}
export function bodyFrame(def: VehicleDefinition): BodyFrame {
  const [fr, , rr] = def.wheelPositions,
    spec = def.spec,
    setup = setupFor(def, DEFAULT_SETUP, DEFAULT_SETUP),
    frontAxle = fr[2],
    rearAxle = rr[2],
    wheelbase = frontAxle - rearAxle,
    frontShare = -rearAxle / wheelbase,
    weight = (spec.dryMass + (def.fuelLoad ?? 24)) * G,
    sag = (share: number, spring: number) => (weight * share * 0.5) / spring,
    hubFront =
      fr[1] - (spec.restLength + setup.frontRide - 0.065 - sag(frontShare, setup.frontSpring)),
    hubRear =
      rr[1] - (spec.restLength + setup.rearRide - 0.075 - sag(1 - frontShare, setup.rearSpring)),
    ground = (hubFront + hubRear) / 2 - spec.wheelRadius;
  return {
    frontAxle,
    rearAxle,
    wheelbase,
    trackFront: Math.abs(fr[0]) * 2,
    trackRear: Math.abs(rr[0]) * 2,
    radius: spec.wheelRadius,
    hubFront,
    hubRear,
    ground,
    z: (s) => frontAxle - s * wheelbase,
    y: (h) => ground + h,
  };
}
