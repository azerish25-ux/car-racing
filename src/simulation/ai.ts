import { DriverBrain } from './driver-brain.ts';
import { FLAG, yellowFlag } from './marshal.ts';
import { TrafficPlanner, personality, type DriverPersonality } from './traffic.ts';
import {
  pitMergeConflict,
  pitYieldSpeed,
  pitPreparationDistance,
  pitApproachTrafficSpeed,
} from './pit-safety.ts';
import { peakGrip } from './tire.ts';
import { approach, clamp, G, mod, Vec3 } from '../core/math.ts';
import { VEHICLE, racingSession } from './config.ts';
import { PHASE, type RaceDirector } from './race.ts';
import { trackPoint, type Track } from './track.ts';
import { RACING_LINE, racingLineFor } from './racing-line.ts';
import type { Vehicle } from './vehicle.ts';
/** Strategic 2 Hz, tactical 12 Hz, controller 120 Hz. All driving uses normal pedals. */
/** Racing envelope from the production car's MEASURED limits
 * (scripts/reference-targets.ts, docs/PHYSICS_REFERENCE.md): constant-speed
 * ramp-steer lateral limits and full stops from 100/200/300 km/h, both fitted
 * as base + aero·v² in m/s². Margins leave room for line error, kerbs, traffic
 * and the finite pedal controller. They are targets for normal pedals and
 * steering only: no grip, force or pose is ever added. */
export const AI_ENVELOPE = Object.freeze({
  lateralBase: 15.95,
  lateralAero: 0.00548,
  brakingBase: 19.9,
  brakingAero: 0.0056,
  /** Fast corners (above ~180 km/h). */
  lateralMargin: 0.72,
  /** Slow corners (below ~70 km/h): tight hairpins, crests and exits on power
   * leave the line-following controller less room. */
  slowLateralMargin: 0.62,
  brakingMargin: 0.55,
});
/** Lateral margin by corner speed (m/s), blended between the two limits. */
export function lateralMarginAt(speed: number) {
  const t = clamp((speed - 20) / 30, 0, 1);
  return (
    AI_ENVELOPE.slowLateralMargin +
    (AI_ENVELOPE.lateralMargin - AI_ENVELOPE.slowLateralMargin) * t * t * (3 - 2 * t)
  );
}
export const ENVELOPE_STEP = 12;
export const ENVELOPE_SAMPLES = 21;
/** Backward velocity profile over samples ENVELOPE_STEP apart: returns the
 * highest speed at sample 0 from which every later sample's corner speed can
 * be met, with braking limited to what the friction circle leaves after the
 * lateral load at each sample. */
export function envelopeProfile(
  curvatures: ArrayLike<number>,
  corners: ArrayLike<number>,
  grip: number,
  aero: number,
) {
  const n = corners.length;
  let v = Math.min(corners[n - 1], 400);
  for (let i = n - 2; i >= 0; i--) {
    const lateralLimit =
      (AI_ENVELOPE.lateralBase + AI_ENVELOPE.lateralAero * aero * v * v) *
      grip *
      lateralMarginAt(v);
    const usage = Math.min(1, (v * v * curvatures[i + 1]) / Math.max(1e-6, lateralLimit));
    const braking =
      (AI_ENVELOPE.brakingBase + AI_ENVELOPE.brakingAero * aero * v * v) *
      grip *
      AI_ENVELOPE.brakingMargin *
      Math.sqrt(Math.max(0, 1 - usage * usage));
    v = Math.min(corners[i], Math.sqrt(v * v + 2 * Math.max(0.5, braking) * ENVELOPE_STEP));
  }
  return v;
}
/** Highest steady speed on curvature κ: v²κ = a0 + k·v². */
export function envelopeCornerSpeed(curvature: number, grip: number, aero: number) {
  // Solve with the fast margin, then once more with the margin at that speed.
  let speed = Infinity;
  for (const margin of [AI_ENVELOPE.lateralMargin, 0]) {
    const m = margin || lateralMarginAt(speed);
    const a0 = AI_ENVELOPE.lateralBase * grip * m,
      k = AI_ENVELOPE.lateralAero * aero * grip * m,
      denominator = Math.abs(curvature) - k;
    speed = denominator <= 1e-7 ? Infinity : Math.sqrt(a0 / denominator);
    if (!Number.isFinite(speed)) return speed;
  }
  return speed;
}
/** Entry speed from which the car can slow to `target` within `distance`
 * with deceleration b0 + kb·v² (exact integral of v dv/ds = -(b0 + kb v²)). */
