import { approach, clamp, G, mod, Vec3 } from '../../core/math.ts';
import { envelopeCornerSpeed, envelopeProfile, ENVELOPE_SAMPLES, ENVELOPE_STEP } from '../ai.ts';
import { BIKE_AI, leanFromCurvature, leanIntent } from '../bike-ai.ts';
import { BikeVehicle } from '../bike-vehicle.ts';
import { peakGrip } from '../tire.ts';
import type { Vehicle } from '../vehicle.ts';
import { pathPoint, type RoutePath } from './route-path.ts';

/** Anything the driver keeps its distance from: other cars and riders, and
 * the festival's kinematic ambient traffic (position and speed only). */
export interface RouteObstacle {
  readonly body: { readonly position: { readonly x: number; readonly z: number } };
  readonly speed: number;
}
/** A rider down (lowside, highside, separated, remounting) this long asks
 * the session for a reset; the bike's own recovery is bounded well inside it. */
const BIKE_DOWN_RESET = 20;
/** Window (m around each envelope sample) and corner-speed reserve of a
 * motorcycle on public roads: junction corners are sharp and short. */
const BIKE_WINDOW = Object.freeze([-6, -3, 3, 6]);
const BIKE_CORNER_RESERVE = 0.88;
/** Heading error (rad) beyond which a motorcycle turns round at walking pace. */
const BIKE_TURN_ROUND = 1.0;

/** Speed (m/s) above which the driver will not commit on a loose road: a
 * narrow crowned gravel lane leaves no margin for the slide a car develops
 * there at rally pace, so the AI keeps a reserve the player may spend. */
