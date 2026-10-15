import { DEFAULT_SETUP } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/config.ts';
import { DirtBikeVehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/offroad/dirt-bike-vehicle.ts';
import { Track } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/track.ts';
import { vehicleDefinition } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/vehicles.ts';
const MX = vehicleDefinition('mx450');
const track = new Track();
for (const click of [0, 0.5, 1]) {
  const bike = new DirtBikeVehicle(0, 'medium', { ...DEFAULT_SETUP, frontDamping: click, rearDamping: click }, 'sport', MX);
  bike.place(track, 120);
  bike.dynamics.speed = 10;
  bike.autoShift = false;
  bike.input.throttle = 0.3;
  for (let t = 0; t < 0.5; t += 1 / 120) bike.step(1 / 120, track);
  const rest = bike.compressionRear;
  bike.vy = -1.5;
  const series: number[] = [];
  for (let t = 0; t < 0.8; t += 1 / 120) { bike.step(1 / 120, track); series.push(bike.compressionRear); }
  const peak = Math.max(...series);
  const settle = series.slice(30).reduce((a, c) => a + Math.abs(c - rest), 0);
  console.log(click, rest.toFixed(4), peak.toFixed(4), settle.toFixed(4), bike.dynamics.state, bike.airborne, bike.dynamics.speed.toFixed(2));
}
