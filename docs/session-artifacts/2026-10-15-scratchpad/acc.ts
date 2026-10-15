const root = process.argv[2];
const { VEHICLES } = await import(root + '/src/simulation/vehicles.ts');
const { Vehicle } = await import(root + '/src/simulation/vehicle.ts');
const { DEFAULT_SETUP } = await import(root + '/src/simulation/config.ts');
const { DynamicsTrack } = await import(root + '/scripts/dynamics-fixtures.ts');
function acc(def, dt) {
  const track = new DynamicsTrack();
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
  car.place(track, 0); car.input.brake = 1;
  for (let t = 0; t < 2; t += dt) car.step(dt, track);
  car.input.brake = 0; car.input.throttle = 1; car.input.ers = 2;
  for (let t = 0; t < 20; t += dt) { car.step(dt, track); if (car.speed*3.6 >= 100) return t; }
}
const base = VEHICLES.rh3;
for (const dm of [0, -1, -3, +1, +3]) {
  const def = { ...base, spec: { ...base.spec, dryMass: base.spec.dryMass + dm } };
  console.log('dMass', dm, acc(def, 1/240), acc(def, 1/120));
}
