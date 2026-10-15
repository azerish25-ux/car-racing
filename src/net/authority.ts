import { clamp } from '../core/math.ts';
import { AIDriver } from '../simulation/ai.ts';
import {
  COMPOUNDS,
  alternateDryCompound,
  mandatoryStopSatisfied,
  type Compound,
  type Controls,
  type SessionOptions,
} from '../simulation/config.ts';
import { OVERTAKE } from '../simulation/drs.ts';
import { PHASE, type RaceDirector } from '../simulation/race.ts';
import type { Track } from '../simulation/track.ts';
import type { Vehicle } from '../simulation/vehicle.ts';
import { Simulation } from '../simulation/world.ts';
import { ByteReader, ByteWriter, DecodeError } from './bytes.ts';
import { TICK_MS } from './constants.ts';
import {
  holdControls,
  quantizeControls,
  readControls,
  sameControls,
  writeControls,
} from './input.ts';
import type { RaceEvent } from './messages.ts';
import { LegalProgressAudit } from './progress.ts';
import { CAR_FLAG, type CarNetState } from './snapshot.ts';

export const DT = TICK_MS / 1000;
/** State-hash checkpoint interval (10 s): lets a verifier reject a record
 * at the first divergent checkpoint instead of at the end of the session. */
export const CHECKPOINT_TICKS = 1200;
export type DriverMode = 'human' | 'ai';

/** Apply one driver's controls to its car exactly as `Simulation.setInput`
 * does for the local player (sanitizing every field), plus the grid hold the
 * world applies to a human car during the lights. `edge` marks the first
 * tick of a command: one-shot controls (ERS overtake) act only there. */
export function applyControls(car: Vehicle, input: Controls, phase: number, edge: boolean) {
  const dst = car.input;
  dst.throttle = Number.isFinite(input.throttle) ? clamp(input.throttle, 0, 1) : 0;
  dst.brake = Number.isFinite(input.brake) ? clamp(input.brake, 0, 1) : 0;
  dst.steer = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
  dst.shift = Number.isFinite(input.shift) ? Math.sign(input.shift) : 0;
  dst.ers = input.ers === 0 ? 0 : input.ers === 2 ? 2 : 1;
  dst.reverse = !!input.reverse;
  dst.manualClutch = input.manualClutch === true;
  dst.clutch = Number.isFinite(input.clutch) ? clamp(input.clutch, 0, 1) : 0;
  if (phase === PHASE.LIGHTS && dst.throttle === 0) dst.brake = 1;
  if (input.drs === true) car.drsRequest = true;
  if (
    edge &&
    input.overtake === true &&
    car.definition.hybrid &&
    car.overtakeClock <= 0 &&
    car.battery >= car.spec.maxBatteryJ * OVERTAKE.minBattery
  )
    car.overtakeClock = OVERTAKE.seconds;
}

/** Per-car controller installed in place of the world's AIDriver. A human
 * car follows its network controls; the AI it extends takes over in the pit
 * lane, after the flag and whenever the server switches the car to `ai`
 * (disconnect takeover). Constructed with the same arguments as the world's
 * own driver, so an all-AI NetDriver field is bit-identical to the plain
 * Simulation (tests/net-authority.test.ts). */
export class NetDriver extends AIDriver {
  mode: DriverMode = 'human';
  controls: Controls = holdControls();
  edge = false;
  update(dt: number, track: Track, cars: Vehicle[], race: RaceDirector) {
    const c = this.car,
      edge = this.edge;
    this.edge = false;
    if (this.mode === 'ai' || c.pitRequested || c.inPit || c.finishTime > 0) {
      super.update(dt, track, cars, race);
      return;
    }
    applyControls(c, this.controls, race.phase, edge);
  }
}

export type JournalEntry =
  | { tick: number; car: number; kind: 'controls'; controls: Controls }
  | { tick: number; car: number; kind: 'overtake' }
  | { tick: number; car: number; kind: 'mode'; mode: DriverMode }
  | { tick: number; car: number; kind: 'pit'; compound?: Compound };

