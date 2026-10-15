import { mod } from '../core/math.ts';
import type { Vehicle } from './vehicle.ts';
import { STANDARD_PIT, type PitLaneDefinition } from './circuits.ts';

/** Original session rules, not a claim of FIA regulation compliance. Distances
 * are metres, speeds m/s and time seconds. A yellow zone extends around an
 * observed incident and persists briefly after that hazard has cleared. */
export const FLAG = { GREEN: 0, YELLOW: 1, CHEQUERED: 2, DOUBLE_YELLOW: 3, BLUE: 4 } as const;
export const MARSHAL = {
  approach: 180,
  exit: 65,
  clearDelay: 3,
  stationaryDelay: 2,
  startGrace: 6,
  yellowSpeed: 25,
  doubleYellowSpeed: 12,
  giveBackSeconds: 2,
  pitSpeed: 80 / 3.6,
  pitTolerance: 0.5,
  pitDuration: 1,
  maximumEvents: 256,
} as const;
export interface RaceEvent {
  sequence: number;
  time: number;
  kind: 'incident' | 'clear' | 'flag' | 'penalty';
  car: number;
  code: string;
  seconds: number;
}
interface Incident {
  active: boolean;
  s: number;
  severity: number;
  clearedFor: number;
}
export function pitSpeedZone(
  s: number,
  length: number,
  pit: Pick<PitLaneDefinition, 'limitBefore' | 'limitAfter'> = STANDARD_PIT,
): boolean {
  const station = mod(s, length);
  return station > length - pit.limitBefore || station < pit.limitAfter;
}
export function yellowFlag(flag: number): boolean {
  return flag === FLAG.YELLOW || flag === FLAG.DOUBLE_YELLOW;
}
export function flagLabel(flag: number): string {
  return (
    ['GREEN FLAG', 'LOCAL YELLOW', 'CHEQUERED', 'DOUBLE YELLOW', 'BLUE FLAG'][flag] ?? 'GREEN FLAG'
  );
}

