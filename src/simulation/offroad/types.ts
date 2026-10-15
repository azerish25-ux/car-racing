/** Type-only contracts between the off-road module and the shared track,
 * circuit and session code (no runtime imports, so circuits.ts and track.ts
 * can name them without an import cycle). */
import type { SurfaceSample, Track, TrackPoint } from '../track.ts';
import type { Vec3 } from '../../core/math.ts';

export type OffroadKind = 'motocross' | 'supercross' | 'rallycross' | 'rally-stage';
/** The authoritative ground of a terrain venue, owned by its Track. */
export interface OffroadSurface {
  readonly kind: OffroadKind;
  /** Fill `out` for a point at station `p`, lateral `lateral` (m, Track sign);
   * `cell` is the Track water-grid cell. False: the point is outside the
   * terrain band and the paved/run-off rules apply. */
  sample(p: TrackPoint, lateral: number, cell: number, out: SurfaceSample): boolean;
  /** Ray against the deformable ground (distance along `down`, or Infinity). */
  cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample): number;
}
/** What a circuit definition carries for a terrain venue. */
export interface OffroadVenueData {
  readonly kind: OffroadKind;
  /** Build the session's authoritative surface for a Track of this venue. */
  createSurface(track: Track): OffroadSurface;
}
/** Off-road block of a two-wheel definition (dirt bikes, supermoto): what the
 * airborne, long-travel and loose-surface adapter (DirtBikeVehicle) needs on
 * top of the road-bike `BikeSpec`. Units SI; original estimates. */
export interface OffroadBikeSpec {
  /** Rising-rate spring: force k·c·(1 + progression·(c/travel)²). */
  progression: number;
  /** Damping at the wheel (N s/m) at low shaft speed; digressive above `damperKnee` m/s. */
  forkDamping: number;
  shockDamping: number;
  damperKnee: number;
  /** Pitch inertia of bike and rider about the CG (kg m²). */
  pitchInertia: number;
  /** Rear wheel and drivetrain spinning inertia (kg m²) and the airborne
   * spin-up / braking rates of the rear wheel (rad/s²). */
  spinInertia: number;
  spinUp: number;
  spinBrake: number;
  /** Rider body-position pitch torque (N m) at full fore/aft. */
  bodyTorque: number;
  /** Landing tolerances: pitch error (rad) front-first / rear-first beyond
   * which the rider crashes, and the shaft speed at full travel (m/s) beyond
   * which a bottomed landing unseats the rider. */
  noseDownLimit: number;
  noseUpLimit: number;
  bottomOutSpeed: number;
  /** Foot dab below this speed (m/s) when leaned beyond `dabLean` (rad). */
  dabSpeed: number;
  dabLean: number;
}
