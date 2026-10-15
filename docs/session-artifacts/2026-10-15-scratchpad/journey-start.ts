const root = process.argv[2];
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS } = await import(`${root}/src/simulation/config.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'race',
  laps: 8,
  opponents: 5,
  assist: 'raw',
  weather: 'changeable',
  setup: { ...DEFAULT_OPTIONS.setup, brakeBias: 0.66 },
  seed: 4417,
});
const c = sim.cars[0];
for (let tick = 0; tick < 120 * 14; tick++) {
  const t = sim.race.raceTime;
  sim.ai[0].update(1 / 120, sim.track, sim.cars, sim.race);
  if (t < 2.5) {
    c.input.throttle = 0;
    c.input.brake = 1;
  } else {
    c.input.throttle = 1;
    c.input.brake = 0;
    c.input.ers = 2;
  }
  sim.step(1 / 120);
  if (tick % 15 === 0 && t > 2)
    console.log(
      `t=${t.toFixed(2)} phase=${sim.race.phase} v=${c.speed.toFixed(1)} lat=${c.lateral.toFixed(2)} steer=${c.input.steer.toFixed(2)} yaw=${c.body.omega.y.toFixed(2)} slip=${c.tires.map((w: any) => w.slip.toFixed(2)).join('/')} ang=${c.tires.map((w: any) => w.angle.toFixed(2)).join('/')} fy=${c.tires.map((w: any) => w.fy.toFixed(0)).join('/')} gear=${c.gear} impact=${c.impact.toFixed(2)}`,
    );
}
