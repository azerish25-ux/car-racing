import { clamp, G, lerp, mod, Quat, Vec3 } from '../core/math.ts';
import {
  AIDriver,
  ENVELOPE_SAMPLES,
  ENVELOPE_STEP,
  envelopeCornerSpeed,
  envelopeProfile,
} from './ai.ts';
import { leanAuthority } from './bike.ts';
import { BikeVehicle } from './bike-vehicle.ts';
import type { RaceDirector } from './race.ts';
import { pitPreparationDistance } from './pit-safety.ts';
import { racingLineFor } from './racing-line.ts';
import { trackPoint, type Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';

/** Bounded GP preview work: at most 1,524 m at the shared 12 m spacing. */
export const GP_APPROACH_SAMPLES = 128;

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
  private readonly ahead = trackPoint();
  private pitCorridor = false;
  private passingScale = 1;
  private readonly approachCurvatures = new Float64Array(GP_APPROACH_SAMPLES);
  private readonly approachCorners = new Float64Array(GP_APPROACH_SAMPLES);
  protected override readonly reverseRecovery = false;
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
    this.passingScale = gpPassingLateralScale(c, track, cars);
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
    c.aiControlled();
  }
  /** Path tracking for a leaning vehicle (WP35): a car's pure pursuit cuts
   * corners and over-corrects when the lean must change before the path can.
   * The bike follows the lane the line follower chose (same tactical offset
   * from the racing line) with the path's own curvature, previewed by the lean
   * response time, plus a critically damped correction of lateral and heading
   * error. The pit approach and the pit lane are absolute corridors (as for
   * cars); at walking pace the car-style command is converted directly. */
  private steerIntent(track: Track, steer: number) {
    const c = this.bike,
      d = c.dynamics;
    if (d.speed < 6) return leanIntent(c, steer);
    // Mirror the line follower's pit-approach latch (same inputs, same rule).
    const entryGap = mod(track.pitEntryS() - c.s, track.length);
    if (!c.pitRequested || c.inPit || entryGap > track.length - 20) this.pitCorridor = false;
    else if (entryGap < pitPreparationDistance(c.speed, c.lateral, track.pit.side * 6))
      this.pitCorridor = true;
    const v = d.speed,
      near = clamp(6 + c.speed * 0.48, 8, 46),
      absolute = c.inPit || this.pitCorridor;
    const tactical = absolute ? 0 : c.aiOffset - this.steeringLineOffset(track, c.s + near);
    const p = track.at(c.s, this.preview);
    const reach = Math.max(1, p.width - 1.4);
    const target = absolute
      ? c.aiOffset
      : clamp(this.steeringLineOffset(track, c.s) + tactical, -reach, reach);
    const pathSlope = absolute
      ? c.inPit
        ? (track.pitOffset(c.s + 3) - track.pitOffset(c.s - 3)) / 6
        : 0
      : (this.steeringLineOffset(track, c.s + 3) - this.steeringLineOffset(track, c.s - 3)) / 6;
    const slope = pathSlope / Math.max(0.5, 1 - p.curvature * target);
    const heading = mod(d.heading - Math.atan2(p.tx, p.tz) + Math.PI, Math.PI * 2) - Math.PI;
    const error = target - c.lateral,
      headingError = Math.atan(slope) - heading;
    // Feed-forward: the lane's curvature where the bike will be once it has leaned.
    const ahead = c.s + v * BIKE_AI.preview;
    const k = absolute
      ? track.at(ahead, this.ahead).curvature
      : this.steeringLineCurvature(track, ahead);
    const feedForward = k / Math.max(0.5, 1 - k * (absolute ? target : tactical));
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
  /** The lane used by the lean tracker. Venue riders can choose a different
   * path; its slope and feed-forward must agree with the path planner. The
   * default preserves the road-bike racing line and its solved curvature. */
  protected steeringLineOffset(track: Track, s: number) {
    return racingLineFor(track).offsetAt(s);
  }
  protected steeringLineCurvature(track: Track, s: number) {
    return racingLineFor(track).curvatureAt(s);
  }
  /** A GP straight can require far more than the shared 240 m brake preview.
   * At 300+ km/h, waiting until a hairpin enters that fixed window leaves the
   * rider over-speed at turn-in, where ABS must give cornering priority. Solve
   * the same normal-pedal profile over the current conservative stop distance
   * plus the rider's lean response. The shared traffic/flag/pit target can only
   * be lowered. Per-wheel grip and physical crash limits remain authoritative. */
  protected override limitSpeed(desired: number, track: Track, race: RaceDirector) {
    void race;
    const c = this.bike,
      d = c.dynamics;
    if (
      (c.definition.id !== 'gpr1' && c.definition.id !== 'gpr2') ||
      c.inPit ||
      this.pitCorridor ||
      !c.riding ||
      !Number.isFinite(d.speed + d.grip + c.lateral + d.heading) ||
      Math.abs(c.lateral) > c.trackPosition.width ||
      Math.sin(d.heading) * c.trackPosition.tx + Math.cos(d.heading) * c.trackPosition.tz < 0.5
    )
      return desired;
    const env = c.definition.ai,
      near = clamp(6 + c.speed * 0.48, 8, 46),
      tactical = c.aiOffset - this.steeringLineOffset(track, c.s + near),
      wetness = clamp(Math.max(c.contacts[0].water, c.contacts[2].water) / 0.8, 0, 1),
      // The less capable contact constrains approach planning even when the
      // intact wheel can still provide useful drive or brake force.
      grip =
        clamp(Math.min(d.grip, d.frontGrip ?? d.grip, d.rearGrip ?? d.grip), 0.1, 1) *
        (1 - 0.15 * wetness) *
        clamp(1 - (0.25 * Math.max(0, Math.abs(tactical) - 1.5)) / 6, 0.8, 1),
      aero =
        ((0.45 + 0.55 * Math.min(c.frontHealth, c.floorHealth)) *
          env.downforceReference *
          (1 - 0.3 * c.wake)) /
        (c.spec.dryMass + c.fuel),
      count = gpApproachSampleCount(
        d.speed,
        env.brakingBase * grip * env.brakingMargin,
        track.length,
      );
    for (let i = 0; i < count; i++) {
      const k = this.steeringLineCurvature(track, c.s + i * ENVELOPE_STEP),
        curvature = k / Math.max(0.5, 1 - k * tactical);
      this.approachCurvatures[i] = Math.abs(curvature);
      this.approachCorners[i] = envelopeCornerSpeed(curvature, grip, aero, env) * this.skill;
    }
    return Math.min(
      desired,
      envelopeProfile(this.approachCurvatures, this.approachCorners, grip, aero, env, count),
    );
  }
  /** Upright GP machines can use a motorcycle-sized passing lane. The
   * footprint expands before a corner and for a leaning nearby rider;
   * stopping distance, yellow flags and the swept collision tests stay in
   * the shared planner. Off-road riders retain their own override. */
  protected override trafficScale() {
    return this.passingScale;
  }
}

