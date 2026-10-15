// Scratch: trace the moment an AI car gets stuck.
import { DEFAULT_OPTIONS } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/config.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/world.ts';

const id = process.argv[2];
const car = Number(process.argv[3] ?? 0);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  circuit: (process.argv[4] ?? 'aurel') as 'aurel',
  mode: 'practice',
  opponents: 3,
  vehicles: [id, id, id, id],
  seed: 1234,
});
sim.autoPlayer = true;
const DT = 1 / 120;
let reported = 0;
for (let t = 0; t < 240; t += DT) {
  sim.step(DT);
  const c = sim.cars[car];
  if (Math.round(t * 120) % 240 === 0 && t < 40)
    console.log(
      `t ${t.toFixed(1)} s ${c.s.toFixed(0)} lat ${c.lateral.toFixed(1)} v ${(c.speed * 3.6).toFixed(0)} gear ${c.gear} rpm ${c.rpm.toFixed(0)} up ${c.up.y.toFixed(2)} thr ${c.throttle.toFixed(2)} brk ${c.brake.toFixed(2)} steer ${c.steer.toFixed(2)} impact ${c.impact.toFixed(2)}`,
    );
  if (c.speed < 1 && t > 10 && reported < 3) {
    reported++;
    console.log(
      `STUCK t ${t.toFixed(1)} s ${c.s.toFixed(0)} lat ${c.lateral.toFixed(1)} up ${c.up.y.toFixed(2)} gear ${c.gear} rpm ${c.rpm.toFixed(0)} thr ${c.throttle.toFixed(2)} brk ${c.brake.toFixed(2)} pos ${c.body.position.y.toFixed(2)} upset ${c.upsetClock.toFixed(1)} inPit ${c.inPit}`,
    );
  }
}
