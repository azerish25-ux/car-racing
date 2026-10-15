import { clamp, mod } from '../../core/math.ts';
import { classifyStage, competitor, observeStage, type StageCompetitor } from '../../core/stage-rules.ts';
import { BikeVehicle } from '../bike-vehicle.ts';
import { createVehicle } from '../bike-vehicle.ts';
import type { Assist, Compound, SessionOptions, Setup } from '../config.ts';
import { rulesetFor } from '../events.ts';
import { O, OFFROAD_STRIDE } from '../protocol.ts';
import { PHASE, type RaceDirector } from '../race.ts';
import { RouteGraph, RouteProgress, type RoutePoint, type RouteSpec } from '../route-graph.ts';
import { MATERIAL } from '../surface-material.ts';
import { trackPoint, type Track } from '../track.ts';
import type { Vehicle } from '../vehicle.ts';
import type { VehicleDefinition } from '../vehicles.ts';
import { TrackTerrainSurface, type CourseTerrain } from './course-terrain.ts';
import type { OffroadCourse } from './course.ts';
import { DirtBikeVehicle } from './dirt-bike-vehicle.ts';
import { isDirtBike } from './dirt-bikes.ts';
import type { OffroadFormat } from './formats.ts';
import { offroadCourse } from './venues.ts';

/** The dynamics adapter for an entrant: off-road motorcycles get the
 * airborne/long-travel extension, everything else its family adapter. */
export function createEntrant(
  id: number,
  compound: Compound,
  setup: Setup,
  assist: Assist,
  definition: VehicleDefinition,
): Vehicle {
  return isDirtBike(definition)
    ? new DirtBikeVehicle(id, compound, setup, assist, definition)
    : createVehicle(id, compound, setup, assist, definition);
}
export interface EntrantFormat {
  /** 0 none, 1 held (gate / start control / queue), 2 released, 3 jump start. */
  start: number;
  slot: number;
  slotS: number;
  slotLateral: number;
  jumped: boolean;
  pushClock: number;
  jokers: number;
  jokerJudged: boolean;
  progress: RouteProgress | null;
  stage: StageCompetitor | null;
  /** Stage: start time (race seconds), running/final stage time, parked. */
  stageStart: number;
  stageTime: number;
  parked: boolean;
  mud: number;
}
const sessions = new WeakMap<Track, OffroadSession>();
/** The off-road session running on a Track, if any (AI drivers read it). */
export function offroadSessionFor(track: Track) {
  return sessions.get(track) ?? null;
}
/** The start gate's fall after the synchronised release (s). */
export const GATE_DROP_SECONDS = 0.25;
/** Off-road session layer (WP37-WP42): owns the authoritative terrain's
 * session lifecycle and the formats — the synchronised motocross gate with
 * jump-start detection and the holeshot, rallycross joker laps counted on a
 * RouteGraph and enforced at the flag, rally stages with staggered starts,
 * splits and a stop control — on top of the shared RaceDirector. */