/** GP racecraft tuning, expressed in the shared planner's car-width units.
 * The upright floor reserves 1.93 m lateral separation (2.75 × 0.7), rather
 * than asking a 0.74 m wide GP machine for a 3.5 m lane change. Full cornering
 * lean restores the original corridor for the chassis and hanging-off rider.
 * This only narrows lateral room; it never cuts longitudinal safety margins. */
export function gpPassingLateralScale(c: BikeVehicle, track: Track, cars: readonly Vehicle[]) {
  if (c.definition.id !== 'gpr1' && c.definition.id !== 'gpr2') return 1;
  // Mixed-class grids have different widths, braking points and approach
  // speeds. Keep their established shared corridor instead of giving just
  // the GP riders a more permissive plan than the bikes beside them.
  if (cars.some((other) => other.definition.id !== 'gpr1' && other.definition.id !== 'gpr2'))
    return 1;
  const d = c.dynamics,
    line = racingLineFor(track);
  let lean = Math.max(Math.abs(d.lean), Math.abs(c.input.steer) * d.leanLimit);
  // A passing commitment lasts three seconds. Reserve the wider corridor
  // before the braking/turn-in sequence, not after the rider is already down
  // on one knee. Current speed is conservative when a braking zone is ahead.
  for (let t = 1; t <= 3; t++) {
    const k = Math.abs(line.curvatureAt(c.s + d.speed * t));
    lean = Math.max(lean, Math.min(d.leanLimit, Math.atan((d.speed * d.speed * k) / G)));
  }
  for (const other of cars) {
    if (other === c || other.inPit !== c.inPit || !(other instanceof BikeVehicle)) continue;
    const gap = mod(other.s - c.s + track.length / 2, track.length) - track.length / 2;
    if (Math.abs(gap) < 180) lean = Math.max(lean, Math.abs(other.dynamics.lean));
  }
  const turning = clamp((lean - 0.15) / 0.6, 0, 1);
  return lerp(0.7, 1, turning * turning * (3 - 2 * turning));
}
/** Bike path-tracking gains: preview (s), bandwidth (rad/s), damping ratio. */
export const BIKE_AI = Object.freeze({
  preview: 0.3,
  bandwidth: 1.2,
  damping: 0.9,
  /** Lateral acceleration a lane correction may use (g). */
  correctionG: 0.6,
});
/** Number of existing 12 m envelope samples needed to see a conservative
 * full stop, ignoring helpful aero drag, plus the lean response distance.
 * Cap at one circuit and fixed scratch capacity, including for invalid or
 * vanishing grip estimates; no time-dependent cache or view allocations. */
export function gpApproachSampleCount(speed: number, deceleration: number, trackLength: number) {
  const v = Number.isFinite(speed) ? clamp(speed, 0, 120) : 0;
  const braking = Number.isFinite(deceleration) ? Math.max(0.5, deceleration) : 0.5;
  const distance = (v * v) / (2 * braking) + v * BIKE_AI.preview;
  const circuitSamples = Number.isFinite(trackLength)
    ? Math.max(2, Math.floor(Math.max(0, trackLength) / ENVELOPE_STEP) + 1)
    : GP_APPROACH_SAMPLES;
  return Math.min(
    GP_APPROACH_SAMPLES,
    circuitSamples,
    Math.max(ENVELOPE_SAMPLES, Math.ceil(distance / ENVELOPE_STEP) + 1),
  );
}
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
