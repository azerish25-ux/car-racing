// Solo AI drive with a patched definition: aipatch.ts <id> <circuit> <seconds> '<json patch>'
const root = '/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3/src';
const { DEFAULT_OPTIONS } = await import(`${root}/simulation/config.ts`);
const { Simulation } = await import(`${root}/simulation/world.ts`);
const { Vehicle } = await import(`${root}/simulation/vehicle.ts`);
const { AIDriver } = await import(`${root}/simulation/ai.ts`);
const { VEHICLES } = await import(`${root}/simulation/vehicles.ts`);
const [id, circuit, secondsText, ...patches] = process.argv.slice(2);
const seconds = Number(secondsText);
for (const patchText of patches.length ? patches : ['{}']) {
  const patch = JSON.parse(patchText);
  const base = VEHICLES[id];
  const def = {
    ...base,
    ...patch,
    setupDefaults: { ...base.setupDefaults, ...patch.setupDefaults },
    ai: { ...base.ai, ...patch.ai },
    spec: { ...base.spec, ...patch.spec },
  };
  const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, mode: 'practice', opponents: 0, vehicles: [id] });
  const old = sim.cars[0];
  const car = new Vehicle(0, DEFAULT_OPTIONS.compound, DEFAULT_OPTIONS.setup, DEFAULT_OPTIONS.assist, def);
  car.place(sim.track, old.s, old.lateral);
  sim.cars[0] = car;
  (sim as unknown as { ai: unknown[] }).ai[0] = new AIDriver(car, 0.92, DEFAULT_OPTIONS.seed);
  sim.autoPlayer = true;
  let worst = 0,
    where = '',
    spins = 0,
    prevYawBig = false;
  for (let i = 0; i < 120 * seconds; i++) {
    sim.step(1 / 120);
    const c = sim.cars[0];
    const off = Math.abs(c.lateral) - c.trackPosition.width;
    if (c.pitPhase === 0 && !c.inPit && off > worst) {
      worst = off;
      where = `t=${(i / 120).toFixed(1)} s=${c.s.toFixed(0)} v=${(c.speed * 3.6).toFixed(0)}`;
    }
    const big = Math.abs(c.body.omega.y) > 1.5;
    if (big && !prevYawBig) spins++;
    prevYawBig = big;
  }
  const lap = sim.race.laps[0];
  console.log(
    id,
    patchText,
    'laps',
    lap.completed,
    'best',
    lap.best ? lap.best.toFixed(2) : '—',
    'worstOff',
    worst.toFixed(2),
    'spins',
    spins,
    where,
  );
}
