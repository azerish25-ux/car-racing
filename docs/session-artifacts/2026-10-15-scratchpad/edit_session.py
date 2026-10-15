import sys
p = sys.argv[1]
s = open(p).read()


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:90], s.count(old))
    s = s.replace(old, new)


rep("""import { clamp, Vec3 } from '../../core/math.ts';
import { CollisionSolver } from '../collision.ts';""", """import { clamp, Vec3 } from '../../core/math.ts';
import { BikeVehicle, createVehicle, writeBikeBlock } from '../bike-vehicle.ts';
import { CollisionSolver } from '../collision.ts';""")
rep("""import {
  CAR_STRIDE,
  DEBRIS_BASE,""", """import {
  BIKE_BASE,
  CAR_STRIDE,
  DEBRIS_BASE,""")
rep("""import { trackPoint, type Track } from '../track.ts';
import { Vehicle } from '../vehicle.ts';
import { vehicleIndex, VEHICLES, type VehicleDefinition } from '../vehicles.ts';""", """import { DirtBikeVehicle } from '../offroad/dirt-bike-vehicle.ts';
import { isDirtBike } from '../offroad/dirt-bikes.ts';
import { trackPoint, type Track } from '../track.ts';
import type { Vehicle } from '../vehicle.ts';
import { vehicleIndex, VEHICLES } from '../vehicles.ts';
import { AmbientTraffic } from './ambient-traffic.ts';""")
rep("""import { asTrack, OpenWorldTrack, WORLD_SURFACE_NAMES } from './open-world-track.ts';""", """import { festivalAdmits, festivalCars, festivalDefaultVehicle, festivalVehicles } from './festival-machines.ts';
import { asTrack, OpenWorldTrack, WORLD_SURFACE_NAMES } from './open-world-track.ts';""")
rep("""import { RouteDriver } from './route-driver.ts';""", """import { RouteDriver, type RouteObstacle } from './route-driver.ts';""")
start = s.index("const COMPOUND_IDS = Object.keys(COMPOUNDS);")
end = s.index("export interface FreeRoamOptions {")
s = s[:start] + """const COMPOUND_IDS = Object.keys(COMPOUNDS);
// The festival's machine list lives with the registry helpers (the career
// and the HUD read it without loading the simulation).
export { festivalAdmits, festivalCars, festivalDefaultVehicle, festivalVehicles };

""" + s[end:]
rep("""  /** Events discovered in earlier sessions (the festival save); unknown
   * ids are ignored. */
  discovered?: readonly string[];
}""", """  /** Events discovered in earlier sessions (the festival save); unknown
   * ids are ignored. */
  discovered?: readonly string[];
  /** Session identity: event results carry `<session>:<run>` run ids, so a
   * consumer (the career) pays each run once. */
  session?: string;
  /** Ambient traffic on highways, country roads and towns (off by default
   * headless, so the scripted acceptance drives are unchanged; the festival
   * host turns it on). Off during events in any case. */
  traffic?: boolean;
}""")
rep("""  | { type: 'vehicle'; id: string }
  | { type: 'travel'; event: string };""", """  | { type: 'vehicle'; id: string }
  | { type: 'travel'; event: string }
  | { type: 'traffic'; value: boolean };""")
rep("""  message: string | null;
  streaming: TileCacheStats;
}""", """  message: string | null;
  streaming: TileCacheStats;
  /** Ambient traffic: the player's setting and the cars alive now (none
   * during events). */
  traffic: { enabled: boolean; cars: number };
}""")
rep("""  readonly results: FestivalResult[] = [];
  mode: FestivalMode = 'free';""", """  readonly results: FestivalResult[] = [];
  /** Ambient traffic (kinematic cars around the player in free roam). */
  readonly traffic: AmbientTraffic;
  trafficEnabled: boolean;
  mode: FestivalMode = 'free';""")
rep("""  private readonly located = { lateral: 0, distance: 0 };
  constructor(readonly options: FreeRoamOptions = {}) {""", """  private readonly located = { lateral: 0, distance: 0 };
  private readonly session: string;
  private runs = 0;
  private readonly obstacles: RouteObstacle[] = [];
  /** Seconds a riderless motorcycle has been down (bounded fallback reset). */
  private riderDown = 0;
  constructor(readonly options: FreeRoamOptions = {}) {""")
