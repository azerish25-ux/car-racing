// Seeded runs of the built-in catalogue endurance events (catalogue wave 2
// review): each event exactly as the player loads it (eventSession: its own
// mixed-class field, duration, weather and seed), the production simulation,
// AI and race control at 120 Hz to the flag. The catalogue races
// (test:catalogue-races) run six Formula cars for two dry laps; these are the
// long-lap, multi-class, changeable-weather sessions they do not cover.
// Asserts the race finishes, every car is classified (no lapped car is timed
// out on a 13-21 km lap), no car is parked for half a minute and marshals
// never have to recover a stranded car. Writes docs/endurance-event-races.json.
//   node --experimental-transform-types scripts/endurance-event-races.ts [event,...]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CATALOGUE_EVENTS } from '../src/simulation/circuit-catalogue/events.ts';
import { EVENTS, eventSession } from '../src/simulation/events.ts';
import { PHASE } from '../src/simulation/race.ts';
import { SC_PHASE } from '../src/simulation/safety-car.ts';
import { MARSHAL_RECOVERY, Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;
const CRITERIA = Object.freeze({ parkedSecondsBelow: MARSHAL_RECOVERY.seconds });

function run(id: string) {
  const event = EVENTS.find((e) => e.id === id)!,
    options = eventSession(event, DEFAULT_OPTIONS),
    sim = new Simulation(options);
  sim.autoPlayer = true;
  const n = sim.cars.length,
    stopped = new Float64Array(n),
    longest = new Float64Array(n);
  let neutralised = 0,
    longestNeutralised = 0,
    period = 0;
  const start = performance.now(),
    limit = (options.durationSeconds ?? 3600) + sim.race.finishGrace + 600;
  for (let t = 0; t < limit && sim.race.phase !== PHASE.FINISHED; t += DT) {
    sim.step(DT);
    if (sim.race.phase !== PHASE.RACING) continue;
    sim.cars.forEach((c, i) => {
      stopped[i] = c.speed < 1 && !c.finishTime && !c.inPit && !c.retired ? stopped[i] + DT : 0;
      longest[i] = Math.max(longest[i], stopped[i]);
    });
    if (sim.race.safetyCar.phase !== SC_PHASE.NONE) {
      neutralised += DT;
      period += DT;
      longestNeutralised = Math.max(longestNeutralised, period);
    } else period = 0;
  }
  const finished = sim.race.phase === PHASE.FINISHED,
    recoveries = [...sim.recoveries].reduce((a, b) => a + b, 0),
    parked = Math.max(...longest);
  const classification = sim.race.order.map((car) => ({
    id: car,
    vehicle: sim.cars[car].definition.id,
    laps: sim.race.laps[car].completed,
    bestLapS: Number(sim.race.laps[car].best.toFixed(3)),
    finishTime: Number(sim.cars[car].finishTime.toFixed(2)),
    retired: sim.cars[car].retired,
    penalty: sim.race.laps[car].penalty,
    longestStopSeconds: Number(longest[car].toFixed(2)),
    marshalRecoveries: sim.recoveries[car],
  }));
  const failures: string[] = [];
  if (!finished) failures.push('race did not finish');
  for (const c of classification) {
    if (c.retired || !(c.finishTime > 0))
      failures.push(`car ${c.id} (${c.vehicle}) not classified`);
    if (c.longestStopSeconds >= CRITERIA.parkedSecondsBelow)
      failures.push(`car ${c.id} parked ${c.longestStopSeconds} s`);
    if (c.marshalRecoveries) failures.push(`car ${c.id} needed marshal recovery`);
  }
  return {
    event: id,
    circuit: options.circuit,
    ruleset: options.ruleset,
    weather: options.weather,
    seed: options.seed,
    durationSeconds: options.durationSeconds ?? null,
    lengthM: Math.round(sim.track.length),
    finishGraceSeconds: Number(sim.race.finishGrace.toFixed(1)),
    passed: failures.length === 0,
    failures,
    raceSeconds: Number(sim.race.raceTime.toFixed(2)),
    safetyCarDeployments: sim.race.safetyCar.deployments,
    neutralisedSeconds: Number(neutralised.toFixed(1)),
    longestNeutralisedSeconds: Number(longestNeutralised.toFixed(1)),
    incidents: sim.race.control.events.filter((e) => e.kind === 'incident').length,
    marshalRecoveries: recoveries,
    longestStopSeconds: Number(parked.toFixed(2)),
    wallSeconds: Number(((performance.now() - start) / 1000).toFixed(1)),
    classification,
  };
}
type Report = ReturnType<typeof run>;

const argv = process.argv.slice(2);
if (argv[0] === '--worker') console.log(JSON.stringify(run(argv[1])));
else {
  const ids = argv[0]
    ? argv[0].split(',')
    : CATALOGUE_EVENTS.filter((e) => e.mode === 'endurance').map((e) => e.id);
  const script = fileURLToPath(import.meta.url);
  // One process per event: the sessions are independent and long.
  const reports = await Promise.all(
    ids.map(
      (id) =>
        new Promise<Report>((resolve, reject) => {
          const child = spawn(process.execPath, [...process.execArgv, script, '--worker', id], {
            stdio: ['ignore', 'pipe', 'inherit'],
          });
          let out = '';
          child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
          child.on('exit', (code) => {
            const line = out.split('\n').find((l) => l.startsWith('{'));
            if (code !== 0 || !line) reject(new Error(`${id}: worker exited ${code}`));
            else resolve(JSON.parse(line) as Report);
          });
        }),
    ),
  );
  for (const r of reports)
    console.log(
      `${r.passed ? 'PASS' : 'FAIL'} ${r.event.padEnd(26)} ${r.lengthM} m ${r.raceSeconds} s SC ${r.safetyCarDeployments} (${r.neutralisedSeconds} s) recoveries ${r.marshalRecoveries} ${r.failures.join('; ')}`,
    );
  if (!argv[0])
    writeFileSync(
      'docs/endurance-event-races.json',
      JSON.stringify(
        {
          description:
            'Seeded runs of the built-in catalogue endurance events as the player loads them (own field, duration, weather and seed): production simulation, AI and race control to the flag.',
          generatedBy: 'npm run test:endurance-events',
          criteria: { ...CRITERIA, everyCarClassified: true, marshalRecoveries: 0 },
          reports,
        },
        null,
        2,
      ) + '\n',
    );
  if (reports.some((r) => !r.passed)) process.exitCode = 1;
}
