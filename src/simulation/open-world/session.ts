import { clamp, Vec3 } from '../../core/math.ts';
import { BikeVehicle, createVehicle, writeBikeBlock } from '../bike-vehicle.ts';
import { CollisionSolver } from '../collision.ts';
import {
  COMPOUNDS,
  controls,
  DEFAULT_SETUP,
  type Assist,
  type Controls,
  type WeatherPreset,
} from '../config.ts';
import {
  BIKE_BASE,
  CAR_STRIDE,
  DEBRIS_BASE,
  DEBRIS_STRIDE,
  F,
  H,
  HEADER,
  K,
  R,
  RACE_BASE,
  SKID_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../protocol.ts';
import { RouteProgress } from '../route-graph.ts';
import { DirtBikeVehicle } from '../offroad/dirt-bike-vehicle.ts';
import { isDirtBike } from '../offroad/dirt-bikes.ts';
import { trackPoint, type Track } from '../track.ts';
import type { Vehicle } from '../vehicle.ts';
import { vehicleIndex, VEHICLES } from '../vehicles.ts';
import { AmbientTraffic } from './ambient-traffic.ts';
import { DRAG, dragLanes, DragTimer, dragTree, type DragTree } from './drag.ts';
import { NearMissDetector } from './near-miss.ts';
import {
  DriftMeter,
  isRace,
  resolveEvents,
  starsFor,
  type DragSlip,
  type DriftSnapshot,
  type FestivalEvent,
  type FestivalResult,
  type Participant,
} from './festival-events.ts';
import {
  festivalAdmits,
  festivalCars,
  festivalDefaultVehicle,
  festivalVehicles,
} from './festival-machines.ts';
import { asTrack, OpenWorldTrack, WORLD_SURFACE_NAMES } from './open-world-track.ts';
import {
  insideFootprint,
  regionStructures,
  StructureGrid,
  treesForTile,
  trunkRadius,
  TREE_STRIDE,
  type Structure,
} from './placement.ts';
import { SOLVANE, SPEED_CLASS_KMH, type RegionDefinition } from './region-data.ts';
import { RouteDriver, type RouteObstacle } from './route-driver.ts';
import { pathPoint, planRoute, RoutePath } from './route-path.ts';
import {
  captureCar,
  CAR_RECORD,
  poseCar,
  REWIND,
  RewindBuffer,
  type RewindFrame,
  type RunRecord,
} from './rewind.ts';
import {
  FestivalSkillChain,
  type FestivalSkillSample,
  type FestivalSkillStatus,
} from './skill-chain.ts';
import type { TileCacheStats } from './terrain-tiles.ts';
import { TILE_SIZE } from './terrain-tiles.ts';
import { openWorld, type OpenWorld } from './world.ts';

const COMPOUND_IDS = Object.keys(COMPOUNDS);
// The festival's machine list lives with the registry helpers (the career
// and the HUD read it without loading the simulation).
export { festivalAdmits, festivalCars, festivalDefaultVehicle, festivalVehicles };

export interface FreeRoamOptions {
  vehicle?: string;
  weather?: WeatherPreset;
  assist?: Assist;
  seed?: number;
  region?: RegionDefinition;
  /** Resident physics terrain tiles (LRU budget). */
  tileBudget?: number;
  /** Spawn point; default: the Port Ilse harbour front. */
  spawn?: { x: number; z: number; heading?: number };
  /** Events discovered in earlier sessions (the festival save); unknown
   * ids are ignored. */
  discovered?: readonly string[];
  /** Session identity: event results carry `<session>:<run>` run ids, so a
   * consumer (the career) pays each run once. */
  session?: string;
  /** Ambient traffic on highways, country roads and towns (off by default
   * headless, so the scripted acceptance drives are unchanged; the festival
   * host turns it on). Off during events in any case. */
  traffic?: boolean;
}
export type FestivalMode = 'free' | 'card' | 'countdown' | 'running' | 'finished';
export type FestivalCommand =
  | { type: 'reset' }
  | { type: 'start'; event: string }
  | { type: 'cancel' }
  | { type: 'continue' }
  | { type: 'autopilot'; value: boolean }
  | { type: 'vehicle'; id: string }
  | { type: 'travel'; event: string }
  | { type: 'traffic'; value: boolean }
  /** Hold to rewind (true), release to resume from there (false). */
  | { type: 'rewind'; active: boolean };
export interface FestivalCard {
  id: string;
  name: string;
  kind: string;
  blurb: string;
  distanceKm: number;
  laps: number;
  rivals: number;
}
/** Low-rate state for the HUD (posted ~10 Hz). */
export interface FestivalStatus {
  mode: FestivalMode;
  time: number;
  vehicleId: string;
  speedKmh: number;
  autopilot: boolean;
  card: FestivalCard | null;
  event: {
    id: string;
    name: string;
    kind: string;
    countdown: number;
    elapsed: number;
    progress: number;
    lap: number;
    laps: number;
    position: number;
    entrants: number;
    offRoute: boolean;
    live: { label: string; value: string } | null;
    /** Next checkpoint position (world) for the guidance arrow/marker. */
    gate: { x: number; z: number } | null;
    /** Rewinds used in this run so far. */
    rewinds: number;
    /** Drag strip: the tree's simulation times, each lane's roll-out time
     * (lamps are sequenced from the frame clock) and the player's slip. */
    drag: {
      tree: DragTree;
      lane: number;
      lanes: { lane: number; leftAt: number | null }[];
      slip: DragSlip | null;
    } | null;
  } | null;
  result: FestivalResult | null;
  discovered: string[];
  road: { name: string; roadClass: string; limitKmh: number; onRoad: boolean; surface: string };
  message: string | null;
  streaming: TileCacheStats;
  /** Ambient traffic: the player's setting and the cars alive now (none
   * during events). */
  traffic: { enabled: boolean; cars: number };
  /** Manual driving skill chains; separate from event/career rewards. */
  skills: FestivalSkillStatus;
  /** Rewind: held now, seconds of history behind the car, seconds rewound
   * in the current hold, whether it may be used here and rewinds used in
   * this free-roam session. */
  rewind?: { active: boolean; allowed: boolean; available: number; back: number; count: number };
}
interface Run {
  event: FestivalEvent;
  participants: Participant[];
  drivers: (RouteDriver | null)[];
  start: number;
  countdown: number;
  offRoute: number;
  drift: DriftMeter | null;
  trapKmh: number | null;
  assisted: boolean;
  progressClock: number;
  /** Seconds the player has been off the legal route (resets on return). */
  lost: number;
  /** Actual route station at activation. Rolling zones retain the player's
   * run-up, and measure only the distance covered after they start timing. */
  entryDistance: number;
  /** Rewinds used in this run. */
  rewinds: number;
  /** Drag strip: tree, lanes, per-car timers and AI reaction times. */
  drag: {
    tree: DragTree;
    lanes: number[];
    offsets: number[];
    timers: DragTimer[];
    reaction: number[];
  } | null;
  /** Touge: each participant's legal distance against event time (s from
   * the start), for the live gap and the finishing margin. */
  traces: { d: number[]; t: number[] }[] | null;
}
const SPAWN = { x: 560, z: -2602, heading: Math.PI / 2 };
/** Event reset: route search window around the legal progress (m, well
 * inside RouteProgress's 60 m maxStep) and the most it may place a car
 * ahead of that progress. */
const RESET_WINDOW = 30;
const RESET_AHEAD = 8;

/**
 * The festival free-roam session (runs in the open-world worker, or headless
 * in scripts/tests): the player's car anywhere in the region on the real
 * world surface, streamed physics terrain, static colliders (buildings,
 * trunks), reset to the nearest road, weather and surface water, event
 * discovery, marker cards, races against route-following AI rivals, passive
 * skill challenges (speed traps, speed zones, drift zones) and typed results.
 * Frames use the circuit snapshot layout so existing car presentation and
 * audio read them unchanged.
 */
export class OpenWorldSimulation {
  readonly world: OpenWorld;
  readonly track: OpenWorldTrack;
  readonly asTrack: Track;
  readonly events: FestivalEvent[];
  readonly structures: Structure[];
  readonly structureGrid: StructureGrid;
  cars: Vehicle[];
  readonly collisions = new CollisionSolver();
  readonly discovered = new Set<string>();
  readonly results: FestivalResult[] = [];
  /** Ambient traffic (kinematic cars around the player in free roam). */
  readonly traffic: AmbientTraffic;
  readonly skills = new FestivalSkillChain();
  trafficEnabled: boolean;
  mode: FestivalMode = 'free';
  tick = 0;
  time = 0;
  autopilot = false;
  private autopilotDriver: RouteDriver | null = null;
  private cardEvent: FestivalEvent | null = null;
  /** A race card the player declined ("not now"): it stays closed until the
   * player has left its marker. */
  private declined: string | null = null;
  /** The player's car was just placed (spawn, travel, reset, new machine):
   * it holds on the brakes, so it does not roll down a hill unattended,
   * until the driver touches a control. */
  private parked = true;
  private run: Run | null = null;
  private lastResult: FestivalResult | null = null;
  private resultClock = 0;
  private message: string | null = null;
  private messageClock = 0;
  private readonly assist: Assist;
  private readonly seed: number;
  private upset = 0;
  private drowned = 0;
  private streamClock = 0;
  private discoveryClock = 0;
  private readonly trees = new Map<number, Float32Array>();
  private readonly treeBudget: number;
  private readonly corner = new Vec3();
  private readonly normal = new Vec3();
  private readonly point = trackPoint();
  private readonly pp = pathPoint();
  private readonly located = { lateral: 0, distance: 0 };
  private readonly session: string;
  private runs = 0;
  private readonly obstacles: RouteObstacle[] = [];
  private readonly nearMisses = new NearMissDetector();
  private readonly skillSample: FestivalSkillSample = {
    lateral: 0,
    forward: 0,
    onRoad: false,
    grounded: false,
    impact: false,
    assisted: false,
  };
  /** Seconds a riderless motorcycle has been down (bounded fallback reset). */
  private riderDown = 0;
  /** Rewind history and the scrub in progress (simulation time shown). */
  readonly rewindBuffer = new RewindBuffer();
  private rewinding: { cursor: number; from: number } | null = null;
  /** Rewinds used in free roam this session (runs count their own). */
  private rewindsRoam = 0;
  constructor(readonly options: FreeRoamOptions = {}) {
    this.world = openWorld(options.region ?? SOLVANE);
    this.track = new OpenWorldTrack(
      this.world,
      options.weather ?? 'clear',
      undefined,
      options.tileBudget ?? 64,
    );
    this.asTrack = asTrack(this.track);
    this.events = resolveEvents(this.world);
    this.structures = regionStructures(this.world);
    this.structureGrid = new StructureGrid(this.structures);
    for (const id of options.discovered ?? [])
      if (this.events.some((e) => e.spec.id === id)) this.discovered.add(id);
    this.treeBudget = options.tileBudget ?? 64;
    this.assist = options.assist ?? 'sport';
    this.seed = options.seed ?? 73021;
    this.session =
      options.session && options.session.length <= 80 ? options.session : `festival-${this.seed}`;
    this.traffic = new AmbientTraffic(this.world.network, this.seed);
    this.trafficEnabled = options.traffic === true;
    const vehicle = this.makeCar(0, options.vehicle ?? festivalDefaultVehicle());
    this.cars = [vehicle];
    const spawn = options.spawn ?? SPAWN;
    this.placeAt(vehicle, spawn.x, spawn.z, spawn.heading ?? SPAWN.heading);
    this.prefetchAround(vehicle, 0);
  }
  get player() {
    return this.cars[0];
  }
  /** The dynamics adapter for a festival machine: cars, road motorcycles
   * (BikeVehicle) and the supermoto (the off-road bike adapter, whose
   * vertical model runs on the region's ground). */
  private makeCar(id: number, vehicleId: string): Vehicle {
    const definition =
      Object.hasOwn(VEHICLES, vehicleId) && festivalAdmits(VEHICLES[vehicleId])
        ? VEHICLES[vehicleId]
        : VEHICLES[festivalDefaultVehicle()];
    if (isDirtBike(definition))
      return new DirtBikeVehicle(id, 'medium', DEFAULT_SETUP, this.assist, definition);
    return createVehicle(id, 'medium', DEFAULT_SETUP, this.assist, definition);
  }
  // --- Placement ----------------------------------------------------------
  /** Put a car at rest on the ground at (x, z) facing `heading` (rad, from +z). */
  placeAt(car: Vehicle, x: number, z: number, heading: number, layerY?: number) {
    const ground = this.track.groundHeight(x, z, layerY);
    const b = car.body;
    b.position.set(x, ground + 0.62, z);
    b.orientation.x = 0;
    b.orientation.y = 0;
    b.orientation.z = 0;
    b.orientation.w = 1;
    b.orientation.yaw(heading);
    b.velocity.set(0, 0, 0);
    b.omega.set(0, 0, 0);
    for (const t of car.tires) t.omega = 0;
    car.retired = false;
    car.upsetClock = 0;
    // A motorcycle's pose is its dynamics state: place that, the body follows.
    if (car instanceof BikeVehicle) car.placeFree(this.asTrack, x, z, heading, ground);
    car.lateral = this.track.nearest(x, z, car.trackPosition, ground + 1);
    car.s = car.trackPosition.s;
  }
  /** Place on a route at distance d and lateral offset, facing along it. */
  private placeOnPath(car: Vehicle, path: RoutePath, d: number, lateral: number) {
    const p = path.at(d, this.pp);
    this.placeAt(
      car,
      p.x + p.nx * lateral,
      p.z + p.nz * lateral,
      Math.atan2(p.tx, p.tz),
      p.y + 0.5,
    );
  }
  /** Stage a car on a drag strip: front bumper on the start line (the
   * route start), `lateral` across in its lane, facing along the strip. */
  private stage(car: Vehicle, path: RoutePath, lateral: number) {
    const p = path.at(0, this.pp),
      back = car.definition.halfExtents[2];
    this.placeAt(
      car,
      p.x - p.tx * back + p.nx * lateral,
      p.z - p.tz * back + p.nz * lateral,
      Math.atan2(p.tx, p.tz),
      p.y + 0.5,
    );
  }
  /** Fresh car (repairs damage) at the nearest road, aligned with travel. */
  resetToRoad(index = 0, reason = 'Reset to the road') {
    const old = this.cars[index],
      pos = old.body.position,
      run = this.run,
      slot = run?.participants.findIndex((p) => p.car === old) ?? -1;
    const fresh = this.makeCar(index, old.definition.id);
    fresh.input.throttle = 0;
    this.cars[index] = fresh;
    if (run && slot >= 0) {
      // Back onto the event route at the last legal progress: near it (the
      // closest route point to the car within a short window) but never
      // more than a few metres ahead of it, so RouteProgress, which accepts
      // only moves of up to its maxStep, matches the placed car at once and
      // a shortcut gains nothing.
      const participant = run.participants[slot];
      participant.car = fresh;
      const path = run.event.path,
        legal = path.progressDistance(participant.progress.edge, participant.progress.s),
        found = path.locate(pos.x, pos.z, legal, RESET_WINDOW, this.located);
      let ahead = found - legal;
      if (path.closed)
        ahead = (((ahead % path.length) + path.length * 1.5) % path.length) - path.length / 2;
      const d = ahead > RESET_AHEAD ? legal + RESET_AHEAD : found;
      this.placeOnPath(fresh, path, d, run.drag?.offsets[slot] ?? 0);
      const driver = run.drivers[slot];
      if (driver) {
        run.drivers[slot] = driverLike(driver, fresh);
        run.drivers[slot]!.relocate(d);
      }
    } else {
      const p = this.point,
        lateral = this.track.nearest(pos.x, pos.z, p, pos.y),
        e = this.world.network.edges[this.world.network.edgeOf[this.world.network.lastSegment]],
        keep = Math.max(0, e.spec.halfWidth - 2.2),
        forward = old.forward.x * p.tx + old.forward.z * p.tz >= 0 ? 1 : -1,
        // Keep to the right-hand lane of the chosen direction (lateral is
        // positive to the left of the edge's forward direction).
        lane = clamp(
          -forward * Math.min(keep, e.spec.halfWidth * 0.5) || clamp(lateral, -keep, keep),
          -keep,
          keep,
        );
      this.placeAt(
        fresh,
        p.x + p.nx * lane,
        p.z + p.nz * lane,
        Math.atan2(p.tx * forward, p.tz * forward),
        p.y + 0.5,
      );
    }
    if (index === 0 && this.autopilotDriver) this.autopilotDriver = null;
    if (index === 0) {
      // A reset is a new car: nothing before it can be rewound to.
      this.rewindBuffer.clear();
      this.rewinding = null;
      this.skills.reset();
      run?.drift?.invalidate(this.time);
      this.parked = true;
      this.say(reason);
    }
    this.upset = 0;
    this.drowned = 0;
  }
  private say(message: string) {
    this.message = message;
    this.messageClock = 3.5;
  }
  // --- Input and commands -------------------------------------------------
  setInput(input: Controls) {
    const dst = this.player.input;
    dst.throttle = Number.isFinite(input.throttle) ? clamp(input.throttle, 0, 1) : 0;
    dst.brake = Number.isFinite(input.brake) ? clamp(input.brake, 0, 1) : 0;
    dst.steer = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
    dst.shift = Number.isFinite(input.shift) ? Math.sign(input.shift) : 0;
    dst.ers = input.ers === 0 ? 0 : input.ers === 2 ? 2 : 1;
    dst.reverse = !!input.reverse;
    dst.manualClutch = input.manualClutch === true;
    dst.clutch = Number.isFinite(input.clutch) ? clamp(input.clutch, 0, 1) : 0;
    if (dst.throttle > 0.05 || dst.brake > 0.05 || Math.abs(dst.steer) > 0.1 || dst.reverse)
      this.parked = false;
  }
  command(cmd: FestivalCommand) {
    switch (cmd.type) {
      case 'reset':
        this.resetToRoad(0);
        break;
      case 'start': {
        const event = this.events.find((e) => e.spec.id === cmd.event);
        if (!event) throw new Error(`Unknown festival event ${cmd.event}`);
        if (this.mode === 'countdown' || this.mode === 'running') this.abandon();
        this.startEvent(event);
        break;
      }
      case 'cancel':
        if (this.run) this.abandon();
        else if (this.mode === 'card') {
          this.declined = this.cardEvent?.spec.id ?? null;
          this.mode = 'free';
          this.cardEvent = null;
        }
        break;
      case 'continue':
        if (this.mode === 'finished') this.endRun();
        break;
      case 'autopilot':
        this.autopilot = !!cmd.value;
        this.rewindBuffer.clear();
        this.rewinding = null;
        if (this.autopilot) this.skills.reset('AUTOPILOT · PRACTICE');
        this.autopilotDriver = null;
        if (!this.autopilot) Object.assign(this.player.input, controls());
        break;
      case 'vehicle': {
        if (!Object.hasOwn(VEHICLES, cmd.id) || !festivalAdmits(VEHICLES[cmd.id]))
          throw new Error(`Vehicle ${cmd.id} cannot run in the festival`);
        if (this.run) this.abandon();
        this.skills.reset();
        this.rewindBuffer.clear();
        this.rewinding = null;
        const old = this.player,
          fresh = this.makeCar(0, cmd.id),
          q = old.body.orientation;
        this.cars[0] = fresh;
        // Heading from the pose itself (`forward` is only updated by a step).
        const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
        this.placeAt(fresh, old.body.position.x, old.body.position.z, heading, old.body.position.y);
        this.parked = true;
        this.say(`${fresh.definition.name} ready`);
        break;
      }
      case 'travel': {
        const event = this.events.find((e) => e.spec.id === cmd.event);
        if (!event) throw new Error(`Unknown festival event ${cmd.event}`);
        if (!this.discovered.has(event.spec.id)) throw new Error('Travel needs a discovered event');
        if (this.run) this.abandon();
        this.skills.reset();
        this.rewindBuffer.clear();
        this.rewinding = null;
        const fresh = this.makeCar(0, this.player.definition.id);
        this.cars[0] = fresh;
        this.placeOnPath(fresh, event.path, 0, 0);
        this.prefetchAround(fresh, 0);
        this.parked = true;
        this.say(`Travelled to ${event.spec.name}`);
        break;
      }
      case 'traffic':
        this.trafficEnabled = !!cmd.value;
        if (!this.trafficEnabled) this.traffic.clear();
        this.say(this.trafficEnabled ? 'Traffic on' : 'Traffic off');
        break;
      case 'rewind':
        if (cmd.active) this.beginRewind();
        else this.endRewind();
        break;
    }
  }
  // --- Events -------------------------------------------------------------
  /** Rival machines: registry machines of the player's class first
   * (data-driven; riders race riders), deterministic per event and seed.
   * Showcase: the fastest registry car. */
  private rivalVehicles(event: FestivalEvent, count: number) {
    const own = this.player.definition,
      all =
        own.dynamicsKind === 'bike'
          ? festivalVehicles().filter((d) => d.dynamicsKind === 'bike')
          : festivalCars();
    if (event.spec.kind === 'showcase') {
      const cars = festivalCars();
      return [cars.reduce((best, d) => (d.ai.topSpeed > best.ai.topSpeed ? d : best), cars[0]).id];
    }
    const same = all.filter((d) => d.classId === own.classId),
      pool = same.length ? same : all;
    return Array.from(
      { length: count },
      (_, i) => pool[(i + event.index + this.seed) % pool.length].id,
    );
  }
  private startEvent(event: FestivalEvent, rolling = false) {
    const race = isRace(event.spec.kind);
    // Passing a passive skill gate starts a measurement, not a new car.
    // Keep momentum, pose, gear, tyre temperatures, damage and controls.
    const keepPlayer = rolling && !race;
    const existingPlayer = this.player;
    if (!keepPlayer) this.skills.reset();
    this.endRun();
    this.cardEvent = null;
    // Ambient traffic is off while an event runs (it returns in free roam).
    this.traffic.clear();
    // Nothing before an event start can be rewound to.
    this.rewindBuffer.clear();
    this.rewinding = null;
    this.runs++;
    const kind = event.spec.kind;
    const rivals = race
      ? Math.max(0, Math.min(kind === 'drag' ? DRAG.lanes - 1 : 7, event.spec.rivals ?? 0))
      : 0;
    const ids = this.rivalVehicles(event, rivals);
    const player = keepPlayer ? existingPlayer : this.makeCar(0, existingPlayer.definition.id);
    const cars = [player, ...ids.map((id, i) => this.makeCar(i + 1, id))];
    this.cars = cars;
    // Grid: two columns on wide roads, single file on narrow ones; the
    // player starts at the back. A drag strip stages every car side by side
    // with its front at the line, the player in a middle lane; a touge
    // battle starts its two cars side by side (FH6 ref 048).
    const path = event.path,
      start = this.pp;
    path.at(0, start);
    const twoWide = start.halfWidth >= 4.4,
      order = [...cars.slice(1), player];
    const strip = kind === 'drag' ? dragLanes(cars.length) : null;
    const lanes = strip
      ? cars.map((_, i) => {
          // The player takes the lane left of centre; rivals fill the rest.
          const mine = Math.floor((strip.length - 1) / 2);
          return strip[i === 0 ? mine : i <= mine ? i - 1 : i];
        })
      : null;
    if (!keepPlayer && lanes) cars.forEach((car, i) => this.stage(car, path, lanes[i].offset));
    else if (!keepPlayer && kind === 'touge') {
      const column = Math.min(1.7, start.halfWidth - 1.5);
      this.placeOnPath(player, path, 10, -column);
      cars.slice(1).forEach((car, i) => this.placeOnPath(car, path, 10 - i * 9, column));
    } else if (!keepPlayer)
      order.forEach((car, slot) => {
        const row = twoWide ? Math.floor(slot / 2) : slot,
          column = twoWide ? (slot % 2 === 0 ? -1 : 1) * Math.min(2.6, start.halfWidth - 1.7) : 0;
        const d = Math.max(
          4,
          (twoWide ? Math.ceil(order.length / 2) : order.length) * 9 + 4 - row * 9,
        );
        this.placeOnPath(car, path, race ? d : 2, column);
      });
    const tolerance = path.maxHalfWidth() + 8;
    const participants: Participant[] = cars.map((car, i) => ({
      car,
      progress: new RouteProgress(event.graph, tolerance),
      finishTime: null,
      name: i === 0 ? 'YOU' : `${car.definition.name}`,
    }));
    for (const p of participants) {
      const pos = p.car.body.position;
      p.progress.update({ x: pos.x, y: pos.y, z: pos.z }, 200);
      p.progress.distance = 0;
    }
    const entryDistance = path.progressDistance(
      participants[0].progress.edge,
      participants[0].progress.s,
    );
    const skill = (i: number) =>
      kind === 'showcase'
        ? 0.97
        : kind === 'touge'
          ? 0.92
          : 0.86 + ((i * 37 + this.seed) % 9) * 0.012;
    // Deterministic per seed and run: the tree's auto-start delay and each
    // AI lane's reaction (0.11-0.23 s).
    const draw = (k: number) =>
      (((this.seed * 7919 + this.runs * 104729 + k * 15485863) >>> 0) % 997) / 997;
    const tree = strip ? dragTree(this.time, draw(0)) : null;
    const drivers = cars.map((car, i) => {
      if (i === 0) return null;
      const driver = new RouteDriver(car, path, skill(i), lanes ? lanes[i].offset : 0);
      // Drag lanes stay in lane, before and after their finish.
      if (lanes) {
        driver.overtake = false;
        driver.keepLane = true;
      }
      return driver;
    });
    const begins = tree ? tree.green : this.time + (race ? 3 : 0);
    this.run = {
      event,
      participants,
      drivers,
      start: begins,
      countdown: begins - this.time,
      offRoute: 0,
      drift: event.spec.kind === 'drift-zone' ? new DriftMeter() : null,
      trapKmh: null,
      assisted: this.autopilot,
      progressClock: 0,
      lost: 0,
      entryDistance,
      rewinds: 0,
      drag:
        tree && lanes
          ? {
              tree,
              lanes: lanes.map((l) => l.lane),
              offsets: lanes.map((l) => l.offset),
              timers: cars.map(() => new DragTimer(path.finishDistance)),
              reaction: cars.map((_, i) => (i === 0 ? 0 : 0.11 + draw(i) * 0.12)),
            }
          : null,
      traces: kind === 'touge' ? cars.map(() => ({ d: [0], t: [0] })) : null,
    };
    this.parked = false;
    this.autopilotDriver = null;
    this.mode = race ? 'countdown' : 'running';
    this.discovered.add(event.spec.id);
    if (!race) this.say(`${event.spec.name}`);
  }
  private abandon() {
    const run = this.run;
    if (!run) return;
    if (isRace(run.event.spec.kind)) this.finishRun(false, true);
    else {
      this.say(`${run.event.spec.name} failed`);
      this.endRun();
    }
  }
  /** Remove rivals and return to free roam. */
  private endRun() {
    if (this.run) {
      this.cars = [this.player];
      // The field changed: the history no longer matches it.
      this.rewindBuffer.clear();
      this.rewinding = null;
    }
    this.run = null;
    this.mode = 'free';
  }
  private finishRun(completed: boolean, abandoned = false) {
    const run = this.run!,
      event = run.event,
      spec = event.spec;
    const player = run.participants[0];
    const elapsed = Math.max(0, (player.finishTime ?? this.time) - run.start);
    const drift = run.drift?.finish(this.time) ?? null;
    // Drag: the player's timing slip; leaving before green is a red light,
    // a disqualification (last place, no result).
    const slip = run.drag ? run.drag.timers[0].slip(run.drag.lanes[0], run.drag.tree.green) : null;
    if (slip?.redLight) completed = false;
    const ranking = run.participants
      .map((p, i) => ({
        p,
        i,
        key:
          i === 0 && slip?.redLight
            ? Infinity
            : p.finishTime !== null
              ? -1e9 + p.finishTime
              : -p.progress.distance,
      }))
      .sort((a, b) => a.key - b.key);
    const position = ranking.findIndex((r) => r.i === 0) + 1;
    const result: FestivalResult = {
      kind: 'festival-result',
      version: 2,
      runId: `${this.session}:${this.runs}`,
      regionId: this.world.region.id,
      eventId: spec.id,
      eventName: spec.name,
      eventKind: spec.kind,
      vehicleId: this.player.definition.id,
      completed,
      abandoned,
      position: isRace(spec.kind) ? position : null,
      entrants: run.participants.length,
      time: completed && spec.kind !== 'speed-trap' ? elapsed : null,
      trapKmh:
        spec.kind === 'speed-trap' && completed
          ? run.trapKmh
          : completed && slip
            ? slip.trapKmh
            : null,
      // The authored path includes braking run-out beyond the finish gate.
      // Crediting that un-driven tail inflated every previous zone result.
      averageKmh:
        spec.kind === 'speed-zone' && completed && elapsed > 0
          ? (Math.min(player.progress.distance, Math.max(0, event.distance - run.entryDistance)) /
              elapsed) *
            3.6
          : null,
      driftScore: drift ? drift.total : null,
      driftLines: drift ? [...drift.lines].sort((a, b) => b.points - a.points).slice(0, 8) : [],
      stars: 0,
      legalDistance: player.progress.distance,
      offRouteSeconds: run.offRoute,
      standings: ranking.map(({ p, i }) => ({
        car: i,
        name: p.name,
        vehicleId: p.car.definition.id,
        time: p.finishTime !== null ? p.finishTime - run.start : null,
        progress: Math.min(1, p.progress.distance / event.distance),
      })),
      at: this.time,
      assisted: run.assisted,
      rewinds: run.rewinds,
      margin: run.traces ? this.tougeMargin(run) : null,
      drag: slip,
    };
    result.stars = starsFor(spec, result);
    this.results.push(result);
    this.lastResult = result;
    this.resultClock = 0;
    this.mode = 'finished';
    // Skill challenges end immediately; races show the results card.
    if (!isRace(spec.kind)) {
      this.say(
        completed
          ? `${spec.name}: ${result.trapKmh !== null ? `${Math.round(result.trapKmh)} km/h` : result.averageKmh !== null ? `${Math.round(result.averageKmh)} km/h average` : `${result.driftScore} points`} · ${'★'.repeat(result.stars)}${'☆'.repeat(3 - result.stars)}`
          : `${spec.name} failed`,
      );
    }
  }
  /** Take the newest result once (the worker forwards it to the main thread). */
  takeResult() {
    const r = this.lastResult;
    this.lastResult = null;
    return r;
  }
  private updateRun(dt: number) {
    const run = this.run;
    if (!run) return;
    const event = run.event,
      path = event.path,
      race = isRace(event.spec.kind);
    if (this.mode === 'countdown') {
      run.countdown = Math.max(0, run.start - this.time);
      if (run.countdown <= 0) this.mode = 'running';
    }
    if (this.mode === 'finished') {
      this.resultClock += dt;
      // Races: rivals roll to a stop; skill challenges dismiss themselves.
      if (!race || this.resultClock > 30) this.endRun();
      return;
    }
    if (this.mode !== 'running') return;
    const drag = run.drag;
    if (
      drag &&
      ((drag.timers[0].leftAt === null && this.time > run.start + DRAG.noShow) ||
        this.time > run.start + DRAG.limit)
    ) {
      this.finishRun(false, true);
      return;
    }
    // The player's ground was sampled last in step(): drift validity reads it.
    run.drift?.update(
      this.player,
      this.time,
      dt,
      !this.track.query.onRoad || run.participants[0].progress.offRoute,
      this.player.impact > 0.25,
      this.player.up.y > 0.45 && this.player.tires.some((t) => t.load > 20),
    );
    run.progressClock += dt;
    if (run.progressClock < 1 / 30) return;
    const step = run.progressClock;
    run.progressClock = 0;
    for (const [i, p] of run.participants.entries()) {
      if (p.finishTime !== null) continue;
      const pos = p.car.body.position;
      p.progress.update({ x: pos.x, y: pos.y, z: pos.z });
      const trace = run.traces?.[i];
      if (trace && p.progress.distance > trace.d[trace.d.length - 1]) {
        trace.d.push(p.progress.distance);
        trace.t.push(this.time - run.start);
      }
      if (!race) {
        // RouteProgress counts positive movement for race bookkeeping.
        // A zone uses net route station: reversing and re-driving the same
        // few metres must not inflate its average speed or completion bar.
        p.progress.distance = Math.max(
          0,
          path.progressDistance(p.progress.edge, p.progress.s) - run.entryDistance,
        );
      }
      const done = path.closed ? p.progress.laps >= event.laps : p.progress.finished;
      if (done) p.finishTime = this.time;
    }
    const player = run.participants[0];
    if (player.progress.offRoute) run.offRoute += step;
    if (player.finishTime !== null) {
      // A drag result waits briefly for the other lanes' time slips.
      if (
        drag &&
        this.time < player.finishTime + DRAG.settle &&
        run.participants.some((p) => p.finishTime === null)
      )
        return;
      if (event.spec.kind === 'speed-trap') run.trapKmh = this.player.speed * 3.6;
      this.finishRun(true);
      return;
    }
    // Leaving the route: skill challenges fail quickly, races after 25 s.
    const limit = race ? 25 : event.spec.kind === 'speed-trap' ? 2 : 4;
    run.lost = player.progress.offRoute ? run.lost + step : 0;
    if (run.lost > limit) this.abandon();
  }
  private updateDiscovery() {
    const pos = this.player.body.position;
    for (const event of this.events) {
      const dx = event.marker.x - pos.x,
        dz = event.marker.z - pos.z;
      if (dx * dx + dz * dz < 380 * 380) this.discovered.add(event.spec.id);
    }
    if (this.mode === 'free' || this.mode === 'card') {
      // Race cards at markers; skill challenges start at their entry gate.
      let card: FestivalEvent | null = null;
      for (const event of this.events) {
        const dx = event.marker.x - pos.x,
          dz = event.marker.z - pos.z,
          d2 = dx * dx + dz * dz;
        if (isRace(event.spec.kind)) {
          if (event.spec.id === this.declined) {
            if (d2 > 30 * 30) this.declined = null;
            continue;
          }
          if (d2 < 16 * 16 && this.player.speed < 4) card = event;
          continue;
        }
        if (this.mode !== 'free' || d2 > 30 * 30) continue;
        const path = event.path,
          entry = path.at(0, this.pp),
          beyondEntry = (pos.x - entry.x) * entry.tx + (pos.z - entry.z) * entry.tz;
        // A nearby car behind the gate or on a stacked crossing has not
        // entered this challenge yet. The old nearest-point projection
        // clamped both sides to station zero and could start it early.
        if (beyondEntry < 0 || Math.abs(pos.y - entry.y) > 5) continue;
        const d = path.locate(pos.x, pos.z, 0, 40, this.located),
          p = path.at(d, this.pp),
          aligned = this.player.forward.x * p.tx + this.player.forward.z * p.tz;
        if (
          d < 25 &&
          Math.abs(this.located.lateral) < p.halfWidth + 1.5 &&
          aligned > 0.6 &&
          this.player.speed > 4
        ) {
          this.startEvent(event, true);
          return;
        }
      }
      if (card) {
        this.cardEvent = card;
        this.mode = 'card';
      } else if (this.mode === 'card') {
        const m = this.cardEvent!.marker;
        if (Math.hypot(m.x - pos.x, m.z - pos.z) > 30) {
          this.mode = 'free';
          this.cardEvent = null;
        }
      }
    }
  }
  // --- Simulation step ----------------------------------------------------
  step(dt: number) {
    this.tick++;
    this.time += dt;
    // Rewinding: the cars are posed from the history; nothing is integrated.
    if (this.rewinding) {
      this.scrub(dt);
      return;
    }
    const run = this.run;
    // Drivers.
    if (run) {
      const hold = this.mode === 'countdown',
        drag = run.drag,
        traffic = this.cars.filter((_, i) => i === 0 || run.participants[i]?.finishTime === null);
      run.drivers.forEach((driver, i) => {
        const p = run.participants[i];
        if (!driver) return;
        // A drag lane launches its own reaction time after green and races
        // on to its own finish after the player's.
        const held = hold || (!!drag && this.time < run.start + drag.reaction[i]);
        driver.update(
          dt,
          traffic,
          held,
          p.finishTime !== null || (this.mode === 'finished' && !drag),
        );
        if (driver.wantsReset) this.resetToRoad(i, 'Rival reset');
      });
      if (hold) {
        const input = this.player.input;
        if (drag) {
          // Staged: the brakes hold the car while the throttle is closed
          // (rev against them for a launch). Driving off before green is
          // the driver's own jump start.
          if (input.throttle < 0.05) input.brake = Math.max(input.brake, 1);
        } else {
          input.throttle = 0;
          input.brake = 1;
        }
      }
      if (this.autopilot && this.mode === 'running') {
        this.autopilotDriver ??= new RouteDriver(this.player, run.event.path, 0.9);
        this.autopilotDriver.update(dt, traffic, false, run.participants[0].finishTime !== null);
        run.assisted = true;
      }
    } else if (this.autopilot) this.cruise(dt);
    else if (this.parked) {
      const input = this.player.input;
      input.throttle = 0;
      input.brake = 1;
    }
    // Physics: two substeps, car contacts, rails and static colliders.
    // Finished rivals are out of the race: no car contact with them.
    const track = this.asTrack,
      contact = run
        ? this.cars.filter((c, i) => i === 0 || run.participants[i]?.finishTime === null)
        : this.cars;
    // Ambient traffic (free roam only): kinematic, then the player's contact.
    const traffic = this.trafficEnabled && !run ? this.traffic : null;
    if (traffic) traffic.step(dt, this.player);
    else if (this.traffic.cars.length) this.traffic.clear();
    for (let sub = 0; sub < 2; sub++) {
      for (const c of this.cars) c.step(dt * 0.5, track);
      this.collisions.solve(contact, track);
      for (const c of this.cars) this.collideStatic(c);
      if (traffic && traffic.cars.length) traffic.collide(this.player);
    }
    // A motorcycle nosed into something and stuck under throttle is helped
    // back onto the road by its own bounded recovery.
    for (const c of this.cars) if (c instanceof BikeVehicle) c.recoverIfUpset(dt, track);
    this.track.evolve(dt, this.time);
    // Recovery: upside down, drowned, fallen or out of the region.
    const player = this.player,
      pos = player.body.position,
      half = this.world.region.half;
    // A motorcycle's fall is its own state (slide, rider jogs back, push,
    // remount: bounded); only a rider down far longer than that is reset.
    const rider = player instanceof BikeVehicle ? player : null;
    this.riderDown = rider && !rider.riding ? this.riderDown + dt : 0;
    this.upset = !rider && player.up.y < 0.3 && player.speed < 6 ? this.upset + dt : 0;
    this.track.sample(pos.x, pos.z, SAMPLE, pos.y);
    this.drowned = this.track.query.waterDepth > 0.75 ? this.drowned + dt : 0;
    if (this.upset > 2 || this.riderDown > 20) this.resetToRoad(0, 'Recovered to the road');
    else if (this.drowned > 1.2) this.resetToRoad(0, 'Pulled out of the water');
    else if (pos.y < SAMPLE.height - 8 || player.retired)
      this.resetToRoad(0, 'Recovered to the road');
    else if (Math.abs(pos.x) > half + 60 || Math.abs(pos.z) > half + 60)
      this.resetToRoad(0, 'The festival region ends here');
    // Streaming: request tiles along every car's path, generate within budget.
    this.streamClock += dt;
    if (this.streamClock > 0.25) {
      this.streamClock = 0;
      for (const c of this.cars) this.prefetchAround(c, 2.5);
    }
    this.track.tiles.prefetch(this.tick % 2 === 0 ? 1.2 : 0);
    // Events and discovery.
    if (run?.drag) this.updateDrag(run);
    this.updateRun(dt);
    this.discoveryClock += dt;
    if (this.discoveryClock > 0.2) {
      this.discoveryClock = 0;
      this.updateDiscovery();
    }
    const skillCar = this.player,
      sample = this.skillSample;
    sample.lateral = skillCar.localVelocity.x;
    sample.forward = skillCar.localVelocity.z;
    sample.onRoad = this.track.query.onRoad;
    sample.grounded = skillCar.up.y > 0.45 && skillCar.tires.some((t) => t.load > 20);
    sample.impact = skillCar.impact > 0.25;
    sample.assisted = this.autopilot || !!(this.run && isRace(this.run.event.spec.kind));
    sample.nearMiss =
      this.nearMisses.update(
        skillCar,
        this.traffic.cars,
        dt,
        sample.onRoad && sample.grounded && !sample.impact && !sample.assisted && !this.run,
      ) > 0;
    this.skills.update(sample, dt);
    if (this.messageClock > 0) {
      this.messageClock -= dt;
      if (this.messageClock <= 0) this.message = null;
    }
    // Rewind history at a fixed interval of driving time.
    if (this.rewindAllowed && this.rewindBuffer.due(dt))
      this.rewindBuffer.push(this.captureFrame());
  }
  /** Drag strip timing: every lane's front bumper past the start line,
   * every step (crossings are interpolated between steps). */
  private updateDrag(run: Run) {
    const drag = run.drag!,
      path = run.event.path;
    run.participants.forEach((p, i) => {
      const car = p.car,
        timer = drag.timers[i],
        front = car.definition.halfExtents[2],
        x = car.body.position.x + car.forward.x * front,
        z = car.body.position.z + car.forward.z * front;
      // Station along the strip (the runway bows gently: not a straight
      // projection), searched near the last one.
      timer.update(this.time, path.locate(x, z, Math.max(0, timer.distance), 30));
      if (timer.finishAt !== null && p.finishTime === null) p.finishTime = timer.finishAt;
    });
  }
  /** Touge: the player's margin over the rival at the player's finish (s,
   * negative behind); the rival still running is measured from the
   * player's own trace (how long ago the player passed the rival's place). */
  private tougeMargin(run: Run) {
    const me = run.participants[0],
      rival = run.participants[1],
      traces = run.traces;
    if (!rival || !traces || me.finishTime === null) return null;
    if (rival.finishTime !== null) return rival.finishTime - me.finishTime;
    const passed = traceTime(traces[0], rival.progress.distance);
    return passed === null ? null : me.finishTime - run.start - passed;
  }
  /** Touge live gap to the rival (s, positive ahead). */
  private tougeGap(run: Run) {
    const me = run.participants[0],
      rival = run.participants[1],
      traces = run.traces;
    if (!rival || !traces) return null;
    const now = Math.max(0, (me.finishTime ?? this.time) - run.start),
      mine = me.progress.distance,
      theirs = rival.progress.distance;
    if (mine >= theirs) {
      const t = traceTime(traces[0], theirs);
      return t === null ? null : now - t;
    }
    const t = traceTime(traces[1], mine);
    return t === null ? null : -(now - t);
  }
  // --- Rewind -------------------------------------------------------------
  /** Rewind is for driving: free roam off the autopilot, and running races
   * and skill challenges; never on the drag strip (the start is the event),
   * in a countdown or on a result. */
  get rewindAllowed() {
    if (this.autopilot) return false;
    if (this.mode === 'free' || this.mode === 'card') return true;
    return this.mode === 'running' && !!this.run && !this.run.drag;
  }
  private captureFrame(): RewindFrame {
    const run = this.run;
    let record: RunRecord | null = null;
    if (run)
      record = {
        elapsed: this.time - run.start,
        offRoute: run.offRoute,
        lost: run.lost,
        progressClock: run.progressClock,
        progress: run.participants.map((p) => ({
          edge: p.progress.edge,
          s: p.progress.s,
          checkpoint: p.progress.checkpoint,
          laps: p.progress.laps,
          finished: p.progress.finished,
          distance: p.progress.distance,
          offRoute: p.progress.offRoute,
          finish: p.finishTime === null ? null : p.finishTime - run.start,
        })),
        drivers: run.drivers.map((d) => (d ? d.d : null)),
        drift: run.drift?.snapshot() ?? null,
        traces: run.traces?.map((t) => t.d.length) ?? null,
      };
    return {
      time: this.time,
      vehicles: this.cars.map((c) => c.definition.id),
      cars: this.cars.map((c) => captureCar(c)),
      run: record,
    };
  }
  private beginRewind() {
    if (this.rewinding) return;
    if (!this.rewindAllowed || this.rewindBuffer.size < 2) {
      this.say(this.rewindAllowed ? 'Nothing to rewind yet' : 'Rewind is not available here');
      return;
    }
    const newest = this.rewindBuffer.newest;
    this.rewinding = { cursor: newest, from: newest };
  }
  /** One step of the scrub: back through the history at REWIND.rate,
   * posing every car (and the event clock) at the cursor. */
  private scrub(dt: number) {
    const r = this.rewinding!,
      history = this.rewindBuffer;
    r.cursor = Math.max(history.oldest, r.cursor - dt * REWIND.rate);
    const span = history.around(r.cursor);
    if (!span || span.a.cars.length !== this.cars.length) {
      this.rewinding = null;
      return;
    }
    this.cars.forEach((car, i) => poseCar(car, span.a.cars[i], span.b.cars[i], span.t));
    const run = this.run;
    if (run && span.a.run && span.b.run)
      run.start =
        this.time - (span.a.run.elapsed + (span.b.run.elapsed - span.a.run.elapsed) * span.t);
    if (this.messageClock > 0) {
      this.messageClock -= dt;
      if (this.messageClock <= 0) this.message = null;
    }
  }
  /** Release: resume from the history frame at the cursor. */
  private endRewind() {
    const r = this.rewinding;
    if (!r) return;
    this.rewinding = null;
    const frame = this.rewindBuffer.at(r.cursor);
    if (!frame || frame.cars.length !== this.cars.length) return;
    const span = r.from - frame.time;
    this.restoreFrame(frame);
    // The restored instant is now: the history before it stays usable.
    this.rewindBuffer.truncate(frame.time);
    this.rewindBuffer.shift(this.time - frame.time);
    if (this.run) this.run.rewinds++;
    else this.rewindsRoam++;
    this.say(`Rewound ${span.toFixed(1)} s`);
  }
  /** Put every car and the running event back to a history frame. Cars are
   * fresh (as a reset: damage repaired) with the recorded pose, velocities,
   * wheel spin and gear; legal progress, clocks and drift state are the
   * recorded ones, so nothing driven after the frame stays credited. */
  private restoreFrame(frame: RewindFrame) {
    const run = this.run;
    frame.cars.forEach((record, i) => {
      const old = this.cars[i];
      if (!old || old.definition.id !== frame.vehicles[i]) return;
      const fresh = this.makeCar(i, old.definition.id);
      Object.assign(fresh.input, old.input);
      this.applyRecord(fresh, record);
      this.cars[i] = fresh;
      if (!run) return;
      run.participants[i].car = fresh;
      const driver = run.drivers[i];
      if (driver) {
        run.drivers[i] = driverLike(driver, fresh);
        run.drivers[i]!.relocate(frame.run?.drivers[i] ?? driver.d);
      }
    });
    const record = frame.run;
    if (run && record) {
      run.start = this.time - record.elapsed;
      run.offRoute = record.offRoute;
      run.lost = record.lost;
      run.progressClock = record.progressClock;
      record.progress.forEach((q, i) => {
        const p = run.participants[i];
        if (!p) return;
        Object.assign(p.progress, {
          edge: q.edge,
          s: q.s,
          checkpoint: q.checkpoint,
          laps: q.laps,
          finished: q.finished,
          distance: q.distance,
          offRoute: q.offRoute,
        });
        p.finishTime = q.finish === null ? null : run.start + q.finish;
      });
      if (run.drift && record.drift) run.drift.restore(record.drift as DriftSnapshot);
      run.traces?.forEach((trace, i) => {
        const keep = record.traces?.[i] ?? trace.d.length;
        trace.d.length = Math.min(trace.d.length, keep);
        trace.t.length = Math.min(trace.t.length, keep);
      });
    }
    this.autopilotDriver = null;
    this.parked = false;
    this.upset = this.drowned = this.riderDown = 0;
    this.skills.reset('REWIND');
    this.nearMisses.reset();
    const pos = this.player.body.position;
    this.traffic.clearNear(pos.x, pos.z, 18);
    this.prefetchAround(this.player, 0);
  }
  /** A history record onto a fresh car. */
  private applyRecord(car: Vehicle, r: Float64Array) {
    const C = CAR_RECORD,
      b = car.body;
    if (car instanceof BikeVehicle) {
      const ground = this.track.groundHeight(r[C.BIKE_X], r[C.BIKE_Z], r[C.PY]);
      car.placeFree(this.asTrack, r[C.BIKE_X], r[C.BIKE_Z], r[C.BIKE_HEADING], ground);
      const d = car.dynamics;
      d.speed = r[C.BIKE_SPEED];
      d.lean = r[C.BIKE_LEAN];
      d.leanRate = r[C.BIKE_LEAN_RATE];
      d.steer = r[C.BIKE_STEER];
    } else {
      b.position.set(r[C.PX], r[C.PY], r[C.PZ]);
      b.orientation.x = r[C.QX];
      b.orientation.y = r[C.QY];
      b.orientation.z = r[C.QZ];
      b.orientation.w = r[C.QW];
      b.velocity.set(r[C.VX], r[C.VY], r[C.VZ]);
      b.omega.set(r[C.WX], r[C.WY], r[C.WZ]);
    }
    for (let i = 0; i < 4; i++) if (car.tires[i]) car.tires[i].omega = r[C.WHEELS + i];
    car.gear = r[C.GEAR];
    car.rpm = r[C.RPM];
    // The engine turns at the recorded speed, the clutch closed on it (a
    // fresh engine at idle would slip and brake the car on release).
    car.clutch.engineOmega = (r[C.RPM] * Math.PI) / 30;
    car.clutch.engagement = 1;
    car.retired = false;
    car.upsetClock = 0;
    car.lateral = this.track.nearest(
      b.position.x,
      b.position.z,
      car.trackPosition,
      b.position.y + 1,
    );
    car.s = car.trackPosition.s;
  }
  private prefetchAround(car: Vehicle, lookahead: number) {
    const b = car.body;
    this.track.tiles.want(b.position.x, b.position.z, b.velocity.x, b.velocity.z, lookahead);
  }
  /** Free-roam autopilot: cruise in the right-hand lane toward the nearest
   * event marker not yet visited, then stop there. */
  private cruise(dt: number) {
    if (!this.autopilotDriver) {
      const pos = this.player.body.position;
      const target = [...this.events]
        .filter((e) => Math.hypot(e.marker.x - pos.x, e.marker.z - pos.z) > 60)
        .sort(
          (a, b) =>
            Math.hypot(a.marker.x - pos.x, a.marker.z - pos.z) -
            Math.hypot(b.marker.x - pos.x, b.marker.z - pos.z),
        )[0];
      if (!target) return;
      const legs = planRoute(
        this.world.network,
        [
          [pos.x, pos.z],
          [target.marker.x, target.marker.z],
        ],
        false,
      );
      const path = new RoutePath(this.world.network, legs, false);
      // Among ambient traffic: in the right-hand lane, following, never
      // overtaking into the oncoming lane.
      this.autopilotDriver = new RouteDriver(
        this.player,
        path,
        0.8,
        this.trafficEnabled ? -1.9 : 0,
        24,
      );
      this.autopilotDriver.overtake = !this.trafficEnabled;
      this.say(`Autopilot: driving to ${target.spec.name}`);
    }
    const driver = this.autopilotDriver;
    const arrived = driver.path.length - driver.d < 12;
    // Keep its distance from the ambient traffic too.
    const obstacles = this.obstacles;
    obstacles.length = 0;
    for (const c of this.cars) obstacles.push(c);
    if (this.trafficEnabled) for (const c of this.traffic.cars) obstacles.push(c);
    driver.update(dt, obstacles, false, arrived);
    if (driver.wantsReset) this.resetToRoad(0);
    if (arrived && this.player.speed < 0.5) {
      this.autopilot = false;
      this.autopilotDriver = null;
      this.say('Autopilot: arrived');
    }
  }
  /** Trees of a physics tile (deterministic, LRU like the terrain tiles). */
  private treesAt(x: number, z: number) {
    const ix = Math.floor(x / TILE_SIZE),
      iz = Math.floor(z / TILE_SIZE),
      key = (ix + 512) * 1024 + (iz + 512);
    let trees = this.trees.get(key);
    if (trees) {
      this.trees.delete(key);
      this.trees.set(key, trees);
      return trees;
    }
    trees = treesForTile(this.world, ix, iz, this.structureGrid, 1);
    this.trees.set(key, trees);
    while (this.trees.size > this.treeBudget)
      this.trees.delete(this.trees.keys().next().value as number);
    return trees;
  }
  /** Buildings and tree trunks as static colliders (impulse with damage). */
  private collideStatic(car: Vehicle) {
    const b = car.body,
      [hx, hy, hz] = car.definition.halfExtents,
      fx = car.forward.x,
      fz = car.forward.z,
      fl = Math.hypot(fx, fz) || 1,
      ux = fx / fl,
      uz = fz / fl;
    // Car frame: +z forward (u), +x left (v = up × u).
    const vx = uz,
      vz = -ux;
    let deepest = 0;
    // Buildings: car perimeter points inside a footprint.
    const nearBuildings = this.structureGrid.near(b.position.x, b.position.z);
    if (nearBuildings.length)
      for (const [a, c] of PERIMETER) {
        const px = b.position.x + vx * a * hx + ux * c * hz,
          pz = b.position.z + vz * a * hx + uz * c * hz;
        for (const index of nearBuildings) {
          const s = this.structures[index];
          if (b.position.y > s.base + s.height + hy || !insideFootprint(s, px, pz)) continue;
          const cos = Math.cos(s.heading),
            sin = Math.sin(s.heading),
            dx = px - s.x,
            dz = pz - s.z,
            lx = dx * cos + dz * sin,
            lz = -dx * sin + dz * cos,
            ex = s.hx - Math.abs(lx),
            ez = s.hz - Math.abs(lz);
          const depth = Math.min(ex, ez);
          if (depth <= deepest) continue;
          deepest = depth;
          if (ex < ez) this.normal.set(Math.sign(lx) * cos, 0, Math.sign(lx) * sin);
          else this.normal.set(-Math.sign(lz) * sin, 0, Math.sign(lz) * cos);
          this.corner.set(px, b.position.y, pz);
        }
      }
    if (deepest > 0)
      this.collisions.impulse(car, null, this.corner, this.normal, Math.min(deepest, 0.6));
    // Tree trunks: circle against the chassis rectangle.
    const trees = this.treesAt(b.position.x, b.position.z);
    for (let i = 0; i < trees.length; i += TREE_STRIDE) {
      const dx = trees[i] - b.position.x,
        dz = trees[i + 1] - b.position.z;
      if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
      const r = trunkRadius(trees[i + 3], trees[i + 2]);
      if (r <= 0) continue;
      const lx = dx * vx + dz * vz,
        lz = dx * ux + dz * uz,
        cx = clamp(lx, -hx, hx),
        cz = clamp(lz, -hz, hz),
        ex = lx - cx,
        ez = lz - cz,
        d = Math.hypot(ex, ez);
      if (d >= r) continue;
      let nx: number, nz: number, depth: number;
      if (d > 1e-4) {
        // From the trunk toward the car's closest point.
        nx = -(ex * vx + ez * ux) / d;
        nz = -(ex * vz + ez * uz) / d;
        depth = r - d;
      } else {
        // Trunk inside the box: push out along the shallow axis.
        const px = hx - Math.abs(lx),
          pz = hz - Math.abs(lz);
        if (px < pz) {
          nx = -Math.sign(lx) * vx;
          nz = -Math.sign(lx) * vz;
          depth = px + r;
        } else {
          nx = -Math.sign(lz) * ux;
          nz = -Math.sign(lz) * uz;
          depth = pz + r;
        }
      }
      this.normal.set(nx, 0, nz);
      this.corner.set(
        b.position.x + cx * vx + cz * ux,
        b.position.y,
        b.position.z + cx * vz + cz * uz,
      );
      this.collisions.impulse(car, null, this.corner, this.normal, Math.min(depth, 0.6));
    }
  }
  // --- Output -------------------------------------------------------------
  status(): FestivalStatus {
    const player = this.player,
      net = this.world.network,
      pos = player.body.position;
    this.track.sample(pos.x, pos.z, SAMPLE, pos.y);
    const q = this.track.query,
      e = net.edges[q.edge];
    const run = this.run;
    let event: FestivalStatus['event'] = null;
    if (run) {
      const p = run.participants[0];
      const ranking = run.participants
        .map((r, i) => ({
          i,
          key: r.finishTime !== null ? -1e9 + r.finishTime : -r.progress.distance,
        }))
        .sort((a, b) => a.key - b.key);
      let live: { label: string; value: string } | null = null;
      const elapsed = Math.max(0, this.time - run.start);
      if (run.event.spec.kind === 'speed-trap')
        live = { label: 'SPEED', value: `${Math.round(player.speed * 3.6)} KM/H` };
      else if (run.event.spec.kind === 'speed-zone')
        live = {
          label: 'AVERAGE',
          value: `${elapsed > 0.5 ? Math.round((p.progress.distance / elapsed) * 3.6) : 0} KM/H`,
        };
      else if (run.drift) live = { label: 'DRIFT', value: `${run.drift.live(this.time)}` };
      else if (run.traces) {
        const gap = this.tougeGap(run);
        live = {
          label: 'GAP',
          value: gap === null ? '—' : `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(2)} S`,
        };
      } else if (run.drag) {
        const slip = run.drag.timers[0].slip(run.drag.lanes[0], run.drag.tree.green);
        live = {
          label: 'REACTION',
          value: slip.redLight
            ? 'RED LIGHT'
            : slip.reaction === null
              ? '—'
              : `${slip.reaction.toFixed(3)} S`,
        };
      }
      const gate = run.event.graph.spec.checkpoints[p.progress.checkpoint];
      let gatePoint: { x: number; z: number } | null = null;
      if (gate) {
        const edge = run.event.graph.spec.edges.find((x) => x.id === gate.edge);
        const point =
          edge?.points[
            Math.min(
              edge.points.length - 1,
              Math.round(
                (gate.s / Math.max(1, run.event.graph.length(gate.edge))) *
                  (edge.points.length - 1),
              ),
            )
          ];
        if (point) gatePoint = { x: point.x, z: point.z };
      }
      event = {
        id: run.event.spec.id,
        name: run.event.spec.name,
        kind: run.event.spec.kind,
        countdown: this.mode === 'countdown' ? Math.max(0, run.start - this.time) : 0,
        elapsed: p.finishTime !== null ? p.finishTime - run.start : elapsed,
        progress: Math.min(1, p.progress.distance / run.event.distance),
        lap: Math.min(run.event.laps, p.progress.laps + 1),
        laps: run.event.laps,
        position: ranking.findIndex((r) => r.i === 0) + 1,
        entrants: run.participants.length,
        offRoute: p.progress.offRoute,
        live,
        gate: gatePoint,
        rewinds: run.rewinds,
        drag: run.drag
          ? {
              tree: run.drag.tree,
              lane: run.drag.lanes[0],
              lanes: run.drag.timers.map((timer, i) => ({
                lane: run.drag!.lanes[i],
                leftAt: timer.leftAt,
              })),
              slip: run.drag.timers[0].slip(run.drag.lanes[0], run.drag.tree.green),
            }
          : null,
      };
    }
    const card = this.cardEvent;
    return {
      mode: this.mode,
      time: this.time,
      vehicleId: player.definition.id,
      speedKmh: player.speed * 3.6,
      autopilot: this.autopilot,
      card: card
        ? {
            id: card.spec.id,
            name: card.spec.name,
            kind: card.spec.kind,
            blurb: card.spec.blurb,
            distanceKm: Math.round(card.distance / 100) / 10,
            laps: card.laps,
            rivals: card.spec.rivals ?? 0,
          }
        : null,
      event,
      result: this.mode === 'finished' ? (this.results[this.results.length - 1] ?? null) : null,
      discovered: [...this.discovered],
      road: {
        name: e.road.name,
        roadClass: e.roadClass,
        limitKmh: SPEED_CLASS_KMH[e.spec.speedClass],
        onRoad: q.onRoad,
        surface: WORLD_SURFACE_NAMES[q.surface] ?? 'ground',
      },
      message: this.message,
      streaming: { ...this.track.tiles.stats },
      traffic: { enabled: this.trafficEnabled, cars: this.traffic.cars.length },
      skills: this.skills.status(),
      rewind: {
        active: !!this.rewinding,
        allowed: this.rewindAllowed && this.rewindBuffer.size >= 2,
        available: this.rewinding
          ? Math.max(0, this.rewinding.cursor - this.rewindBuffer.oldest)
          : this.rewindBuffer.available(this.rewindBuffer.newest),
        back: this.rewinding ? this.rewinding.from - this.rewinding.cursor : 0,
        count: run ? run.rewinds : this.rewindsRoam,
      },
    };
  }
  /** Snapshot in the circuit frame layout (race fields neutral). */
  writeFrame(out: Float32Array, stepMs = 0, dropped = 0) {
    if (out.length !== HEADER + this.cars.length * CAR_STRIDE)
      throw new Error('Invalid snapshot buffer');
    out.fill(0);
    out[H.TIME] = this.time;
    out[H.PHASE] = 2;
    out[H.RACE_TIME] = this.time;
    out[H.RAIN] = this.track.rain;
    out[H.CLOUD] = this.track.cloud;
    out[H.AMBIENT] = this.track.ambient;
    out[H.STEP_MS] = stepMs;
    out[H.DROPPED] = dropped;
    out[H.WATER] = this.track.meanWater();
    out[H.TICK] = this.tick;
    out[H.CARS] = this.cars.length;
    out[H.LENGTH] = this.track.length;
    out[H.WIND_X] = this.track.windX;
    out[H.WIND_Z] = this.track.windZ;
    out[H.LAP_LEADER] = 1;
    this.cars.forEach((c, id) => writeCar(out, id, c));
    return out;
  }
  makeFrame() {
    return this.writeFrame(new Float32Array(HEADER + this.cars.length * CAR_STRIDE));
  }
  /** The ambient traffic block that goes with a frame (ambient-traffic.ts). */
  trafficFrame() {
    return this.traffic.writeSnapshot();
  }
}
const SAMPLE = {
  s: 0,
  width: 0,
  lateral: 0,
  height: 0,
  normal: new Vec3(0, 1, 0),
  surface: 0,
  water: 0,
  rubber: 0,
  marbles: 0,
  temp: 0,
  grip: 1,
  resistance: 0,
  cell: 0,
  pit: false,
};
/** A fresh driver like `driver` for a replacement car (reset, rewind). */
function driverLike(driver: RouteDriver, car: Vehicle) {
  const fresh = new RouteDriver(car, driver.path, driver.skill, driver.laneOffset, driver.speedCap);
  fresh.overtake = driver.overtake;
  fresh.keepLane = driver.keepLane;
  return fresh;
}
/** Event time (s from the start) at which a trace reached `distance`. */
function traceTime(trace: { d: number[]; t: number[] }, distance: number) {
  const d = trace.d,
    n = d.length;
  if (!n || distance > d[n - 1]) return null;
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] < distance) lo = mid;
    else hi = mid;
  }
  if (d[lo] >= distance) return trace.t[lo];
  const span = d[hi] - d[lo];
  return trace.t[lo] + (span > 0 ? ((distance - d[lo]) / span) * (trace.t[hi] - trace.t[lo]) : 0);
}
/** Car perimeter sample points in half-extent units (x: left, z: forward). */
const PERIMETER: readonly (readonly [number, number])[] = Object.freeze([
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
]);
/** One car's block of the snapshot (same fields as the circuit writer). */
function writeCar(out: Float32Array, id: number, c: Vehicle) {
  const b = c.body,
    o = carBase(id),
    q = b.orientation;
  out[o + F.X] = b.position.x;
  out[o + F.Y] = b.position.y;
  out[o + F.Z] = b.position.z;
  out[o + F.QX] = q.x;
  out[o + F.QY] = q.y;
  out[o + F.QZ] = q.z;
  out[o + F.QW] = q.w;
  out[o + F.VX] = b.velocity.x;
  out[o + F.VY] = b.velocity.y;
  out[o + F.VZ] = b.velocity.z;
  out[o + F.WX] = b.omega.x;
  out[o + F.WY] = b.omega.y;
  out[o + F.WZ] = b.omega.z;
  out[o + F.SPEED] = c.speed;
  out[o + F.STEER] = c.steer;
  out[o + F.RPM] = c.rpm;
  out[o + F.GEAR] = c.gear;
  out[o + F.THROTTLE] = c.throttle;
  out[o + F.BRAKE] = c.brake;
  out[o + F.FUEL] = c.fuel;
  out[o + F.BATTERY] = c.battery;
  out[o + F.AERO_FRONT] = c.aero.front + c.aero.floor * 0.46;
  out[o + F.AERO_REAR] = c.aero.rear + c.aero.floor * 0.54;
  out[o + F.DRAG] = c.aero.drag;
  out[o + F.FRONT_HEALTH] = c.frontHealth;
  out[o + F.FLOOR_HEALTH] = c.floorHealth;
  out[o + F.REAR_HEALTH] = c.rearHealth;
  out[o + F.S] = c.s;
  out[o + F.LATERAL] = c.lateral;
  out[o + F.AI_TARGET] = c.aiTarget;
  out[o + F.G_LONG] = c.gLong;
  out[o + F.G_LAT] = c.gLat;
  out[o + F.G_VERT] = c.gVert;
  out[o + F.RANK] = id + 1;
  out[o + F.WAKE] = c.wake;
  out[o + F.SLIP_ENERGY] = c.tires.reduce((sum, w) => sum + w.energy, 0);
  out[o + F.BOTTOM_ENERGY] = c.bottomEnergy;
  out[o + F.IMPACT] = c.impact;
  out[o + F.COMPOUND] = COMPOUND_IDS.indexOf(c.tires[0].compound);
  out[o + F.MOTOR_POWER] = c.motorPower;
  out[o + F.REGEN_POWER] = c.regenerationPower;
  out[o + F.FRONT_RIDE] = c.frontRideHeight;
  out[o + F.REAR_RIDE] = c.rearRideHeight;
  out[o + F.BRAKE_BIAS] = c.setup.brakeBias;
  out[o + F.DIFF_POWER] = c.setup.diffPower;
  out[o + F.DIFF_COAST] = c.setup.diffCoast;
  out[o + F.ERS_MODE] = c.input.ers;
  out[o + F.SIDEPOD_HEALTH] = c.sidepodHealth;
  out[o + F.LOST_MASS] = c.lostMass;
  out[o + F.SUSPENSION_DAMAGE] = c.suspensionDamage;
  out[o + F.LAP_VALID] = 1;
  out[o + F.RETIRED] = Number(c.retired);
  out[o + F.MASS] = c.body.mass;
  out[o + F.CLUTCH_PEDAL] = c.input.clutch;
  out[o + F.CLUTCH_ENGAGEMENT] = c.clutch.engagement;
  out[o + F.CLUTCH_TORQUE] = c.clutch.transmittedTorque;
  out[o + F.CLUTCH_SLIP_POWER] = c.clutch.slipPower;
  out[o + F.ENGINE_TORQUE] = c.engineOutputTorque;
  out[o + RACE_BASE + R.VEHICLE] = vehicleIndex(c.definition.id);
  // Motorcycle block (lean, rider, suspension) for the bike presentation.
  if (c instanceof BikeVehicle) writeBikeBlock(out, o + BIKE_BASE, c);
  const k = o + SKID_BASE,
    skid = c.skid;
  out[k + K.CONTACTS] = skid.contacts;
  out[k + K.LOAD] = skid.normalLoad;
  out[k + K.SLIDE_POWER] = skid.slidingPower;
  out[k + K.DAMPING_POWER] = skid.dampingPower;
  out[k + K.SPARK_POWER] = skid.sparkPower;
  out[k + K.SPARK_X] = skid.point.x;
  out[k + K.SPARK_Y] = skid.point.y;
  out[k + K.SPARK_Z] = skid.point.z;
  out[k + K.NORMAL_X] = skid.normal.x;
  out[k + K.NORMAL_Y] = skid.normal.y;
  out[k + K.NORMAL_Z] = skid.normal.z;
  out[k + K.VELOCITY_X] = skid.velocity.x;
  out[k + K.VELOCITY_Y] = skid.velocity.y;
  out[k + K.VELOCITY_Z] = skid.velocity.z;
  out[k + K.SLIDE_WORK] = skid.slidingWorkJ;
  out[k + K.SPARK_WORK] = skid.sparkWorkJ;
  out[k + K.TOTAL_WORK] = skid.totalWorkJ;
  for (let i = 0; i < c.debris.pieces.length; i++) {
    const piece = c.debris.pieces[i],
      p = o + DEBRIS_BASE + i * DEBRIS_STRIDE;
    out[p] = piece.kind;
    out[p + 1] = piece.position.x;
    out[p + 2] = piece.position.y;
    out[p + 3] = piece.position.z;
    out[p + 4] = piece.rotation;
    out[p + 5] = piece.age;
    out[p + 6] = piece.mass;
    out[p + 7] = Number(piece.active);
  }
  for (let i = 0; i < 4; i++) {
    const w = c.tires[i],
      p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    out[p + W.OMEGA] = w.omega;
    out[p + W.LOAD] = w.load;
    out[p + W.FX] = w.fx;
    out[p + W.FY] = w.fy;
    out[p + W.SLIP] = w.slip;
    out[p + W.ANGLE] = w.angle;
    out[p + W.SURFACE_TEMP] = w.surfaceTemp;
    out[p + W.CARCASS_TEMP] = w.carcassTemp;
    out[p + W.WEAR] = w.wear;
    out[p + W.DIRT] = w.dirt;
    out[o + F.MARBLE_PICKUP_FR + i] = w.marblePickup;
    out[p + W.COMPRESSION] = w.compression;
    out[p + W.DISC_TEMP] = w.discTemp;
    out[p + W.WATER] = w.water;
    out[p + W.SURFACE] = w.surface;
    out[p + W.ROTATION] = w.rotation;
    out[p + W.FLAT] = w.flatSpot;
    out[p + W.PRESSURE] = w.pressure;
    out[p + W.RADIUS] = w.radius;
    out[p + W.BLISTERING] = w.blistering;
    out[p + W.GRAINING] = w.graining;
    out[p + W.PUNCTURED] = Number(w.punctured);
    out[p + W.SUSPENSION_DAMAGE] = c.cornerDamage[i];
    out[p + W.SLIP_POWER] = w.energy;
    out[p + W.LENGTH] = w.length;
    out[p + W.STEER] = c.wheelSteering[i];
    out[p + W.CAMBER] = c.wheelCamber[i];
  }
}
