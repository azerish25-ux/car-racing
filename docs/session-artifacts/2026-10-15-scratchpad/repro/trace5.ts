import { DEFAULT_OPTIONS, type SessionOptions } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/config.ts';
import { PHASE } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/race.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/world.ts';
const car = +(process.argv[2] ?? 5), from = +(process.argv[3] ?? 179), to = +(process.argv[4] ?? 181.5);
const options: SessionOptions = { ...DEFAULT_OPTIONS, mode: 'race', weather: 'clear', circuit: 'valley-ridge-mx', ruleset: 'motocross-moto', laps: 3, opponents: 7, vehicles: Array.from({ length: 8 }, (_, i) => (i % 3 === 2 ? 'mx250' : 'mx450')), seed: 41001 };
const sim = new Simulation(options);
sim.autoPlayer = true;
let k = 0;
for (let t = 0; t < 600 && sim.race.phase !== PHASE.FINISHED; t += 1 / 120, k++) {
  sim.step(1 / 120);
  const b = sim.cars[car] as any;
  if (b.clock >= from && b.clock <= to && k % 3 === 0)
    console.log(b.clock.toFixed(2), 's', b.s.toFixed(2), 'v', b.dynamics.speed.toFixed(2), 'p', b.pitch.toFixed(3), 'pr', b.pitchRate.toFixed(2), 'road', b.roadPitch.toFixed(3), 'FF', b.forceFront.toFixed(0), 'FR', b.forceRear.toFixed(0), 'cF', b.compressionFront.toFixed(3), 'cR', b.compressionRear.toFixed(3), 'thr', b.throttle.toFixed(2), 'brk', b.brake.toFixed(2), 'rb', b.rearBrake.toFixed(2), 'body', b.riderBody.toFixed(2), 'stand', b.standing.toFixed(2), 'air', b.airborne ? 'AIR' : '-', 'state', b.dynamics.state, 'long', b.longitudinal.toFixed(0), 'nt', b.noseTorque.toFixed(0));
  if (b.clock > to) break;
}
