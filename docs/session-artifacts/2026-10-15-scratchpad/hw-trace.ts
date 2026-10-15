const W = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { DEFAULT_OPTIONS } = await import(W + '/src/simulation/config.ts');
const { PHASE } = await import(W + '/src/simulation/race.ts');
const { Simulation } = await import(W + '/src/simulation/world.ts');
const { EVENTS, eventSession } = await import(W + '/src/simulation/events.ts');
const ev = EVENTS.find((e: any) => e.id === (process.argv[2] ?? 'hochwald-multi-class'));
const opts = eventSession(ev, DEFAULT_OPTIONS);
const sim = new Simulation(opts);
sim.autoPlayer = true;
const watch = Number(process.argv[3] ?? 7), until = Number(process.argv[4] ?? 600);
let next = 0;
for (let t = 0; sim.race.raceTime < until && sim.race.phase !== PHASE.FINISHED; t += 1 / 120) {
  sim.step(1 / 120);
  if (sim.race.raceTime >= next) {
    next += 15;
    const c: any = sim.cars[watch];
    console.log(JSON.stringify({ t: Math.round(sim.race.raceTime), s: Math.round(c.s), lat: +c.lateral.toFixed(2), v: +c.speed.toFixed(2), gear: c.gear, impact: +c.impact.toFixed(2), ret: c.retired, inPit: c.inPit, sc: sim.race.safetyCar.phase, scDep: sim.race.safetyCar.deployments, fuel: +c.fuel.toFixed(1), leaderS: Math.round((sim.cars[sim.race.order[0]] as any).s), leaderLaps: sim.race.laps[sim.race.order[0]].completed, wetness: +(sim.track.water.reduce((a: number, b: number) => a + b, 0) / sim.track.water.length).toFixed(3) }));
  }
}
console.log('events', JSON.stringify(sim.race.control.events.slice(0, 20)));
