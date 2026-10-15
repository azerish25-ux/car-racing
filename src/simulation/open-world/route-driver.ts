import { approach, clamp, G, Vec3 } from '../../core/math.ts';
import { envelopeCornerSpeed, envelopeProfile, ENVELOPE_SAMPLES, ENVELOPE_STEP } from '../ai.ts';
import { peakGrip } from '../tire.ts';
import type { Vehicle } from '../vehicle.ts';
import { pathPoint, type RoutePath } from './route-path.ts';

/** Why the driver is doing what it does (HUD/debug, tests). */
export type RouteDecision = 'HOLD' | 'RACE LINE' | 'FOLLOW' | 'PASS LEFT' | 'PASS RIGHT' | 'RECOVERY' | 'FINISHED';

/**
 * AI for the festival: drives a planned road-network route (RoutePath) with
 * the same pedals and steering as the player. It reuses the circuit AI's
 * capability envelope (envelopeCornerSpeed / envelopeProfile with the
 * vehicle's own CapabilityEnvelope, peakGrip of the actual contact so dirt,
 * grass and water slow it honestly), pure-pursuit steering and friction-
 * circle pedal shaping, on the route's race line instead of a circuit's
 * racing line. No grip, force or pose is ever added.
 */
export class RouteDriver {
  /** Distance along the route of the car (local search keeps it honest on
   * switchbacks: progress never jumps to a neighbouring leg). */
  d = 0;
  lateral = 0;
  decision: RouteDecision = 'HOLD';
  /** Seconds the car has been stuck, off the road or upside down. */
  trouble = 0;
  /** Set when the driver asks the session to put it back on the route. */
  wantsReset = false;
  private tactical = 0;
  private stuck = 0;
  private recovery = 0;
  private trafficSpeed = Infinity;
  private trafficClock = 0;
  private readonly target = pathPoint();
  private readonly sample = pathPoint();
  private readonly curvatures = new Float64Array(ENVELOPE_SAMPLES);
  private readonly corners = new Float64Array(ENVELOPE_SAMPLES);
  private readonly delta = new Vec3();
  private readonly local = new Vec3();
  private readonly located = { lateral: 0, distance: 0 };
  private readonly other = { lateral: 0, distance: 0 };
  constructor(
    readonly car: Vehicle,
    public path: RoutePath,
    /** Fraction of the envelope used (0.8 calm .. 1 committed). */
    readonly skill = 0.92,
    /** Constant lane offset preference (traffic keeps right). */
    readonly laneOffset = 0,
    /** Speed cap (m/s), e.g. a cruising autopilot. */
    readonly speedCap = Infinity,
  ) {
    this.d = path.locate(car.body.position.x, car.body.position.z, 0, path.length);
  }
  /** Re-locate after a teleport. */
  relocate(guess = this.d) {
    this.d = this.path.locate(this.car.body.position.x, this.car.body.position.z, guess, 120);
    this.stuck = 0;
    this.recovery = 0;
    this.trouble = 0;
    this.wantsReset = false;
  }
  update(dt: number, cars: readonly Vehicle[], hold = false, finished = false) {
    const c = this.car,
      command = c.input,
      path = this.path;
    command.shift = 0;
    command.manualClutch = false;
    command.clutch = 0;
    command.reverse = false;
    command.ers = 1;
    this.d = path.locate(c.body.position.x, c.body.position.z, this.d, 40, this.located);
    this.lateral = this.located.lateral;
    if (hold) {
      command.throttle = 0;
      command.brake = 1;
      command.steer = 0;
      this.decision = 'HOLD';
      return;
    }
    const env = c.definition.ai;
    // Traffic (12 Hz): follow, or take a lane beside a slower car ahead.
    this.trafficClock += dt;
    if (this.trafficClock > 1 / 12) {
      this.trafficClock = 0;
      this.planTraffic(cars);
    }
    const lookahead = clamp(6 + c.speed * 0.5, 8, 48);
    path.at(this.d + lookahead, this.target);
    const reach = Math.max(0.5, this.target.halfWidth - 1.3);
    const offset = finished
      ? reach
      : clamp(path.lineAt(this.d + lookahead) * (this.laneOffset ? 0 : 1) + this.laneOffset + this.tactical, -reach, reach);
    this.delta.set(
      this.target.x + this.target.nx * offset - c.body.position.x,
      0,
      this.target.z + this.target.nz * offset - c.body.position.z,
    );
    c.body.orientation.inverseRotate(this.delta, this.local);
    const purePursuit = Math.atan2(
        2 * c.spec.wheelbase * this.local.x,
        Math.max(10, this.local.x * this.local.x + this.local.z * this.local.z),
      ),
      speedSteer = c.assist === 'sport' ? 1 / (1 + c.speed * 0.018) : 1;
    command.steer = clamp(purePursuit / (c.spec.maxSteer * speedSteer), -1, 1);
    // Envelope speed profile along the route ahead (the race line's own
    // curvature, or the centreline's for a lane-keeping driver).
    const grip = clamp(peakGrip(c.tires[0], 2500, c.contacts[0], Math.max(c.speed, 38)) / env.referenceMu, 0.1, 1);
    const aero = (env.downforceReference * (0.45 + 0.55 * Math.min(c.frontHealth, c.floorHealth))) / (c.spec.dryMass + c.fuel);
    const laneGrip = grip * clamp(1 - Math.abs(this.tactical) * 0.03, 0.85, 1);
    for (let i = 0; i < ENVELOPE_SAMPLES; i++) {
      const at = this.d + i * ENVELOPE_STEP;
      const k = this.laneOffset ? path.at(at, this.sample).curvature : path.lineCurvatureAt(at);
      this.curvatures[i] = Math.abs(k);
      this.corners[i] = envelopeCornerSpeed(k, laneGrip, aero, env) * this.skill;
    }
    let desired = Math.min(env.topSpeed * this.skill, this.speedCap);
    desired = Math.min(desired, envelopeProfile(this.curvatures, this.corners, laneGrip, aero, env));
    desired = Math.min(desired, this.trafficSpeed);
    // The end of a point-to-point route: brake to a stop before its end.
    const remaining = path.closed ? Infinity : path.length - 6 - this.d;
    if (remaining < 1) desired = 0;
    else if (remaining < 260) desired = Math.min(desired, Math.sqrt(2 * 5 * remaining));
    // A finished car eases off and pulls to the right-hand verge.
    if (finished) desired = Math.min(desired, Math.max(0, c.speed - 4), 16);
    // Far off the road: slow down while steering back.
    const off = Math.abs(this.lateral - offset);
    if (off > 6) desired = Math.min(desired, Math.max(8, 30 - off));
    c.aiTarget = desired;
    c.aiOffset = offset;
    const error = desired - c.speed;
    command.throttle = clamp(error * 0.25 + 0.13, 0, 1);
    command.brake = clamp(-error * 0.18, 0, 1);
    const lateralUsage = Math.min(
      1,
      (Math.abs(c.gLat) * G) / Math.max(1, (env.lateralBase + env.lateralAero * aero * c.speed * c.speed) * grip),
    );
    const available = Math.sqrt(Math.max(0, 1 - lateralUsage * lateralUsage));
    command.throttle = Math.min(command.throttle, 0.2 + 0.8 * available);
    const wheelspin = Math.max(c.tires[2].slip, c.tires[3].slip, c.tires[0].slip, c.tires[1].slip);
    if (wheelspin > 0.08) command.throttle *= clamp(1 - (wheelspin - 0.08) * 5, 0.05, 1);
    command.brake = Math.min(command.brake, 0.3 + 0.7 * available);
    let lock = 0;
    for (const tire of c.tires) lock = Math.min(lock, tire.slip);
    if (lock < -0.12) command.brake *= clamp(1 - (-lock - 0.12) * 4, 0.35, 1);
    if (desired < 0.15) {
      command.throttle = 0;
      command.brake = 1;
    }
    this.decision = finished ? 'FINISHED' : this.tactical > 1 ? 'PASS RIGHT' : this.tactical < -1 ? 'PASS LEFT' : this.trafficSpeed < c.speed + 1 ? 'FOLLOW' : 'RACE LINE';
    // Stuck against something: reverse out with opposite lock.
    if (!finished && c.speed < 0.8 && desired > 5) this.stuck += dt;
    else if (this.recovery <= 0) this.stuck = 0;
    if (this.stuck > 3 && this.recovery <= 0) this.recovery = 2.2;
    if (this.recovery > 0) {
      this.recovery -= dt;
      command.reverse = true;
      command.throttle = 0.35;
      command.brake = 0;
      command.steer = -command.steer;
      this.decision = 'RECOVERY';
      if (this.recovery <= 0) this.stuck = 0;
    }
    // Ask for a reset when recovery keeps failing, when far off the route
    // or upside down.
    const upset = c.up.y < 0.3;
    if (!finished && (this.stuck > 9 || this.located.distance > 40 || upset)) this.trouble += dt;
    else this.trouble = Math.max(0, this.trouble - dt);
    if (this.trouble > 4) this.wantsReset = true;
  }
  /** Lane choice and following speed from the cars ahead on the route. */
  private planTraffic(cars: readonly Vehicle[]) {
    const c = this.car,
      path = this.path;
    let follow = Infinity,
      blockLeft = false,
      blockRight = false,
      blocked: Vehicle | null = null;
    for (const other of cars) {
      if (other === c) continue;
      const dx = other.body.position.x - c.body.position.x,
        dz = other.body.position.z - c.body.position.z;
      if (dx * dx + dz * dz > 80 * 80) continue;
      const od = path.locate(other.body.position.x, other.body.position.z, this.d, 90, this.other),
        lateral = this.other.lateral;
      let gap = od - this.d;
      if (path.closed && gap < -path.length / 2) gap += path.length;
      if (gap < -6 || gap > 70) continue;
      const side = lateral - (this.lateral + 0);
      if (gap < 8 && Math.abs(side) < 3.2) {
        if (side > 0) blockRight = true;
        else blockLeft = true;
      }
      if (gap > 2 && Math.abs(side) < 2.4 && other.speed < c.speed + 3) {
        // Following speed: keep a short gap at the other car's pace.
        const keep = Math.sqrt(Math.max(0, other.speed ** 2 + 2 * 5 * Math.max(0, gap - 8 - c.speed * 0.4)));
        if (keep < follow) {
          follow = keep;
          blocked = other;
        }
      }
    }
    path.at(this.d, this.sample);
    const reach = Math.max(0, this.sample.halfWidth - 1.6);
    let tactical = 0;
    if (blocked && reach > 2.2) {
      path.locate(blocked.body.position.x, blocked.body.position.z, this.d, 90, this.other);
      const theirs = this.other.lateral;
      // Pass on the side with more room, if it is free.
      const right = theirs < 0 && !blockRight,
        left = theirs >= 0 && !blockLeft;
      if (right || left) {
        tactical = clamp((right ? theirs + 3.2 : theirs - 3.2) - path.lineAt(this.d), -reach * 2, reach * 2);
        follow = Math.max(follow, blocked.speed + 2);
      }
    }
    this.tactical = approach(this.tactical, tactical, 0.6);
    this.trafficSpeed = follow;
  }
}
