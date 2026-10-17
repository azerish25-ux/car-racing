import { approach, clamp, mod, Random } from '../core/math.ts';
import {
  COMPOUNDS,
  alternateDryCompound,
  mandatoryStopSatisfied,
  type Controls,
} from './config.ts';
import { FLAG, yellowFlag } from './marshal.ts';
import type { RaceDirector } from './race.ts';
import type { Track } from './track.ts';
import { trackPoint } from './track.ts';
import type { DriverPersonality } from './traffic.ts';
import type { Vehicle } from './vehicle.ts';

/** Seeded correlated control mistakes. The stochastic hazard changes requests,
 * never chassis pose, grip or physical capability. Probabilities are original
 * design calibration (events/second), not measured human-driver statistics. */
export class DriverErrorModel {
  events = 0;
  active = false;
  steer = 0;
  pedal = 0;
  private remaining = 0;
  private nextSteer = 0;
  private nextPedal = 0;
  private readonly random: Random;
  constructor(seed: number) {
    this.random = new Random(seed);
  }
  sample(dt: number, rate: number, stress: number, consistency: number, enabled: boolean) {
    if (![dt, rate, stress, consistency].every(Number.isFinite) || dt <= 0)
      throw new Error('Invalid driver-error step');
    this.remaining = Math.max(0, this.remaining - dt);
    if (!enabled) {
      this.remaining = 0;
      this.nextSteer = this.nextPedal = 0;
    } else if (
      this.remaining <= 0 &&
      this.random.next() < 1 - Math.exp(-Math.max(0, rate) * (1 + 3 * clamp(stress, 0, 1)) * dt)
    ) {
      this.remaining = 0.4 + this.random.next() * 0.65;
      this.nextSteer = (this.random.next() * 2 - 1) * (0.008 + (1 - consistency) * 0.06);
      this.nextPedal = (this.random.next() * 2 - 1) * (0.035 + (1 - consistency) * 0.09);
      this.events++;
    }
    this.active = this.remaining > 0;
    if (!this.active) this.nextSteer = this.nextPedal = 0;
  }
  apply(dt: number, controls: Controls, enabled: boolean) {
    this.steer = approach(this.steer, enabled ? this.nextSteer : 0, dt * 0.04);
    this.pedal = approach(this.pedal, enabled ? this.nextPedal : 0, dt * 0.16);
    if (!enabled) return;
    controls.steer = clamp(controls.steer + this.steer, -1, 1);
    controls.throttle = clamp(controls.throttle + this.pedal, 0, 1);
    // Braking errors affect normal modulation, never disable an emergency stop.
    if (controls.brake > 0.05 && controls.brake < 0.7)
      controls.brake = clamp(controls.brake - this.pedal * 0.35, 0, 1);
  }
}

/** One early defensive line choice per approaching corner. Late blocking and
 * repeated zigzags are rejected even when a personality is highly defensive. */
export class DefensiveLine {
  offset = 0;
  challenger = -1;
  private until = 0;
  private cooldown = 0;
  private sample = trackPoint();
  update(
    car: Vehicle,
    cars: readonly Vehicle[],
    track: Track,
    now: number,
    bias: number,
    enabled: boolean,
  ) {
    if (!enabled) {
      this.offset = 0;
      this.challenger = -1;
      return 0;
    }
    if (now < this.until) return this.offset;
    this.offset = 0;
    this.challenger = -1;
    if (now < this.cooldown || car.brake > 0.15 || bias < 0.35) return 0;
    let nearest = 70;
    for (const other of cars) {
      if (other === car || other.inPit || other.retired || other.finishTime) continue;
      const gap = mod(car.s - other.s + track.length / 2, track.length) - track.length / 2;
      // Side-by-side cars and a very late attacker already own their corridor.
      if (gap < 15 || gap > nearest || other.speed < car.speed + 1.2) continue;
      this.challenger = other.id;
      nearest = gap;
    }
    if (this.challenger < 0) return 0;
    let bend = 0,
      distance = 0;
    for (let d = 45; d <= 180; d += 15) {
      track.at(car.s + d, this.sample);
      if (Math.abs(this.sample.curvature) > Math.abs(bend)) {
        bend = this.sample.curvature;
        distance = d;
      }
    }
    if (Math.abs(bend) < 0.003) {
      this.challenger = -1;
      return 0;
    }
    this.offset = Math.sign(bend) * (1 + bias * 1.1);
    this.until = now + clamp(distance / Math.max(car.speed, 15), 1.5, 4);
    this.cooldown = this.until + 4;
    return this.offset;
  }
}

/** Strategic decisions read real battery, tire, weather and traffic state.
 * Traits adjust risk, requests and decisions, never physical tire coefficients. */
