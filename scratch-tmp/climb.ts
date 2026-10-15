import { clamp, mod } from '../src/core/math.ts';
import { DIRT_BIKES } from '../src/simulation/offroad/dirt-bikes.ts';
import { rigBike, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { trackPoint } from '../src/simulation/track.ts';

const venue = (process.argv[2] ?? 'valley-ridge-mx') as 'valley-ridge-mx';
const def = DIRT_BIKES[process.argv[3] ?? 'mx450'];
const throttle = Number(process.argv[4] ?? 1);
const points = (process.argv[5] ?? '585.5,586.5,592.5,593.5,602.5,603.5').split(',').map(Number);
const track = rigTrack(venue);
const p = trackPoint();
for (const s0 of points) {
  const bike = rigBike(def, track, s0, 0); bike.place(track, s0, Number(process.env.LAT ?? 0));
  bike.gear = 1;
  let t = 0;
  let maxPitch = 0;
  for (; t < 10; t += 1 / 120) {
    track.at(bike.s, p);
    const heading = Math.atan2(p.tx, p.tz),
      error = mod(heading - bike.dynamics.heading + Math.PI, Math.PI * 2) - Math.PI;
    bike.input.steer = clamp(-(bike.lateral - Number(process.env.LAT ?? 0)) * 0.08 + error * 1.6, -1, 1);
    bike.input.throttle = throttle;
    bike.input.brake = 0;
    bike.input.clutch = 0;
    bike.aiControlled(1e9);
    bike.step(1 / 120, track);
    maxPitch = Math.max(maxPitch, bike.pitch - bike.roadPitch);
    if (mod(bike.s - s0 + 400, track.length) - 400 > 8) break;
  }
  console.log(
    `s0 ${s0} -> s ${bike.s.toFixed(1)} t ${t.toFixed(2)} speed ${bike.speed.toFixed(2)} roadPitch ${bike.roadPitch.toFixed(2)} pitch ${bike.pitch.toFixed(2)} maxLift ${maxPitch.toFixed(2)} drive ${bike.dynamics.driveForce.toFixed(0)} thr ${(bike as any).throttle.toFixed(2)} state ${bike.dynamics.state} crashes ${bike.dynamics.crashes}`,
  );
}
