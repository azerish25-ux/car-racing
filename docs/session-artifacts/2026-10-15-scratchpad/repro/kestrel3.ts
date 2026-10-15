import { DEFAULT_OPTIONS, type SessionOptions } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/config.ts';
import { PHASE } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/race.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/world.ts';
const options: SessionOptions = { ...DEFAULT_OPTIONS, mode: 'race', weather: 'clear', circuit: 'kestrel-rx', ruleset: 'rallycross-joker', laps: 4, opponents: 4, vehicles: Array(5).fill('rcx6'), seed: 41005 };
const sim = new Simulation(options);
sim.autoPlayer = true;
let k = 0;
for (let t = 0; t < 160 && sim.race.phase !== PHASE.FINISHED; t += 1 / 120, k++) {
  sim.step(1 / 120);
  const c = sim.cars[3], lap = sim.race.laps[3];
  if (k % 12 === 0 && sim.race.raceTime > 143 && sim.race.raceTime < 153) console.log(sim.race.raceTime.toFixed(1), 's', c.s.toFixed(1), 'lat', c.lateral.toFixed(2), 'v', c.speed.toFixed(1), 'laps', lap.completed, 'dist', lap.distance?.toFixed?.(1), 'fin', c.finishTime.toFixed(1), 'ret', c.retired, 'pos', c.body.position.x.toFixed(1), c.body.position.z.toFixed(1), "pit", c.inPit, "thr", c.input.throttle.toFixed(2), "brk", c.input.brake.toFixed(2), "steer", c.input.steer.toFixed(2), "gear", (c as any).gear, "rpm", (c as any).rpm?.toFixed?.(0), "up", c.up.y.toFixed(2));
}