export class OffroadSession {
  readonly surface: TrackTerrainSurface;
  readonly terrain: CourseTerrain;
  readonly course: OffroadCourse;
  readonly format: OffroadFormat | null;
  readonly entrants: EntrantFormat[];
  /** Car id that reached the first corner first after the gate (-1: none yet). */
  holeshot = -1;
  /** Joker route (rallycross) and the stage route (rally). */
  readonly route: RouteGraph | null;
  private readonly point = trackPoint();
  private parkedCount = 0;
  private readonly racing: boolean;
  /** Messages for race control / the HUD (format events), newest last. */
  readonly log: { time: number; car: number; code: string; text: string }[] = [];
  constructor(
    readonly track: Track,
    readonly cars: readonly Vehicle[],
    readonly race: RaceDirector,
    readonly options: SessionOptions,
  ) {
    if (!(track.offroad instanceof TrackTerrainSurface)) throw new Error('Not a terrain venue');
    this.surface = track.offroad;
    this.terrain = this.surface.terrain;
    this.course = this.surface.course;
    this.terrain.reset();
    const rules = rulesetFor(options);
    this.racing = options.mode === 'race' || options.mode === 'endurance';
    this.format = this.racing ? (rules.format ?? null) : null;
    this.entrants = cars.map(() => ({
      start: 0,
      slot: -1,
      slotS: 0,
      slotLateral: 0,
      jumped: false,
      pushClock: 0,
      jokers: 0,
      jokerJudged: false,
      progress: null,
      stage: null,
      stageStart: Infinity,
      stageTime: -1,
      parked: false,
      mud: 0,
    }));
    this.route = this.buildRoute();
    if (this.format?.start === 'gate' && this.course.spec.gate) {
      const slots = gateSlots(track, this.course, cars.length),
        picks = pickSlots(options.grid ?? cars.map((c) => c.id), slots.preference);
      for (const c of cars) {
        const e = this.entrants[c.id];
        e.slot = picks.get(c.id)!;
        e.slotS = c.s;
        e.slotLateral = slots.lateral[e.slot];
      }
    }
    if (this.format?.start === 'staggered')
      (options.grid ?? cars.map((c) => c.id)).forEach((id, k) => (this.entrants[id].slot = k));
    if (this.route && this.format?.kind === 'rallycross')
      for (const [id, c] of cars.entries()) {
        const progress = new RouteProgress(this.route, 9, (this.course.spec.joker?.ramp ?? 20) + 14);
        const at = this.route.project('lap-b', c.body.position);
        progress.s = at ? at.s : 0;
        this.entrants[id].progress = progress;
      }
    sessions.set(track, this);
  }
  static create(track: Track, cars: readonly Vehicle[], race: RaceDirector, options: SessionOptions) {
    return track.offroad instanceof TrackTerrainSurface ? new OffroadSession(track, cars, race, options) : null;
  }
  /** Start placement before timing begins (gate slots or the stage queue). */
  static place(track: Track, cars: readonly Vehicle[], options: SessionOptions) {
    const course = offroadCourse(track.circuit),
      format = rulesetFor(options).format;
    if (!course || !format || !(options.mode === 'race' || options.mode === 'endurance')) return;
    if (format.start === 'gate' && course.spec.gate) {
      const slots = gateSlots(track, course, cars.length),
        order = options.grid ?? cars.map((c) => c.id),
        picks = pickSlots(order, slots.preference);
      for (const c of cars) {
        const k = picks.get(c.id)!,
          reach = c instanceof BikeVehicle ? c.bikeSpec.cgToFront + c.bikeSpec.frontWheelRadius + 0.05 : 2.4;
        c.place(track, mod(course.spec.gate.s - reach, track.length), slots.lateral[k]);
      }
    } else if (format.start === 'staggered' && course.spec.stage) {
      const order = options.grid ?? cars.map((c) => c.id);
      order.forEach((id, k) =>
        cars[id].place(track, mod(course.spec.stage!.start - 9 * (k + 1), track.length), 0),
      );
    }
  }
  private buildRoute(): RouteGraph | null {
    const track = this.track,
      course = this.course,
      p = this.point,
      L = track.length;
    const line = (from: number, to: number, offset: (s: number) => number) => {
      const span = mod(to - from, L) || L,
        n = Math.max(2, Math.ceil(span / 3));
      const points: RoutePoint[] = [];
      for (let i = 0; i <= n; i++) {
        const s = from + (span * i) / n;
        track.at(s, p);
        const l = offset(s);
        points.push({ x: p.x + p.nx * l, y: p.y, z: p.z + p.nz * l });
      }
      return points;
    };
    const joker = course.spec.joker;
    if (joker && this.format?.kind === 'rallycross') {
      const spec: RouteSpec = {
        id: `${track.circuit.id}-joker`,
        version: 1,
        closed: true,
        start: 'lap-b',
        edges: [
          { id: 'lap-a', kind: 'main', points: line(0, joker.from, () => 0), next: ['main', 'joker'] },
          { id: 'main', kind: 'main', points: line(joker.from, joker.to, () => 0), next: ['lap-b'] },
          {
            id: 'joker',
            kind: 'joker',
            points: line(joker.from, joker.to, (s) => course.jokerCentre(s) ?? 0),
            next: ['lap-b'],
          },
          { id: 'lap-b', kind: 'main', points: line(joker.to, L, () => 0), next: ['lap-a'] },
        ],
        checkpoints: [{ edge: 'lap-b', s: 1 }],
      };
      return new RouteGraph(spec);
    }
    const stage = course.spec.stage;
    if (stage && this.format?.kind === 'stage') {
      const edge = line(stage.start, stage.finish, () => 0),
        length = edge.reduce(
          (a, q, i) => (i ? a + Math.hypot(q.x - edge[i - 1].x, q.y - edge[i - 1].y, q.z - edge[i - 1].z) : 0),
          0,
        ),
        total = mod(stage.finish - stage.start, L);
      return new RouteGraph({
        id: `${track.circuit.id}-stage`,
        version: 1,
        closed: false,
        start: 'stage',
        edges: [{ id: 'stage', kind: 'stage', points: edge, next: [] }],
        checkpoints: [
          ...stage.splits.map((s) => ({ edge: 'stage', s: (mod(s - stage.start, L) / total) * length })),
          { edge: 'stage', s: length - 0.5 },
        ],
      });
    }
    return null;
  }
  /** Seconds after the green the starter `k` (stage start order) leaves. */
  stageStartTime(order: number) {
    return 2 + order * (this.format?.stage?.interval ?? 20);
  }
  /** Gate up (1) .. down (0) at race time `raceTime` (synchronised for every slot). */
  static gateAngle(raceTime: number) {
    return 1 - clamp(raceTime / GATE_DROP_SECONDS, 0, 1);
  }
  jokersTaken(id: number) {
    return this.entrants[id]?.jokers ?? 0;
  }
  /** Before the physics substeps: hold machines at the gate, the start
   * control and the queue (inputs only; the player may still jump). */
  beforePhysics(dt: number) {
    void dt;
    const f = this.format,
      race = this.race;
    if (!f) return;
    if (f.start === 'gate') {
      const held = race.phase === PHASE.LIGHTS || race.time < race.greenAt;
      for (const [id, e] of this.entrants.entries()) {
        if (e.start === 0) e.start = 1;
        if (held && id > 0) {
          const c = this.cars[id];
          c.input.throttle = 0;
          c.input.brake = 1;
        }
        if (!held && e.start === 1) e.start = 2;
      }
      return;
    }
    if (f.start === 'staggered') {
      const now = race.time - race.greenAt;
      const order = this.options.grid ?? this.cars.map((c) => c.id);
      order.forEach((id, k) => {
        const c = this.cars[id],
          e = this.entrants[id],
          go = this.stageStartTime(k);
        if (e.parked) {
          c.input.throttle = 0;
          c.input.brake = 1;
          c.input.steer = 0;
          return;
        }
        if (e.start === 0 && race.phase === PHASE.RACING && now >= go - 4) {
          // Called to the start control.
          const stage = this.course.spec.stage!;
          c.place(this.track, mod(stage.start - 2.2, this.track.length), 0);
          e.slotS = c.s;
          e.start = 1;
          e.stageStart = go;
        }
        if (e.start <= 1 && now < go) {
          const atLine = e.start === 1;
          // AI and queued machines hold; the player at the line may jump.
          if (id > 0 || !atLine || c.input.throttle === 0) {
            c.input.throttle = 0;
            c.input.brake = 1;
          }
          if (!atLine) c.input.steer = 0;
        } else if (e.start === 1 && now >= go) {
          e.start = e.jumped ? 3 : 2;
          e.stage = competitor(id, new RouteProgress(this.route!, 10));
        }
      });
    }
  }
  /** After the physics: terrain, the gate and start controls, holeshot,
   * joker counting and enforcement, stage timing and parking. */
  afterPhysics(dt: number) {
    this.deformTerrain(dt);
    this.terrain.weather(this.track.rain, this.track.cloud, dt);
    const f = this.format;
    if (!f) return;
    if (f.start === 'gate') this.gate(dt);
    if (f.kind === 'rallycross' && this.route) this.jokers();
    if (f.kind === 'stage' && this.route) this.stage();
  }
  private gate(dt: number) {
    const race = this.race,
      course = this.course,
      gate = course.spec.gate!,
      L = this.track.length,
      up = race.time < race.greenAt + GATE_DROP_SECONDS * 0.5;
    for (const [id, c] of this.cars.entries()) {
      const e = this.entrants[id];
      if (up) {
        // The gate is a wall: a machine that creeps into it is held there.
        const front = c instanceof BikeVehicle ? c.contacts[0].s : c.s + 2.4,
          into = mod(front - gate.s + L / 2, L) - L / 2;
        const crept = mod(c.s - e.slotS + L / 2, L) - L / 2;
        const pushing = c.input.throttle > 0.2 && race.time > race.greenAt - 0.4;
        e.pushClock = pushing ? e.pushClock + dt : 0;
        if ((crept > 0.25 || e.pushClock > 0.15) && !e.jumped && race.time < race.greenAt) {
          e.jumped = true;
          e.start = 3;
          this.penalize(id, this.format!.jumpStartPenalty, 'JUMP_START', 'JUMP START AT THE GATE');
        }
        if (into > -0.02) c.place(this.track, e.slotS, e.slotLateral);
      }
      // Holeshot: the first machine past the first-corner line on lap one.
      if (this.holeshot < 0 && race.phase === PHASE.RACING && race.laps[id].completed === 0) {
        const past = mod(c.s - gate.holeshot, L);
        if (past < 25 && c.speed > 2) {
          this.holeshot = id;
          this.note(id, 'HOLESHOT', 'HOLESHOT');
        }
      }
    }
  }
  private jokers() {
    const f = this.format!,
      race = this.race;
    for (const [id, c] of this.cars.entries()) {
      const e = this.entrants[id];
      if (!e.progress || c.retired) continue;
      const before = e.progress.edge;
      e.progress.update(c.body.position);
      if (e.progress.edge === 'joker' && before !== 'joker' && race.phase === PHASE.RACING) {
        e.jokers++;
        this.note(id, 'JOKER', `JOKER LAP ${e.jokers}/${f.joker!.required}`);
      }
      // At the flag: exactly the required joker laps, else time per difference.
      if (c.finishTime > 0 && !e.jokerJudged) {
        e.jokerJudged = true;
        const missing = Math.abs(e.jokers - f.joker!.required);
        if (missing)
          this.penalize(
            id,
            missing * f.joker!.penaltySeconds,
            'JOKER',
            `JOKER TAKEN ${e.jokers}/${f.joker!.required} · +${missing * f.joker!.penaltySeconds} S`,
          );
      }
    }
  }
  private stage() {
    const race = this.race,
      stage = this.course.spec.stage!,
      L = this.track.length,
      now = race.time - race.greenAt,
      f = this.format!;
    for (const [id, c] of this.cars.entries()) {
      const e = this.entrants[id];
      // Jump start at the control: rolling before the clock says go.
      if (e.start === 1 && now < e.stageStart && !e.jumped) {
        const crept = mod(c.s - e.slotS + L / 2, L) - L / 2;
        if (crept > 0.5) {
          e.jumped = true;
          this.penalize(id, f.jumpStartPenalty, 'JUMP_START', 'JUMP START AT THE CONTROL');
        }
      }
      if (!e.stage || e.parked) continue;
      const time = now - e.stageStart;
      e.stage.progress.update(c.body.position);
      observeStage(e.stage, time);
      if (e.stage.finishTime !== null && e.stageTime < 0) {
        e.stageTime = e.stage.finishTime;
        if (!(c.finishTime > 0)) c.finishTime = e.stageTime + race.laps[id].penalty;
        this.note(id, 'STAGE_FINISH', `STAGE TIME ${e.stageTime.toFixed(1)} S`);
      } else if (e.stageTime < 0 && time > (f.stage?.maxSeconds ?? 600) && !c.retired) {
        c.retired = true;
        this.note(id, 'STAGE_DNF', 'OVER THE STAGE TIME LIMIT');
      }
      // After the flying finish: stop at the control, then park off the road.
      if (e.stageTime >= 0 || c.retired) {
        const toStop = mod(stage.stop - c.s, L);
        if (!c.retired && toStop < L / 2) {
          c.input.throttle = 0;
          c.input.brake = clamp(c.speed / Math.max(4, toStop), 0.2, 1);
        }
        if (c.speed < 0.6 || c.retired || toStop > L / 2) this.park(id);
      }
    }
  }
  private park(id: number) {
    const e = this.entrants[id],
      c = this.cars[id],
      stage = this.course.spec.stage!;
    if (e.parked) return;
    e.parked = true;
    const p = this.track.at(stage.stop, this.point);
    c.place(this.track, mod(stage.stop + 12 + 9 * this.parkedCount++, this.track.length), -(p.width + 2.4));
    c.input.throttle = 0;
    c.input.brake = 1;
  }
  private penalize(id: number, seconds: number, code: string, text: string) {
    this.race.penalize(id, seconds, code);
    this.note(id, code, text);
  }
  private note(car: number, code: string, text: string) {
    this.log.push({ time: this.race.time, car, code, text });
    if (this.log.length > 64) this.log.shift();
    if (car === 0) {
      this.race.message = text;
    }
  }
  /** Ruts: every loaded contact patch presses the authoritative soil, in a
   * fixed entrant/wheel order (deterministic; replays re-derive it). */
  private deformTerrain(dt: number) {
    const t = this.terrain;
    for (const c of this.cars) {
      if (c instanceof DirtBikeVehicle && c.airborne) continue;
      const bike = c instanceof BikeVehicle,
        wheels = bike ? [0, 2] : [0, 1, 2, 3];
      for (const i of wheels) {
        const tire = c.tires[i],
          contact = c.contacts[i];
        if (!(tire.load > 1) || contact.pit) continue;
        const slip = clamp(Math.abs(tire.slip) * 4 + (bike ? 0 : Math.abs(tire.fy) / (tire.load + 1) * 0.3), 0, 2);
        t.deform(contact.lateral, contact.s, tire.load, slip, dt);
      }
      // Mud on cars (bikes carry their own): wet, soft soil under the wheels.
      if (!bike) {
        const e = this.entrants[c.id],
          s = c.contacts[2].surface,
          wet = s === MATERIAL.MUD ? 1 : s === MATERIAL.DIRT || s === MATERIAL.GRAVEL_ROAD ? 0.15 : 0,
          spin = Math.abs(c.tires[2].slip) + Math.abs(c.tires[3].slip);
        e.mud = clamp(e.mud + wet * (0.003 * c.speed + 0.05 * spin) * dt - 0.0012 * e.mud * dt, 0, 1);
      }
    }
  }
  /** Format results: holeshot, jokers, stage splits and the classification. */
  results() {
    const f = this.format;
    const stage =
      f?.kind === 'stage'
        ? classifyStage(this.entrants.map((e, id) => e.stage ?? competitor(id, new RouteProgress(this.route!))))
        : null;
    return {
      kind: f?.kind ?? null,
      holeshot: this.holeshot,
      jokers: this.entrants.map((e) => e.jokers),
      jumpStarts: this.entrants.map((e) => e.jumped),
      splits: this.entrants.map((e) => e.stage?.splits ?? []),
      stageTimes: this.entrants.map((e) => e.stageTime),
      stage,
      terrain: this.terrain.stats(),
    };
  }
}
/** Gate slot laterals across the start straight and their preference order:
 * nearest the inside of the first corner first. */
