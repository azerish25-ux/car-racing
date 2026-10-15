// Seeded AI motorcycle races (WP35): eight AI riders on each circuit, the
// production simulation at 120 Hz. Asserts every rider is classified, no
// rider is ever parked for long, and incidents stay bounded. Writes
// docs/bike-race.json; exits 1 when an assertion fails.
import { writeFileSync } from 'node:fs';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;
const races: Partial<SessionOptions>[] = [
  { circuit: 'aurel', vehicles: Array(8).fill('gpr1'), seed: 3303 },
  { circuit: 'vellamar', vehicles: Array(8).fill('sbk1000'), seed: 77 },
  {
    circuit: 'aurel',
    vehicles: Array.from({ length: 8 }, (_, i) => (i % 2 ? 'sbk1000' : 'gpr1')),
    seed: 2024,
    weather: 'rain',
  },
];
const failures: string[] = [];
const results = races.map((race) => {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    ruleset: 'gp-motorcycle',
    laps: 3,
    opponents: 7,
    ...race,
  });
  sim.autoPlayer = true;
  const stopped = new Float64Array(8);
  let longestStop = 0,
    t = 0;
  const start = performance.now();
  for (; t < 1200 && sim.race.phase !== PHASE.FINISHED; t += DT) {
    sim.step(DT);
    if (sim.race.phase !== PHASE.RACING) continue;
    sim.cars.forEach((c, id) => {
      stopped[id] = c.speed < 1 && !c.finishTime && !c.inPit ? stopped[id] + DT : 0;
      longestStop = Math.max(longestStop, stopped[id]);
    });
  }
  const crashes = sim.cars.map((c) => (c as BikeVehicle).dynamics.crashes);
  const label = `${race.circuit} ${race.weather ?? 'clear'} seed ${race.seed}`;
  if (sim.race.phase !== PHASE.FINISHED) failures.push(`${label}: race did not finish`);
  if (sim.cars.some((c) => !(c.finishTime > 0) || c.retired))
    failures.push(`${label}: a rider was not classified`);
  if (longestStop >= 20) failures.push(`${label}: a rider was parked ${longestStop.toFixed(1)} s`);
  if (crashes.reduce((a, b) => a + b, 0) > 6) failures.push(`${label}: too many crashes`);
  const result = {
    circuit: race.circuit,
    weather: race.weather ?? 'clear',
    seed: race.seed,
    vehicles: race.vehicles,
    raceSeconds: sim.race.raceTime,
    wallSeconds: (performance.now() - start) / 1000,
    finishTimes: sim.cars.map((c) => c.finishTime),
    bestLaps: sim.race.laps.map((l) => l.best),
    crashes,
    trackLimitWarnings: sim.race.laps.map((l) => l.warnings),
    penalties: sim.race.laps.map((l) => l.penalty),
    incidents: sim.race.control.events.filter((e) => e.kind === 'incident').length,
    safetyCarDeployments: sim.race.safetyCar.deployments,
    longestStopSeconds: longestStop,
  };
  console.log(
    `${label}: finished ${sim.race.phase === PHASE.FINISHED} in ${sim.race.raceTime.toFixed(1)} s, crashes ${crashes.join(',')}, best ${Math.min(...result.bestLaps.filter((b) => b > 0)).toFixed(2)} s`,
  );
  return result;
});
writeFileSync(
  'docs/bike-race.json',
  JSON.stringify({ passed: failures.length === 0, failures, races: results }, null, 2) + '\n',
);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
