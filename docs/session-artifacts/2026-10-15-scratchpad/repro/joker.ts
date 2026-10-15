import { mod } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/core/math.ts';
import { DEFAULT_OPTIONS, type SessionOptions } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/config.ts';
import { PHASE } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/race.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/world.ts';
const options: SessionOptions = { ...DEFAULT_OPTIONS, mode: 'race', weather: 'clear', circuit: 'kestrel-rx', ruleset: 'rallycross-joker', laps: 4, opponents: 4, vehicles: Array(5).fill('rcx6'), seed: 41005 };
const sim = new Simulation(options);
sim.autoPlayer = true;
const s = sim.offroad!, L = sim.track.length, lines = s.jokerLines();
console.log('lines', lines.map((x) => x.toFixed(1)), 'centres', lines.map((x) => s.course.jokerCentre(x)?.toFixed(2)), 'joker', JSON.stringify(s.course.spec.joker));
const last = sim.cars.map((c) => c.s);
for (let t = 0; t < 120 && sim.race.phase !== PHASE.FINISHED; t += 1 / 120) {
  sim.step(1 / 120);
  sim.cars.forEach((c, id) => {
    const d = mod(c.s - last[id] + L / 2, L) - L / 2;
    lines.forEach((x, k) => { if (d > 0 && d < 15 && mod(x - last[id], L) <= d) console.log(t.toFixed(1), 'car', id, 'line', k, 'lat', c.lateral.toFixed(2), 'on', s.course.onJoker(x, c.lateral), 'leg', s.entrants[id].jokerLeg, 'jokers', s.entrants[id].jokers); });
    last[id] = c.s;
  });
}
