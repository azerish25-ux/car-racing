import { DEFAULT_OPTIONS, validateOptions } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/simulation/config.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/simulation/world.ts';
import { CIRCUIT_IDS } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/simulation/circuits.ts';
for (const circuit of CIRCUIT_IDS) {
  const sim = new Simulation(
    validateOptions({ ...DEFAULT_OPTIONS, circuit, mode: 'race', laps: 3, opponents: 0, seed: 909 }),
  );
  sim.autoPlayer = true;
  const t0 = performance.now();
  let first = -1;
  for (let i = 0; i < 120 * 100; i++) {
    sim.step(1 / 120);
    if (sim.race.laps[0].completed >= 1 && first < 0) {
      first = sim.race.time;
      break;
    }
  }
  console.log(
    circuit,
    'length',
    sim.track.length.toFixed(0),
    'greenAt',
    sim.race.greenAt.toFixed(2),
    'first lap complete at',
    first.toFixed(2),
    'last',
    sim.race.laps[0].last.toFixed(3),
    'cpu ms',
    (performance.now() - t0).toFixed(0),
  );
}
