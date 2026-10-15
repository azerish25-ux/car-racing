// node --experimental-transform-types bench.ts <root> : ms per 1/120 s step, 8-car wet race.
const root = process.argv[2];
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS, startingGrid } = await import(`${root}/src/simulation/config.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  circuit: 'aurel',
  mode: 'race',
  laps: 5,
  opponents: 7,
  weather: 'rain',
  compound: 'wet',
  grid: startingGrid(8, 'midfield'),
});
sim.autoPlayer = true;
const frame = sim.makeFrame();
for (let i = 0; i < 120 * 8; i++) sim.step(1 / 120); // through the lights
const samples: number[] = [];
for (let block = 0; block < 12; block++) {
  const t0 = performance.now();
  for (let i = 0; i < 240; i++) {
    sim.step(1 / 120);
    if (i % 2 === 0) sim.writeFrame(frame);
  }
  samples.push((performance.now() - t0) / 240);
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify({ root, medianMsPerStep: samples[6].toFixed(3), minMsPerStep: samples[0].toFixed(3) }),
);
