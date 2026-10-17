import { approach, clamp, G, mod } from '../../core/math.ts';
import { AIDriver, envelopeBrakingSpeed, envelopeCornerSpeed } from '../ai.ts';
import { BikeAIDriver, createDriver } from '../bike-ai.ts';
import { FLAG } from '../marshal.ts';
import { PHASE, type RaceDirector } from '../race.ts';
import { RACING_LINE, racingLineFor } from '../racing-line.ts';
import { lineCost } from '../terrain.ts';
import { surfaceSample, Track, trackPoint } from '../track.ts';
import { peakGrip } from '../tire.ts';
import type { Vehicle } from '../vehicle.ts';
import { TrackTerrainSurface } from './course-terrain.ts';
import { DirtBikeVehicle } from './dirt-bike-vehicle.ts';
import { takeoffSpeed, type JumpSurvey } from './profile.ts';
import { LANDING_RULES } from './riding-feedback.ts';
import { offroadSessionFor } from './session.ts';
import { offroadCourse } from './venues.ts';

/** Take-off speed the sprung chassis adds to the speed held up the face
 * (m/s): the springs rebound off the lip and the flight starts slightly
 * behind the point-mass lip. Measured per feature kind on the production
 * terrain by scripts/offroad-calibration.ts (the AI's lip speeds there must
 * land on every surveyed landing face). */
export const TAKEOFF_GAIN: Readonly<Record<JumpSurvey['kind'], number>> = Object.freeze({
  tabletop: 0.4,
  'step-up': 0.45,
  crest: 0.3,
  kicker: 1.0,
  double: 0.5,
  triple: 0.78,
});
/** The line is held straight from this far before a jump's face (m) and
 * blended in and out over JUMP_LINE_BLEND metres. */
const JUMP_LINE_LEAD = 18,
  JUMP_LINE_BLEND = 10;
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
/** Speed shortfall (m/s) of the AI's other limits under the lip speed that
 * aborts a committed jump (traffic or an incident on the run-up). */
const ABORT_MARGIN = 2.5;
/** Heading error to the course direction (rad) beyond which a rider only
 * steers back toward it. */
const HEADING_LIMIT = 0.5;
/** Seconds after the gate drop the field launches flat out. */
const LAUNCH_SECONDS = 1.6;
/** Grade (sine of the ground slope) and speed (m/s) below which a rider
 * climbing a face holds the drive that carries it (climbFace). */
const CLIMB_GRADE = 0.1,
  CLIMB_SPEED = 8;
/** Seconds a riding bike may sit still before the marshals push it out. */
const STUCK_SECONDS = 4;
/** Lip speed (m/s) a rider rolls a feature at: below it the bike stays on the ground. */
export const ROLL_SPEED = 2.5;
/** Speed (m/s) whose energy carries a rolling bike `climb` metres up to a
 * crest at ROLL_SPEED (the drive is not counted on: on loose faces it
 * barely holds the grade). */
export function rollSpeed(climb: number) {
  return Math.sqrt(ROLL_SPEED * ROLL_SPEED + 2 * G * Math.max(0, climb));
}
/** The speed to hold up the face of `j` so the flight lands on its landing
 * zone (tabletops a little short: the deck is the safe side). */
export function jumpHoldSpeed(j: JumpSurvey) {
  const aim = j.landing - (j.forgiving ? 0.15 * j.landingLength : 0),
    v = takeoffSpeed(aim - j.takeoff, j.lipHeight - j.landingHeight, j.lipAngle);
  return Number.isFinite(v) ? Math.max(ROLL_SPEED, v - TAKEOFF_GAIN[j.kind]) : 12;
}
/** Off-road rider AI (WP40): the shared race craft and lean-aware tracker
 * of BikeAIDriver, plus line choice over the deformable soil (the terrain's
 * `lineCost`: deep rut edges, soft loose ground and compacted lines) and jump
 * speed control — arrive at each lip at the speed whose flight lands on the
 * landing face's downslope, or, when that speed cannot be reached on the run
 * up, roll the feature slowly. In the air the adapter's pitch aid (AI always)
 * aims the bike at the predicted landing slope. Crashes recover through the
 * shared remount sequence. */
