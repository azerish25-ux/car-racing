import { OpenWorldSimulation } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/session.ts';
import { controls } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/config.ts';
import type { BikeVehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/bike-vehicle.ts';

for (const vehicle of ['sm450', 'sbk1000']) {
  const sim2 = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 24 });
  sim2.command({ type: 'vehicle', id: vehicle });
  const b2 = sim2.player as BikeVehicle;
  const orig = b2.impactAt.bind(b2);
  b2.impactAt = (energy, point) => {
    if (energy > 100)
      console.log(vehicle, 'impact', energy.toFixed(0), point, new Error().stack?.split('\n').slice(2, 4).join(' | '));
    return orig(energy, point);
  };
  sim2.setInput({ ...controls(), throttle: 0.5 });
  for (let i = 0; i < 120 * 2; i++) { sim2.step(1 / 120); if (i > 185 && i < 210) console.log(i, b2.dynamics.state, b2.dynamics.speed.toFixed(2), b2.body.position.x.toFixed(2), 'slide', b2.slide.toFixed(3), 'grip', b2.dynamics.grip.toFixed(3), 'surf', b2.contacts[0].surface, b2.contacts[2].surface, 'fx', b2.dynamics.frontBrakeForce?.toFixed?.(0)); }
  console.log(vehicle, 'state', b2.dynamics.state, b2.body.position, 'half', b2.definition.halfExtents);
}
