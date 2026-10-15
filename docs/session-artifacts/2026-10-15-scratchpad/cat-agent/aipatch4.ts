// 4-car AI incident score with a patched definition (all cars):
// aipatch4.ts <id> <circuit> <seconds> '<json patch>' ...
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
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit,
    mode: 'practice',
    opponents: 3,
    vehicles: [id, id, id, id],
    seed: 4242,
  });
  for (let k = 0; k < 4; k++) {
    const old = sim.cars[k];
    const car = new Vehicle(k, DEFAULT_OPTIONS.compound, DEFAULT_OPTIONS.setup, DEFAULT_OPTIONS.assist, def);
    car.place(sim.track, old.s, old.lateral);
    sim.cars[k] = car;
    (sim as unknown as { ai: unknown[] }).ai[k] = new AIDriver(car, 0.92 + (k % 4) * 0.014, DEFAULT_OPTIONS.seed);
  }
  sim.autoPlayer = true;
  const off = [false, false, false, false];
  let incidents = 0;
  const where: string[] = [];
  for (let i = 0; i < 120 * seconds; i++) {
    sim.step(1 / 120);
    sim.cars.forEach((c, k) => {
      const outside = !c.inPit && c.pitPhase === 0 && Math.abs(c.lateral) - c.trackPosition.width > 2;
      if (outside && !off[k]) {
        incidents++;
        where.push(Math.round(c.s / 50) * 50 + '');
      }
      off[k] = outside;
    });
  }
  const laps = sim.race.laps.reduce((n, l) => n + l.completed, 0);
  const best = Math.min(...sim.race.laps.map((l) => l.best || Infinity));
  console.log(
    id,
    patchText,
    `inc/lap ${(incidents / Math.max(1, laps)).toFixed(2)} (${incidents}/${laps}) best ${Number.isFinite(best) ? best.toFixed(1) : '—'} [${where.join(' ')}]`,
  );
}
