// Scratch: trace a bike rider through a lap section.
import { DEFAULT_OPTIONS } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/config.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/world.ts';
import type { BikeVehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/bike-vehicle.ts';

const [id, circuit, from, to, rider] = process.argv.slice(2);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  circuit: circuit as 'aurel',
  mode: 'practice',
  opponents: 3,
  vehicles: [id, id, id, id],
  seed: 1234,
});
sim.autoPlayer = true;
const DT = 1 / 120;
for (let t = 0; t < Number(to); t += DT) {
  sim.step(DT);
  const c = sim.cars[Number(rider ?? 1)] as unknown as BikeVehicle;
  if (t >= Number(from) && Math.round(t * 120) % 24 === 0)
    console.log(
      `t ${t.toFixed(1)} s ${c.s.toFixed(0)} lat ${c.lateral.toFixed(1)} v ${(c.speed * 3.6).toFixed(0)} brk ${c.input.brake.toFixed(2)} rb ${c.input.clutch.toFixed(2)} thr ${c.input.throttle.toFixed(2)} st ${c.input.steer.toFixed(2)} lean ${c.dynamics.lean.toFixed(2)} tgt ${(c.aiTarget * 3.6).toFixed(0)} gLong ${c.gLong.toFixed(2)} crashes ${c.dynamics.crashes}`,
    );
}