export function gateSlots(track: Track, course: OffroadCourse, riders: number) {
  const gate = course.spec.gate!,
    n = Math.max(gate.slots, riders),
    lateral = Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * gate.spacing);
  const p = trackPoint();
  let turn = 0;
  for (let s = gate.holeshot; s < gate.holeshot + 40; s += 4) turn += track.at(s, p).curvature;
  // Curvature > 0 turns toward +lateral: that side is the inside.
  const inside = turn >= 0 ? 1 : -1,
    preference = lateral.map((_, k) => k).sort((a, b) => lateral[b] * inside - lateral[a] * inside);
  return { lateral, preference };
}
function pickSlots(order: readonly number[], preference: readonly number[]) {
  const taken = new Set<number>(),
    out = new Map<number, number>();
  for (const id of order) {
    const k = preference.find((s) => !taken.has(s))!;
    taken.add(k);
    out.set(id, k);
  }
  return out;
}
/** Snapshot off-road block (protocol O). Zeros on paved circuits for
 * machines without an off-road adapter. */
export function writeOffroadBlock(out: Float32Array, base: number, car: Vehicle, session: OffroadSession | null) {
  out.fill(0, base, base + OFFROAD_STRIDE);
  if (car instanceof DirtBikeVehicle) {
    out[base + O.AIRBORNE] = Number(car.airborne);
    out[base + O.AIR_TIME] = car.airTime;
    out[base + O.STANDING] = car.standing;
    out[base + O.DAB] = car.dab;
    out[base + O.BOTTOM] = car.bottom;
    out[base + O.LANDING_PITCH] = car.lastLanding?.pitchError ?? 0;
    out[base + O.LANDING_SPEED] = car.lastLanding?.normalSpeed ?? 0;
    out[base + O.BODY] = car.riderBody;
    out[base + O.MUD] = car.mud;
    out[base + O.RUT_FRONT] = car.rutFront;
    out[base + O.RUT_REAR] = car.rutRear;
    out[base + O.MOISTURE] = car.moisture;
  } else if (session) {
    const loads = car.tires.reduce((a, t) => a + t.load, 0),
      t = session.terrain;
    out[base + O.AIRBORNE] = Number(loads < 1 && !car.retired);
    out[base + O.MUD] = session.entrants[car.id]?.mud ?? 0;
    out[base + O.RUT_FRONT] = t.depthAt(car.contacts[0].lateral, car.contacts[0].s);
    out[base + O.RUT_REAR] = t.depthAt(car.contacts[2].lateral, car.contacts[2].s);
    out[base + O.MOISTURE] = t.moistureAt(t.cellIndex(car.contacts[2].lateral, car.contacts[2].s));
  }
  if (!session) return;
  const e = session.entrants[car.id];
  if (!e) return;
  out[base + O.JOKERS] = e.jokers;
  out[base + O.START] = e.jumped ? 3 : e.start;
  out[base + O.SLOT] = e.slot + 1;
  out[base + O.FORMAT] =
    session.format?.kind === 'stage'
      ? e.stageTime >= 0
        ? e.stageTime
        : e.stage
          ? session.race.time - session.race.greenAt - e.stageStart
          : -1
      : Number(session.holeshot === car.id);
}
