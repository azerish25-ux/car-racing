import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/agent-a964cb482ef4886a4/src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '/home/user/Experiment-3/.claude/worktrees/agent-a964cb482ef4886a4/src/simulation/config.ts';
let t = performance.now();
const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
console.log('build', performance.now() - t);
sim.autoPlayer = true;
t = performance.now();
for (let i = 0; i < 120 * 60; i++) sim.step(1 / 120);
console.log('60s sim 1 car', performance.now() - t, sim.race.laps[0].completed, sim.cars[0].s);