rep("""    this.assist = options.assist ?? 'sport';
    this.seed = options.seed ?? 73021;""", """    this.assist = options.assist ?? 'sport';
    this.seed = options.seed ?? 73021;
    this.session = options.session && options.session.length <= 80 ? options.session : `festival-${this.seed}`;
    this.traffic = new AmbientTraffic(this.world.network, this.seed);
    this.trafficEnabled = options.traffic === true;""")
rep("""  private makeCar(id: number, vehicleId: string) {
    const definition = Object.hasOwn(VEHICLES, vehicleId) ? VEHICLES[vehicleId] : VEHICLES[festivalDefaultVehicle()];
    return new Vehicle(id, 'medium', DEFAULT_SETUP, this.assist, definition);
  }""", """  /** The dynamics adapter for a festival machine: cars, road motorcycles
   * (BikeVehicle) and the supermoto (the off-road bike adapter, whose
   * vertical model runs on the region's ground). */
  private makeCar(id: number, vehicleId: string): Vehicle {
    const definition =
      Object.hasOwn(VEHICLES, vehicleId) && festivalAdmits(VEHICLES[vehicleId]) ? VEHICLES[vehicleId] : VEHICLES[festivalDefaultVehicle()];
    if (isDirtBike(definition)) return new DirtBikeVehicle(id, 'medium', DEFAULT_SETUP, this.assist, definition);
    return createVehicle(id, 'medium', DEFAULT_SETUP, this.assist, definition);
  }""")
rep("""    for (const t of car.tires) t.omega = 0;
    car.retired = false;
    car.upsetClock = 0;""", """    for (const t of car.tires) t.omega = 0;
    car.retired = false;
    car.upsetClock = 0;
    // A motorcycle's pose is its dynamics state: place that, the body follows.
    if (car instanceof BikeVehicle) car.placeFree(this.asTrack, x, z, heading, ground);""")
rep("""      case 'vehicle': {
        if (!Object.hasOwn(VEHICLES, cmd.id) || VEHICLES[cmd.id].dynamicsKind !== 'four-wheel')
          throw new Error(`Vehicle ${cmd.id} cannot run in the festival`);""", """      case 'vehicle': {
        if (!Object.hasOwn(VEHICLES, cmd.id) || !festivalAdmits(VEHICLES[cmd.id]))
          throw new Error(`Vehicle ${cmd.id} cannot run in the festival`);""")
rep("""        this.say(`Travelled to ${event.spec.name}`);
        break;
      }
    }
  }""", """        this.say(`Travelled to ${event.spec.name}`);
        break;
      }
      case 'traffic':
        this.trafficEnabled = !!cmd.value;
        if (!this.trafficEnabled) this.traffic.clear();
        this.say(this.trafficEnabled ? 'Traffic on' : 'Traffic off');
        break;
    }
  }""")
rep("""  /** Rival machines: registry cars of the player's class first (data-driven),
   * deterministic per event and seed. Showcase: the fastest registry car. */
  private rivalVehicles(event: FestivalEvent, count: number) {
    const all = festivalVehicles(),
      own = this.player.definition;
    if (event.spec.kind === 'showcase')
      return [all.reduce((best, d) => (d.ai.topSpeed > best.ai.topSpeed ? d : best), all[0]).id];
    const same = all.filter((d) => d.classId === own.classId),
      pool = same.length ? same : all;""", """  /** Rival machines: registry machines of the player's class first
   * (data-driven; riders race riders), deterministic per event and seed.
   * Showcase: the fastest registry car. */
  private rivalVehicles(event: FestivalEvent, count: number) {
    const own = this.player.definition,
      all = own.dynamicsKind === 'bike' ? festivalVehicles().filter((d) => d.dynamicsKind === 'bike') : festivalCars();
    if (event.spec.kind === 'showcase') {
      const cars = festivalCars();
      return [cars.reduce((best, d) => (d.ai.topSpeed > best.ai.topSpeed ? d : best), cars[0]).id];
    }
    const same = all.filter((d) => d.classId === own.classId),
      pool = same.length ? same : all;""")
