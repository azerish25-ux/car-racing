const W = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { DEFAULT_OPTIONS } = await import(W + '/src/simulation/config.ts');
const { PHASE } = await import(W + '/src/simulation/race.ts');
const { Simulation } = await import(W + '/src/simulation/world.ts');
const { EVENTS, eventSession } = await import(W + '/src/simulation/events.ts');
const DT = 1 / 120;
const ids = (process.argv[2] ?? '').split(',').filter(Boolean);
const lapCap = process.argv[3] ? Number(process.argv[3]) : 0;
for (const e of EVENTS) {
  if (!ids.includes(e.id)) continue;
  const opts = eventSession(e, DEFAULT_OPTIONS);
  if (lapCap && opts.mode !== 'endurance') opts.laps = Math.min(opts.laps, lapCap);
  const sim = new Simulation(opts);
  sim.autoPlayer = true;
  const n = sim.cars.length;
  const stuck = new Float64Array(n), worst = new Float64Array(n), at: number[][] = Array.from({ length: n }, () => []);
  let maxImpact = 0, maxImpactAt = -1, nonfinite = false;
  const start = performance.now();
  const timeout = 120 * Math.max(600, (opts.durationSeconds ?? 0) + 1200, (sim.track.length / 20) * (opts.laps + 1));
  let tick = 0;
  for (; tick < timeout && sim.race.phase !== PHASE.FINISHED; tick++) {
    sim.step(DT);
    for (const c of sim.cars as any[]) {
      if (!(c.body.position.finite() && c.body.omega.finite())) { nonfinite = true; break; }
      if (c.impact > maxImpact) { maxImpact = c.impact; maxImpactAt = Math.round(c.s); }
      const racing = sim.race.phase === PHASE.RACING && !c.finishTime && !c.inPit && !c.retired;
      if (racing && sim.race.time > sim.race.greenAt + 5 && c.speed < 1) {
        stuck[c.id] += DT; if (stuck[c.id] > worst[c.id]) worst[c.id] = stuck[c.id];
        if (Math.abs(stuck[c.id] - 4) < DT / 2) at[c.id].push(Math.round(c.s));
      } else stuck[c.id] = 0;
    }
    if (nonfinite) break;
  }
  const unclassified = (sim.cars as any[]).filter((c) => !(c.finishTime > 0) || c.retired).map((c) => `${c.id}:${c.definition?.id ?? ''}${c.retired ? ':ret' : ''}`);
  console.log(JSON.stringify({ id: e.id, mode: opts.mode, laps: opts.laps, finished: sim.race.phase === PHASE.FINISHED, nonfinite, raceT: Math.round(sim.race.raceTime), wall: Math.round((performance.now() - start) / 1000), worstStuck: Array.from(worst).map((x) => +x.toFixed(1)), stuckAt: at.map((a) => a.join('/')), unclassified, maxImpact: +maxImpact.toFixed(1), maxImpactAt, completed: sim.race.laps.map((l: any) => l.completed), incidents: sim.race.control.events.filter((x: any) => x.kind === 'incident').length }));
}
