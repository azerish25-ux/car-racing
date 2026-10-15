// Usage: node --experimental-transform-types changeable-probe.ts <root> [seconds]
const root = process.argv[2];
const seconds = Number(process.argv[3] ?? 320);
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS } = await import(`${root}/src/simulation/config.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  opponents: 3,
  mode: 'practice',
  weather: 'changeable',
  compound: 'medium',
});
sim.autoPlayer = true;
const health = sim.cars.map((c: any) => c.frontHealth);
const off = sim.cars.map(() => false);
for (let tick = 0; tick < seconds * 120; tick++) {
  sim.step(1 / 120);
  const t = tick / 120;
  sim.cars.forEach((c: any, i: number) => {
    const water = c.tires.map((w: any) => w.water.toFixed(2)).join('/');
    if (c.frontHealth < health[i] - 0.01) {
      console.log(
        `t=${t.toFixed(1)} car${i} HIT front ${c.frontHealth.toFixed(2)} speed ${(c.speed * 3.6).toFixed(0)} lat ${c.lateral.toFixed(1)} water ${water} yaw ${c.body.omega.y.toFixed(2)} pit ${c.pitRequested}`,
      );
      health[i] = c.frontHealth;
    }
    const isOff = !c.inPit && Math.abs(c.lateral) > c.trackPosition.width + 1.5;
    if (isOff && !off[i])
      console.log(
        `t=${t.toFixed(1)} car${i} OFF lat ${c.lateral.toFixed(1)} s ${c.s.toFixed(0)} speed ${(c.speed * 3.6).toFixed(0)} water ${water} slip ${c.tires.map((w: any) => w.slip.toFixed(2)).join('/')} ang ${c.tires.map((w: any) => w.angle.toFixed(2)).join('/')} surf ${c.tires.map((w: any) => w.surface).join('')} aq ${c.tires.map((w: any) => (w.aquaplane ?? 0).toFixed(2)).join('/')} pit ${c.pitRequested}`,
      );
    off[i] = isOff;
  });
  if (tick % (120 * 20) === 0)
    console.log(
      `t=${t.toFixed(0)} rain ${sim.track.rain.toFixed(1)} water ${sim.track.meanWater().toFixed(2)} laps ${sim.race.laps.map((l: any) => l.completed).join(',')} pits ${sim.cars.map((c: any) => `${c.pitRequested ? 'R' : ''}${c.pitStops}`).join(',')} speeds ${sim.cars.map((c: any) => (c.speed * 3.6).toFixed(0)).join(',')}`,
    );
}
