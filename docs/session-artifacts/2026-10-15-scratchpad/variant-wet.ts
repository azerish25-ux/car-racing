const root = process.argv[2];
const variant = process.argv[3] ?? 'none';
const seconds = Number(process.argv[4] ?? 60);
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS } = await import(`${root}/src/simulation/config.ts`);
const tf = await import(`${root}/src/simulation/tyre-force.ts`);
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
if (variant.includes('circle') && tf.DEBUG) tf.DEBUG.circle = true;
for (const c of sim.cars as any[]) {
  let tyre = { ...c.dynamics.tyre };
  let suspension = c.dynamics.suspension;
  let aero = c.dynamics.aero;
  for (const v of variant.split(',')) {
    if (v === 'norelax') tyre.relaxationLength = 0;
    if (v === 'linear') tyre = { ...tyre, frictionStiffnessCoupling: 1, stiffnessLoadExponent: 0 };
    if (v === 'coupling1') tyre = { ...tyre, frictionStiffnessCoupling: 1 };
    if (v === 'coupling8') tyre = { ...tyre, frictionStiffnessCoupling: 0.8 };
    if (v === 'nocamber') tyre = { ...tyre, camberSensitivity: 0, camberStiffness: 0.258 };
    if (v === 'nogeo')
      suspension = {
        front: { ...suspension.front, camberGain: 0, rollCentreHeight: 0, antiBrake: 0, antiDrive: 0 },
        rear: { ...suspension.rear, camberGain: 0, rollCentreHeight: 0, antiBrake: 0, antiDrive: 0 },
      };
    if (v === 'noaero') aero = { ...aero, lagLength: 0, floorCentrePitch: 0, floorCentreHeight: 0 };
  }
  c.dynamics = { ...c.dynamics, tyre, suspension, aero };
  for (const t of c.tires) t.construction = tyre;
}
let offs = 0,
  impacts = 0;
const off = sim.cars.map(() => false);
for (let tick = 0; tick < seconds * 120; tick++) {
  sim.step(1 / 120);
  for (const c of sim.cars as any[]) {
    const isOff = !c.inPit && Math.abs(c.lateral) > c.trackPosition.width + 1.0;
    if (isOff && !off[c.id]) offs++;
    off[c.id] = isOff;
    if (c.impact > 0.05) impacts++;
  }
}
console.log(JSON.stringify({ variant, offs, impactTicks: impacts, s: sim.cars.map((c: any) => Math.round(c.s)) }));
