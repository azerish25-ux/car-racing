const root = '/home/user/Experiment-3/.claude/worktrees/agent-a726b8c5722e56270';
const { Simulation } = await import(root + '/src/simulation/world.ts');
const { DEFAULT_OPTIONS } = await import(root + '/src/simulation/config.ts');
const circuit = process.argv[2] ?? 'aurel';
const vehicle = process.argv[3] ?? 'gpr1';
const n = Number(process.argv[4] ?? 8);
const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, mode: 'race', ruleset: 'gp-motorcycle', opponents: n - 1, laps: 3, vehicles: Array.from({ length: n }, () => vehicle), seed: Number(process.argv[5] ?? 3303) });
sim.autoPlayer = true;
const seen = sim.race.laps.map(() => 0);
for (let i = 0; i < 120 * 400 && sim.race.phase !== 3; i++) {
  sim.step(1 / 120);
  sim.race.laps.forEach((l: any, id: number) => {
    if (l.warnings !== seen[id]) {
      seen[id] = l.warnings;
      const c = sim.cars[id] as any;
      console.log(`t=${(i / 120).toFixed(1)} car${id} warn=${l.warnings} s=${c.s.toFixed(0)} lat=${c.lateral.toFixed(2)} w=${c.trackPosition.width.toFixed(2)} c0=${c.contacts[0].lateral.toFixed(2)}/${c.contacts[0].width.toFixed(2)} c2=${c.contacts[2].lateral.toFixed(2)}/${c.contacts[2].width.toFixed(2)} v=${(c.speed * 3.6).toFixed(0)} aiOff=${c.aiOffset.toFixed(2)} dec=${(sim.ai[id] as any).decision}`);
    }
  });
}
