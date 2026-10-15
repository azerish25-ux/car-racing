import { OpenWorldSimulation } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/session.ts';

const sim = new OpenWorldSimulation({ traffic: true, tileBudget: 24 });
sim.command({ type: 'autopilot', value: true });
let longest = 0;
const stoppedSince = new Map<number, number>();
for (let i = 0; i < 300 * 120; i++) {
  sim.step(1 / 120);
  if (!sim.autopilot && i % 600 === 0) sim.command({ type: 'autopilot', value: true });
  const t = sim.traffic;
  for (const c of t.cars) {
    if (c.speed < 0.3) {
      if (!stoppedSince.has(c.id)) stoppedSince.set(c.id, sim.time);
      longest = Math.max(longest, sim.time - stoppedSince.get(c.id)!);
    } else stoppedSince.delete(c.id);
  }
  if (i % (120 * 30) === 0) {
    const cars = t.cars;
    const stopped = cars.filter((c) => c.speed < 0.3).length,
      waiting = cars.filter((c) => c.waiting).length,
      mean = cars.reduce((a, c) => a + c.speed, 0) / Math.max(1, cars.length);
    console.log(`t=${(i / 120).toFixed(0)} cars=${cars.length} stopped=${stopped} waiting=${waiting} meanKmh=${(mean * 3.6).toFixed(0)} player=${(sim.player.speed * 3.6).toFixed(0)} road=${sim.status().road.name} col=${t.collisions}`);
  }
}
console.log('longest stop', longest.toFixed(1), 's; collisions', sim.traffic.collisions);
