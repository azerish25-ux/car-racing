// Festival region acceptance (npm run test:open-world): builds the region,
// validates the road network and every event route, drives AI cars along
// long road-network routes on the real world surface (asserting legal
// progress without getting stuck and the physics tile budget), runs one
// race against route-following rivals, and writes docs/open-world.json.
import { writeFileSync } from 'node:fs';
import { CollisionSolver } from '../src/simulation/collision.ts';
import { resolveEvents, type FestivalEvent } from '../src/simulation/open-world/festival-events.ts';
import { asTrack, OpenWorldTrack, WORLD_SURFACE_NAMES } from '../src/simulation/open-world/open-world-track.ts';
import { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { festivalDefaultVehicle, OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import type { TileCacheStats } from '../src/simulation/open-world/terrain-tiles.ts';
import { OpenWorld } from '../src/simulation/open-world/world.ts';
import { surfaceSample } from '../src/simulation/track.ts';
import { RouteProgress, validateRoute } from '../src/simulation/route-graph.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { vehicleDefinition } from '../src/simulation/vehicles.ts';

const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
};
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

const started = performance.now();
const world = new OpenWorld();
const network = world.network.stats();
const routeErrors = validateRoute(world.network.routeSpec());
check(2 * world.region.half >= 8000, `region is ${round((2 * world.region.half) / 1000, 2)} km square (>= 8 km)`);
check(network.totalKm >= 60, `road network ${network.totalKm} km (>= 60 km)`);
check(routeErrors.length === 0, `network RouteGraph valid (${routeErrors.length} errors)`);
const events = resolveEvents(world);
check(events.length === world.region.events.length, `${events.length} event routes planned and validated`);

interface DriveReport {
  route: string;
  vehicle: string;
  lengthKm: number;
  finished: boolean;
  timeS: number;
  averageKmh: number;
  topKmh: number;
  legalKm: number;
  offRouteS: number;
  longestStallS: number;
  resetRequests: number;
  surfacesS: Record<string, number>;
  tiles: TileCacheStats;
  wallMs: number;
}
/** One AI car alone on an event route: progress every 5 s must grow. */
function drive(event: FestivalEvent, vehicleId: string, budget: number): DriveReport {
  const track = new OpenWorldTrack(world, 'clear', undefined, budget),
    physics = asTrack(track),
    path = event.path;
  const car = new Vehicle(0, 'medium', undefined, 'sport', vehicleDefinition(vehicleId));
  const p = pathPoint();
  path.at(4, p);
  const ground = track.groundHeight(p.x, p.z, p.y + 0.5);
  car.body.position.set(p.x, ground + 0.62, p.z);
  car.body.orientation.yaw(Math.atan2(p.tx, p.tz));
  const driver = new RouteDriver(car, path, 0.9),
    progress = new RouteProgress(event.graph, path.maxHalfWidth() + 8),
    collisions = new CollisionSolver();
  const surfaces: Record<string, number> = {};
  let time = 0,
    offRoute = 0,
    top = 0,
    resets = 0,
    lastProgress = 0,
    lastProgressAt = 0,
    stall = 0;
  const wall = performance.now();
  const dt = 1 / 120;
  for (let tick = 0; tick < 120 * 1500; tick++) {
    driver.update(dt, [car]);
    for (let sub = 0; sub < 2; sub++) {
      car.step(dt / 2, physics);
      collisions.solve([car], physics);
    }
    track.evolve(dt, time);
    time += dt;
    top = Math.max(top, car.speed);
    if (tick % 30 === 0) {
      track.tiles.want(car.body.position.x, car.body.position.z, car.body.velocity.x, car.body.velocity.z, 2.5);
      const b = car.body.position;
      progress.update({ x: b.x, y: b.y, z: b.z });
      if (progress.offRoute) offRoute += 0.25;
      track.sample(b.x, b.z, SAMPLE, b.y);
      const name = WORLD_SURFACE_NAMES[track.query.surface];
      surfaces[name] = (surfaces[name] ?? 0) + 0.25;
    }
    track.tiles.prefetch(tick % 2 ? 0 : 1.5);
    if (driver.wantsReset) {
      resets++;
      driver.relocate();
    }
    if (time - lastProgressAt >= 5) {
      if (progress.distance - lastProgress < 30) stall += time - lastProgressAt;
      else stall = 0;
      lastProgress = progress.distance;
      lastProgressAt = time;
      if (stall > 30) break;
    }
    if (progress.finished) break;
  }
  return {
    route: event.spec.id,
    vehicle: vehicleId,
    lengthKm: round(path.length / 1000, 2),
    finished: progress.finished,
    timeS: round(time),
    averageKmh: round((progress.distance / time) * 3.6),
    topKmh: round(top * 3.6),
    legalKm: round(progress.distance / 1000, 2),
    offRouteS: round(offRoute),
    longestStallS: round(stall),
    resetRequests: resets,
    surfacesS: Object.fromEntries(Object.entries(surfaces).map(([k, v]) => [k, round(v)])),
    tiles: { ...track.tiles.stats },
    wallMs: Math.round(performance.now() - wall),
  };
}
const SAMPLE = surfaceSample();

const vehicle = festivalDefaultVehicle();
const long = events.find((e) => e.spec.id === 'coast-to-summit')!;
const dirt = events.find((e) => e.spec.id === 'thornwood-rally')!;
const drives = [drive(long, vehicle, 24), drive(dirt, vehicle, 24)];
for (const d of drives) {
  console.log(
    `${d.route}: ${d.lengthKm} km in ${d.timeS} s (${d.averageKmh} km/h avg, ${d.topKmh} top), off-route ${d.offRouteS} s, resets ${d.resetRequests}, tiles peak ${d.tiles.peakResident}/${d.tiles.budget}, stalls ${d.tiles.stalls}`,
  );
  check(d.finished, `${d.route}: AI finished the route`);
  check(d.longestStallS < 15, `${d.route}: never stuck (longest stall ${d.longestStallS} s)`);
  check(d.resetRequests === 0, `${d.route}: no reset needed`);
  check(d.offRouteS < 5, `${d.route}: stayed on the legal route (${d.offRouteS} s off)`);
  check(d.tiles.peakResident <= d.tiles.budget, `${d.route}: physics tiles within budget (${d.tiles.peakResident}/${d.tiles.budget})`);
}
check(drives[0].lengthKm >= 10, `long route is ${drives[0].lengthKm} km (>= 10 km)`);

// A race through the session: rivals follow the route, the result is typed.
const sim = new OpenWorldSimulation({ vehicle });
sim.command({ type: 'autopilot', value: true });
sim.command({ type: 'start', event: 'valley-sprint' });
let race = null;
for (let i = 0; i < 120 * 200 && !race; i++) {
  sim.step(1 / 120);
  race = sim.takeResult();
}
check(!!race?.completed, 'valley sprint race completed with a typed result');
check((race?.standings.filter((s) => s.time !== null).length ?? 0) >= (race?.entrants ?? 1) - 1, 'rivals finished the race route');

const report = {
  generatedBy: 'npm run test:open-world',
  region: {
    id: world.region.id,
    name: world.region.name,
    sizeKm: round((2 * world.region.half) / 1000, 3),
    seed: world.region.seed,
    buildMs: Math.round(world.buildMs),
  },
  network,
  events: events.map((e) => ({
    id: e.spec.id,
    kind: e.spec.kind,
    lengthKm: round(e.path.length / 1000, 2),
    laps: e.laps,
    legs: e.path.legs.length,
    checkpoints: e.graph.spec.checkpoints.length,
  })),
  drives,
  race: race && {
    event: race.eventId,
    completed: race.completed,
    position: race.position,
    entrants: race.entrants,
    timeS: race.time && round(race.time),
    standings: race.standings.map((s) => ({ name: s.name, vehicle: s.vehicleId, timeS: s.time && round(s.time, 2) })),
  },
  failures,
  wallMs: Math.round(performance.now() - started),
};
writeFileSync(new URL('../docs/open-world.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(failures.length ? `${failures.length} failure(s)` : 'Open world acceptance passed', '→ docs/open-world.json');
if (failures.length) process.exitCode = 1;
