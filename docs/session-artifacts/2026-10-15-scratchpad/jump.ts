const W = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { DEFAULT_OPTIONS } = await import(W + '/src/simulation/config.ts');
const { PHASE } = await import(W + '/src/simulation/race.ts');
const { Simulation } = await import(W + '/src/simulation/world.ts');
const { EVENTS, eventSession } = await import(W + '/src/simulation/events.ts');
const id = process.argv[2];
const ev = EVENTS.find((e: any) => e.id === id);
const opts = ev ? eventSession(ev, DEFAULT_OPTIONS) : { ...DEFAULT_OPTIONS, circuit: id, mode: 'race', laps: 2, opponents: 5, weather: 'clear', seed: 29030 };
const sim = new Simulation(opts);
sim.autoPlayer = process.argv[3] !== 'human';
let maxSpeed = new Float64Array(sim.cars.length);
for (let t = 0; t < 12 && sim.race.phase !== PHASE.RACING; t += 1 / 120) {
  sim.step(1 / 120);
  sim.cars.forEach((c: any, i: number) => { maxSpeed[i] = Math.max(maxSpeed[i], Math.abs(c.speed)); });
}
console.log(id, 'phase', sim.race.phase, 'penalties', sim.race.laps.map((l: any) => l.penalty), 'jumped', sim.race.laps.map((l: any) => l.jumped), 'maxSpeedDuringLights', Array.from(maxSpeed).map((x) => x.toFixed(2)), 'msg', sim.race.message, 'events', JSON.stringify(sim.race.control.events.slice(0, 3)));
