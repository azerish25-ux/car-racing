// Launch timing: per car, reaction, time to gain 0.3 m/s and 3 m/s after green.
const repo = process.argv[2];
const weather = process.argv[3] ?? 'clear';
const { DEFAULT_OPTIONS } = await import(`${repo}/src/simulation/config.ts`);
const { Simulation } = await import(`${repo}/src/simulation/world.ts`);
for (const seed of [DEFAULT_OPTIONS.seed, 4417, 73021, 1234]) {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 3, opponents: 9, weather, seed, compound: weather === 'rain' ? 'wet' : DEFAULT_OPTIONS.compound });
  sim.autoPlayer = true;
  const n = sim.cars.length;
  const t03 = new Array(n).fill(NaN), t3 = new Array(n).fill(NaN);
  for (let i = 0; i < 120 * 12; i++) {
    sim.step(1 / 120);
    const t = sim.race.time - sim.race.greenAt;
    for (const c of sim.cars) {
      const p = c.trackPosition;
      const along = c.body.velocity.x * p.tx + c.body.velocity.z * p.tz;
      if (t > -0.01 && Number.isNaN(t03[c.id]) && along > 0.3) t03[c.id] = t;
      if (t > -0.01 && Number.isNaN(t3[c.id]) && along > 3) t3[c.id] = t;
    }
  }
  const react = sim.ai.map((a: any) => a.brain.reactionSeconds);
  console.log(`seed ${seed} ${weather}`);
  for (let i = 0; i < n; i++)
    console.log(`  car ${i} react ${react[i].toFixed(3)} firstEval~${(react[i] + 1 / 12).toFixed(3)} gain0.3 ${t03[i].toFixed(3)} 3m/s ${t3[i].toFixed(3)} ahead(i-2) gain0.3 - firstEval = ${i >= 2 ? (t03[i - 2] - react[i] - 1 / 12).toFixed(3) : '-'}`);
}
