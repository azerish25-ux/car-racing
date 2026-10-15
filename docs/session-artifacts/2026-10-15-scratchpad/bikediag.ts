// Scratch: bike AI incidents — crashes per rider and where.
import { DEFAULT_OPTIONS } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/config.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/world.ts';
import type { BikeVehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/bike-vehicle.ts';

const [id, circuit, secs] = process.argv.slice(2);
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
const last = [0, 0, 0, 0];
for (let t = 0; t < Number(secs); t += DT) {
  sim.step(DT);
  sim.cars.forEach((c, i) => {
    const b = c as unknown as BikeVehicle;
    if (b.dynamics.crashes !== last[i]) {
      last[i] = b.dynamics.crashes;
      console.log(
        `t ${t.toFixed(1)} rider ${i} crash #${last[i]} s ${c.s.toFixed(0)} v ${(c.speed * 3.6).toFixed(0)} lat ${c.lateral.toFixed(1)}`,
      );
    }
  });
}
console.log('events', sim.race.control.events.map((e) => `${e.kind}@${e.time?.toFixed?.(0) ?? ''}`).join(' '));