export class DirtBikeAIDriver extends BikeAIDriver {
  private rutBias = 0;
  private biasTarget = 0;
  private lineClock = 0;
  private plan: { jump: JumpSurvey; clear: boolean; locked: boolean } | null = null;
  private readonly lineBefore = trackPoint();
  private readonly lineHere = trackPoint();
  private readonly lineAfter = trackPoint();
  private lineTrack: Track | null = null;
  private featureLines: Array<{ from: number; to: number; lateral: number }> = [];
  readonly decisions = { clears: 0, rolls: 0, aborts: 0, pushes: 0 };
  constructor(
    readonly rider: DirtBikeVehicle,
    skill = 0.94,
    seed = 73021,
  ) {
    super(rider, skill, seed);
  }
  override update(dt: number, track: Track, cars: Vehicle[], race: RaceDirector) {
    this.lineClock -= dt;
    if (this.lineClock <= 0) {
      this.lineClock = 0.25;
      this.chooseLine(track);
    }
    this.rutBias = approach(this.rutBias, this.biasTarget, dt * 1.2);
    super.update(dt, track, cars, race);
    this.governJump(track);
    this.climbFace();
    this.headingGuard(track);
    this.gateLaunch(track, race);
    this.unstick(dt, track, race);
  }
  /** Gate start: every rider goes flat out as the gate drops (the traffic
   * planner would otherwise wait for a gap in a row of bikes abreast). */
  private gateLaunch(track: Track, race: RaceDirector) {
    const c = this.rider;
    if (!c.riding || race.phase !== PHASE.RACING || race.raceTime > LAUNCH_SECONDS) return;
    if (offroadSessionFor(track)?.format?.start !== 'gate' || race.laps[c.id].completed > 0) return;
    c.input.throttle = 1;
    c.input.brake = 0;
  }
  /** A rider rejoining from wide of a berm slows while turning back toward
   * the course. Steering alone is insufficient: a leaned bike takes time to
   * stand up, and a normal racing target accelerates it across the next wall
   * before it can point down the lane. */
  private headingGuard(track: Track) {
    const c = this.rider,
      d = c.dynamics;
    if (!c.riding || c.airborne || c.speed < 2) return;
    track.at(c.s, squarePoint);
    const error =
      mod(Math.atan2(squarePoint.tx, squarePoint.tz) - d.heading + Math.PI, Math.PI * 2) - Math.PI;
    if (Math.abs(error) < HEADING_LIMIT) return;
    c.input.steer = clamp(error * 2.2 - d.lean * 0.4, -0.6, 0.6);
    const rejoin = Math.max(2.8, 5.5 - 2 * Math.abs(error));
    // This rejoin limit runs after the jump planner. A committed clear
    // must see the same substantial pre-face braking constraint as the
    // upstream traffic limit, or it reaches the lip below its clear speed.
    const plan = this.plan;
    if (plan?.clear && plan.locked && rejoin < c.aiTarget) {
      const run = mod(plan.jump.takeoff - c.s, track.length),
        face = plan.jump.takeoff - plan.jump.start;
      if (
        run <= 28 && run <= track.length / 2 && run >= face + 0.5 &&
        rejoin < jumpHoldSpeed(plan.jump) - ABORT_MARGIN
      ) {
        plan.clear = false;
        this.decisions.aborts++;
      }
    }
    c.aiTarget = Math.min(c.aiTarget, rejoin);
    c.input.throttle = Math.min(c.input.throttle, clamp(0.2 + (rejoin - c.speed) * 0.5, 0, 1));
    c.input.brake = Math.max(c.input.brake, clamp((c.speed - rejoin) * 0.4, 0, 1));
  }
  private stuck = 0;
  /** Marshal assistance: a bike pinned against a tyre wall or beached on a
   * berm's back (riding, but going nowhere) is pushed back onto the track. */
  private unstick(dt: number, track: Track, race: RaceDirector) {
    const c = this.rider;
    if (
      race.phase !== PHASE.RACING || race.raceTime <= 5 ||
      !c.riding || c.airborne || c.speed >= 0.5
    ) {
      this.stuck = 0;
      return;
    }
    // Count actual drive effort while stationary. Passing traffic can
    // briefly hold a beached rider on the brakes; that pause does not mean
    // the bike moved. A continuously queued rider accrues no effort, and
    // assistance still starts only on a tick asking for drive.
    if (c.aiTarget <= 0.5 || c.input.throttle <= 0.2 || c.input.brake >= 0.1) return;
    this.stuck += dt;
    if (this.stuck < STUCK_SECONDS) return;
    this.stuck = 0;
    // At the course edge facing the course, never back on a face it could
    // not climb (the adapter's restart point).
    c.restart(track);
    this.decisions.pushes++;
  }
  /** Slow up a face a rider holds the drive that carries the grade: the
   * general pedal controller, proportional to the speed error, settles well
   * below its target on a 30° face and, slowed further by traffic, at a
   * standstill where the drive only just holds the bike there (it cannot
   * restart). Below the target speed the throttle is at least the grade's
   * share of full drive. */
  private climbFace() {
    const c = this.rider,
      input = c.input,
      grade = Math.sin(c.groundPitch);
    if (!c.riding || c.airborne || grade < CLIMB_GRADE || c.speed > CLIMB_SPEED) return;
    if (c.aiTarget < 0.5 || c.aiTarget <= c.speed) return;
    input.throttle = Math.max(input.throttle, clamp(0.3 + 1.4 * grade, 0, 1));
    input.brake = 0;
  }
  /** On the last metres to a lip a rider meters the speed with a firm hand
   * (the general controller's proportional pedal settles below its target)
   * and drives up the face rather than coasting it. */
  private governJump(track: Track) {
    const c = this.rider,
      plan = this.plan,
      input = c.input;
    if (!plan?.clear || !c.riding || c.airborne || input.reverse) return;
    const j = plan.jump,
      run = mod(j.takeoff - c.s, track.length);
    if (run > 28 || run > track.length / 2) return;
    const face = j.takeoff - j.start,
      onFace = run < face + 0.5,
      e = c.aiTarget - c.speed;
    if (onFace) {
      input.throttle = clamp(0.2 + 0.5 * Math.max(0, e), 0, 1);
      input.brake = 0;
    } else {
      input.throttle = clamp(0.25 + 0.9 * e, 0, 1);
      input.brake = clamp(-0.35 * e, 0, 1);
    }
    // Square to the lip and upright: from a few metres out the lean intent
    // only aligns the heading with the face (the lateral is kept).
    if (run < face + 10) {
      track.at(c.s, squarePoint);
      const d = c.dynamics,
        error =
          mod(Math.atan2(squarePoint.tx, squarePoint.tz) - d.heading + Math.PI, Math.PI * 2) -
          Math.PI;
      input.steer = clamp(error * 2.2 - d.lean * 0.4, -0.5, 0.5);
    }
  }
  /** Lateral choice at the preview point: the terrain's line cost across a
   * band around the racing line, with a pull back toward the line. */
  private chooseLine(track: Track) {
    const surface = Track.offroadOf(track);
    if (!(surface instanceof TrackTerrainSurface)) return;
    const c = this.rider,
      line = racingLineFor(track),
      s = c.s + clamp(c.speed * 0.8, 8, 30),
      base = line.offsetAt(s),
      p = track.at(s, previewPoint),
      reach = Math.max(0.5, p.width - 1.1);
    let best = 0,
      bestCost = Infinity;
    for (const d of [-1.6, -0.8, 0, 0.8, 1.6]) {
      const l = clamp(base + d, -reach, reach),
        cost = lineCost(surface.terrain, l, s) + 0.55 * Math.abs(l - base);
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = l - base;
      }
    }
    this.biasTarget = best;
  }
  /** The rut-biased racing line, held straight over a jump (from the run-up
   * to the end of the landing): a bike leaves a lip upright and square to it,
   * so the line's own swing across a straight for the next corner waits. */
  protected override lineOffset(track: Track, s: number, racing: number) {
    const base = racing + this.rutBias,
      course = offroadCourse(track.circuit);
    if (!course) return base;
    if (this.lineTrack !== track) {
      this.lineTrack = track;
      const sections = [
        ...course.rough.map((r) => ({ from: r.from - JUMP_LINE_LEAD, to: r.to + 2 })),
        ...course.jumps.map((j) => ({ from: j.start - JUMP_LINE_LEAD, to: j.end + 2 })),
      ].sort((a, b) => a.from - b.from);
      const merged: Array<{ from: number; to: number }> = [];
      for (const section of sections) {
        const previous = merged.at(-1);
        if (previous && section.from <= previous.to + JUMP_LINE_BLEND)
          previous.to = Math.max(previous.to, section.to);
        else merged.push({ ...section });
      }
      // A feature train crossing the lap line is one corridor too.
      const first = merged[0], last = merged.at(-1);
      if (first && last && first !== last && first.from + track.length <= last.to + JUMP_LINE_BLEND) {
        last.to = first.to + track.length;
        merged.shift();
      }
      const line = racingLineFor(track);
      this.featureLines = merged.map((section) => ({
        ...section,
        lateral: clamp(line.offsetAt(section.from), -1.5, 1.5),
      }));
    }
    // Consecutive jumps and rollers share a line. Otherwise an exit line
    // from one feature can demand a full-width lane change inside the next
    // bump train, where airborne tyres cannot execute that correction.
    for (const section of this.featureLines) {
      const rel = mod(s - section.from, track.length), span = section.to - section.from;
      if (rel > span + JUMP_LINE_BLEND) continue;
      const w = rel < JUMP_LINE_BLEND
        ? smooth(rel / JUMP_LINE_BLEND)
        : rel > span
          ? 1 - smooth((rel - span) / JUMP_LINE_BLEND)
          : 1;
      return base + (section.lateral - base) * w;
    }
    return base;
  }
  /** The lean tracker follows the same narrowed, rut-biased and feature-held
   * path as the planner. Using the road line here asks a rider to swerve
   * across rollers even while the off-road planner holds a straight line. */
  protected override steeringLineOffset(track: Track, s: number) {
    const c = this.rider,
      wetness = clamp(c.contacts[0].water / 0.8, 0, 1),
      width = (1 - 0.45 * wetness) * (c.definition.ai.lineScale ?? 1),
      base = this.lineOffset(track, s, racingLineFor(track).offsetAt(s) * width),
      reach = Math.max(1, track.at(s, this.lineHere).width - RACING_LINE.edgeMargin);
    return clamp(base, -reach, reach);
  }
  /** Signed curvature of that actual path, from three nearby ground-plane
   * positions. The road-bike solver remains untouched; a frozen straight
   * gives exactly zero feed-forward through a whoop or a jump face. */
  protected override steeringLineCurvature(track: Track, s: number) {
    const la = this.steeringLineOffset(track, s - 2),
      lb = this.steeringLineOffset(track, s),
      lc = this.steeringLineOffset(track, s + 2),
      a = track.at(s - 2, this.lineBefore),
      b = track.at(s, this.lineHere),
      c = track.at(s + 2, this.lineAfter),
      ax = b.x + b.nx * lb - a.x - a.nx * la,
      az = b.z + b.nz * lb - a.z - a.nz * la,
      bx = c.x + c.nx * lc - b.x - b.nx * lb,
      bz = c.z + c.nz * lc - b.z - b.nz * lb;
    return Math.atan2(az * bx - ax * bz, ax * bx + az * bz) /
      Math.max(0.1, (Math.hypot(ax, az) + Math.hypot(bx, bz)) * 0.5);
  }
  /** A motorcycle needs about half a car's lateral room to pass or avoid. */
  protected override trafficScale() {
    return 0.5;
  }
  /** Speed reachable from `v` over `run` metres on loose ground: the
   * engine's power at the tyre (less drag) and ~0.4 g of traction, capped. */
  private reach(v: number, run: number, cap: number) {
    const c = this.rider,
      spec = c.definition.spec,
      mass = c.dynamics.mass,
      power = 0.82 * spec.motorPowerW;
    let speed = Math.max(1, v);
    for (let x = 0; x < run && speed < cap; x += 1) {
      const a =
        Math.min(0.4 * G, power / (mass * speed)) - (c.dynamics.p.drag * speed * speed) / mass;
      speed = Math.sqrt(Math.max(1, speed * speed + 2 * a));
    }
    return Math.min(speed, cap);
  }
  /** Jump speed control: hold the speed whose flight lands on the landing
   * zone; when the run-up cannot reach it, roll the feature. The choice is
   * locked where the braking distance to the rolling speed runs out (a late
   * change of mind arrives at the lip at neither speed; traffic then waits
   * until the landing), and nobody brakes on a face (it noses down). A rider
   * on the ground inside a gap (rolled, or remounted after a fall) rolls on
   * over the landing mound. */
  protected override limitSpeed(desired: number, track: Track, race: RaceDirector) {
    const course = offroadCourse(track.circuit),
      c = this.rider,
      L = track.length;
    if (!course || c.airborne) return desired;
    const inside = course.jumpAt(c.s);
    if (
      inside &&
      mod(c.s - inside.takeoff, L) < inside.end - inside.takeoff + 1 &&
      mod(c.s - inside.start, L) > inside.takeoff - inside.start + 0.5
    ) {
      // A real clear may touch down before the surveyed gap ends. Keep
      // upstream race/traffic limits while its suspension settles instead
      // of abruptly commanding the walking target for a beached rider.
      const landing = c.lastLanding;
      if (
        this.plan?.jump === inside && this.plan.clear && this.plan.locked &&
        landing && course.jumpAt(landing.s) === inside &&
        landing.airTime > LANDING_RULES.minimumAirTime &&
        c.clock >= landing.time && c.clock - landing.time <= LANDING_RULES.settleSeconds
      ) return desired;
      this.plan = null;
      if (inside.forgiving) return desired;
      // Down in a gap: enough speed to roll up and over the next mound (its
      // height above the ground here), never less than a walking roll.
      return Math.min(desired, Math.max(ROLL_SPEED + 1.5, rollSpeed(course.climbAhead(c.s))));
    }
    const next = inside ? { jump: inside } : course.nextJump(c.s);
    if (!next) return desired;
    const j = next.jump,
      run = mod(j.takeoff - c.s + 1, L) - 1;
    if (run > 160 || run > L / 2) {
      this.plan = null;
      return desired;
    }
    const hold = jumpHoldSpeed(j),
      faceLength = j.takeoff - j.start,
      toFace = run - faceLength,
      onFace = toFace < 0.5;
    // Under a yellow flag nobody jumps: roll it. Otherwise clear the gap
    // only when the run-up and every other limit leave the hold speed.
    const flag = race.control.flags[c.id],
      yellow = flag === FLAG.YELLOW || flag === FLAG.DOUBLE_YELLOW;
    // A roll reaches the foot of the face with the speed whose energy carries
    // the bike up to the lip at a walking roll: up a 30° face of loose soil
    // the drive barely holds the grade (and not at all when it is wet), so
    // the climb is ridden on momentum.
    const rollFoot = rollSpeed(j.lipHeight),
      brakeToRoll = (c.speed * c.speed - rollFoot * rollFoot) / (2 * 0.45 * G) + 4;
    const same = this.plan?.jump === j;
    if (!same || !this.plan!.locked || (yellow && this.plan!.clear && toFace > brakeToRoll - 2)) {
      const reachable = this.reach(c.speed, Math.max(0, toFace - 1), c.definition.ai.topSpeed);
      const clear = !yellow && reachable >= hold - (j.forgiving ? 0.8 : 0.25);
      if (!same) {
        if (clear) this.decisions.clears++;
        else this.decisions.rolls++;
      }
      this.plan = { jump: j, clear, locked: onFace || toFace < brakeToRoll };
    }
    const plan = this.plan!;
    if (!plan.clear) {
      if (onFace) {
        // Up the face: the speed the rest of the climb needs, kept (never
        // braked away) up to a little more.
        const need = rollSpeed(j.lipHeight - course.profileHeight(c.s));
        return Math.min(desired, Math.max(need, Math.min(c.speed, need + 1.5)));
      }
      return Math.min(
        desired,
        Math.sqrt(rollFoot * rollFoot + 2 * 0.45 * G * Math.max(0, toFace - 1)),
      );
    }
    // Committed: the lip speed is the target, small traffic and corner
    // limits wait for the landing; a real obstruction ahead (a slower or
    // stopped machine on the run-up) aborts the jump: brake and roll it.
    if (plan.locked) {
      if (!onFace && desired < hold - ABORT_MARGIN) {
        plan.clear = false;
        this.decisions.aborts++;
        return desired;
      }
      return onFace ? Math.max(hold, c.speed) : hold;
    }
    return Math.min(desired, Math.sqrt(hold * hold + 2 * 0.45 * G * Math.max(0, toFace - 1)));
  }
}
const previewPoint = trackPoint(),
  squarePoint = trackPoint();
