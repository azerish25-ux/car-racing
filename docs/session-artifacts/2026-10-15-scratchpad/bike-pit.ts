import { DEFAULT_OPTIONS } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/config.ts';
import { PHASE } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/race.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/world.ts';
const DT = 1 / 120;
const vehicle = process.argv[2] ?? 'gpr1';
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'race',
  ruleset: vehicle === 'apx01' ? 'formula-sprint' : 'gp-motorcycle',
  laps: 2,
  opponents: 3,
  circuit: 'aurel',
  vehicles: Array(4).fill(vehicle),
  seed: 3303,
});
sim.autoPlayer = true;
let requested = false;
const log: string[] = [];
let last = -1;
for (let t = 0; t < 600 && sim.race.phase !== PHASE.FINISHED; t += DT) {
  sim.step(DT);
  const c = sim.cars[0];
  if (!requested && sim.race.phase === PHASE.RACING && sim.race.raceTime > 20) {
    c.pitRequested = true;
    c.nextCompound = 'soft';
    requested = true;
  }
  if (c.pitPhase !== last) {
    log.push(
      `t=${t.toFixed(2)} phase=${c.pitPhase} clock=${c.pitClock.toFixed(2)} speed=${c.speed.toFixed(2)} s=${c.s.toFixed(1)} jack=${c.jackHeight.toFixed(3)}`,
    );
    last = c.pitPhase;
  }
}
console.log(log.join('\n'));
console.log(
  'stops',
  sim.cars.map((c) => c.pitStops),
  'compound',
  sim.cars[0].tires.map((t) => t.compound),
  'finish',
  sim.cars.map((c) => c.finishTime.toFixed(2)),
);
