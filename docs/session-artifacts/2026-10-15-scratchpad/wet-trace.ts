const root = process.argv[2];
const id = Number(process.argv[3] ?? 5);
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS } = await import(`${root}/src/simulation/config.ts`);
const { peakGrip } = await import(`${root}/src/simulation/tire.ts`);
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
let next = 0;
for (let tick = 0; tick < 120 * 16; tick++) {
  sim.step(1 / 120);
  const c = sim.cars[id] as any;
  const s = (c.s + 100) % sim.track.length;
  if (s >= next && s < 400) {
    next = s + 15;
    const grip = peakGrip(c.tires[0], 2500, c.contacts[0], Math.max(c.speed, 38));
    console.log(
      `t=${(tick / 120).toFixed(1)} s=${c.s.toFixed(0)} v=${(c.speed * 3.6).toFixed(0)} target=${(c.aiTarget * 3.6).toFixed(0)} thr=${c.input.throttle.toFixed(2)} brk=${c.input.brake.toFixed(2)} steer=${c.input.steer.toFixed(2)} gLat=${c.gLat.toFixed(2)} gLong=${c.gLong.toFixed(2)} grip=${grip.toFixed(2)} T=${c.tires[0].carcassTemp.toFixed(0)}/${c.tires[0].surfaceTemp.toFixed(0)} w=${c.tires[0].water.toFixed(2)} lat=${c.lateral.toFixed(1)}`,
    );
  }
}