const COMPOUND_IDS = Object.keys(COMPOUNDS) as Compound[];

/** The authoritative race: one Simulation stepped with every driver's
 * accepted inputs. Everything that influences the physical outcome goes
 * through `setControls`, `setMode` and `requestPit`, which journal it stamped
 * with the tick it is applied before. Replaying the journal on a fresh world
 * reproduces the race exactly (verified records, crash recovery). */
export class AuthoritativeWorld {
  readonly sim: Simulation;
  readonly drivers: NetDriver[];
  readonly journal: JournalEntry[] = [];
  readonly lapTimes: number[][];
  readonly lapValid: boolean[][];
  readonly audit: LegalProgressAudit;
  private readonly history: Float64Array;
  private readonly impact: Float64Array;
  private readonly contact: Uint8Array;
  private readonly finished: Uint8Array;
  private frame: Float32Array;
  /** Race events produced by the last `step` (lap completions, finishes). */
  events: RaceEvent[] = [];
  /** State hash every CHECKPOINT_TICKS ticks. */
  readonly checkpoints: { tick: number; hash: string }[] = [];
  constructor(readonly options: SessionOptions) {
    this.sim = new Simulation(options);
    this.sim.autoPlayer = true;
    this.drivers = this.sim.ai.map((ai) => new NetDriver(ai.car, ai.skill, this.sim.options.seed));
    this.drivers.forEach((driver, i) => (this.sim.ai[i] = driver));
    const n = this.sim.cars.length;
    this.lapTimes = Array.from({ length: n }, () => []);
    this.lapValid = Array.from({ length: n }, () => []);
    this.history = new Float64Array(n * 4 * 3);
    this.impact = new Float64Array(n);
    this.contact = new Uint8Array(n);
    this.finished = new Uint8Array(n);
    this.frame = this.sim.makeFrame();
    this.audit = new LegalProgressAudit(this.sim);
  }
  get tick() {
    return this.sim.tick;
  }
  get cars() {
    return this.sim.cars.length;
  }
  /** Level controls for `car` from this tick on; `first` applies the
   * command's one-shot controls (overtake, pit request) on this tick. */
  setControls(car: number, input: Controls, first: boolean) {
    const driver = this.drivers[car],
      level = quantizeControls({ ...input, overtake: false, pit: false });
    if (!sameControls(level, driver.controls)) {
      driver.controls = level;
      this.journal.push({ tick: this.tick, car, kind: 'controls', controls: level });
    }
    if (first && input.overtake) {
      driver.edge = true;
      this.journal.push({ tick: this.tick, car, kind: 'overtake' });
    }
    if (first && input.pit) this.requestPit(car);
  }
  setMode(car: number, mode: DriverMode) {
    if (this.drivers[car].mode === mode) return;
    this.drivers[car].mode = mode;
    this.journal.push({ tick: this.tick, car, kind: 'mode', mode });
  }
  /** Toggle a pit request, choosing the compound as `Simulation.requestPit`. */
  requestPit(car: number, compound?: Compound) {
    const c = this.sim.cars[car],
      track = this.sim.track,
      ruleset = this.sim.race.ruleset;
    this.journal.push({ tick: this.tick, car, kind: 'pit', ...(compound ? { compound } : {}) });
    c.pitRequested = !c.pitRequested;
    if (compound && Object.hasOwn(COMPOUNDS, compound)) {
      c.nextCompound = compound;
      return;
    }
    c.nextCompound =
      track.meanWater() > 0.85
        ? 'wet'
        : track.meanWater() > 0.3
          ? 'intermediate'
          : ruleset.tires.mandatoryCompoundChange && !mandatoryStopSatisfied(c.compoundsUsed)
            ? alternateDryCompound(c.tires[0].compound)
            : 'medium';
  }
  apply(entry: JournalEntry) {
    if (entry.tick !== this.tick) throw new Error('Journal entry applied at the wrong tick');
    if (!Number.isInteger(entry.car) || entry.car < 0 || entry.car >= this.cars)
      throw new Error('Journal entry names an unknown car');
    if (entry.kind === 'controls') this.setControls(entry.car, entry.controls, false);
    else if (entry.kind === 'overtake') {
      this.drivers[entry.car].edge = true;
      this.journal.push({ ...entry });
    } else if (entry.kind === 'mode') this.setMode(entry.car, entry.mode);
    else this.requestPit(entry.car, entry.compound);
  }
  step() {
    this.sim.step(DT);
    this.events = [];
    const tick = this.tick,
      cars = this.sim.cars,
      h = this.history,
      slot = tick % 4;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i],
        v = c.body.velocity,
        o = (i * 4 + slot) * 3;
      h[o] = v.x;
      h[o + 1] = v.y;
      h[o + 2] = v.z;
      if (c.impact > this.impact[i] + 1e-9) this.contact[i] = 1;
      this.impact[i] = c.impact;
      const lap = this.sim.race.laps[i];
      while (this.lapTimes[i].length < lap.completed) {
        this.lapTimes[i].push(lap.last);
        this.lapValid[i].push(lap.lastValid && lap.lastPenalty === 0);
        this.events.push({
          type: 'lap',
          car: i,
          lap: lap.completed,
          time: lap.last,
          valid: lap.lastValid && lap.lastPenalty === 0,
          tick,
        });
      }
      if (!this.finished[i] && c.finishTime > 0) {
        this.finished[i] = 1;
        this.events.push({ type: 'finish', car: i, tick });
      }
    }
    this.audit.update();
    if (tick % CHECKPOINT_TICKS === 0) this.checkpoints.push({ tick, hash: this.stateHash() });
  }
  /** World-frame acceleration over the last three ticks (m/s²). */
  acceleration(car: number) {
    const tick = this.tick;
    if (tick < 4) return [0, 0, 0];
    const h = this.history,
      a = (car * 4 + (tick % 4)) * 3,
      b = (car * 4 + ((tick + 1) % 4)) * 3,
      k = 1 / (3 * DT);
    return [(h[a] - h[b]) * k, (h[a + 1] - h[b + 1]) * k, (h[a + 2] - h[b + 2]) * k];
  }
  /** Compact state of one car; `full` adds prediction fields. Clears the
   * car's contact latch when `consume` is set (once per snapshot). */
  capture(car: number, full: boolean, out: CarNetState, ghost = false): CarNetState {
    const c = this.sim.cars[car],
      b = c.body,
      lap = this.sim.race.laps[car],
      driver = this.drivers[car];
    out.id = car;
    out.flags =
      (full ? CAR_FLAG.FULL : 0) |
      (c.inPit ? CAR_FLAG.IN_PIT : 0) |
      (c.retired ? CAR_FLAG.RETIRED : 0) |
      (c.finishTime > 0 ? CAR_FLAG.FINISHED : 0) |
      (this.contact[car] ? CAR_FLAG.CONTACT : 0) |
      (driver.mode === 'ai' || c.pitRequested || c.inPit || c.finishTime > 0 ? CAR_FLAG.AI : 0) |
      (c.drsOpen ? CAR_FLAG.DRS_OPEN : 0) |
      (ghost ? CAR_FLAG.GHOST : 0);
    out.x = b.position.x;
    out.y = b.position.y;
    out.z = b.position.z;
    out.qx = b.orientation.x;
    out.qy = b.orientation.y;
    out.qz = b.orientation.z;
    out.qw = b.orientation.w;
    out.vx = b.velocity.x;
    out.vy = b.velocity.y;
    out.vz = b.velocity.z;
    if (full) {
      const a = this.acceleration(car);
      out.wx = b.omega.x;
      out.wy = b.omega.y;
      out.wz = b.omega.z;
      out.ax = a[0];
      out.ay = a[1];
      out.az = a[2];
    } else out.wx = out.wy = out.wz = out.ax = out.ay = out.az = 0;
    out.steer = c.steer;
    out.throttle = c.throttle;
    out.brake = c.brake;
    out.gear = c.gear;
    out.rpm = c.rpm;
    out.s = c.s;
    out.laps = lap.completed;
    out.rank = this.sim.race.order.indexOf(car) + 1;
    return out;
  }
  /** Clear contact latches after a snapshot interval. */
  clearContacts() {
    this.contact.fill(0);
  }
  /** FNV-1a over the full simulation frame (same as the WP49 prototype). */
  stateHash() {
    this.sim.writeFrame(this.frame);
    const words = new Uint32Array(this.frame.buffer, this.frame.byteOffset, this.frame.length);
    let h = 0x811c9dc5;
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  /** Classification order with every completed lap time. */
  classification() {
    return this.sim.race.order.map((car, index) => {
      const c = this.sim.cars[car],
        lap = this.sim.race.laps[car];
      return {
        position: index + 1,
        car,
        laps: lap.completed,
        lapTimes: [...this.lapTimes[car]],
        best: lap.best,
        finishTime: c.finishTime,
        retired: c.retired,
      };
    });
  }
  /** Re-simulate `journal` from the start to `endTick` on a fresh world.
   * `inspect` runs after every tick; returning false stops the replay early
   * (a verifier that has already found a divergence). */
  static replay(
    options: SessionOptions,
    journal: readonly JournalEntry[],
    endTick: number,
    inspect?: (world: AuthoritativeWorld) => boolean,
  ) {
    const world = new AuthoritativeWorld(options);
    let i = 0;
    while (world.tick < endTick) {
      while (i < journal.length && journal[i].tick === world.tick) world.apply(journal[i++]);
      if (i < journal.length && journal[i].tick < world.tick)
        throw new Error('Journal is not in tick order');
      world.step();
      if (inspect && !inspect(world)) return world;
    }
    if (i < journal.length) throw new Error('Journal has entries after its end tick');
    return world;
  }
}

