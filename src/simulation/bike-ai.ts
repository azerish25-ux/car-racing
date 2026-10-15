import { clamp, G, lerp, mod, Quat, Vec3 } from '../core/math.ts';
import { AIDriver } from './ai.ts';
import { leanAuthority } from './bike.ts';
import { BikeVehicle } from './bike-vehicle.ts';
import type { RaceDirector } from './race.ts';
import { racingLineFor } from './racing-line.ts';
import { trackPoint, type Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';

/** Bike rider AI (WP35). The shared race-craft layers (strategy, traffic,
 * racing line, pit approach, flags, capability-envelope speed targets) are
 * the AIDriver's; the bike's own `VehicleDefinition.ai` envelope makes those
 * targets lean-limited. Only the steering contract differs: the path
 * curvature the line follower wants is converted into the lean intent the
 * rider aid tracks (tan φ = v²κ/g), with direct bar steering at walking pace.
 * While the rider is down the bike receives no commands. */
export class BikeAIDriver extends AIDriver {
  private readonly savedOrientation = new Quat();
  private readonly savedPosition = new Vec3();
  private readonly preview = trackPoint();
  constructor(
    readonly bike: BikeVehicle,
    skill = 0.96,
    seed = 73021,
  ) {
    super(bike, skill, seed);
  }
  override update(dt: number, track: Track, cars: Vehicle[], race: RaceDirector) {
    const c = this.bike,
      d = c.dynamics,
      command = c.input;
    if (!c.riding) {
      command.throttle = 0;
      command.brake = 0;
      command.steer = 0;
      command.clutch = 0;
      command.reverse = false;
      c.aiTarget = 0;
      this.decision = d.state === 'remount' ? 'REMOUNTING' : 'RIDER DOWN';
      return;
    }
    // The line follower measures the path in the ground frame at the tyres'
    // contact line: a lean must not rotate its target, nor the CG's inward
    // offset bias it toward the apex.
    const body = c.body;
    this.savedOrientation.x = body.orientation.x;
    this.savedOrientation.y = body.orientation.y;
    this.savedOrientation.z = body.orientation.z;
    this.savedOrientation.w = body.orientation.w;
    this.savedPosition.copy(body.position);
    body.orientation.yaw(d.heading);
    body.position.set(d.x, body.position.y, d.z);
    try {
      super.update(dt, track, cars, race);
    } finally {
      body.orientation.x = this.savedOrientation.x;
      body.orientation.y = this.savedOrientation.y;
      body.orientation.z = this.savedOrientation.z;
      body.orientation.w = this.savedOrientation.w;
      body.position.copy(this.savedPosition);
    }
    command.reverse = false;
    command.clutch = 0;
    command.steer = this.steerIntent(track, command.steer);
  }
  /** Path tracking for a leaning vehicle (WP35): a car's pure pursuit cuts
   * corners and over-corrects when the lean must change before the path can.
   * The bike follows the lane the line follower chose (same tactical offset
   * from the racing line) with the path's own curvature, previewed by the lean
   * response time, plus a critically damped correction of lateral and heading
   * error. In the pit lane and at walking pace the car-style command is
   * converted directly. */
  private steerIntent(track: Track, steer: number) {
    const c = this.bike,
      d = c.dynamics;
    if (c.inPit || c.pitRequested || d.speed < 6) return leanIntent(c, steer);
    const line = racingLineFor(track),
      v = d.speed,
      near = clamp(6 + c.speed * 0.48, 8, 46);
    const tactical = c.aiOffset - line.offsetAt(c.s + near);
    const p = track.at(c.s, this.preview);
    const reach = Math.max(1, p.width - 1.4);
    const target = clamp(line.offsetAt(c.s) + tactical, -reach, reach);
    const slope =
      (line.offsetAt(c.s + 3) - line.offsetAt(c.s - 3)) /
      6 /
      Math.max(0.5, 1 - p.curvature * target);
    const heading = mod(d.heading - Math.atan2(p.tx, p.tz) + Math.PI, Math.PI * 2) - Math.PI;
    const error = target - c.lateral,
      headingError = Math.atan(slope) - heading;
    // Feed-forward: the lane's curvature where the bike will be once it has leaned.
    const ahead = c.s + v * BIKE_AI.preview;
    const k = line.curvatureAt(ahead);
    const feedForward = k / Math.max(0.5, 1 - k * tactical);
    const w = BIKE_AI.bandwidth;
    // Corrections are gentle: their lateral acceleration is bounded, so a
    // lane error never asks for a full-lean swerve on a straight.
    const correction = clamp(
      (w * w * error) / (v * v) + (2 * BIKE_AI.damping * w * headingError) / v,
      (-BIKE_AI.correctionG * G) / (v * v),
      (BIKE_AI.correctionG * G) / (v * v),
    );
    return leanFromCurvature(c, feedForward + correction, steer);
  }
}
/** Bike path-tracking gains: preview (s), bandwidth (rad/s), damping ratio. */
export const BIKE_AI = Object.freeze({
  preview: 0.3,
  bandwidth: 1.2,
  damping: 0.9,
  /** Lateral acceleration a lane correction may use (g). */
  correctionG: 0.6,
});
/** Lean intent for a path curvature (tan φ = v²κ/g, less the hang-off share). */
export function leanFromCurvature(c: BikeVehicle, kappa: number, steer: number) {
  const d = c.dynamics,
    lean = Math.atan((d.speed * d.speed * kappa) / G);
  const fast = clamp(lean / Math.max(0.1, d.leanLimit), -1, 1);
  return lerp(slowIntent(c, steer), fast, leanAuthority(d.speed));
}
function slowIntent(c: BikeVehicle, steer: number) {
  const speedSteer = c.assist === 'sport' ? 1 / (1 + c.speed * 0.018) : 1;
  return clamp((steer * c.spec.maxSteer * speedSteer) / (c.dynamics.p.maxSteer * 0.5), -1, 1);
}
/** Convert a car-style steering command (pure-pursuit fraction of the speed-
 * scaled lock) into the bike's lean intent. */
export function leanIntent(c: BikeVehicle, steer: number) {
  const d = c.dynamics,
    speedSteer = c.assist === 'sport' ? 1 / (1 + c.speed * 0.018) : 1,
    delta = steer * c.spec.maxSteer * speedSteer,
    kappa = Math.tan(delta) / c.spec.wheelbase,
    lean = Math.atan((d.speed * d.speed * kappa) / G);
  const fast = clamp(lean / Math.max(0.1, d.leanLimit), -1, 1),
    slow = clamp(delta / (d.p.maxSteer * 0.5), -1, 1);
  return lerp(slow, fast, leanAuthority(d.speed));
}
/** The AI driver for an entrant's family. */
export function createDriver(car: Vehicle, skill: number, seed: number): AIDriver {
  return car instanceof BikeVehicle
    ? new BikeAIDriver(car, skill, seed)
    : new AIDriver(car, skill, seed);
}
