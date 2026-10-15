const root = process.argv[2];
const circuit = process.argv[3] ?? 'aurel';
const { DEFAULT_OPTIONS } = await import(root + '/src/simulation/config.ts');
const { Simulation } = await import(root + '/src/simulation/world.ts');
const vehicles = (process.argv[4] ?? 'xf2,xf2,xf2,xf2').split(',');
const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, mode: 'practice', opponents: 3, vehicles, seed: 11 });
sim.autoPlayer = true;
let minFan = [1e9,1e9,1e9,1e9], minFloor=[1,1,1,1], offs=[0,0,0,0], bottom=[0,0,0,0];
for (let i = 0; i < 120 * 240; i++) {
  sim.step(1 / 120);
  sim.cars.forEach((c, k) => {
    minFan[k] = Math.min(minFan[k], c.fanForce);
    minFloor[k] = Math.min(minFloor[k], c.floorHealth);
    if (c.bottomEnergy > 0) bottom[k] += 1;
  });
  if (i % (120*60) === 0) console.log('t', i/120, sim.cars.map(c => `fan=${c.fanForce.toFixed(0)} floor=${c.floorHealth.toFixed(3)} v=${c.speed.toFixed(1)}`).join(' | '));
}
console.log('minFan', minFan.map(x=>x.toFixed(0)), 'minFloor', minFloor.map(x=>x.toFixed(3)), 'bottomTicks', bottom, 'laps', sim.race.laps.map(l=>l.completed), 'best', sim.race.laps.map(l=>l.best?.toFixed?.(2)));
