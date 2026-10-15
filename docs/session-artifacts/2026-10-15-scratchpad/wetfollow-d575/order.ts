// Race order, gaps and overtakes over time. node --experimental-transform-types order.ts <root> [seconds]
const root = process.argv[2];
const limit = Number(process.argv[3] ?? 120);
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS, startingGrid } = await import(`${root}/src/simulation/config.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  circuit: 'aurel',
  mode: 'race',
  laps: 5,
  opponents: 7,
  weather: process.argv[4] ?? 'rain',
  compound: (process.argv[4] ?? 'rain') === 'rain' ? 'wet' : 'medium',
  grid: startingGrid(8, 'midfield'),
});
sim.autoPlayer = true;
let last = '';
let changes = 0;
const progress = (i: number) => sim.race.laps[i].completed * sim.track.length + sim.cars[i].s;
for (let tick = 0; tick < limit * 120; tick++) {
  sim.step(1 / 120);
  const order = sim.race.order.join(',');
  if (order !== last) {
    if (last) changes++;
    last = order;
  }
  if (tick % (120 * 5) === 0) {
    const ids = [...sim.race.order];
    const lead = progress(ids[0]);
    console.log(
      `t=${sim.race.time.toFixed(0)} order=${ids.join(',')} gaps=${ids.map((i) => (lead - progress(i)).toFixed(0)).join(',')} v0=${sim.cars[0].speed.toFixed(1)} lat0=${sim.cars[0].lateral.toFixed(1)}`,
    );
  }
}
console.log(JSON.stringify({ root, orderChanges: changes, final: last }));
