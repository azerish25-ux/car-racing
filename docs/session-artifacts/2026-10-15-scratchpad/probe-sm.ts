import { OpenWorldSimulation } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/session.ts';
import { controls } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/config.ts';
import type { BikeVehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/bike-vehicle.ts';

const direct = process.argv[2] === 'direct';
const sim = new OpenWorldSimulation({ vehicle: direct ? 'sm450' : 'tc1', tileBudget: 24 });
if (!direct) sim.command({ type: 'vehicle', id: 'sm450' });
const b = sim.player as BikeVehicle;
console.log('placed', b.body.position, 'up', b.up, 'state', b.dynamics.state);
sim.setInput({ ...controls(), throttle: 0.5 });
for (let i = 0; i < 120 * 3; i++) {
  sim.step(1 / 120);
  const d = b.dynamics;
  if (i % 12 === 0)
    console.log((i / 120).toFixed(2), d.state, 'v', d.speed.toFixed(2), 'lean', d.lean.toFixed(3), 'pitch', d.pitch.toFixed(3), 'y', b.body.position.y.toFixed(2), 'gear', b.gear, 'air', (b as unknown as { airborne: boolean }).airborne, 'msg', sim.status().message);
}
