// Usage: node --experimental-transform-types variant-probe.ts <root> <variant> [seconds] [weather]
const root = process.argv[2];
const variant = process.argv[3] ?? 'none';
const seconds = Number(process.argv[4] ?? 200);
const weather = process.argv[5] ?? 'changeable';
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS } = await import(`${root}/src/simulation/config.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  opponents: 3,
  mode: 'practice',
  weather,
  compound: weather === 'rain' ? 'wet' : 'medium',
  assist: (process.argv[6] ?? 'sport') as 'sport' | 'raw',
});
sim.autoPlayer = true;
if (variant.includes('circle')) (await import(`${root}/src/simulation/tyre-force.ts`)).DEBUG.circle = true;
for (const c of (sim.cars as any[]).filter((car: any) => car.dynamics)) {
  let tyre = { ...c.dynamics.tyre };
  let suspension = c.dynamics.suspension;
  let engine = c.dynamics.engine;
  let aero = c.dynamics.aero;
  for (const v of variant.split(',')) {
    if (v === 'norelax') tyre.relaxationLength = 0;
    if (v === 'linear') tyre = { ...tyre, frictionStiffnessCoupling: 1, stiffnessLoadExponent: 0 };
    if (v === 'nocamber') tyre = { ...tyre, camberSensitivity: 0, camberStiffness: 0.258 };
    if (v === 'nogeo')
      suspension = {
        front: { ...suspension.front, camberGain: 0, rollCentreHeight: 0, antiBrake: 0, antiDrive: 0 },
        rear: { ...suspension.rear, camberGain: 0, rollCentreHeight: 0, antiBrake: 0, antiDrive: 0 },
      };
    if (v === 'nolag') engine = { ...engine, throttleRise: 0, throttleFall: 0, pumping: 0 };
    if (v === 'noaero') aero = { ...aero, lagLength: 0, floorCentrePitch: 0, floorCentreHeight: 0 };
  }
  c.dynamics = { ...c.dynamics, tyre, suspension, engine, aero };
  for (const t of c.tires) t.construction = tyre;
}
let maxLateral = 0;
const offs: string[] = [];
for (let tick = 0; tick < seconds * 120; tick++) {
  sim.step(1 / 120);
  for (const c of sim.cars as any[])
    if (!c.inPit) {
      const lat = Math.abs(c.lateral);
      if (lat > c.trackPosition.width + 1.5 && lat > maxLateral)
        offs.push(`${(tick / 120).toFixed(0)}:${c.id}@${c.s.toFixed(0)}`);
      maxLateral = Math.max(maxLateral, lat);
    }
}
console.log(
  JSON.stringify({
    variant,
    maxLateral: +maxLateral.toFixed(2),
    laps: sim.race.laps.map((l: any) => l.completed),
    pits: sim.cars.map((c: any) => c.pitStops),
    health: sim.cars.map((c: any) => +c.frontHealth.toFixed(2)),
    offs: offs.slice(0, 6),
  }),
);
