import { clamp, mod } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/core/math.ts';
import { DEFAULT_SETUP } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/config.ts';
import { DirtBikeVehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/dirt-bike-vehicle.ts';
import { DIRT_BIKES } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/dirt-bikes.ts';
import { rigTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/venues.ts';
const assist = (process.argv[2] ?? 'raw') as 'raw' | 'sport';
for (const id of ['mx450', 'mx250', 'sm450'] as const) {
  const venue = id === 'sm450' ? 'valley-ridge-mx' : 'valley-ridge-mx';
  const track = rigTrack(venue), course = offroadCourse(track.circuit)!;
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, DIRT_BIKES[id]);
  bike.place(track, mod(course.spec.gate!.s - 1.5, track.length), 0);
  bike.gear = 1;
  const dt = 1 / 240;
  let firstAir = -1, maxPitch = 0, maxCore = 0, s0 = bike.s, causes: string[] = [];
  for (let t = 0; t < 4; t += dt) {
    bike.input.throttle = 1; bike.input.brake = 0; bike.input.clutch = 0;
    bike.input.steer = clamp(-bike.lateral * 0.08, -1, 1);
    const p0 = bike.pitch;
    bike.step(dt, track);
    if (bike.airborne && firstAir < 0) { firstAir = t; console.log(id, 'airborne t', t.toFixed(3), 'speed', bike.speed.toFixed(2), 'pitch', p0.toFixed(2), '->', bike.pitch.toFixed(2), 'core', bike.dynamics.pitch.toFixed(2), 'dist', mod(bike.s - s0, track.length).toFixed(1)); }
    maxPitch = Math.max(maxPitch, bike.pitch); maxCore = Math.max(maxCore, bike.dynamics.pitch);
  }
  console.log(id, assist, 'firstAir', firstAir.toFixed(3), 'maxPitch', maxPitch.toFixed(2), 'maxCore', maxCore.toFixed(2), 'crashes', bike.dynamics.crashes, JSON.stringify(bike.crashCauses.map(c=>c.cause)), 'dist', mod(bike.s - s0, track.length).toFixed(1));
}
