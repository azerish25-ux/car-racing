import { DEFAULT_OPTIONS, controls } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/config.ts';
import { PHASE } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/race.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/world.ts';
for (const mode of ['hold', 'blip', 'tap'] as const) {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 2, seed: 51007, circuit: 'valley-ridge-mx', ruleset: 'motocross-moto', opponents: 3, vehicles: Array(4).fill('mx450') });
  for (let i = 0; i < 20 * 120 && sim.race.phase !== PHASE.RACING; i++) {
    const to = sim.race.greenAt - sim.race.time;
    const on = mode === 'hold' ? true : mode === 'blip' ? to < 0.3 : to < 2 && to > 1.85;
    sim.setInput({ ...controls(), throttle: on ? 1 : 0 });
    sim.step(1 / 120);
  }
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  console.log(mode, 'penalty', sim.race.laps[0].penalty, 'rd jumped', sim.race.laps[0].jumped, 'gate jumped', sim.offroad!.entrants[0].jumped);
}