export function envelopeBrakingSpeed(
  target: number,
  distance: number,
  grip: number,
  aero: number,
  margin = AI_ENVELOPE.brakingMargin,
) {
  if (!Number.isFinite(target)) return Infinity;
  const b0 = AI_ENVELOPE.brakingBase * grip * margin,
    kb = AI_ENVELOPE.brakingAero * aero * grip * margin;
  return Math.sqrt(
    (target * target + b0 / kb) * Math.exp(2 * kb * Math.max(0, distance)) - b0 / kb,
  );
}
/** Braking envelope with explicit controller response distance. Solving
 * d = v*tau + v²/(2a) keeps a finite-bandwidth pedal controller inside its stop.
 */
export function stoppingTarget(distance: number, deceleration: number, responseSeconds = 0.8) {
  const a = Math.max(0.1, deceleration);
  return (
    Math.sqrt((a * responseSeconds) ** 2 + 2 * a * Math.max(0, distance)) - a * responseSeconds
  );
}
export class AIDriver {
  private target = trackPoint();
  private sample = trackPoint();
  private delta = new Vec3();
  private local = new Vec3();
  private strategyClock = 0;
  private tacticalClock = 0;
  /** Absolute lateral target at the car (m from the centreline). */
  private offset = 0;
  /** Lateral distance from the racing line (passing/defending lanes). */
  private tactical = 0;
  private desiredOffset = 0;
  private trafficSpeed = 100;
  private stuckTime = 0;
  private preparingPit = false;
  private readonly curvatures = new Float64Array(ENVELOPE_SAMPLES);
  private readonly corners = new Float64Array(ENVELOPE_SAMPLES);
  private planner = new TrafficPlanner();
  readonly personality: DriverPersonality;
  readonly brain: DriverBrain;
  decision = 'RACING LINE';
  constructor(
    readonly car: Vehicle,
    readonly skill = 0.96,
    seed = 73021,
  ) {
    this.personality = personality(seed, car.id);
    this.brain = new DriverBrain(this.personality, seed, car.id);
  }
  update(dt: number, track: Track, cars: Vehicle[], race: RaceDirector) {
    const c = this.car,
      command = c.input;
    command.shift = 0;
    command.manualClutch = false;
    command.clutch = 0;
    command.reverse = false;
    command.ers = this.brain.ers;
    if (race.phase === PHASE.LIGHTS || race.time < race.greenAt + this.brain.reactionSeconds) {
      command.throttle = 0;
      command.brake = 1;
      command.steer = 0;
      return;
    }
    // The AI opens DRS whenever race control makes it available (race sessions
    // only, so single-car practice benchmarks never run with the flap open).
    if (racingSession(race.options.mode)) c.drsRequest = true;
    this.strategyClock += dt;
    this.tacticalClock += dt;
    if (this.strategyClock >= 0.5) {
      this.brain.update(this.strategyClock, c, cars, track, race);
      this.strategyClock = 0;
      command.ers = this.brain.ers;
    }
    const pitLane = track.pit,
      entryLane = pitLane.side * 6;
    const entryGap = mod(track.pitEntryS() - c.s, track.length);
    // Once preparation starts, slower speed must not shrink its lookahead and
    // cancel the lane change. Only crossing/missing the entry ends this intent.
    if (!c.pitRequested || c.inPit || entryGap > track.length - 20) this.preparingPit = false;
    else if (entryGap < pitPreparationDistance(c.speed, c.lateral, entryLane))
      this.preparingPit = true;
    const preparingPit = this.preparingPit;
    const line = racingLineFor(track);
    // In the wet a driver keeps off the painted edges and kerbs and leaves
    // room for a slide, so the line narrows towards the centreline (to 55% of
    // its width from about 0.8 mm of water under the car).
    const wetness = clamp(c.contacts[0].water / 0.8, 0, 1);
    const width = 1 - 0.45 * wetness;
    const lineAt = (s: number) => line.offsetAt(s) * width;
    if (this.tacticalClock > 1 / 12 && !c.inPit) {
      this.tacticalClock = 0;
      const grip = clamp(
        peakGrip(c.tires[0], 2500, c.contacts[0], Math.max(c.speed, 38)) / 1.82,
        0.1,
        1,
      );
      const plan = this.planner.evaluate(
        c,
        cars,
        track,
        race.time,
        8.5 * grip,
        this.personality,
        yellowFlag(race.control.flags[c.id]) || race.control.neutralised > 0,
        preparingPit ? entryLane : this.brain.preferredLine(c, cars, track, race) || lineAt(c.s),
        preparingPit,
        lineAt,
      );
      this.desiredOffset = plan.offset;
      this.trafficSpeed = plan.speedLimit;
      this.decision = plan.decision;
    }
    if (!c.inPit) c.pitYielding = false;
    const pit = c.inPit,
      box = track.boxS(c.id),
      boxGap = mod(box - c.s, track.length);
    // On track the car follows the racing line; a passing or defending lane is
    // a tactical distance from that line, changed at a finite lateral rate.
    // The pit approach and the pit lane keep absolute corridors (the entry is
    // a fixed place on the track, not a distance from the line).
    const lineHere = lineAt(c.s);
    const corridor = pit || preparingPit;
    if (pit) {
      this.offset = approach(this.offset, this.pitLine(track, c.s), dt * 6);
      this.tactical = this.offset - lineHere;
    } else if (preparingPit) {
      this.offset = approach(this.offset, this.desiredOffset, dt * 1.6);
      this.tactical = this.offset - lineHere;
    } else {
      this.tactical = approach(this.tactical, this.desiredOffset - lineHere, dt * 1.6);
      this.offset = lineHere + this.tactical;
    }
    let lookahead = clamp(6 + c.speed * 0.48, 8, 46);
    if (pit && c.pitPhase === 1 && boxGap < 35)
      lookahead = Math.min(lookahead, Math.max(1, boxGap));
    track.at(c.s + lookahead, this.target);
    const reach = Math.max(1, this.target.width - RACING_LINE.edgeMargin);
    const pathOffset = pit
      ? this.pitLine(track, c.s + lookahead)
      : corridor
        ? this.offset
        : clamp(lineAt(c.s + lookahead) + this.tactical, -reach, reach);
    this.delta.set(
      this.target.x + this.target.nx * pathOffset - c.body.position.x,
      0,
      this.target.z + this.target.nz * pathOffset - c.body.position.z,
    );
    c.body.orientation.inverseRotate(this.delta, this.local);
    const purePursuit = Math.atan2(
        2 * VEHICLE.wheelbase * this.local.x,
        Math.max(10, this.local.x * this.local.x + this.local.z * this.local.z),
      ),
      speedSteer = c.assist === 'sport' ? 1 / (1 + c.speed * 0.018) : 1;
    command.steer = clamp(purePursuit / (VEHICLE.maxSteer * speedSteer), -1, 1);
    let desired = 92 * this.skill;
    const grip = clamp(
        peakGrip(c.tires[0], 2500, c.contacts[0], Math.max(c.speed, 38)) / 1.82,
        0.1,
        1,
      ),
      braking = 8.5 * grip;
    // Backwards braking envelope, not a distance-to-waypoint switch. Downforce
    // scales with speed and with 1/mass; damage removes its share.
    // Following in another car's wake costs downforce (about 30% of it at full
    // overlap, from the aero model's front/rear/floor wake losses).
    const aero =
      ((0.45 + 0.55 * Math.min(c.frontHealth, c.floorHealth)) * 794 * (1 - 0.3 * c.wake)) /
      (VEHICLE.dryMass + c.fuel);
    // Off the racing line (passing or defending lanes) there is less room to
    // run wide, so the envelope keeps a larger reserve there.
    // Standing water also costs the rear axle grip under trail braking (it
    // steps out first), so the wet envelope keeps up to 15% more in reserve.
    const laneGrip =
      grip *
      (1 - 0.15 * wetness) *
      clamp(
        1 - (0.25 * Math.max(0, Math.abs(corridor ? this.offset : this.tactical) - 1.5)) / 6,
        0.8,
        1,
      );
    // Samples every 12 m for 240 m, then a backward pass with a friction
    // circle: braking only uses the grip the corner leaves (trail braking).
    // Corner radii are those of the path driven: the racing line, offset by
    // the tactical lane (the pit lane follows the centreline geometry).
    for (let i = 0; i < ENVELOPE_SAMPLES; i++) {
      const s = c.s + i * ENVELOPE_STEP;
      let curvature: number;
      if (corridor) {
        track.at(s, this.sample);
        curvature = this.sample.curvature / (1 - this.sample.curvature * this.offset);
      } else {
        // A narrowed line blends the line's curvature with the centreline's.
        let k = line.curvatureAt(s);
        if (width < 1) k = k * width + track.at(s, this.sample).curvature * (1 - width);
        curvature = k / (1 - k * this.tactical);
      }
      this.curvatures[i] = Math.abs(curvature);
      this.corners[i] = envelopeCornerSpeed(curvature, laneGrip, aero) * this.skill;
    }
    desired = Math.min(desired, envelopeProfile(this.curvatures, this.corners, laneGrip, aero));
    if (!c.inPit) desired = Math.min(desired * this.brain.pace, this.trafficSpeed);
    if (c.finishTime) desired = Math.min(desired, 38);
    if (preparingPit)
      desired = Math.min(
        desired,
        Math.sqrt(14 * 14 + 2 * braking * 0.85 * Math.max(0, entryGap - 30)),
      );
    if (preparingPit) {
      const yielding = pitApproachTrafficSpeed(
        c,
        cars,
        track,
        this.desiredOffset,
        track.pit.side * 6,
      );
      if (yielding < desired) {
        desired = yielding;
        this.decision = 'YIELD FOR PIT APPROACH';
      }
    }
    desired = Math.min(desired, race.control.targetSpeed(c.id, braking * 0.7));
    if (race.control.flags[c.id] === FLAG.BLUE && c.speed > 10)
      desired = Math.min(desired, c.speed * 0.94);
    if (yellowFlag(race.control.flags[c.id])) {
      this.decision = 'LOCAL CAUTION / NO OVERTAKING';
      command.ers = 0;
    }
    if (pit) {
      desired = Math.min(desired, 21.1);
      // Slow corridor: just inside the entry line and through the exit merge.
      if (
        c.s > track.length - (track.pit.entry + 15) ||
        (c.s > track.pit.limitAfter - 10 && c.s < track.pit.mergeEnd + 5)
      )
        desired = Math.min(desired, 9 + 5 * grip);
      const distance = mod(track.boxS(c.id) - c.s, track.length);
      if (c.pitPhase === 1 && distance < 125)
        desired = Math.min(desired, stoppingTarget(distance - 1.8, Math.max(1.1, 4.5 * grip)));
      if (c.pitPhase >= 2 && c.pitPhase <= 5) desired = 0;
      this.decision = 'PIT SERVICE';
      c.pitYielding = pitMergeConflict(c, cars, track);
      if (c.pitYielding) {
        desired = Math.min(desired, pitYieldSpeed(c, true, braking, track.pit.holdLine));
        this.decision = 'YIELD AT PIT EXIT';
      }
      for (const other of cars) {
        if (other === c || !other.inPit) continue;
        const gap = mod(other.s - c.s, track.length);
        // Fast-lane traffic queues in longitudinal order. A service-bay car
        // also blocks if our upcoming bay approach would sweep into it, even
        // while our current lateral separation still looks harmless.
        const conflict =
          other.pitPhase === 1 ||
          other.pitPhase === 6 ||
          Math.abs(other.lateral - c.lateral) < 2.7 ||
          Math.abs(other.lateral - this.pitLine(track, other.s)) < 3;
        if (conflict && gap > 0 && gap < 80)
          desired = Math.min(
            desired,
            Math.sqrt(
              Math.max(
                0,
                other.speed ** 2 + 2 * Math.max(1, braking * 0.7) * (gap - 7 - c.speed * 0.75),
              ),
            ),
          );
      }
    }
    const lateralError = Math.abs(c.lateral - (pit ? this.pitLine(track, c.s) : this.offset));
    if (lateralError > 4) desired = Math.min(desired, Math.max(10, 34 - lateralError * 2));
    c.aiTarget = desired;
    c.aiOffset = pathOffset;
    const error = desired - c.speed;
    command.throttle = clamp(error * 0.25 + 0.13, 0, 1);
    command.brake = clamp(-error * 0.18, 0, 1);
    // Friction circle on exit: power comes in as the lateral load unwinds, so
    // a car at the cornering limit is not also asked for full traction.
    const lateralUsage = Math.min(
      1,
      (Math.abs(c.gLat) * G) /
        ((AI_ENVELOPE.lateralBase + AI_ENVELOPE.lateralAero * aero * c.speed * c.speed) * grip),
    );
    command.throttle = Math.min(
      command.throttle,
      0.2 + 0.8 * Math.sqrt(Math.max(0, 1 - lateralUsage * lateralUsage)),
    );
    // A driver feathers the pedal against wheelspin (rear slip ratio above the
    // traction peak) rather than holding it flat through a slide.
    const wheelspin = Math.max(c.tires[2].slip, c.tires[3].slip);
    if (wheelspin > 0.08) command.throttle *= clamp(1 - (wheelspin - 0.08) * 5, 0.05, 1);
    // Braking shares the same friction circle: at the cornering limit the
    // pedal is squeezed, not stamped, and eased off a locking wheel. Losing
    // the rear under braking is worse than missing a traffic target.
    const available = Math.sqrt(Math.max(0, 1 - lateralUsage * lateralUsage));
    command.brake = Math.min(command.brake, 0.3 + 0.7 * available);
    let lock = 0;
    for (const tire of c.tires) lock = Math.min(lock, tire.slip);
    if (lock < -0.12) command.brake *= clamp(1 - (-lock - 0.12) * 4, 0.35, 1);
    if (desired < 0.15) {
      command.throttle = 0;
      command.brake = 1;
    }
    if (!pit && c.speed < 0.7 && desired > 6) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 5 && this.stuckTime < 9) {
      command.reverse = true;
      command.throttle = 0.25;
      command.brake = 0;
      command.steer = -command.steer;
      this.decision = 'RECOVERY';
    }
    if (this.stuckTime >= 10) this.stuckTime = 0;
    this.brain.errors.apply(
      dt,
      command,
      !pit &&
        !preparingPit &&
        !c.finishTime &&
        !c.retired &&
        !command.reverse &&
        race.control.flags[c.id] === FLAG.GREEN &&
        desired > 15 &&
        this.trafficSpeed > c.speed + 2,
    );
    // A missed service box is a drive-through, not a reverse maneuver across
    // queued cars. Preserve the request so the next lawful entry retries it.
    if (pit && c.pitPhase === 1 && c.s > box + 2.4 && c.s < box + 80) {
      c.pitPhase = 6;
      c.pitRequested = true;
      command.reverse = false;
      this.decision = 'MISSED BOX / RETRY NEXT LAP';
    }
  }
  private pitLine(track: Track, s: number) {
    const base = track.pitOffset(s),
      c = this.car,
      box = track.boxS(c.id),
      gap = mod(box - s, track.length);
    const service =
      c.pitPhase >= 2 && c.pitPhase <= 5
        ? 1
        : c.pitPhase === 1
          ? s > box && s < box + 40
            ? 1
            : clamp((55 - gap) / 45, 0, 1)
          : 0;
    const side = track.pit.side,
      offset =
        base + side * (-1.5 + service * 3.6) * clamp(Math.abs(base) / track.pit.offset, 0, 1);
    return s > track.length - (track.pit.entry + 25) ? side * Math.max(6, side * offset) : offset;
  }
}
