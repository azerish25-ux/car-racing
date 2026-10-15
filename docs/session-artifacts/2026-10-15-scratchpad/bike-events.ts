const W = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { DEFAULT_OPTIONS } = await import(W + '/src/simulation/config.ts');
const { PHASE } = await import(W + '/src/simulation/race.ts');
const { Simulation } = await import(W + '/src/simulation/world.ts');
const { EVENTS, eventSession, sessionIncompatibilities } = await import(W + '/src/simulation/events.ts');
const DT = 1 / 120;
const which = process.argv[2] ?? 'events';
let sessions: { label: string; opts: any }[] = [];
if (which === 'events') {
  const ids = (process.argv[3] ?? '').split(',').filter(Boolean);
  for (const e of EVENTS) if (ids.includes(e.id)) sessions.push({ label: e.id, opts: eventSession(e, DEFAULT_OPTIONS) });
} else {
  // bikes on given circuits
  const circuits = (process.argv[3] ?? '').split(',');
  const machine = process.argv[4] ?? 'gpr1';
  for (const c of circuits)
    sessions.push({ label: `${c} ${machine}`, opts: { ...DEFAULT_OPTIONS, mode: 'race', ruleset: machine === 'ss600' || machine === 'cr750' ? 'motorcycle-class-sprint' : 'gp-motorcycle', laps: Number(process.argv[5] ?? 3), opponents: 7, circuit: c, vehicles: Array(8).fill(machine), seed: Number(process.argv[6] ?? 4242) } });
}
for (const { label, opts } of sessions) {
  const inc = sessionIncompatibilities(opts);
  const sim = new Simulation(opts);
  sim.autoPlayer = true;
  const n = sim.cars.length;
  const stopped = new Float64Array(n);
  const stopAt: number[][] = Array.from({ length: n }, () => []);
  let longest = 0, where = -1, t = 0;
  const start = performance.now();
  const limit = 60 * 60 * 1.5;
  for (; t < limit && sim.race.phase !== PHASE.FINISHED; t += DT) {
    sim.step(DT);
    if (sim.race.phase !== PHASE.RACING) continue;
    sim.cars.forEach((c: any, id: number) => {
      stopped[id] = c.speed < 1 && !c.finishTime && !c.inPit ? stopped[id] + DT : 0;
      if (stopped[id] > longest) { longest = stopped[id]; where = c.s; }
      if (Math.abs(stopped[id] - 3) < DT / 2) stopAt[id].push(Math.round(c.s));
    });
  }
  const crashes = sim.cars.map((c: any) => c.dynamics?.crashes ?? 0);
  const unclassified = sim.cars.filter((c: any) => !(c.finishTime > 0) || c.retired).map((c: any) => c.id);
  console.log(JSON.stringify({ label, inc, finished: sim.race.phase === PHASE.FINISHED, raceT: Math.round(sim.race.raceTime), wall: Math.round((performance.now() - start) / 1000), crashes, longest: +longest.toFixed(1), where: Math.round(where), stops: stopAt.map((a) => a.join('/')), unclassified, best: Math.min(...sim.race.laps.map((l: any) => l.best).filter((b: number) => b > 0)).toFixed(2), incidents: sim.race.control.events.filter((e: any) => e.kind === 'incident').length }));
}
