// Motorcycle class clearance (catalogue wave 2 review): a seeded AI race for
// every motorcycle race class on every bike-safe circuit. Geometry alone
// (bikeSafetyReport: run-off, barrier distance, kerbs) does not show that a
// class can ride a circuit: the classic class falls in tight hairpins that
// the modern classes take cleanly. A class is cleared on a circuit when its
// race passes the test:bikes criteria (finished, every rider classified, no
// rider parked 20 s, at most 6 falls). CircuitDefinition.bikeClasses must
// list exactly the cleared classes; the motorcycle rulesets and the bike
// career admit only those. Writes docs/bike-clearance.json; exits 1 when a
// declared class fails or a passing class is not declared.
//   node --experimental-transform-types scripts/bike-clearance.ts [--jobs N] [circuit,...]
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { CIRCUITS, CIRCUIT_IDS, type CircuitId } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { BIKE_RACE_CLASSES } from '../src/simulation/events.ts';
import { PHASE } from '../src/simulation/race.ts';
import { classInfo } from '../src/simulation/vehicle-classes.ts';
import { VEHICLE_IDS, VEHICLES } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120,
  LAPS = 3,
  RIDERS = 8;
const CRITERIA = Object.freeze({ parkedSecondsBelow: 20, fallsAtMost: 6 });
/** One race per (circuit, class): the class's registered machines in turn. */
const field = (cls: string) => {
  const ids = VEHICLE_IDS.filter((id) => VEHICLES[id].classId === cls);
  return Array.from({ length: RIDERS }, (_, i) => ids[i % ids.length]);
};
const seedOf = (circuit: string, cls: string) =>
  32000 + CIRCUIT_IDS.indexOf(circuit as CircuitId) * 10 + BIKE_RACE_CLASSES.indexOf(cls as never);

function race(circuit: string, cls: string) {
  const vehicles = field(cls),
    ruleset = classInfo(cls).raceRuleset!,
    seed = seedOf(circuit, cls);
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    circuit: circuit as CircuitId,
    ruleset,
    laps: LAPS,
    opponents: RIDERS - 1,
    vehicles,
    seed,
  });
  sim.autoPlayer = true;
  const stopped = new Float64Array(RIDERS);
  let longestStop = 0;
  const start = performance.now();
  for (let t = 0; t < 1200 && sim.race.phase !== PHASE.FINISHED; t += DT) {
    sim.step(DT);
    if (sim.race.phase !== PHASE.RACING) continue;
    sim.cars.forEach((c, id) => {
      stopped[id] = c.speed < 1 && !c.finishTime && !c.inPit ? stopped[id] + DT : 0;
      longestStop = Math.max(longestStop, stopped[id]);
    });
  }
  const falls = sim.cars.map((c) => (c as BikeVehicle).dynamics.crashes),
    fallTotal = falls.reduce((a, b) => a + b, 0),
    finished = sim.race.phase === PHASE.FINISHED,
    classified = sim.cars.every((c) => c.finishTime > 0 && !c.retired),
    bests = sim.race.laps.map((l) => l.best).filter((b) => b > 0);
  return {
    circuit,
    class: cls,
    ruleset,
    vehicles,
    seed,
    laps: LAPS,
    passed:
      finished &&
      classified &&
      longestStop < CRITERIA.parkedSecondsBelow &&
      fallTotal <= CRITERIA.fallsAtMost,
    finished,
    classified,
    falls,
    fallTotal,
    longestStopSeconds: Number(longestStop.toFixed(2)),
    raceSeconds: Number(sim.race.raceTime.toFixed(2)),
    bestLapS: bests.length ? Number(Math.min(...bests).toFixed(3)) : null,
    wallSeconds: Number(((performance.now() - start) / 1000).toFixed(1)),
  };
}
type Result = ReturnType<typeof race>;

const argv = process.argv.slice(2);
const worker = argv.indexOf('--worker');
if (worker >= 0) {
  // A worker races the pairs it is handed and prints one JSON line each.
  for (const pair of argv[worker + 1].split(';')) {
    const [circuit, cls] = pair.split('|');
    console.log(JSON.stringify(race(circuit, cls)));
  }
} else {
  const jobsAt = argv.indexOf('--jobs'),
    jobs =
      jobsAt >= 0 ? Number(argv[jobsAt + 1]) : Math.max(1, Math.min(4, availableParallelism())),
    requested = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--jobs');
  const circuits = (requested ? requested.split(',') : [...CIRCUIT_IDS]).filter(
    (id) => CIRCUITS[id as CircuitId]?.bikeSafe,
  );
  const pairs = circuits.flatMap((c) => BIKE_RACE_CLASSES.map((cls) => `${c}|${cls}`));
  const shards = Array.from({ length: jobs }, (_, k) => pairs.filter((_, i) => i % jobs === k));
  const script = fileURLToPath(import.meta.url);
  const results: Result[] = [];
  await Promise.all(
    shards
      .filter((s) => s.length)
      .map(
        (shard) =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [...process.execArgv, script, '--worker', shard.join(';')],
              { stdio: ['ignore', 'pipe', 'inherit'] },
            );
            let buffer = '';
            child.stdout.on('data', (chunk: Buffer) => {
              buffer += chunk.toString();
              let line: number;
              while ((line = buffer.indexOf('\n')) >= 0) {
                const text = buffer.slice(0, line);
                buffer = buffer.slice(line + 1);
                if (!text.startsWith('{')) continue;
                const r = JSON.parse(text) as Result;
                results.push(r);
                console.log(
                  `${r.passed ? 'PASS' : 'FAIL'} ${r.circuit.padEnd(20)} ${r.class.padEnd(13)} falls ${r.fallTotal} parked ${r.longestStopSeconds} s best ${r.bestLapS} s`,
                );
              }
            });
            child.on('exit', (code) =>
              code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)),
            );
          }),
      ),
  );
  const order = (r: Result) => pairs.indexOf(`${r.circuit}|${r.class}`);
  results.sort((a, b) => order(a) - order(b));
  const cleared = Object.fromEntries(
    circuits.map((c) => [
      c,
      BIKE_RACE_CLASSES.filter((cls) =>
        results.some((r) => r.circuit === c && r.class === cls && r.passed),
      ),
    ]),
  );
  const failures: string[] = [];
  for (const c of circuits) {
    const declared = CIRCUITS[c as CircuitId].bikeClasses ?? [];
    for (const cls of declared)
      if (!cleared[c].includes(cls as never))
        failures.push(`${c}: ${cls} is declared in bikeClasses but its seeded race fails`);
    for (const cls of cleared[c])
      if (!declared.includes(cls))
        failures.push(`${c}: ${cls} passes but is not declared in bikeClasses`);
  }
  if (!requested)
    writeFileSync(
      'docs/bike-clearance.json',
      JSON.stringify(
        {
          description:
            'Seeded AI motorcycle races, one per motorcycle race class on every bike-safe circuit (production simulation at 120 Hz, no assists beyond the default). A class is cleared on a circuit when its race passes the criteria; CircuitDefinition.bikeClasses lists exactly the cleared classes.',
          generatedBy: 'npm run test:bike-clearance',
          criteria: { laps: LAPS, riders: RIDERS, ...CRITERIA, everyRiderClassified: true },
          passed: failures.length === 0,
          failures,
          cleared,
          results,
        },
        null,
        2,
      ) + '\n',
    );
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}
