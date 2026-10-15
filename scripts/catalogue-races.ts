// Seeded AI race on every circuit-catalogue layout (WP29/WP30 acceptance
// evidence): the production simulation, AI, race control and lap timing drive
// a full field with no teleport, grip bonus or pose override. Asserts every car
// classifies, nothing is stuck, laps are valid-length and lap times plausible.
// Writes docs/circuit-catalogue-races.json.
//   node --experimental-transform-types scripts/catalogue-races.ts [ids] [--laps N] [--cars N]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { CATALOGUE_CIRCUIT_IDS } from '../src/simulation/circuit-catalogue/venue-data.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};
const laps = flag('--laps', 2),
  cars = flag('--cars', 6),
  seed = 29030;
const requested = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const ids = requested ? requested.split(',') : [...CATALOGUE_CIRCUIT_IDS];
/** Plausible best-lap average speed band for the Formula field (km/h). */
const PLAUSIBLE_KMH = [90, 320] as const;
/** A car below 1 m/s on track (not serviced, not finished) this long is stuck. */
const STUCK_SECONDS = 8;

const reports = [];
for (const id of ids) {
  const circuit = CIRCUITS[id as keyof typeof CIRCUITS];
  if (!circuit) throw new Error(`Unknown circuit ${id}`);
  const started = performance.now();
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit: circuit.id,
    mode: 'race',
    laps,
    opponents: cars - 1,
    weather: 'clear',
    seed,
  });
  sim.autoPlayer = true;
  const stuck = new Float64Array(cars),
    worstStuck = new Float64Array(cars);
  let maximumImpact = 0,
    maximumSpeed = 0,
    airborne = 0;
  const failures: string[] = [];
  const timeout = 120 * Math.max(240, (sim.track.length / 25) * (laps + 1));
  for (let tick = 0; tick < timeout && sim.race.phase !== PHASE.FINISHED; tick++) {
    sim.step(1 / 120);
    for (const car of sim.cars) {
      if (!(car.body.position.finite() && car.body.omega.finite())) {
        failures.push(`car ${car.id}: non-finite rigid state`);
        break;
      }
      maximumImpact = Math.max(maximumImpact, car.impact);
      maximumSpeed = Math.max(maximumSpeed, car.speed);
      if (sim.race.phase === PHASE.RACING && car.tires.every((t) => t.compression <= 0))
        airborne += 1 / 120;
      const racing = sim.race.phase === PHASE.RACING && !car.finishTime && !car.inPit;
      if (racing && sim.race.time > sim.race.greenAt + 5 && car.speed < 1) {
        stuck[car.id] += 1 / 120;
        worstStuck[car.id] = Math.max(worstStuck[car.id], stuck[car.id]);
      } else stuck[car.id] = 0;
    }
    if (failures.length) break;
  }
  if (sim.race.phase !== PHASE.FINISHED) failures.push('race did not finish before the timeout');
  const classification = sim.race.order.map((carId) => {
    const lap = sim.race.laps[carId];
    return {
      id: carId,
      laps: lap.completed,
      best: lap.best,
      finishTime: sim.cars[carId].finishTime,
      retired: sim.cars[carId].retired,
      penalty: lap.penalty,
      warnings: lap.warnings,
      worstStuckSeconds: worstStuck[carId],
    };
  });
  for (const c of classification) {
    if (c.retired) failures.push(`car ${c.id} retired`);
    if (c.laps < laps) failures.push(`car ${c.id} completed ${c.laps}/${laps} laps`);
    if (c.worstStuckSeconds > STUCK_SECONDS)
      failures.push(`car ${c.id} stuck ${c.worstStuckSeconds.toFixed(1)} s`);
    const kmh = c.best > 0 ? (sim.track.length / c.best) * 3.6 : 0;
    if (!(kmh >= PLAUSIBLE_KMH[0] && kmh <= PLAUSIBLE_KMH[1]))
      failures.push(
        `car ${c.id} best lap ${c.best.toFixed(2)} s (${kmh.toFixed(0)} km/h) implausible`,
      );
  }
  const bests = classification.map((c) => c.best).filter((b) => b > 0);
  const report = {
    id,
    name: circuit.name,
    group: circuit.catalogue?.group ?? 'original',
    lengthM: Math.round(sim.track.length),
    referenceLengthM: circuit.catalogue?.referenceLength ?? null,
    laps,
    cars,
    seed,
    passed: failures.length === 0,
    failures,
    bestLapS: bests.length ? Math.min(...bests) : null,
    slowestBestLapS: bests.length ? Math.max(...bests) : null,
    bestLapAverageKmh: bests.length
      ? ((sim.track.length / Math.min(...bests)) * 3.6).toFixed(1)
      : null,
    raceTimeS: Number(sim.race.raceTime.toFixed(2)),
    maximumSpeedKmh: Number((maximumSpeed * 3.6).toFixed(1)),
    maximumImpact: Number(maximumImpact.toFixed(3)),
    airborneCarSeconds: Number(airborne.toFixed(2)),
    wallSeconds: Number(((performance.now() - started) / 1000).toFixed(1)),
    classification,
  };
  reports.push(report);
  console.log(
    `${report.passed ? 'PASS' : 'FAIL'} ${id.padEnd(22)} ${report.lengthM} m best ${report.bestLapS?.toFixed(2)} s (${report.bestLapAverageKmh} km/h) impact ${report.maximumImpact} air ${report.airborneCarSeconds} s ${report.wallSeconds} s ${failures.join('; ')}`,
  );
}
const sources = [
  'src/simulation/circuits.ts',
  'src/simulation/track.ts',
  'src/simulation/ai.ts',
  'src/simulation/circuit-catalogue/builder.ts',
  'src/simulation/circuit-catalogue/real-world.ts',
  'src/simulation/circuit-catalogue/unconventional.ts',
];
if (!requested) {
  const document = {
    description:
      'Seeded AI races on every circuit-catalogue layout (WP29/WP30). Production simulation, AI and race control; no assists beyond the default sport setting. Lap times are AI pace, not reference lap records.',
    generatedBy: 'npm run test:catalogue-races',
    sources: Object.fromEntries(
      sources.map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]),
    ),
    criteria: {
      everyCarCompletesLaps: laps,
      stuckSecondsAtMost: STUCK_SECONDS,
      bestLapAverageKmh: PLAUSIBLE_KMH,
    },
    reports,
  };
  writeFileSync('docs/circuit-catalogue-races.json', JSON.stringify(document, null, 2) + '\n');
}
if (reports.some((r) => !r.passed)) process.exit(1);
