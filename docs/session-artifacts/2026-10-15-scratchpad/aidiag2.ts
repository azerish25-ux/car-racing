// Scratch: fine trace of one AI car through a time window.
import { DEFAULT_OPTIONS } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/config.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/world.ts';

const [id, carArg, from, to] = process.argv.slice(2);
const car = Number(carArg);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  circuit: 'aurel',
  mode: 'practice',
  opponents: 3,
  vehicles: [id, id, id, id],
  seed: 1234,
});
sim.autoPlayer = true;
const DT = 1 / 120;
for (let t = 0; t < Number(to); t += DT) {
  sim.step(DT);
  const c = sim.cars[car];
  if (t >= Number(from) && Math.round(t * 120) % 30 === 0) {
    const v = c.speed;
    const slips = c.tires.map((tr) => ((tr.omega * tr.radius) / Math.max(v, 1) - 1).toFixed(2)).join(' ');
    console.log(
      `t ${t.toFixed(2)} s ${c.s.toFixed(0)} lat ${c.lateral.toFixed(1)} v ${(v * 3.6).toFixed(0)} g ${c.gear} rpm ${c.rpm.toFixed(0)} thr ${c.throttle.toFixed(2)} brk ${c.brake.toFixed(2)} st ${c.steer.toFixed(3)} yaw ${c.body.omega.y.toFixed(2)} vx ${c.localVelocity.x.toFixed(2)} gLat ${c.gLat.toFixed(2)} gLong ${c.gLong.toFixed(2)} slip ${slips} tgt ${(c.aiTarget * 3.6).toFixed(0)}`,
    );
  }
}