/** Rally and rallycross AI on loose ground (WP40): corner and braking speeds
 * use the grip of the surface the line crosses ahead (asphalt to gravel, a
 * mud patch), crests are taken at a speed that keeps the car's flight inside
 * the landing zone, and the rallycross joker lap is planned and driven: each
 * driver takes it once, on a lap chosen from its seed. */
export class OffroadCarAIDriver extends AIDriver {
  private readonly ahead = surfaceSample();
  private readonly p = trackPoint();
  private readonly jokerLap: number;
  private gripClock = 0;
  private surfaceCap = Infinity;
  constructor(car: Vehicle, skill = 0.94, seed = 73021, laps = 4) {
    super(car, skill, seed);
    // Lap 1 is crowded at the joker; most drivers keep it for later.
    this.jokerLap = 1 + ((car.id * 7 + seed) % Math.max(1, laps));
  }
  private wantsJoker(track: Track, race: RaceDirector) {
    const session = offroadSessionFor(track),
      course = session?.course,
      joker = course?.spec.joker;
    if (!session || !joker || session.format?.kind !== 'rallycross') return false;
    if (session.jokersTaken(this.car.id) >= (session.format.joker?.required ?? 1)) return false;
    const lap = race.laps[this.car.id].completed + 1;
    return lap >= Math.min(this.jokerLap, race.options.laps);
  }
  protected override lineOffset(track: Track, s: number, racing: number) {
    const course = offroadCourse(track.circuit);
    if (!course?.spec.joker) return racing;
    const centre = course.jokerCentre(s);
    if (centre === null) return racing;
    const session = offroadSessionFor(track);
    if (!session || !this.raceRef || !this.wantsJoker(track, this.raceRef)) {
      // On the joker road already (it started early): stay on it.
      return course.onJoker(this.car.s, this.car.lateral) ? centre : racing;
    }
    return centre;
  }
  /** On the joker road the car keeps its lane (the planner's lanes end at
   * the main road's edge), and the path target may reach the joker road. */
  protected override laneOverride(track: Track, s: number, planned: number) {
    const course = offroadCourse(track.circuit),
      centre = course?.jokerCentre(s) ?? null;
    if (centre === null || !this.raceRef) return planned;
    const on = course!.onJoker(s, this.car.lateral);
    return on || this.wantsJoker(track, this.raceRef) ? centre : planned;
  }
  protected override laneReach(track: Track, s: number, reach: number) {
    const course = offroadCourse(track.circuit),
      centre = course?.jokerCentre(s) ?? null;
    if (centre === null) return reach;
    return Math.max(reach, Math.abs(centre) + course!.spec.joker!.halfWidth - 1.2);
  }
  private raceRef: RaceDirector | null = null;
  override update(dt: number, track: Track, cars: Vehicle[], race: RaceDirector) {
    this.raceRef = race;
    super.update(dt, track, cars, race);
  }
  protected override limitSpeed(desired: number, track: Track, race: RaceDirector) {
    void race;
    const c = this.car,
      env = c.definition.ai,
      course = offroadCourse(track.circuit);
    if (!course) return desired;
    this.gripClock -= 1 / 120;
    if (this.gripClock <= 0) {
      this.gripClock = 0.2;
      this.surfaceCap = this.surfaceSpeed(track);
    }
    desired = Math.min(desired, this.surfaceCap);
    // Crests: keep the flight inside the landing zone (cars land on four
    // wheels; the zone's far edge is the limit).
    const next = course.nextJump(c.s - 2);
    if (next) {
      const j = next.jump,
        run = mod(j.takeoff - c.s, track.length);
      if (run < 200 && run < track.length / 2) {
        const far = j.landing + j.landingLength / 2,
          v = takeoffSpeed(far - j.takeoff, j.lipHeight - j.landingHeight * 0.4, j.lipAngle);
        if (Number.isFinite(v)) {
          const lip = Math.max(14, v * 1.15);
          desired = Math.min(
            desired,
            Math.sqrt(lip * lip + 2 * env.brakingBase * 0.5 * Math.max(0, run - 3)),
          );
        }
      }
    }
    return desired;
  }
  /** Envelope speed using the grip of the surface ahead on the racing line. */
  private surfaceSpeed(track: Track) {
    const c = this.car,
      env = c.definition.ai,
      line = racingLineFor(track);
    const here = clamp(
      peakGrip(c.tires[0], 2500, c.contacts[0], Math.max(c.speed, 25)) / env.referenceMu,
      0.1,
      1,
    );
    let cap = Infinity;
    for (let i = 1; i <= 12; i++) {
      const d = i * 12,
        s = c.s + d;
      track.at(s, this.p);
      const l = line.offsetAt(s);
      track.sample(this.p.x + this.p.nx * l, this.p.z + this.p.nz * l, this.ahead, this.p.y);
      const grip = clamp(
        peakGrip(c.tires[0], 2500, this.ahead, Math.max(c.speed, 25)) / env.referenceMu,
        0.1,
        1,
      );
      if (grip >= here * 0.97) continue;
      const k = line.curvatureAt(s),
        corner = envelopeCornerSpeed(k, grip, 0, env) * this.skill;
      cap = Math.min(
        cap,
        envelopeBrakingSpeed(corner, d, Math.min(grip, here), 0, env.brakingMargin, env),
      );
    }
    return cap;
  }
}
/** The AI driver for an entrant on any venue: off-road bikes and cars on a
 * terrain venue get the off-road drivers; everything else is unchanged. */
export function createEntrantDriver(
  car: Vehicle,
  skill: number,
  seed: number,
  track: Track,
  laps = 4,
) {
  if (car instanceof DirtBikeVehicle) return new DirtBikeAIDriver(car, skill, seed);
  if (Track.offroadOf(track) && !(car.definition.dynamicsKind === 'bike'))
    return new OffroadCarAIDriver(car, skill, seed, laps);
  return createDriver(car, skill, seed);
}