export const LOOSE_ROAD_SPEED = 41;

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
  /** Take a lane beside a slower car ahead (racing); off, it only follows
   * (the free-roam cruise among ambient traffic). */
  overtake = true;
  /** Measured understeer: road-wheel angle over the geometric angle the
   * car's actual yaw rate implies (1 = neutral). Pure pursuit is geometric;
   * this scales it so a car that runs wide at speed still holds the line. */
  private understeer = 1;
  private stuck = 0;
  private recovery = 0;
  private trafficSpeed = Infinity;
  private trafficClock = 0;
  /** Seconds a motorcycle's rider has been down (see BIKE_DOWN_RESET). */
  private down = 0;
  /** A motorcycle turning round at walking pace (see BIKE_TURN_ROUND). */
  private turningRound = false;
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
    /** Constant lane offset (m, positive left; right-hand traffic is negative). */
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
  update(dt: number, cars: readonly RouteObstacle[], hold = false, finished = false) {
    const c = this.car,
      command = c.input,
      path = this.path,
      bike = c instanceof BikeVehicle ? c : null;
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
    if (bike && !bike.riding) {
      // Rider down: no commands while the bike's bounded crash recovery runs
      // (slide, jog back, push to the road, remount).
      command.throttle = 0;
      command.brake = 0;
      command.steer = 0;
      c.aiTarget = 0;
      this.decision = 'RECOVERY';
      this.down += dt;
      if (this.down > BIKE_DOWN_RESET && !finished) this.wantsReset = true;
      return;
    }
    this.down = 0;
    const env = c.definition.ai;
    // Traffic (12 Hz): follow, or take a lane beside a slower car ahead.
    this.trafficClock += dt;
    if (this.trafficClock > 1 / 12) {
      this.trafficClock = 0;
      this.planTraffic(cars);
    }
    // Pure pursuit of a point on the race line (or lane) ahead. Lateral
    // offsets are positive to the left of travel (Track convention), the
    // car's local +X is its left, and positive steer turns left.
    const lookahead = clamp(6 + c.speed * 0.5, 8, 48);
    path.at(this.d + lookahead, this.target);
    const reach = Math.max(0.5, this.target.halfWidth - 1.3);
    // A finished car pulls over to the right-hand verge (negative lateral).
    const offset = finished
      ? -reach
      : clamp(path.lineAt(this.d + lookahead) * (this.laneOffset ? 0 : 1) + this.laneOffset + this.tactical, -reach, reach);
    this.delta.set(
      this.target.x + this.target.nx * offset - c.body.position.x,
      0,
      this.target.z + this.target.nz * offset - c.body.position.z,
    );
    if (bike) {
      // The lean must not rotate the target: the ground frame of the heading.
      const h = bike.dynamics.heading,
        sh = Math.sin(h),
        ch = Math.cos(h);
      this.local.set(this.delta.x * ch - this.delta.z * sh, 0, this.delta.x * sh + this.delta.z * ch);
    } else c.body.orientation.inverseRotate(this.delta, this.local);
    const purePursuit = Math.atan2(
        2 * c.spec.wheelbase * this.local.x,
        Math.max(10, this.local.x * this.local.x + this.local.z * this.local.z),
      ),
      speedSteer = c.assist === 'sport' ? 1 / (1 + c.speed * 0.018) : 1;
    // Learn the understeer from the yaw rate actually achieved (positive yaw
    // and steer are both to the left) while cornering with grip in hand.
    const yawCurvature = (c.body.omega.x * c.up.x + c.body.omega.y * c.up.y + c.body.omega.z * c.up.z) / Math.max(1, c.speed),
      geometric = Math.atan(c.spec.wheelbase * yawCurvature);
    if (!bike && c.speed > 15 && Math.abs(geometric) > 0.002 && Math.sign(geometric) === Math.sign(c.steer) && this.recovery <= 0)
      this.understeer = approach(this.understeer, clamp(c.steer / geometric, 0.9, 2.5), dt * 0.8);
    command.steer = clamp((purePursuit * this.understeer) / (c.spec.maxSteer * speedSteer), -1, 1);
    // A motorcycle facing away from its route (a route planned from where it
    // stopped) turns round at walking pace on the bars, then leans.
    let turning = false,
      away = 0;
    if (bike) {
      path.at(this.d, this.sample);
      away = Math.abs(mod(bike.dynamics.heading - Math.atan2(this.sample.tx, this.sample.tz) + Math.PI, Math.PI * 2) - Math.PI);
      // Hysteresis: once turning round, carry on until nearly aligned.
      this.turningRound = away > (this.turningRound ? BIKE_TURN_ROUND * 0.3 : BIKE_TURN_ROUND);
      turning = this.turningRound;
      command.steer = turning ? leanIntent(bike, command.steer) : this.leanCommand(bike, command.steer, finished);
    }
    // Envelope speed profile along the route ahead (the race line's own
    // curvature, or the centreline's for a lane-keeping driver).
    const grip = clamp(peakGrip(c.tires[0], 2500, c.contacts[0], Math.max(c.speed, 38)) / env.referenceMu, 0.1, 1);
    const aero = (env.downforceReference * (0.45 + 0.55 * Math.min(c.frontHealth, c.floorHealth))) / (c.spec.dryMass + c.fuel);
    const laneGrip = grip * clamp(1 - Math.abs(this.tactical) * 0.03, 0.85, 1);
    for (let i = 0; i < ENVELOPE_SAMPLES; i++) {
      const at = this.d + i * ENVELOPE_STEP;
      const curvatureAt = (x: number) => (this.laneOffset ? path.at(x, this.sample).curvature : path.lineCurvatureAt(x));
      let k = curvatureAt(at);
      // A motorcycle cannot brake hard while leaned: the sharpest point of
      // each sample's window counts (a junction corner shorter than the
      // sample spacing is not missed), with a lean reserve.
      if (bike)
        for (const o of BIKE_WINDOW) {
          const w = curvatureAt(at + o);
          if (Math.abs(w) > Math.abs(k)) k = w;
        }
      this.curvatures[i] = Math.abs(k);
      // Crests: keep the tyres loaded (v²·κ below ~half of g) instead of
      // flying a rolling road and landing off-line.
      const crest = -path.verticalCurvatureAt(at),
        crestSpeed = crest > 1e-4 ? Math.sqrt((0.55 * G) / crest) : Infinity,
        loose = path.network.edges[path.edge[path.index(at)]].spec.surface !== 'asphalt';
      this.corners[i] = Math.min(
        envelopeCornerSpeed(k, laneGrip, aero, env) * this.skill * (bike ? BIKE_CORNER_RESERVE : 1),
        crestSpeed,
        loose ? LOOSE_ROAD_SPEED * this.skill : Infinity,
      );
    }
    let desired = Math.min(env.topSpeed * this.skill, this.speedCap);
    // Turning round at walking pace; aligning again before speeding up.
    if (turning) desired = Math.min(desired, 4);
    else if (bike) desired = Math.min(desired, Math.max(6, 30 - 60 * away));
    desired = Math.min(desired, envelopeProfile(this.curvatures, this.corners, laneGrip, aero, env));
    desired = Math.min(desired, this.trafficSpeed);
    // The end of a point-to-point route: brake to a stop before its end.
    const remaining = path.closed ? Infinity : path.length - 6 - this.d;
    if (remaining < 1) desired = 0;
    else if (remaining < 260) desired = Math.min(desired, Math.sqrt(2 * 5 * remaining));
    // A finished car eases off.
    if (finished) desired = Math.min(desired, Math.max(0, c.speed - 4), 16);
    // Far off the road: slow down while steering back. (Lifting whenever the
    // car runs a little wide was tried: at speed the throttle chatter it
    // causes excites a yaw weave, so line errors are left to the steering.)
    const off = Math.abs(this.lateral - offset);
    if (off > 6) desired = Math.min(desired, Math.max(8, 30 - off));
    // A rider well off the line regains it before using the line's speed
    // (the lean controller's correction is bounded).
    if (bike && off > 2) desired = Math.min(desired, Math.max(6, 26 - 2.5 * off));
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
    // (A motorcycle has no reverse: its own stuck help puts it back on the road.)
    if (this.stuck > 3 && this.recovery <= 0 && !bike) this.recovery = 2.2;
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
    const upset = !bike && c.up.y < 0.3;
    if (!finished && (this.stuck > 9 || this.located.distance > 40 || upset)) this.trouble += dt;
    else this.trouble = Math.max(0, this.trouble - dt);
    if (this.trouble > 4) this.wantsReset = true;
    if (bike) bike.aiControlled();
  }
  /** Lean intent for a motorcycle (the steering contract of the bike AI,
   * bike-ai.ts): the lane's own curvature previewed by the lean response,
   * plus a damped, acceleration-bounded correction of lateral and heading
   * error; car-style bar steering at walking pace. */
  private leanCommand(bike: BikeVehicle, steer: number, finished: boolean) {
    const d = bike.dynamics,
      path = this.path,
      v = d.speed;
    if (v < 6) return leanIntent(bike, steer);
    const p = path.at(this.d, this.sample),
      reach = Math.max(0.5, p.halfWidth - 1.3),
      lane = this.laneOffset !== 0;
    const line = (at: number) => (lane ? 0 : path.lineAt(at));
    const target = finished ? -reach : clamp(line(this.d) + this.laneOffset + this.tactical, -reach, reach);
    const pathSlope = (line(this.d + 3) - line(this.d - 3)) / 6,
      slope = pathSlope / Math.max(0.5, 1 - p.curvature * target);
    const heading = mod(d.heading - Math.atan2(p.tx, p.tz) + Math.PI, Math.PI * 2) - Math.PI;
    const error = target - this.lateral,
      headingError = Math.atan(slope) - heading;
    const ahead = this.d + v * BIKE_AI.preview,
      k = lane ? path.at(ahead, this.sample).curvature : path.lineCurvatureAt(ahead),
      feedForward = k / Math.max(0.5, 1 - k * (lane ? target : this.tactical));
    const w = BIKE_AI.bandwidth,
      bound = (BIKE_AI.correctionG * G) / (v * v);
    const correction = clamp((w * w * error) / (v * v) + (2 * BIKE_AI.damping * w * headingError) / v, -bound, bound);
    return leanFromCurvature(bike, feedForward + correction, steer);
  }
  /** Lane choice and following speed from the cars ahead on the route. */
  private planTraffic(cars: readonly RouteObstacle[]) {
    const c = this.car,
      path = this.path;
    let follow = Infinity,
      blockLeft = false,
      blockRight = false,
      blocked: RouteObstacle | null = null;
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
    if (blocked && reach > 2.2 && this.overtake) {
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
