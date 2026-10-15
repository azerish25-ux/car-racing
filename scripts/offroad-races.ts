// Seeded AI off-road races (WP37-WP42): the production simulation at 120 Hz
// on each terrain venue with its own format — an outdoor motocross moto and
// an indoor supercross main event from the synchronised gate, a rallycross
// heat with its joker lap, and a gravel special stage with staggered starts —
// then every built-in off-road event exactly as the player loads it
// (eventSession over the default options: its own field, laps, weather,
// ruleset and seed; cars and bikes). Asserts every race finishes inside its
// time limit, every entrant is classified (none of these formats retires a
// healthy entrant and no mechanical failure is modelled, so a retirement is a
// stuck or lost machine), nobody is parked longer than PARKED_LIMIT, crashes
// per rider-lap stay inside the discipline's bound, the soil ruts, every
// rallycross car takes exactly one joker (no joker penalty) and every stage
// car starts on its interval and records its splits. Writes
// docs/offroad-races.json; exits 1 when an assertion fails.
// OFFROAD_RACE=<text> runs only the races whose label contains it.
import { writeFileSync } from 'node:fs';
import { CIRCUITS, circuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { EVENTS, eventSession, rulesetFor } from '../src/simulation/events.ts';
import type { DirtBikeAIDriver } from '../src/simulation/offroad/ai.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;
/** Longest an entrant may stand still while racing (s): a crash's slide,
 * separation, jog back, push and remount (BIKE_RECOVERY), or a wait behind
 * one under the yellow, with a margin. */
const PARKED_LIMIT = 20;
/** Crashes per rider per lap (motorcycles) by course kind. */
const CRASH_BOUNDS: Readonly<Record<string, number>> = Object.freeze({
  motocross: 0.5,
  supercross: 0.75,
});
interface Race {
  label: string;
  session: SessionOptions;
  /** Built-in event id (raced as loaded); absent for the fixed sessions. */
  event?: string;
  /** Bound on crashes per rider per lap (motorcycles). */
  crashesPerRiderLap?: number;
  /** Race-time limit (s). */
  limit: number;
}
const fixed = (label: string, options: Partial<SessionOptions>): Race => ({
  label,
  session: { ...DEFAULT_OPTIONS, mode: 'race', weather: 'clear', ...options },
  limit: 600,
});
const RACES: Race[] = [
  fixed('Valley Ridge motocross moto', {
    circuit: 'valley-ridge-mx',
    ruleset: 'motocross-moto',
    laps: 3,
    opponents: 7,
    vehicles: Array.from({ length: 8 }, (_, i) => (i % 3 === 2 ? 'mx250' : 'mx450')),
    seed: 41001,
  }),
  fixed('Arena Nord supercross main', {
    circuit: 'arena-nord-sx',
    ruleset: 'motocross-moto',
    laps: 3,
    opponents: 7,
    vehicles: Array(8).fill('mx450'),
    seed: 41003,
  }),
  fixed('Kestrel rallycross heat', {
    circuit: 'kestrel-rx',
    ruleset: 'rallycross-joker',
    laps: 4,
    opponents: 4,
    vehicles: Array(5).fill('rcx6'),
    seed: 41005,
  }),
  fixed('Pinewood special stage', {
    circuit: 'pinewood-stage',
    ruleset: 'rally-stage',
    laps: 1,
    opponents: 3,
    vehicles: Array(4).fill('rl2'),
    seed: 41006,
  }),
  // Every built-in off-road event as the player loads it (the career and the
  // EVENTS cards offer them).
  ...EVENTS.filter((e) => CIRCUITS[e.circuit].offroad).map(
    (e): Race => ({
      label: `event ${e.id}`,
      session: eventSession(e, DEFAULT_OPTIONS),
      event: e.id,
      limit: 1200,
    }),
  ),
].map((r) => {
  const kind: string = offroadCourse(circuitDefinition(r.session.circuit))?.kind ?? '';
  return { ...r, crashesPerRiderLap: r.crashesPerRiderLap ?? CRASH_BOUNDS[kind] };
});
const failures: string[] = [];
const only = process.env.OFFROAD_RACE;
const results = RACES.filter(
  (r) => !only || r.label.toLowerCase().includes(only.toLowerCase()),
).map((race) => {
  const options = race.session;
  const sim = new Simulation(options);
  sim.autoPlayer = true;
  const session = sim.offroad!;
  const n = sim.cars.length;
  const stopped = new Float64Array(n);
  let longestStop = 0,
    parked = { car: -1, s: 0, time: 0 },
    t = 0;
  const start = performance.now();
  for (; t < race.limit && sim.race.phase !== PHASE.FINISHED; t += DT) {
    sim.step(DT);
    if (sim.race.phase !== PHASE.RACING) continue;
    sim.cars.forEach((c, id) => {
      const e = session.entrants[id];
      // Queued or parked stage cars stand still by the rules.
      const waiting = e.start <= 1 || e.parked || c.finishTime > 0 || c.inPit;
      stopped[id] = c.speed < 1 && !waiting ? stopped[id] + DT : 0;
      if (stopped[id] > longestStop) {
        longestStop = stopped[id];
        parked = { car: id, s: +c.s.toFixed(1), time: +sim.race.raceTime.toFixed(1) };
      }
    });
  }
  const label = race.label;
  if (sim.race.phase !== PHASE.FINISHED)
    failures.push(`${label}: did not finish in ${race.limit} s`);
  const unclassified = sim.cars.filter((c) => !(c.finishTime > 0) || c.retired).map((c) => c.id);
  if (unclassified.length) failures.push(`${label}: not classified ${unclassified.join(', ')}`);
  if (longestStop >= PARKED_LIMIT)
    failures.push(
      `${label}: car ${parked.car} was parked ${longestStop.toFixed(1)} s (at ${parked.s} m, ${parked.time} s)`,
    );
  const bikes = sim.cars.filter((c): c is DirtBikeVehicle => c instanceof DirtBikeVehicle);
  const crashes = bikes.map((b) => b.dynamics.crashes);
  let crashRate: number | undefined;
  if (race.crashesPerRiderLap !== undefined && bikes.length) {
    const laps = options.laps,
      worst = Math.max(...crashes);
    crashRate = crashes.reduce((a, b) => a + b, 0) / (bikes.length * laps);
    if (crashRate > race.crashesPerRiderLap)
      failures.push(
        `${label}: ${crashRate.toFixed(2)} crashes per rider per lap (bound ${race.crashesPerRiderLap})`,
      );
    // Nobody crashes on more than half the laps.
    if (worst > Math.max(1, Math.ceil(laps / 2)))
      failures.push(`${label}: one rider crashed ${worst} times in ${laps} laps`);
  }
  const terrain = session.terrain.stats();
  if (terrain.cells < 1000 || terrain.deepest < 0.01)
    failures.push(
      `${label}: the soil barely rutted (${terrain.cells} cells, ${terrain.deepest.toFixed(3)} m)`,
    );
  const format = rulesetFor(options).format!;
  const jokers = session.entrants.map((e) => e.jokers);
  if (format.kind === 'rallycross') {
    const wrong = jokers.map((j, id) => [id, j]).filter(([, j]) => j !== format.joker!.required);
    if (wrong.length) failures.push(`${label}: joker laps ${JSON.stringify(wrong)}`);
    const penalties = session.log.filter((l) => l.code === 'JOKER');
    if (session.log.some((l) => l.code === 'JOKER' && l.text.includes('+')))
      failures.push(`${label}: joker penalties ${penalties.map((p) => p.text).join('; ')}`);
  }
  const results = session.results();
  if (format.kind === 'stage') {
    const order = options.grid ?? sim.cars.map((c) => c.id);
    order.forEach((id, k) => {
      const e = session.entrants[id];
      const expected = session.stageStartTime(k);
      if (Math.abs(e.stageStart - expected) > 1e-6)
        failures.push(`${label}: car ${id} started at ${e.stageStart}`);
      if (e.jumped) failures.push(`${label}: car ${id} jumped the start`);
      if (!(e.stageTime > 0)) failures.push(`${label}: car ${id} has no stage time`);
    });
  }
  if (format.start === 'gate' && session.holeshot < 0)
    failures.push(`${label}: no holeshot recorded`);
  const ai = sim.ai.map((d) => (d as unknown as Partial<DirtBikeAIDriver>).decisions ?? null);
  const result = {
    race: label,
    ...(race.event ? { event: race.event } : {}),
    circuit: options.circuit,
    ruleset: options.ruleset,
    laps: options.laps,
    weather: options.weather,
    seed: options.seed,
    vehicles: options.vehicles,
    raceSeconds: +sim.race.raceTime.toFixed(2),
    wallSeconds: +((performance.now() - start) / 1000).toFixed(1),
    finishTimes: sim.cars.map((c) => +c.finishTime.toFixed(2)),
    retired: sim.cars.filter((c) => c.retired).map((c) => c.id),
    bestLaps: sim.race.laps.map((l) => +l.best.toFixed(2)),
    crashes,
    crashesPerRiderLap: crashRate === undefined ? undefined : +crashRate.toFixed(3),
    crashBound: race.crashesPerRiderLap,
    crashCauses: bikes.map((b) => b.crashCauses.map((c) => `${c.cause}@${c.s.toFixed(0)}`)),
    landings: bikes.map((b) => b.landings),
    aiDecisions: ai,
    longestStopSeconds: +longestStop.toFixed(2),
    longestStop: parked,
    holeshot: session.holeshot,
    jokers: format.kind === 'rallycross' ? jokers : undefined,
    stage:
      format.kind === 'stage'
        ? session.entrants.map((e) => ({
            start: e.stageStart,
            time: +e.stageTime.toFixed(2),
            splits: e.stage?.splits ?? [],
          }))
        : undefined,
    log: session.log.map((l) => `${l.time.toFixed(1)} car ${l.car} ${l.code}: ${l.text}`),
    terrain: { ...terrain, hash: session.terrain.hash() },
    classification: results,
  };
  console.log(
    `${label}: ${result.raceSeconds} s race, ${result.wallSeconds} s wall, crashes ${JSON.stringify(crashes)}` +
      (crashRate === undefined ? '' : ` (${crashRate.toFixed(2)}/rider-lap)`) +
      `, longest stop ${longestStop.toFixed(1)} s, terrain ${terrain.cells} cells / ${(terrain.deepest * 100).toFixed(1)} cm` +
      (result.jokers ? `, jokers ${JSON.stringify(result.jokers)}` : '') +
      (format.start === 'gate' ? `, holeshot car ${session.holeshot}` : ''),
  );
  return result;
});
writeFileSync(
  'docs/offroad-races.json',
  `${JSON.stringify(
    {
      generated: 'npm run test:offroad (scripts/offroad-races.ts)',
      dt: DT,
      parkedLimitSeconds: PARKED_LIMIT,
      crashBounds: CRASH_BOUNDS,
      passed: failures.length === 0,
      races: results,
      failures,
    },
    null,
    2,
  )}\n`,
);
for (const f of failures) console.log(`FAIL ${f}`);
if (failures.length) process.exit(1);
