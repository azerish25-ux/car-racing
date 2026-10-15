import { OpenWorldSimulation } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/session.ts';
import { controls } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/config.ts';

const mode = process.argv[2] ?? 'traffic';
const vehicle = process.argv[3];
const seconds = Number(process.argv[4] ?? 120);
const sim = new OpenWorldSimulation({ traffic: mode === 'traffic', vehicle, tileBudget: 24 });
sim.command({ type: 'autopilot', value: true });
const start = { ...sim.player.body.position };
let maxCars = 0,
  stepMs = 0,
  worst = 0,
  distance = 0,
  falls = 0,
  last = { x: start.x, z: start.z },
  riding = true;
const t0 = performance.now();
for (let i = 0; i < seconds * 120; i++) {
  const a = performance.now();
  sim.step(1 / 120);
  const b = performance.now() - a;
  stepMs += b;
  worst = Math.max(worst, b);
  maxCars = Math.max(maxCars, sim.traffic.cars.length);
  const p = sim.player.body.position;
  distance += Math.hypot(p.x - last.x, p.z - last.z);
  last = { x: p.x, z: p.z };
  const r = (sim.player as unknown as { riding?: boolean }).riding;
  if (r === false && riding) falls++;
  if (r !== undefined) riding = r;
  if (!sim.autopilot && i % 1200 === 0) sim.command({ type: 'autopilot', value: true });
  if (i % (120 * 10) === 0) {
    const st = sim.status();
    console.log(
      `t=${(i / 120).toFixed(0)} cars=${sim.traffic.cars.length} speed=${(sim.player.speed * 3.6).toFixed(0)} road=${st.road.name} onRoad=${st.road.onRoad} msg=${st.message} collisions=${sim.traffic.collisions} spawned=${sim.traffic.spawned} despawned=${sim.traffic.despawned}`,
    );
  }
}
void controls;
console.log(
  JSON.stringify({
    maxCars,
    avgStepMs: stepMs / (seconds * 120),
    worst,
    distanceKm: distance / 1000,
    falls,
    digest: sim.traffic.digest(),
    wall: performance.now() - t0,
    spawned: sim.traffic.spawned,
  }),
);
