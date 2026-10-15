// Usage: node --experimental-transform-types corner-probe.ts <root> <t0> <t1> [car]
const root = process.argv[2];
const t0 = Number(process.argv[3] ?? 110),
  t1 = Number(process.argv[4] ?? 135),
  car = Number(process.argv[5] ?? 1);
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS } = await import(`${root}/src/simulation/config.ts`);
const { peakGrip } = await import(`${root}/src/simulation/tire.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  opponents: 3,
  mode: 'practice',
  weather: 'changeable',
  compound: 'medium',
  assist: (process.argv[6] ?? 'sport') as 'sport' | 'raw',
});
sim.autoPlayer = true;
for (let tick = 0; tick < t1 * 120; tick++) {
  sim.step(1 / 120);
  const t = tick / 120;
  if (t < t0 || tick % 12) continue;
  const c = sim.cars[car];
  if (c.s < 650 || c.s > 850) continue;
  const grip = peakGrip(c.tires[0], 2500, c.contacts[0], Math.max(c.speed, 38));
  console.log(
    `t=${t.toFixed(2)} s=${c.s.toFixed(0)} v=${(c.speed * 3.6).toFixed(0)} lat=${c.lateral.toFixed(2)} steer=${c.input.steer.toFixed(3)} thr=${c.input.throttle.toFixed(2)} brk=${c.input.brake.toFixed(2)} gLat=${c.gLat.toFixed(2)} yaw=${c.body.omega.y.toFixed(2)} grip=${grip.toFixed(2)} ang=${c.tires.map((w: any) => w.angle.toFixed(3)).join('/')} slip=${c.tires.map((w: any) => w.slip.toFixed(2)).join('/')} load=${c.tires.map((w: any) => w.load.toFixed(0)).join('/')} use=${c.tires.map((w: any) => (w.usage ?? 0).toFixed(2)).join("/")} pk=${c.tires.map((w: any) => (w.peakSlip ?? 0).toFixed(3)).join("/")} w=${c.tires[0].water.toFixed(2)} gear=${c.gear}`,
  );
}
