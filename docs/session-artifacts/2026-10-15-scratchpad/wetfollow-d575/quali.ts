// Clean-air pace by skill: qualifying spreads the field around the lap.
const root = process.argv[2];
const weather = process.argv[3] ?? 'rain';
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS } = await import(`${root}/src/simulation/config.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  circuit: 'aurel',
  mode: 'qualifying',
  laps: 3,
  opponents: 7,
  weather,
  compound: weather === 'rain' ? 'wet' : 'medium',
});
sim.autoPlayer = true;
for (let tick = 0; tick < 300 * 120; tick++) sim.step(1 / 120);
console.log(
  root.slice(-10),
  weather,
  sim.race.laps.map((l: any, i: number) => `${i}:${l.best.toFixed(2)}`).join(' '),
);
