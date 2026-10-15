// ms per step in 2 s blocks over the first 60 s. node --experimental-transform-types bench2.ts <root>
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
const out: string[] = [];
for (let block = 0; block < 30; block++) {
  const t0 = performance.now();
  for (let i = 0; i < 240; i++) {
    sim.step(1 / 120);
    if (i % 2 === 0) sim.writeFrame(frame);
  }
  out.push(((performance.now() - t0) / 240).toFixed(2));
}
console.log(root.slice(-14), out.join(' '));
