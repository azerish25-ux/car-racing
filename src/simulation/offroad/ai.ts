import { approach, clamp, G, mod } from '../../core/math.ts';
import { AIDriver, envelopeBrakingSpeed, envelopeCornerSpeed } from '../ai.ts';
import { BikeAIDriver, createDriver } from '../bike-ai.ts';
import { FLAG } from '../marshal.ts';
import type { RaceDirector } from '../race.ts';
import { racingLineFor } from '../racing-line.ts';
import { lineCost } from '../terrain.ts';
import { surfaceSample, trackPoint, type Track } from '../track.ts';
import { peakGrip } from '../tire.ts';
import type { Vehicle } from '../vehicle.ts';
import { TrackTerrainSurface } from './course-terrain.ts';
import { DirtBikeVehicle } from './dirt-bike-vehicle.ts';
import { takeoffSpeed, type JumpSurvey } from './profile.ts';
import { offroadSessionFor } from './session.ts';
import { offroadCourse } from './venues.ts';

/** Take-off speed the sprung chassis adds to the speed held up the face
 * (m/s): the springs rebound off the lip and the flight starts slightly
 * behind the point-mass lip. Measured per feature kind on the production
 * terrain by scripts/offroad-calibration.ts (the AI's lip speeds there must
 * land on every surveyed landing face). */
export const TAKEOFF_GAIN: Readonly<Record<JumpSurvey['kind'], number>> = Object.freeze({
  tabletop: 0.45,
  'step-up': 0.45,
  crest: 0.3,
  kicker: 1.0,
  double: 0.65,
  triple: 1.05,
});
/** Lip speed (m/s) a rider rolls a feature at: below it the bike stays on the ground. */
export const ROLL_SPEED = 2.5;
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
  private plan: { jump: JumpSurvey; clear: boolean } | null = null;
  readonly decisions = { clears: 0, rolls: 0 };
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
  }
  /** Lateral choice at the preview point: the terrain's line cost across a
   * band around the racing line, with a pull back toward the line. */
  private chooseLine(track: Track) {
    const surface = track.offroad;
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
  protected override lineOffset(track: Track, s: number, racing: number) {
    void track;
    void s;
    return racing + this.rutBias;
  }
  /** A motorcycle needs about half a car's lateral room to pass or avoid. */
  protected override trafficScale() {
    return 0.5;
  }
  /** Jump speed control: hold the speed whose flight lands on the landing
   * zone; when the run-up cannot reach it, take a forgiving feature as fast
   * as possible and roll a gap jump. No braking on a face (it noses down). */
  protected override limitSpeed(desired: number, track: Track, race: RaceDirector) {
    const course = offroadCourse(track.circuit),
      c = this.rider;
    if (!course || c.airborne) return desired;
    const next = course.nextJump(c.s - 3);
    if (!next) return desired;
    const j = next.jump,
      run = mod(j.takeoff - c.s, track.length);
    if (run > 160 || run > track.length / 2) {
      this.plan = null;
      return desired;
    }
    const hold = jumpHoldSpeed(j);
    // Under a yellow flag nobody jumps: roll it. Otherwise clear the gap
    // only when the run-up (dirt traction ~0.4 g) and every other limit
    // (traffic, the corner before) leave the hold speed.
    const yellow = race.control.flags[c.id] === FLAG.YELLOW || race.control.flags[c.id] === FLAG.DOUBLE_YELLOW;
    const reachable = Math.min(desired + 0.5, Math.sqrt(c.speed * c.speed + 2 * 0.4 * G * Math.max(0, run - 4)));
    const onFaceNow = mod(c.s - j.start, track.length) < j.takeoff - j.start + 0.5;
    if (!this.plan || this.plan.jump !== j || !onFaceNow) {
      const clear = !yellow && (j.forgiving || reachable >= hold - 0.3);
      if (!this.plan || this.plan.jump !== j) {
        if (clear) this.decisions.clears++;
        else this.decisions.rolls++;
      }
      this.plan = { jump: j, clear };
    }
    const lip = this.plan.clear ? hold : ROLL_SPEED;
    const onFace = mod(c.s - j.start, track.length) < j.takeoff - j.start + 0.5;
    // On the face: hold, and above it only coast.
    if (onFace) return Math.min(desired, Math.max(lip, c.speed - 0.2));
    // Brake to the lip speed before the face with a dirt envelope (~0.45 g).
    const toFace = Math.max(0, mod(j.start - c.s, track.length) - 1);
    return Math.min(desired, Math.sqrt(lip * lip + 2 * 0.45 * G * toFace));
  }
}
const previewPoint = trackPoint();
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
  constructor(
    car: Vehicle,
    skill = 0.94,
    seed = 73021,
    laps = 4,
  ) {
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
      const e = session?.entrants[this.car.id];
      return e?.progress?.edge === 'joker' ? centre : racing;
    }
    return centre;
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
          desired = Math.min(desired, Math.sqrt(lip * lip + 2 * env.brakingBase * 0.5 * Math.max(0, run - 3)));
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
    const here = clamp(peakGrip(c.tires[0], 2500, c.contacts[0], Math.max(c.speed, 25)) / env.referenceMu, 0.1, 1);
    let cap = Infinity;
    for (let i = 1; i <= 12; i++) {
      const d = i * 12,
        s = c.s + d;
      track.at(s, this.p);
      const l = line.offsetAt(s);
      track.sample(this.p.x + this.p.nx * l, this.p.z + this.p.nz * l, this.ahead, this.p.y);
      const grip = clamp(peakGrip(c.tires[0], 2500, this.ahead, Math.max(c.speed, 25)) / env.referenceMu, 0.1, 1);
      if (grip >= here * 0.97) continue;
      const k = line.curvatureAt(s),
        corner = envelopeCornerSpeed(k, grip, 0, env) * this.skill;
      cap = Math.min(cap, envelopeBrakingSpeed(corner, d, Math.min(grip, here), 0, env.brakingMargin, env));
    }
    return cap;
  }
}
/** The AI driver for an entrant on any venue: off-road bikes and cars on a
 * terrain venue get the off-road drivers; everything else is unchanged. */
export function createEntrantDriver(car: Vehicle, skill: number, seed: number, track: Track, laps = 4) {
  if (car instanceof DirtBikeVehicle) return new DirtBikeAIDriver(car, skill, seed);
  if (track.offroad && !(car.definition.dynamicsKind === 'bike'))
    return new OffroadCarAIDriver(car, skill, seed, laps);
  return createDriver(car, skill, seed);
}
