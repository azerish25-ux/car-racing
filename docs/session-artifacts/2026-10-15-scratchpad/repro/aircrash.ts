import { circuitDefinition } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/circuits.ts';
import { jumpHoldSpeed } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/ai.ts';
import { DIRT_BIKES } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/dirt-bikes.ts';
import { rideLine, rigBike, rigTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/venues.ts';
const track = rigTrack('valley-ridge-mx');
const j = offroadCourse(circuitDefinition('valley-ridge-mx'))!.jumps.find((k) => k.name === 'SKY TRIPLE')!;
const hold = jumpHoldSpeed(j);
const bike = rigBike(DIRT_BIKES.mx450, track, j.start - 12, hold);
const dt = 1 / 240;
let crashedAt = -1, prevY = 0;
for (let t = 0; t < 6; t += dt) {
  if (!bike.airborne && bike.riding) rideLine(bike, track, Math.max(hold, bike.dynamics.speed));
  if (bike.airborne && bike.airTime > 0.6 && crashedAt < 0) { bike.impactAt(10000, bike.body.position); crashedAt = t; console.log('impact y', bike.body.position.y.toFixed(2), 'ground', bike.contacts[2].height.toFixed(2), 'vy', bike.vy.toFixed(2)); }
  prevY = bike.body.position.y;
  bike.step(dt, track);
  if (crashedAt >= 0 && t - crashedAt < 1.5 && Math.round((t - crashedAt) / dt) % 12 === 0)
    console.log('t+', (t - crashedAt).toFixed(3), 'y', bike.body.position.y.toFixed(2), 'dy', (bike.body.position.y - prevY).toFixed(3), 'vy', bike.body.velocity.y.toFixed(2), 'air', bike.airborne, 'state', bike.dynamics.state, 'speed', bike.dynamics.speed.toFixed(2), 's', bike.s.toFixed(1), 'rider y', bike.rider.y.toFixed(2));
  if (crashedAt >= 0 && t - crashedAt > 1.5) break;
}
console.log(JSON.stringify(bike.crashCauses));
