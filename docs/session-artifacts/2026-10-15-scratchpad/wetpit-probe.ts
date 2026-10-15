const root = process.argv[2];
const seconds = Number(process.argv[3] ?? 200);
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS } = await import(`${root}/src/simulation/config.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'practice',
  opponents: 9,
  weather: 'rain',
  compound: 'medium',
  seed: 4417,
});
sim.autoPlayer = true;
for (const car of sim.cars) {
  car.pitRequested = true;
  car.nextCompound = 'wet';
}
const off = sim.cars.map(() => false);
const impact = sim.cars.map(() => 0);
for (let tick = 0; tick < seconds * 120; tick++) {
  sim.step(1 / 120);
  const t = tick / 120;
  for (const c of sim.cars as any[]) {
    const isOff = !c.inPit && Math.abs(c.lateral) > c.trackPosition.width + 1.0;
    if (isOff && !off[c.id])
      console.log(
        `t=${t.toFixed(1)} car${c.id} OFF s=${c.s.toFixed(0)} lat=${c.lateral.toFixed(1)} v=${(c.speed * 3.6).toFixed(0)} yaw=${c.body.omega.y.toFixed(2)} water=${c.tires[0].water.toFixed(2)} use=${c.tires.map((w: any) => (w.usage ?? 0).toFixed(2)).join('/')} slip=${c.tires.map((w: any) => w.slip.toFixed(2)).join('/')} thr=${c.input.throttle.toFixed(2)} brk=${c.input.brake.toFixed(2)} steer=${c.input.steer.toFixed(2)}`,
      );
    off[c.id] = isOff;
    if (c.impact > impact[c.id] + 0.02) {
      console.log(`t=${t.toFixed(1)} car${c.id} IMPACT ${c.impact.toFixed(2)} s=${c.s.toFixed(0)} lat=${c.lateral.toFixed(1)} v=${(c.speed * 3.6).toFixed(0)}`);
    }
    impact[c.id] = c.impact;
  }
  if (tick % (120 * 20) === 0)
    console.log(
      `t=${t.toFixed(0)} s=${sim.cars.map((c: any) => c.s.toFixed(0)).join(',')} v=${sim.cars.map((c: any) => (c.speed * 3.6).toFixed(0)).join(',')} pit=${sim.cars.map((c: any) => (c.inPit ? 'P' : c.pitStops)).join('')}`,
    );
}