export class MarshalControl {
  readonly flags: Uint8Array;
  readonly zoneDistance: Float64Array;
  readonly zoneSpeed: Float64Array;
  readonly blueCar: Int16Array;
  readonly events: RaceEvent[] = [];
  sequence = 0;
  /** Safety-car phase (SC_PHASE): overtaking while neutralised is judged as under yellow. */
  neutralised = 0;
  readonly penaltyCount: Uint32Array;
  private readonly incidents: Incident[];
  private readonly stopped: Float64Array;
  private readonly lastImpact: Float64Array;
  private readonly pitClock: Float64Array;
  private readonly pitPenalized: Uint8Array;
  private readonly previousFlags: Uint8Array;
  private readonly previousGap: Float64Array;
  private readonly passDue: Float64Array;
  private readonly returnedPair: Uint8Array;
  constructor(
    readonly length: number,
    readonly count: number,
    private readonly penalize: (car: number, seconds: number, code: string) => void,
    private readonly pit: PitLaneDefinition = STANDARD_PIT,
  ) {
    if (
      !Number.isFinite(length) ||
      length <= 0 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 32
    )
      throw new Error('Invalid marshal field');
    this.flags = new Uint8Array(count);
    this.previousFlags = new Uint8Array(count);
    this.zoneDistance = new Float64Array(count).fill(-1);
    this.zoneSpeed = new Float64Array(count).fill(-1);
    this.blueCar = new Int16Array(count).fill(-1);
    this.penaltyCount = new Uint32Array(count);
    this.stopped = new Float64Array(count);
    this.lastImpact = new Float64Array(count);
    this.pitClock = new Float64Array(count);
    this.pitPenalized = new Uint8Array(count);
    this.previousGap = new Float64Array(count * count).fill(NaN);
    this.passDue = new Float64Array(count * count).fill(-1);
    this.returnedPair = new Uint8Array(count * count);
    this.incidents = Array.from({ length: count }, () => ({
      active: false,
      s: 0,
      severity: 1,
      clearedFor: 0,
    }));
  }
  get hasIncident() {
    return this.incidents.some((incident) => incident.active);
  }
  /** The speed allowed at lap distance `s` given the active yellow zones,
   * braking at `braking` m/s² for zones ahead (the safety car obeys these). */
  speedLimitAt(s: number, braking: number): number {
    let limit = Infinity;
    for (const incident of this.incidents) {
      if (!incident.active) continue;
      const fromStart = mod(s - (incident.s - MARSHAL.approach), this.length);
      const ahead = fromStart <= MARSHAL.approach + MARSHAL.exit ? 0 : this.length - fromStart;
      const cap =
        incident.severity === FLAG.DOUBLE_YELLOW ? MARSHAL.doubleYellowSpeed : MARSHAL.yellowSpeed;
      if (ahead < 500) limit = Math.min(limit, Math.sqrt(cap * cap + 2 * braking * ahead));
    }
    return limit;
  }
  /** A stopped or retired car obstructs the track (double yellow). */
  get hasObstruction() {
    return this.incidents.some(
      (incident) => incident.active && incident.severity === FLAG.DOUBLE_YELLOW,
    );
  }
  private emit(time: number, kind: RaceEvent['kind'], car: number, code: string, seconds = 0) {
    if (this.events.length === MARSHAL.maximumEvents) this.events.shift();
    this.events.push({ sequence: ++this.sequence, time, kind, car, code, seconds });
  }
  /** An incident race control sees directly (a rider down, WP34), wherever it
   * ends up: a local yellow at lap distance `s`, cleared like any other. */
  report(car: number, s: number, code: string, time: number) {
    const incident = this.incidents[car];
    this.emit(time, 'incident', car, code);
    if (!incident.active) incident.severity = FLAG.YELLOW;
    incident.active = true;
    incident.s = s;
    incident.clearedFor = 0;
  }
  recordPenalty(car: number, seconds: number, code: string, time: number) {
    this.penaltyCount[car]++;
    this.emit(time, 'penalty', car, code, seconds);
  }
  /** Conservative braking approach to a local limit. This is a controller
   * target only: it never edits velocity, tire grip, mass or body position. */
  targetSpeed(car: number, braking: number): number {
    if (this.zoneDistance[car] < 0) return Infinity;
    return Math.sqrt(
      this.zoneSpeed[car] ** 2 + 2 * Math.max(0.5, braking) * this.zoneDistance[car],
    );
  }
  settlePending(cars: readonly Vehicle[]) {
    for (let i = 0; i < this.count; i++)
      for (let j = 0; j < this.count; j++) {
        const index = i * this.count + j;
        if (this.passDue[index] < 0) continue;
        const gap = mod(cars[j].s - cars[i].s + this.length / 2, this.length) - this.length / 2;
        if (gap <= 0.5) this.penalize(i, 5, 'OVERTAKE_UNDER_YELLOW');
        this.passDue[index] = -1;
      }
  }
  update(
    dt: number,
    time: number,
    cars: readonly Vehicle[],
    progress: readonly { distance: number }[],
  ) {
    if (
      !Number.isFinite(dt + time) ||
      dt <= 0 ||
      time < 0 ||
      cars.length !== this.count ||
      progress.length !== this.count
    )
      throw new Error('Invalid marshal update');
    this.previousFlags.set(this.flags);
    for (let id = 0; id < this.count; id++) {
      const car = cars[id],
        incident = this.incidents[id];
      const onRoad = !car.inPit && Math.abs(car.lateral) < car.trackPosition.width + 1.5;
      this.stopped[id] =
        onRoad && car.speed < 3 && time > MARSHAL.startGrace && !car.finishTime
          ? this.stopped[id] + dt
          : 0;
      const impact = onRoad && car.impact > 0.18 && car.impact > this.lastImpact[id] + 0.01;
      this.lastImpact[id] = car.impact;
      const obstructed =
        onRoad && !car.finishTime && (car.retired || this.stopped[id] >= MARSHAL.stationaryDelay);
      if (impact || obstructed) {
        const severity = obstructed ? FLAG.DOUBLE_YELLOW : FLAG.YELLOW;
        if (!incident.active || incident.severity !== severity)
          this.emit(
            time,
            'incident',
            id,
            severity === FLAG.DOUBLE_YELLOW ? 'OBSTRUCTION' : 'CONTACT',
          );
        incident.active = true;
        incident.s = car.s;
        incident.severity = severity;
        incident.clearedFor = 0;
      } else if (incident.active) {
        incident.clearedFor += dt;
        if (incident.clearedFor >= MARSHAL.clearDelay) {
          incident.active = false;
          this.emit(time, 'clear', id, 'INCIDENT_CLEARED');
        }
      }
      if (!car.inPit) {
        this.pitClock[id] = 0;
        this.pitPenalized[id] = 0;
      } else if (
        pitSpeedZone(car.s, this.length, this.pit) &&
        car.speed > MARSHAL.pitSpeed + MARSHAL.pitTolerance
      ) {
        this.pitClock[id] += dt;
        if (this.pitClock[id] >= MARSHAL.pitDuration && !this.pitPenalized[id] && !car.finishTime) {
          this.pitPenalized[id] = 1;
          this.penalize(id, 5, 'PIT_SPEEDING');
        }
      } else this.pitClock[id] = 0;
    }
    for (let id = 0; id < this.count; id++) {
      const car = cars[id];
      let flag: number = FLAG.GREEN;
      this.zoneDistance[id] = -1;
      this.zoneSpeed[id] = -1;
      this.blueCar[id] = -1;
      if (!car.inPit && !car.finishTime) {
        for (let hazard = 0; hazard < this.count; hazard++) {
          const incident = this.incidents[hazard];
          if (!incident.active || hazard === id) continue;
          const fromStart = mod(car.s - (incident.s - MARSHAL.approach), this.length);
          const inside = fromStart <= MARSHAL.approach + MARSHAL.exit;
          const ahead = inside ? 0 : this.length - fromStart;
          const cap =
            incident.severity === FLAG.DOUBLE_YELLOW
              ? MARSHAL.doubleYellowSpeed
              : MARSHAL.yellowSpeed;
          // Reserve a finite braking preview before the flag's entry line.
          if (
            ahead < 500 &&
            (this.zoneDistance[id] < 0 ||
              cap * cap + 2 * 5 * ahead < this.zoneSpeed[id] ** 2 + 2 * 5 * this.zoneDistance[id])
          ) {
            this.zoneDistance[id] = ahead;
            this.zoneSpeed[id] = cap;
          }
          if (inside) flag = Math.max(flag, incident.severity);
        }
        if (!yellowFlag(flag)) {
          let nearest = Infinity;
          for (let other = 0; other < this.count; other++) {
            const leader = cars[other];
            if (
              other === id ||
              leader.inPit ||
              leader.retired ||
              leader.finishTime ||
              leader.speed <= car.speed + 2
            )
              continue;
            const behind = mod(car.s - leader.s, this.length);
            if (
              progress[other].distance - progress[id].distance > this.length * 0.5 &&
              behind < Math.max(35, leader.speed * 2.5) &&
              behind < nearest
            ) {
              flag = FLAG.BLUE;
              this.blueCar[id] = other;
              nearest = behind;
            }
          }
        }
      }
      if (car.finishTime) flag = FLAG.CHEQUERED;
      this.flags[id] = flag;
      if (flag !== this.previousFlags[id]) this.emit(time, 'flag', id, flagLabel(flag));
    }
    // Resolve returns for the entire field first. Otherwise array order could
    // penalize the innocent driver for accepting the position being returned.
    this.returnedPair.fill(0);
    for (let i = 0; i < this.count; i++) {
      for (let j = 0; j < this.count; j++) {
        const index = i * this.count + j;
        const gap = mod(cars[j].s - cars[i].s + this.length / 2, this.length) - this.length / 2;
        if (this.passDue[index] >= 0 && gap > 0.5) this.returnedPair[index] = 1;
      }
    }
    for (let i = 0; i < this.count; i++) {
      for (let j = 0; j < this.count; j++) {
        if (i === j) continue;
        const index = i * this.count + j,
          a = cars[i],
          b = cars[j];
        const gap = mod(b.s - a.s + this.length / 2, this.length) - this.length / 2;
        const eligible =
          !a.inPit &&
          !b.inPit &&
          !a.finishTime &&
          !b.finishTime &&
          !a.retired &&
          !b.retired &&
          b.speed > 5 &&
          // A fallen rider's bike is a hazard, not a rival being overtaken.
          (b as { riding?: boolean }).riding !== false;
        if (this.passDue[index] >= 0) {
          if (gap > 0.5)
            this.passDue[index] = -1; // Position returned in the grace interval.
          else if (time >= this.passDue[index]) {
            this.penalize(i, 5, 'OVERTAKE_UNDER_YELLOW');
            this.passDue[index] = -1;
          }
        } else if (
          eligible &&
          !this.returnedPair[j * this.count + i] &&
          this.previousGap[index] > 0.5 &&
          this.previousGap[index] < 30 &&
          gap < -0.5 &&
          gap > -30 &&
          ((yellowFlag(this.flags[i]) && yellowFlag(this.previousFlags[i])) || this.neutralised > 0)
        ) {
          this.passDue[index] = time + MARSHAL.giveBackSeconds;
        }
        // Preserve side while centres overlap; changing signs at zero would
        // miss the pass as it crosses from +0.5 to -0.5 over many physics ticks.
        if (Math.abs(gap) > 0.5) this.previousGap[index] = gap;
      }
    }
  }
}
