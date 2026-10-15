// Per-car lap times and overtakes over a full race.
// node --experimental-transform-types laps.ts <root> [weather] [slot]
const root = process.argv[2];
const weather = process.argv[3] ?? 'rain';
const slot = process.argv[4] ?? 'midfield';
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS, startingGrid } = await import(`${root}/src/simulation/config.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  circuit: 'aurel',
  mode: 'race',
  laps: 5,
  opponents: 7,
  weather,
  compound: weather === 'rain' ? 'wet' : 'medium',
  grid: startingGrid(8, slot),
});
sim.autoPlayer = true;
const passes: string[] = [];
let prev = [...sim.race.order];
for (let tick = 0; tick < 480 * 120; tick++) {
  sim.step(1 / 120);
  const order = sim.race.order;
  if (sim.race.time > 12)
    for (let p = 0; p < order.length; p++)
      if (order[p] !== prev[p]) {
        const a = order[p],
          b = prev[p];
        if (prev.indexOf(a) > p) passes.push(`${sim.race.time.toFixed(0)}:${a}>${b}`);
      }
  prev = [...order];
  if (sim.cars.every((c) => c.finishTime > 0 || c.retired)) break;
}
console.log(
  JSON.stringify({
    root: root.slice(-12),
    weather,
    time: sim.race.time.toFixed(0),
    final: sim.race.order.join(','),
    best: sim.race.laps.map((l: any, i: number) => `${i}:${l.best.toFixed(2)}`).join(' '),
    passes: passes.join(' '),
  }),
);