const KIND = { controls: 0, overtake: 1, mode: 2, pit: 3 } as const;
/** Compact binary journal: tick deltas as varints, quantized controls. */
export function encodeJournal(entries: readonly JournalEntry[]) {
  const w = new ByteWriter(entries.length * 10 + 16);
  w.varint(entries.length);
  let last = 0;
  for (const e of entries) {
    if (e.tick < last) throw new Error('Journal is not in tick order');
    w.varint(e.tick - last)
      .u8(e.car)
      .u8(KIND[e.kind]);
    last = e.tick;
    if (e.kind === 'controls') writeControls(w, e.controls);
    else if (e.kind === 'mode') w.u8(e.mode === 'ai' ? 1 : 0);
    else if (e.kind === 'pit') w.u8(e.compound ? COMPOUND_IDS.indexOf(e.compound) : 255);
  }
  return w.finish();
}
export function decodeJournal(data: Uint8Array, maxEntries = 2_000_000): JournalEntry[] {
  const r = new ByteReader(data),
    n = r.varint();
  if (n > maxEntries) throw new DecodeError('Journal is too long');
  const out: JournalEntry[] = [];
  let tick = 0;
  for (let i = 0; i < n; i++) {
    tick += r.varint();
    const car = r.u8(),
      kind = r.u8();
    if (kind === KIND.controls)
      out.push({ tick, car, kind: 'controls', controls: readControls(r) });
    else if (kind === KIND.overtake) out.push({ tick, car, kind: 'overtake' });
    else if (kind === KIND.mode) {
      const m = r.u8();
      if (m > 1) throw new DecodeError('Invalid driver mode');
      out.push({ tick, car, kind: 'mode', mode: m ? 'ai' : 'human' });
    } else if (kind === KIND.pit) {
      const c = r.u8();
      if (c !== 255 && c >= COMPOUND_IDS.length) throw new DecodeError('Invalid compound');
      out.push({ tick, car, kind: 'pit', ...(c === 255 ? {} : { compound: COMPOUND_IDS[c] }) });
    } else throw new DecodeError('Unknown journal entry');
  }
  r.end();
  return out;
}
