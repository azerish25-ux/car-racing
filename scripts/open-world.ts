// Festival region acceptance (npm run test:open-world): builds the region,
// validates the road network and every event route, drives AI cars along
// long road-network routes on the real world surface (asserting legal
// progress without getting stuck and the physics tile budget), runs one
// race against route-following rivals, and writes docs/open-world.json.
// Those drives and the race run with ambient traffic off (the session's
// headless default), so their results do not depend on it; traffic and
// motorcycles are measured separately afterwards.
import { writeFileSync } from 'node:fs';
import { CollisionSolver } from '../src/simulation/collision.ts';
import { resolveEvents, type FestivalEvent } from '../src/simulation/open-world/festival-events.ts';
import { TRAFFIC } from '../src/simulation/open-world/ambient-traffic.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
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

// --- Ambient traffic (measured separately: free roam, autopilot cruise) ---
function trafficDrive(seconds: number, seed = 73021) {
  const sim = new OpenWorldSimulation({ vehicle, traffic: true, seed, tileBudget: 24 });
  const traffic = sim.traffic;
  let trafficMs = 0,
    stepMs = 0,
    peak = 0,
    closest = Infinity,
    overCap = 0;
  const seen = new Set<number>();
  const step = traffic.step.bind(traffic);
  traffic.step = (dt, player) => {
    const t = performance.now();
    step(dt, player);
    trafficMs += performance.now() - t;
  };
  sim.command({ type: 'autopilot', value: true });
  for (let i = 0; i < seconds * 120; i++) {
    const t = performance.now();
    sim.step(1 / 120);
    stepMs += performance.now() - t;
    if (!sim.autopilot && i % 600 === 0) sim.command({ type: 'autopilot', value: true });
    const p = sim.player.body.position;
    peak = Math.max(peak, traffic.cars.length);
    for (const c of traffic.cars)
      if (!seen.has(c.id)) {
        seen.add(c.id);
        closest = Math.min(closest, Math.hypot(c.position.x - p.x, c.position.z - p.z));
      }
    if (i % 60 === 0)
      for (const [key, n] of traffic.tileCounts()) overCap = Math.max(overCap, n - traffic.capOf(key));
  }
  const steps = seconds * 120;
  return {
    seconds,
    peakCars: peak,
    capCars: TRAFFIC.maxCars,
    perTileCap: TRAFFIC.perTile,
    worstOverTileCap: overCap,
    spawned: traffic.spawned,
    despawned: traffic.despawned,
    collisions: traffic.collisions,
    closestSpawnM: round(closest),
    trafficMsPerStep: round(trafficMs / steps, 4),
    sessionMsPerStep: round(stepMs / steps, 4),
    digest: traffic.digest(),
  };
}
const trafficReport = trafficDrive(120);
const repeat = trafficDrive(30),
  repeatAgain = trafficDrive(30);
console.log(
  `traffic: peak ${trafficReport.peakCars}/${trafficReport.capCars} cars, ${trafficReport.spawned} spawned, closest spawn ${trafficReport.closestSpawnM} m, ${trafficReport.collisions} collisions, ${trafficReport.trafficMsPerStep} ms/step traffic of ${trafficReport.sessionMsPerStep} ms/step session`,
);
check(trafficReport.peakCars > 0 && trafficReport.peakCars <= TRAFFIC.maxCars, `traffic within the total cap (peak ${trafficReport.peakCars}/${TRAFFIC.maxCars})`);
check(trafficReport.closestSpawnM >= TRAFFIC.spawnMin - 2, `traffic spawns beyond ${TRAFFIC.spawnMin} m of the player (closest ${trafficReport.closestSpawnM} m)`);
check(repeat.digest === repeatAgain.digest, `traffic is deterministic (digest ${repeat.digest} twice)`);
check(trafficReport.trafficMsPerStep < 0.25, `traffic is cheap (${trafficReport.trafficMsPerStep} ms per 120 Hz step in Node)`);

// --- Motorcycles (measured separately) -----------------------------------
function bikeRace(bike: string, eventId: string) {
  const sim = new OpenWorldSimulation({ vehicle: bike, tileBudget: 24 });
  sim.command({ type: 'autopilot', value: true });
  sim.command({ type: 'start', event: eventId });
  const falls = sim.cars.map(() => 0),
    riding = sim.cars.map(() => true);
  let result = null;
  for (let i = 0; i < 120 * 400 && !result; i++) {
    sim.step(1 / 120);
    sim.cars.forEach((c, k) => {
      const now = c instanceof BikeVehicle ? c.riding : true;
      if (riding[k] && !now) falls[k]++;
      riding[k] = now;
    });
    result = sim.takeResult();
  }
  return {
    bike,
    event: eventId,
    completed: !!result?.completed,
    timeS: result?.time != null ? round(result.time) : null,
    finishers: result?.standings.filter((s) => s.time !== null).length ?? 0,
    entrants: result?.entrants ?? 0,
    playerFalls: falls[0],
    rivalFalls: falls.slice(1).reduce((a, b) => a + b, 0),
  };
}
function bikeRoam(bike: string, seconds: number) {
  const sim = new OpenWorldSimulation({ vehicle: bike, tileBudget: 24 });
  sim.command({ type: 'autopilot', value: true });
  let falls = 0,
    riding = true,
    distance = 0,
    last = { x: sim.player.body.position.x, z: sim.player.body.position.z };
  for (let i = 0; i < seconds * 120; i++) {
    sim.step(1 / 120);
    if (!sim.autopilot && i % 600 === 0) sim.command({ type: 'autopilot', value: true });
    const b = sim.player as BikeVehicle,
      p = b.body.position;
    distance += Math.hypot(p.x - last.x, p.z - last.z);
    last = { x: p.x, z: p.z };
    if (riding && !b.riding) falls++;
    riding = b.riding;
  }
  return { bike, seconds, distanceKm: round(distance / 1000, 2), falls };
}
const bikes = {
  roam: ['sbk1000', 'nr900', 'sm450'].map((b) => bikeRoam(b, 120)),
  races: [bikeRace('sbk1000', 'valley-sprint'), bikeRace('sm450', 'thornwood-rally')],
};
for (const r of bikes.roam) {
  console.log(`bike roam ${r.bike}: ${r.distanceKm} km in ${r.seconds} s, ${r.falls} falls`);
  check(r.falls === 0, `${r.bike}: rode ${r.seconds} s of free roam on the autopilot without a fall`);
}
for (const r of bikes.races) {
  console.log(`bike race ${r.bike} ${r.event}: ${r.completed ? `${r.timeS} s` : 'not completed'}, ${r.finishers}/${r.entrants} finished, falls ${r.playerFalls} + ${r.rivalFalls}`);
  check(r.completed && r.finishers === r.entrants, `${r.bike}: ${r.event} completed by every rider`);
}

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
  traffic: { drive: trafficReport, repeatDigests: [repeat.digest, repeatAgain.digest] },
  bikes,
  failures,
  wallMs: Math.round(performance.now() - started),
};
writeFileSync(new URL('../docs/open-world.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(failures.length ? `${failures.length} failure(s)` : 'Open world acceptance passed', '→ docs/open-world.json');
if (failures.length) process.exitCode = 1;
