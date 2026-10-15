import { clamp, mod } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/core/math.ts';
import { DEFAULT_SETUP } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/config.ts';
import { DirtBikeVehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/dirt-bike-vehicle.ts';
import { DIRT_BIKES } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/dirt-bikes.ts';
import { rigTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/venues.ts';
const track = rigTrack('valley-ridge-mx'), course = offroadCourse(track.circuit)!;
const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', DIRT_BIKES.mx450);
bike.place(track, mod(course.spec.gate!.s - 1.5, track.length), 0);
bike.gear = 1;
const dt = 1 / 240;
let k = 0;
for (let t = 0; t < 1.2; t += dt, k++) {
  bike.input.throttle = 1; bike.input.brake = 0; bike.input.clutch = 0;
  bike.input.steer = clamp(-bike.lateral * 0.08, -1, 1);
  bike.step(dt, track);
  if (k % 8 === 0 || bike.airborne) console.log(t.toFixed(3), 'v', bike.dynamics.speed.toFixed(2), 'p', bike.pitch.toFixed(3), 'pr', bike.pitchRate.toFixed(2), 'vy', bike.vy.toFixed(2), 'FF', bike.forceFront.toFixed(0), 'FR', bike.forceRear.toFixed(0), 'cR', bike.compressionRear.toFixed(3), 'core', bike.dynamics.pitch.toFixed(2), 'drive', bike.dynamics.driveForce.toFixed(0), bike.airborne ? 'AIR' : '');
  if (bike.airborne) break;
}