/** Lap after which an endurance car makes its mandatory stop. */
export function plannedStopLap(laps: number, tireManagement: number) {
  return Math.max(1, Math.min(laps - 2, Math.round(laps * (0.3 + 0.3 * tireManagement))));
}
export class DriverBrain {
  ers: 0 | 1 | 2 = 1;
  pace = 1;
  stress = 0;
  pressure = 0;
  tireCare = 0;
  decision = 'BALANCED';
  readonly errors: DriverErrorModel;
  readonly defence = new DefensiveLine();
  readonly reactionSeconds: number;
  constructor(
    readonly traits: DriverPersonality,
    seed: number,
    id: number,
  ) {
    this.errors = new DriverErrorModel(seed ^ Math.imul(id + 3, 0x85ebca6b));
    const r = new Random(seed ^ Math.imul(id + 1, 0xc2b2ae35));
    this.reactionSeconds = 0.15 + (1 - traits.consistency) * 1.2 + r.next() * 0.05;
  }
  update(dt: number, car: Vehicle, cars: readonly Vehicle[], track: Track, race: RaceDirector) {
    const traits = this.traits,
      water = track.meanWater();
    let wear = 0,
      overheat = 0,
      punctured = false;
    for (const tire of car.tires) {
      wear = Math.max(wear, tire.wear);
      overheat = Math.max(overheat, (tire.surfaceTemp - COMPOUNDS[tire.compound].ideal - 15) / 55);
      punctured ||= tire.punctured;
    }
    this.pressure = 0;
    let attack = false;
    for (const other of cars) {
      if (other === car || other.inPit || other.retired || other.finishTime) continue;
      const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
      if (gap < -7 && gap > -70 && other.speed >= car.speed - 1)
        this.pressure = Math.max(this.pressure, (70 + gap) / 63);
      if (
        gap > 9 &&
        gap < 55 &&
        car.speed > other.speed - 2 &&
        Math.abs(car.lateral - other.lateral) > 1
      )
        attack = true;
    }
    this.tireCare =
      clamp((wear - 0.35) * 1.2 + Math.max(0, overheat) * 0.5, 0, 1) * traits.tireManagement;
    const wet = clamp(water / 0.8, 0, 1);
    this.stress = clamp(
      this.pressure * 0.35 + wear * 0.25 + wet * 0.3 + Math.max(0, overheat) * 0.3,
      0,
      1,
    );
    // The steady-state corner envelope cannot spend the entire tire budget on
    // cornering while a slick shod car also changes lanes on standing water.
    // Preserve a control margin until the real stop fits suitable tires. This
    // reduces pedal targets only; it never increases friction or alters poses.
    const compound = car.tires[0].compound;
    const slick = compound !== 'intermediate' && compound !== 'wet';
    const mismatch = slick ? clamp((water - 0.12) / 0.7, 0, 1) : 0;
    this.pace =
      (1 - this.tireCare * 0.035 - wet * (1 - traits.wetSkill) * 0.07) * (1 - 0.22 * mismatch);
    const caution = yellowFlag(race.control.flags[car.id]);
    const safe = !car.inPit && !car.pitRequested && !car.finishTime && !car.retired && !caution;
    const reserve = 4e6 * (0.13 + 0.12 * traits.tireManagement);
    if (!safe || car.battery < reserve) {
      this.ers = 0;
      this.decision = 'HARVEST / CONSERVE';
    } else if (
      attack &&
      car.battery > reserve + 1.0e6 &&
      traits.aggression > 0.45 &&
      Math.abs(car.trackPosition.curvature) < 0.004
    ) {
      this.ers = 2;
      this.decision = 'ATTACK / DEPLOY';
    } else {
      this.ers = 1;
      this.decision = this.tireCare > 0.2 ? 'TIRE MANAGEMENT' : 'BALANCED';
    }
    // Motos, heats and stages carry their tyres to the finish. Their courses
    // have no in-race service; a road strategy request strands them in a bay.
    if (
      race.ruleset.service.pitStops &&
      !car.inPit &&
      !car.finishTime &&
      !car.retired &&
      car.s < track.length - track.pit.exitBefore
    ) {
      const compound = car.tires[0].compound;
      const wrongWet = water > 0.18 && compound !== 'intermediate' && compound !== 'wet';
      const wrongDry = water < 0.05 && (compound === 'intermediate' || compound === 'wet');
      // Endurance: one planned stop onto a different dry compound, in a window
      // set by the driver's tyre management (kinder drivers stop later).
      const lap = race.laps[car.id];
      const mandatory =
        race.ruleset.tires.mandatoryCompoundChange &&
        !mandatoryStopSatisfied(car.compoundsUsed) &&
        lap.completed >= plannedStopLap(race.options.laps, traits.tireManagement) &&
        lap.completed < race.options.laps - 1;
      if (
        wrongWet ||
        wrongDry ||
        punctured ||
        mandatory ||
        wear > 0.64 + 0.05 * (1 - traits.tireManagement)
      ) {
        car.pitRequested = true;
        car.nextCompound =
          water > 0.9
            ? 'wet'
            : water > 0.16
              ? 'intermediate'
              : race.ruleset.tires.mandatoryCompoundChange &&
                  !mandatoryStopSatisfied(car.compoundsUsed)
                ? alternateDryCompound(compound)
                : 'medium';
        this.decision = mandatory ? 'STRATEGY / MANDATORY STOP' : 'STRATEGY / PIT';
      }
    }
    this.errors.sample(
      dt,
      traits.errorRate,
      this.stress,
      traits.consistency,
      safe && car.speed > 18,
    );
  }
  preferredLine(car: Vehicle, cars: readonly Vehicle[], track: Track, race: RaceDirector) {
    return this.defence.update(
      car,
      cars,
      track,
      race.time,
      this.traits.defensiveBias,
      !car.inPit &&
        !car.pitRequested &&
        !car.finishTime &&
        race.control.flags[car.id] === FLAG.GREEN,
    );
  }
}
