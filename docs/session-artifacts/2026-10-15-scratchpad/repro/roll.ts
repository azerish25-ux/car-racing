import { mod } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/core/math.ts';
import { circuitDefinition } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/circuits.ts';
import { DIRT_BIKES } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/dirt-bikes.ts';
import { rideLine, rigBike, rigTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/venues.ts';
const venue = (process.argv[3] ?? 'valley-ridge-mx') as 'valley-ridge-mx';
const track = rigTrack(venue);
const j = offroadCourse(circuitDefinition(venue))!.jumps.find((k) => k.name === (process.argv[2] ?? 'BARN DOUBLE'))!;
console.log(JSON.stringify(j));
const bike = rigBike(DIRT_BIKES.mx450, track, j.start - 12, 2.5);
const dt = 1 / 240;
let k = 0;
for (let t = 0; t < 40 && bike.riding; t += dt, k++) {
  rideLine(bike, track, 2.5);
  bike.step(dt, track);
  if (k % 24 === 0 || !bike.riding) console.log(t.toFixed(2), 's', bike.s.toFixed(2), 'v', bike.dynamics.speed.toFixed(2), 'gear', bike.gear, 'p', bike.pitch.toFixed(3), 'road', (bike as any).roadPitch.toFixed(3), 'FF', bike.forceFront.toFixed(0), 'FR', bike.forceRear.toFixed(0), 'thr', bike.input.throttle.toFixed(2), 'brk', bike.input.brake.toFixed(2), 'lean', bike.dynamics.lean.toFixed(2), 'state', bike.dynamics.state, 'core p', bike.dynamics.pitch.toFixed(2), bike.airborne ? 'AIR' : '', 'lat', bike.lateral.toFixed(2));
  if (mod(bike.s - j.end, track.length) < 5) break;
}
console.log(JSON.stringify(bike.crashCauses), bike.lastLanding && JSON.stringify(bike.lastLanding));
