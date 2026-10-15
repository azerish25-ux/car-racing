// Per-step physics cost of a 20-car field (masterplan §23.4 budget evidence).
// Twenty production Vehicles with production AI drivers run 60 simulated
// seconds on Aurel at the worker's 120 Hz tick with two 240 Hz substeps, the
// same order of operations as Simulation.step (whose session options cap the
// field at twelve). Reports wall time per 120 Hz tick for the whole loop and
// for Vehicle.step alone. Usage:
//   node --experimental-transform-types scripts/physics-cost.ts [--repeat N] [--seconds S]
// Timing is machine- and load-dependent; compare candidates on one machine,
// interleaved, never against numbers recorded elsewhere.
import { AIDriver } from '../src/simulation/ai.ts';
import { wakeFields } from '../src/simulation/aero.ts';
import { CollisionSolver } from '../src/simulation/collision.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { PHASE, RaceDirector, updatePit } from '../src/simulation/race.ts';
import { Track } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';

const argument = (name: string, fallback: number) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? Number(process.argv[index + 1]) : fallback;
};
const CARS = 20,
  TICK = 1 / 120,
  seconds = argument('--seconds', 60),
  repeat = argument('--repeat', 3);

function run() {
  const track = new Track('clear');
  const options = { ...DEFAULT_OPTIONS, mode: 'practice' as const, opponents: CARS - 1 };
  const cars = Array.from({ length: CARS }, (_, i) => {
    const car = new Vehicle(i, 'medium', options.setup, 'sport');
    const slot = i;
    car.place(
      track,
      track.length - track.pit.gridStart - Math.floor(slot / 2) * track.pit.gridRow,
      slot % 2 === 0 ? -track.pit.gridColumn : track.pit.gridColumn,
    );
    return car;
  });
  const ai = cars.map((c) => new AIDriver(c, 0.92 + (c.id % 4) * 0.014, options.seed));
  const race = new RaceDirector(cars, track, options);
  race.phase = PHASE.RACING;
  race.time = race.greenAt;
  const collisions = new CollisionSolver();
  let vehicleMs = 0;
  const started = performance.now();
  const ticks = Math.round(seconds / TICK);
  for (let tick = 0; tick < ticks; tick++) {
    for (const c of cars) {
      ai[c.id].update(TICK, track, cars, race);
      wakeFields(c, cars);
    }
    for (let sub = 0; sub < 2; sub++) {
      const before = performance.now();
      for (const c of cars) c.step(TICK * 0.5, track);
      vehicleMs += performance.now() - before;
      collisions.solve(cars, track);
    }
    for (const c of cars) c.recoverIfUpset(TICK, track);
    for (const c of cars) updatePit(c, track, TICK, cars);
    track.evolve(TICK, Math.max(0, race.time - race.greenAt));
    race.step(TICK);
  }
  const totalMs = performance.now() - started;
  const distance = cars.reduce((sum, c) => sum + race.laps[c.id].distance, 0) / CARS;
  return {
    tickMs: totalMs / ticks,
    vehicleStepMsPerTick: vehicleMs / ticks,
    vehicleStepUsPerCarSubstep: (vehicleMs * 1000) / (ticks * 2 * CARS),
    meanDistanceM: distance,
    retired: cars.filter((c) => c.retired).length,
  };
}
const results = Array.from({ length: repeat }, run);
const median = (key: keyof (typeof results)[number]) =>
  results.map((r) => r[key]).sort((a, b) => a - b)[Math.floor(results.length / 2)];
console.log(
  JSON.stringify(
    {
      cars: CARS,
      simulatedSeconds: seconds,
      repeats: repeat,
      medianTickMs: median('tickMs'),
      medianVehicleStepMsPerTick: median('vehicleStepMsPerTick'),
      medianVehicleStepUsPerCarSubstep: median('vehicleStepUsPerCarSubstep'),
      meanDistanceM: median('meanDistanceM'),
      retired: median('retired'),
      runs: results,
    },
    null,
    2,
  ),
);
