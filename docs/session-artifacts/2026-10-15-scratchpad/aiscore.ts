// AI quality score: 4-car single-class practice on each circuit; counts
// incidents (leaving the road by more than 2 m outside the pit lane) per lap.
const root = '/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3/src';
const { DEFAULT_OPTIONS } = await import(`${root}/simulation/config.ts`);
const { Simulation } = await import(`${root}/simulation/world.ts`);
const { VEHICLES } = await import(`${root}/simulation/vehicles.ts`);
const seconds = Number(process.argv[2] ?? 240);
const ids = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(VEHICLES);
const circuits = (process.env.CIRCUITS ?? 'aurel,vellamar').split(',');
for (const id of ids) {
  const parts: string[] = [];
  let totalIncidents = 0,
    totalLaps = 0;
  for (const circuit of circuits) {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit,
      mode: 'practice',
      opponents: 3,
      vehicles: [id, id, id, id],
      seed: 4242,
    });
    sim.autoPlayer = true;
    const off = sim.cars.map(() => false);
    let incidents = 0;
    for (let i = 0; i < 120 * seconds; i++) {
      sim.step(1 / 120);
      sim.cars.forEach((c, k) => {
        const outside =
          !c.inPit && c.pitPhase === 0 && Math.abs(c.lateral) - c.trackPosition.width > 2;
        if (outside && !off[k]) incidents++;
        off[k] = outside;
      });
    }
    const laps = sim.race.laps.reduce((n, l) => n + l.completed, 0);
    const best = Math.min(...sim.race.laps.map((l) => l.best || Infinity));
    totalIncidents += incidents;
    totalLaps += laps;
    parts.push(`${circuit} ${incidents}/${laps} best ${Number.isFinite(best) ? best.toFixed(1) : '—'}`);
  }
  console.log(
    id.padEnd(6),
    `incidents/lap ${(totalIncidents / Math.max(1, totalLaps)).toFixed(2)}`,
    parts.join(' · '),
  );
}