rep("""  private startEvent(event: FestivalEvent) {
    this.endRun();
    this.cardEvent = null;""", """  private startEvent(event: FestivalEvent) {
    this.endRun();
    this.cardEvent = null;
    // Ambient traffic is off while an event runs (it returns in free roam).
    this.traffic.clear();
    this.runs++;""")
rep("""    const result: FestivalResult = {
      kind: 'festival-result',
      version: 1,
      regionId: this.world.region.id,""", """    const result: FestivalResult = {
      kind: 'festival-result',
      version: 2,
      runId: `${this.session}:${this.runs}`,
      regionId: this.world.region.id,""")
rep("""    // Physics: two substeps, car contacts, rails and static colliders.
    // Finished rivals are out of the race: no car contact with them.
    const track = this.asTrack,
      contact = run ? this.cars.filter((c, i) => i === 0 || run.participants[i]?.finishTime === null) : this.cars;
    for (let sub = 0; sub < 2; sub++) {
      for (const c of this.cars) c.step(dt * 0.5, track);
      this.collisions.solve(contact, track);
      for (const c of this.cars) this.collideStatic(c);
    }
    this.track.evolve(dt, this.time);""", """    // Physics: two substeps, car contacts, rails and static colliders.
    // Finished rivals are out of the race: no car contact with them.
    const track = this.asTrack,
      contact = run ? this.cars.filter((c, i) => i === 0 || run.participants[i]?.finishTime === null) : this.cars;
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
    this.track.evolve(dt, this.time);""")
rep("""    this.upset = player.up.y < 0.3 && player.speed < 6 ? this.upset + dt : 0;""", """    // A motorcycle's fall is its own state (slide, rider jogs back, push,
    // remount: bounded); only a rider down far longer than that is reset.
    const rider = player instanceof BikeVehicle ? player : null;
    this.riderDown = rider && !rider.riding ? this.riderDown + dt : 0;
    this.upset = !rider && player.up.y < 0.3 && player.speed < 6 ? this.upset + dt : 0;""")
rep("""    if (this.upset > 2) this.resetToRoad(0, 'Recovered to the road');""", """    if (this.upset > 2 || this.riderDown > 20) this.resetToRoad(0, 'Recovered to the road');""")
rep("""    const driver = this.autopilotDriver;
    const arrived = driver.path.length - driver.d < 12;
    driver.update(dt, this.cars, false, arrived);""", """    const driver = this.autopilotDriver;
    const arrived = driver.path.length - driver.d < 12;
    // Keep its distance from the ambient traffic too.
    const obstacles = this.obstacles;
    obstacles.length = 0;
    for (const c of this.cars) obstacles.push(c);
    if (this.trafficEnabled) for (const c of this.traffic.cars) obstacles.push(c);
    driver.update(dt, obstacles, false, arrived);""")
rep("""      message: this.message,
      streaming: { ...this.track.tiles.stats },
    };""", """      message: this.message,
      streaming: { ...this.track.tiles.stats },
      traffic: { enabled: this.trafficEnabled, cars: this.traffic.cars.length },
    };""")
rep("""  makeFrame() {
    return this.writeFrame(new Float32Array(HEADER + this.cars.length * CAR_STRIDE));
  }""", """  makeFrame() {
    return this.writeFrame(new Float32Array(HEADER + this.cars.length * CAR_STRIDE));
  }
  /** The ambient traffic block that goes with a frame (ambient-traffic.ts). */
  trafficFrame() {
    return this.traffic.writeSnapshot();
  }""")
rep("""  out[o + RACE_BASE + R.VEHICLE] = vehicleIndex(c.definition.id);""", """  out[o + RACE_BASE + R.VEHICLE] = vehicleIndex(c.definition.id);
  // Motorcycle block (lean, rider, suspension) for the bike presentation.
  if (c instanceof BikeVehicle) writeBikeBlock(out, o + BIKE_BASE, c);""")
open(p, 'w').write(s)
print('ok')
