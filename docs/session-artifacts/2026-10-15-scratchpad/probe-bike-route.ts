import { OpenWorldSimulation } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/session.ts';
import { BikeVehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/bike-vehicle.ts';

// A race on a bike in the session: the player on autopilot, bike rivals.
const vehicle = process.argv[2] ?? 'sbk1000';
const event = process.argv[3] ?? 'valley-sprint';
const sim = new OpenWorldSimulation({ vehicle, tileBudget: 24 });
sim.command({ type: 'autopilot', value: true });
sim.command({ type: 'start', event });
console.log('cars', sim.cars.map((c) => c.definition.id).join(','));
let result = null;
const falls = new Array(sim.cars.length).fill(0);
const was = sim.cars.map(() => true);
let resets = 0;
const t0 = performance.now();
for (let i = 0; i < 120 * 600 && !result; i++) {
  const msg = sim.status().message;
  sim.step(1 / 120);
  if (sim.status().message !== msg && sim.status().message?.includes('reset')) resets++;
  sim.cars.forEach((c, k) => {
    const r = c instanceof BikeVehicle ? c.riding : true;
    if (was[k] && !r) falls[k]++;
    was[k] = r;
  });
  result = sim.takeResult();
}
console.log(JSON.stringify({ completed: result?.completed, position: result?.position, time: result?.time, standings: result?.standings.map((s) => [s.vehicleId, s.time && Math.round(s.time * 10) / 10, Math.round(s.progress * 100)]), falls, resets, wall: performance.now() - t0 }));
