// Usage: node --experimental-transform-types thermal-probe.ts <root> [weather] [seconds] [vehicle]
const root = process.argv[2];
const weather = (process.argv[3] ?? 'clear') as 'clear' | 'rain' | 'changeable';
const seconds = Number(process.argv[4] ?? 150);
const vehicle = process.argv[5] ?? 'apx01';
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS } = await import(`${root}/src/simulation/config.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'practice',
  opponents: 0,
  weather,
  vehicles: [vehicle],
  compound: weather === 'rain' ? 'wet' : 'medium',
});
sim.autoPlayer = true;
const ticks = seconds * 120;
const sums = { surface: [0, 0, 0, 0], carcass: [0, 0, 0, 0], pressure: [0, 0, 0, 0], core: [0, 0, 0, 0] };
let n = 0,
  maxSpeed = 0,
  lapTimes: number[] = [];
for (let i = 0; i < ticks; i++) {
  sim.step(1 / 120);
  const c = sim.cars[0];
  maxSpeed = Math.max(maxSpeed, c.speed);
  if (i > 120 * 40) {
    n++;
    c.tires.forEach((t: any, k: number) => {
      sums.surface[k] += t.surfaceTemp;
      sums.carcass[k] += t.carcassTemp;
      sums.pressure[k] += t.pressure;
      sums.core[k] += t.coreTemp ?? NaN;
    });
  }
}
const lap = sim.race.laps[0];
const avg = (a: number[]) => a.map((v) => +(v / n).toFixed(1));
console.log(
  JSON.stringify({
    root: root.slice(-30),
    weather,
    vehicle,
    surface: avg(sums.surface),
    carcass: avg(sums.carcass),
    core: avg(sums.core),
    pressure: avg(sums.pressure),
    wear: sim.cars[0].tires.map((t: any) => +t.wear.toFixed(4)),
    maxKmh: +(maxSpeed * 3.6).toFixed(1),
    best: lap.best,
    completed: lap.completed,
  }),
);
