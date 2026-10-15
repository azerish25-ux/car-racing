// AI sanity drive per vehicle: a 4-car single-class practice on a circuit,
// reporting best lap, laps, retirements, upsets and worst off-centre excursion.
const root = '/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3/src';
const { DEFAULT_OPTIONS } = await import(`${root}/simulation/config.ts`);
const { Simulation } = await import(`${root}/simulation/world.ts`);
const { VEHICLES } = await import(`${root}/simulation/vehicles.ts`);
const circuit = process.argv[2] ?? 'aurel';
const seconds = Number(process.argv[3] ?? 200);
const ids = process.argv.slice(4).length ? process.argv.slice(4) : Object.keys(VEHICLES);
for (const id of ids) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit,
    mode: 'practice',
    opponents: 0,
    vehicles: [id],
  });
  sim.autoPlayer = true;
  let where = '';
  let upsets = 0,
    worst = 0,
    peak = 0;
  const upright = sim.cars.map(() => true);
  const t0 = Date.now();
  for (let i = 0; i < 120 * seconds; i++) {
    sim.step(1 / 120);
    sim.cars.forEach((c, k) => {
      const up = c.up.y > 0.35;
      if (!up && upright[k]) upsets++;
      upright[k] = up;
      peak = Math.max(peak, c.speed);
      const half = c.trackPosition.width ?? 6;
      const off = Math.abs(c.lateral) - half;
      if (!c.inPit && !c.pitRequested && c.pitPhase === 0 && off > worst) {
        worst = off;
        where = `car${k} t=${(i / 120).toFixed(1)} s=${c.s.toFixed(0)} v=${(c.speed * 3.6).toFixed(0)} lat=${c.lateral.toFixed(1)} half=${half.toFixed(1)}`;
      }
    });
  }
  const best = sim.race.laps.map((l) => l.best).filter((x) => x > 0);
  console.log(
    id.padEnd(6),
    'best',
    best.length ? Math.min(...best).toFixed(2) : '—',
    'laps',
    sim.race.laps.map((l) => l.completed).join('/'),
    'retired',
    sim.cars.filter((c) => c.retired).length,
    'upsets',
    upsets,
    'worstOff',
    worst.toFixed(2),
    'pits',
    sim.cars.map((c) => c.pitStops).join('/'),
    'invalid',
    sim.race.laps.map((l) => (l.valid ? 0 : 1)).join(''),
    'peak',
    (peak * 3.6).toFixed(0),
    `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    where,
  );
}
