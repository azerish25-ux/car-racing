import { clamp, Vec3 } from '../../core/math.ts';
import { CollisionSolver } from '../collision.ts';
import { COMPOUNDS, controls, DEFAULT_SETUP, type Assist, type Controls, type WeatherPreset } from '../config.ts';
import {
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
import { trackPoint, type Track } from '../track.ts';
import { Vehicle } from '../vehicle.ts';
import { vehicleIndex, VEHICLES, type VehicleDefinition } from '../vehicles.ts';
import {
  DriftMeter,
  isRace,
  resolveEvents,
  starsFor,
  type FestivalEvent,
  type FestivalResult,
  type Participant,
} from './festival-events.ts';
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
import { RouteDriver } from './route-driver.ts';
import { pathPoint, planRoute, RoutePath } from './route-path.ts';
import type { TileCacheStats } from './terrain-tiles.ts';
import { TILE_SIZE } from './terrain-tiles.ts';
import { openWorld, type OpenWorld } from './world.ts';

const COMPOUND_IDS = Object.keys(COMPOUNDS);
/** Festival order of vehicle classes: road cars, then GT and club cars,
 * then saloon and loose-surface machines, then prototypes and single-seaters
 * (any class not listed comes last). */
const FESTIVAL_CLASS_ORDER: readonly (readonly string[])[] = [
  ['road', 'street'],
  ['gt', 'gt-sport', 'club'],
  ['touring', 'rally', 'rallycross', 'offroad'],
  ['hypercar', 'prototype'],
];
/** Classes the festival does not offer: karts have no ground clearance or
 * road-going steering for public roads, kerbs and junction crowns. */
const FESTIVAL_EXCLUDED_CLASSES: readonly string[] = ['kart'];
/** Vehicles that can run in the festival: every four-wheel definition in the
 * registry except karts, road cars first (data-driven: definitions added to
 * vehicles.ts appear here without code changes). */
export function festivalVehicles(): VehicleDefinition[] {
  const rank = (d: VehicleDefinition) => {
    const c = String(d.classId),
      i = FESTIVAL_CLASS_ORDER.findIndex((group) => group.includes(c));
    return i < 0 ? FESTIVAL_CLASS_ORDER.length : i;
  };
  return Object.values(VEHICLES)
    .filter((d) => d.dynamicsKind === 'four-wheel' && !FESTIVAL_EXCLUDED_CLASSES.includes(String(d.classId)))
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}
/** Default festival machine: the first road/GT-class car, else the first
 * non-Formula car, else whatever the registry holds first. */
export function festivalDefaultVehicle() {
  const list = festivalVehicles();
  return (list.find((d) => d.classId !== 'formula') ?? list[0]).id;
}

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
}
export type FestivalMode = 'free' | 'card' | 'countdown' | 'running' | 'finished';
export type FestivalCommand =
  | { type: 'reset' }
  | { type: 'start'; event: string }
  | { type: 'cancel' }
  | { type: 'continue' }
  | { type: 'autopilot'; value: boolean }
  | { type: 'vehicle'; id: string }
  | { type: 'travel'; event: string };
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
  } | null;
  result: FestivalResult | null;
  discovered: string[];
  road: { name: string; roadClass: string; limitKmh: number; onRoad: boolean; surface: string };
  message: string | null;
  streaming: TileCacheStats;
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
}
const SPAWN = { x: 560, z: -2602, heading: Math.PI / 2 };

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
  constructor(readonly options: FreeRoamOptions = {}) {
    this.world = openWorld(options.region ?? SOLVANE);
    this.track = new OpenWorldTrack(this.world, options.weather ?? 'clear', undefined, options.tileBudget ?? 64);
    this.asTrack = asTrack(this.track);
    this.events = resolveEvents(this.world);
    this.structures = regionStructures(this.world);
    this.structureGrid = new StructureGrid(this.structures);
    for (const id of options.discovered ?? []) if (this.events.some((e) => e.spec.id === id)) this.discovered.add(id);
    this.treeBudget = options.tileBudget ?? 64;
    this.assist = options.assist ?? 'sport';
    this.seed = options.seed ?? 73021;
    const vehicle = this.makeCar(0, options.vehicle ?? festivalDefaultVehicle());
    this.cars = [vehicle];
    const spawn = options.spawn ?? SPAWN;
    this.placeAt(vehicle, spawn.x, spawn.z, spawn.heading ?? SPAWN.heading);
    this.prefetchAround(vehicle, 0);
  }
  get player() {
    return this.cars[0];
  }
  private makeCar(id: number, vehicleId: string) {
    const definition = Object.hasOwn(VEHICLES, vehicleId) ? VEHICLES[vehicleId] : VEHICLES[festivalDefaultVehicle()];
    return new Vehicle(id, 'medium', DEFAULT_SETUP, this.assist, definition);
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
    car.lateral = this.track.nearest(x, z, car.trackPosition, ground + 1);
    car.s = car.trackPosition.s;
  }
  /** Place on a route at distance d and lateral offset, facing along it. */
  private placeOnPath(car: Vehicle, path: RoutePath, d: number, lateral: number) {
    const p = path.at(d, this.pp);
    this.placeAt(car, p.x + p.nx * lateral, p.z + p.nz * lateral, Math.atan2(p.tx, p.tz), p.y + 0.5);
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
      // Back onto the event route at the last legal progress.
      const participant = run.participants[slot];
      participant.car = fresh;
      const path = run.event.path,
        d = path.locate(pos.x, pos.z, this.progressDistance(participant), 80, this.located);
      this.placeOnPath(fresh, path, d, 0);
      const driver = run.drivers[slot];
      if (driver) {
        run.drivers[slot] = new RouteDriver(fresh, path, driver.skill);
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
        lane = clamp(-forward * Math.min(keep, e.spec.halfWidth * 0.5) || clamp(lateral, -keep, keep), -keep, keep);
      this.placeAt(fresh, p.x + p.nx * lane, p.z + p.nz * lane, Math.atan2(p.tx * forward, p.tz * forward), p.y + 0.5);
    }
    if (index === 0 && this.autopilotDriver) this.autopilotDriver = null;
    if (index === 0) {
      this.parked = true;
      this.say(reason);
    }
    this.upset = 0;
    this.drowned = 0;
  }
  private progressDistance(p: Participant) {
    // RouteProgress distance accumulates laps; the path is one lap long.
    const length = this.run?.event.path.length ?? 1;
    return p.progress.distance % length;
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
    if (dst.throttle > 0.05 || dst.brake > 0.05 || Math.abs(dst.steer) > 0.1 || dst.reverse) this.parked = false;
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
        this.autopilotDriver = null;
        if (!this.autopilot) Object.assign(this.player.input, controls());
        break;
      case 'vehicle': {
        if (!Object.hasOwn(VEHICLES, cmd.id) || VEHICLES[cmd.id].dynamicsKind !== 'four-wheel')
          throw new Error(`Vehicle ${cmd.id} cannot run in the festival`);
        if (this.run) this.abandon();
        const old = this.player,
          fresh = this.makeCar(0, cmd.id);
        this.cars[0] = fresh;
        this.placeAt(fresh, old.body.position.x, old.body.position.z, Math.atan2(old.forward.x, old.forward.z), old.body.position.y);
        this.parked = true;
        this.say(`${fresh.definition.name} ready`);
        break;
      }
      case 'travel': {
        const event = this.events.find((e) => e.spec.id === cmd.event);
        if (!event) throw new Error(`Unknown festival event ${cmd.event}`);
        if (!this.discovered.has(event.spec.id)) throw new Error('Travel needs a discovered event');
        if (this.run) this.abandon();
        const fresh = this.makeCar(0, this.player.definition.id);
        this.cars[0] = fresh;
        this.placeOnPath(fresh, event.path, 0, 0);
        this.prefetchAround(fresh, 0);
        this.parked = true;
        this.say(`Travelled to ${event.spec.name}`);
        break;
      }
    }
  }
  // --- Events -------------------------------------------------------------
  /** Rival machines: registry cars of the player's class first (data-driven),
   * deterministic per event and seed. Showcase: the fastest registry car. */
  private rivalVehicles(event: FestivalEvent, count: number) {
    const all = festivalVehicles(),
      own = this.player.definition;
    if (event.spec.kind === 'showcase')
      return [all.reduce((best, d) => (d.ai.topSpeed > best.ai.topSpeed ? d : best), all[0]).id];
    const same = all.filter((d) => d.classId === own.classId),
      pool = same.length ? same : all;
    return Array.from({ length: count }, (_, i) => pool[(i + event.index + this.seed) % pool.length].id);
  }
  private startEvent(event: FestivalEvent) {
    this.endRun();
    this.cardEvent = null;
    const race = isRace(event.spec.kind);
    const rivals = race ? Math.max(0, Math.min(7, event.spec.rivals ?? 0)) : 0;
    const ids = this.rivalVehicles(event, rivals);
    const player = this.makeCar(0, this.player.definition.id);
    const cars = [player, ...ids.map((id, i) => this.makeCar(i + 1, id))];
    this.cars = cars;
    // Grid: two columns on wide roads, single file on narrow ones; the
    // player starts at the back.
    const path = event.path,
      start = this.pp;
    path.at(0, start);
    const twoWide = start.halfWidth >= 4.4,
      order = [...cars.slice(1), player];
    order.forEach((car, slot) => {
      const row = twoWide ? Math.floor(slot / 2) : slot,
        column = twoWide ? (slot % 2 === 0 ? -1 : 1) * Math.min(2.6, start.halfWidth - 1.7) : 0;
      const d = Math.max(4, (twoWide ? Math.ceil(order.length / 2) : order.length) * 9 + 4 - row * 9);
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
    const skill = (i: number) => (event.spec.kind === 'showcase' ? 0.97 : 0.86 + ((i * 37 + this.seed) % 9) * 0.012);
    this.run = {
      event,
      participants,
      drivers: cars.map((car, i) => (i === 0 ? null : new RouteDriver(car, path, skill(i)))),
      start: this.time + (race ? 3 : 0),
      countdown: race ? 3 : 0,
      offRoute: 0,
      drift: event.spec.kind === 'drift-zone' ? new DriftMeter() : null,
      trapKmh: null,
      assisted: this.autopilot,
      progressClock: 0,
      lost: 0,
    };
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
    if (this.run) this.cars = [this.player];
    this.run = null;
    this.mode = 'free';
  }
  private finishRun(completed: boolean, abandoned = false) {
    const run = this.run!,
      event = run.event,
      spec = event.spec,
      path = event.path;
    const player = run.participants[0];
    const elapsed = Math.max(0, (player.finishTime ?? this.time) - run.start);
    const drift = run.drift?.finish(this.time) ?? null;
    const ranking = run.participants
      .map((p, i) => ({ p, i, key: p.finishTime !== null ? -1e9 + p.finishTime : -p.progress.distance }))
      .sort((a, b) => a.key - b.key);
    const position = ranking.findIndex((r) => r.i === 0) + 1;
    const result: FestivalResult = {
      kind: 'festival-result',
      version: 1,
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
      trapKmh: spec.kind === 'speed-trap' && completed ? run.trapKmh : null,
      averageKmh: spec.kind === 'speed-zone' && completed && elapsed > 0 ? (path.length / elapsed) * 3.6 : null,
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
    // The player's ground was sampled last in step(): drift validity reads it.
    run.drift?.update(this.player, this.time, dt, !this.track.query.onRoad, this.player.impact > 0.25);
    run.progressClock += dt;
    if (run.progressClock < 1 / 30) return;
    const step = run.progressClock;
    run.progressClock = 0;
    for (const p of run.participants) {
      if (p.finishTime !== null) continue;
      const pos = p.car.body.position;
      p.progress.update({ x: pos.x, y: pos.y, z: pos.z });
      const done = path.closed ? p.progress.laps >= event.laps : p.progress.finished;
      if (done) p.finishTime = this.time;
    }
    const player = run.participants[0];
    if (player.progress.offRoute) run.offRoute += step;
    if (player.finishTime !== null) {
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
          if (d2 < 16 * 16 && this.player.speed < 22) card = event;
          continue;
        }
        if (this.mode !== 'free' || d2 > 30 * 30) continue;
        const path = event.path,
          d = path.locate(pos.x, pos.z, 0, 40, this.located),
          p = path.at(d, this.pp),
          aligned = this.player.forward.x * p.tx + this.player.forward.z * p.tz;
        if (d < 25 && Math.abs(this.located.lateral) < p.halfWidth + 1.5 && aligned > 0.6 && this.player.speed > 4) {
          this.startEvent(event);
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
    const run = this.run;
    // Drivers.
    if (run) {
      const hold = this.mode === 'countdown',
        traffic = this.cars.filter((_, i) => i === 0 || run.participants[i]?.finishTime === null);
      run.drivers.forEach((driver, i) => {
        const p = run.participants[i];
        if (!driver) return;
        driver.update(dt, traffic, hold, p.finishTime !== null || this.mode === 'finished');
        if (driver.wantsReset) this.resetToRoad(i, 'Rival reset');
      });
      if (hold) {
        const input = this.player.input;
        input.throttle = 0;
        input.brake = 1;
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
      contact = run ? this.cars.filter((c, i) => i === 0 || run.participants[i]?.finishTime === null) : this.cars;
    for (let sub = 0; sub < 2; sub++) {
      for (const c of this.cars) c.step(dt * 0.5, track);
      this.collisions.solve(contact, track);
      for (const c of this.cars) this.collideStatic(c);
    }
    this.track.evolve(dt, this.time);
    // Recovery: upside down, drowned, fallen or out of the region.
    const player = this.player,
      pos = player.body.position,
      half = this.world.region.half;
    this.upset = player.up.y < 0.3 && player.speed < 6 ? this.upset + dt : 0;
    this.track.sample(pos.x, pos.z, SAMPLE, pos.y);
    this.drowned = this.track.query.waterDepth > 0.75 ? this.drowned + dt : 0;
    if (this.upset > 2) this.resetToRoad(0, 'Recovered to the road');
    else if (this.drowned > 1.2) this.resetToRoad(0, 'Pulled out of the water');
    else if (pos.y < SAMPLE.height - 8 || player.retired) this.resetToRoad(0, 'Recovered to the road');
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
    this.updateRun(dt);
    this.discoveryClock += dt;
    if (this.discoveryClock > 0.2) {
      this.discoveryClock = 0;
      this.updateDiscovery();
    }
    if (this.messageClock > 0) {
      this.messageClock -= dt;
      if (this.messageClock <= 0) this.message = null;
    }
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
        .sort((a, b) => Math.hypot(a.marker.x - pos.x, a.marker.z - pos.z) - Math.hypot(b.marker.x - pos.x, b.marker.z - pos.z))[0];
      if (!target) return;
      const legs = planRoute(this.world.network, [[pos.x, pos.z], [target.marker.x, target.marker.z]], false);
      const path = new RoutePath(this.world.network, legs, false);
      this.autopilotDriver = new RouteDriver(this.player, path, 0.8, 0, 24);
      this.say(`Autopilot: driving to ${target.spec.name}`);
    }
    const driver = this.autopilotDriver;
    const arrived = driver.path.length - driver.d < 12;
    driver.update(dt, this.cars, false, arrived);
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
    while (this.trees.size > this.treeBudget) this.trees.delete(this.trees.keys().next().value as number);
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
    if (deepest > 0) this.collisions.impulse(car, null, this.corner, this.normal, Math.min(deepest, 0.6));
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
      this.corner.set(b.position.x + cx * vx + cz * ux, b.position.y, b.position.z + cx * vz + cz * uz);
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
        .map((r, i) => ({ i, key: r.finishTime !== null ? -1e9 + r.finishTime : -r.progress.distance }))
        .sort((a, b) => a.key - b.key);
      let live: { label: string; value: string } | null = null;
      const elapsed = Math.max(0, this.time - run.start);
      if (run.event.spec.kind === 'speed-trap') live = { label: 'SPEED', value: `${Math.round(player.speed * 3.6)} KM/H` };
      else if (run.event.spec.kind === 'speed-zone')
        live = {
          label: 'AVERAGE',
          value: `${elapsed > 0.5 ? Math.round((p.progress.distance / elapsed) * 3.6) : 0} KM/H`,
        };
      else if (run.drift) live = { label: 'DRIFT', value: `${run.drift.live(this.time)}` };
      const gate = run.event.graph.spec.checkpoints[p.progress.checkpoint];
      let gatePoint: { x: number; z: number } | null = null;
      if (gate) {
        const edge = run.event.graph.spec.edges.find((x) => x.id === gate.edge);
        const point = edge?.points[Math.min(edge.points.length - 1, Math.round((gate.s / Math.max(1, run.event.graph.length(gate.edge))) * (edge.points.length - 1)))];
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
    };
  }
  /** Snapshot in the circuit frame layout (race fields neutral). */
  writeFrame(out: Float32Array, stepMs = 0, dropped = 0) {
    if (out.length !== HEADER + this.cars.length * CAR_STRIDE) throw new Error('Invalid snapshot buffer');
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
