const root = process.argv[2];
const id = process.argv[3];
const kmh = Number(process.argv[4] ?? 100);
const { VEHICLES } = await import(root + '/src/simulation/vehicles.ts');
const { Vehicle } = await import(root + '/src/simulation/vehicle.ts');
const { DEFAULT_SETUP } = await import(root + '/src/simulation/config.ts');
const { DynamicsTrack } = await import(root + '/scripts/dynamics-fixtures.ts');
const def = VEHICLES[id];
const track = new DynamicsTrack('runway');
const dt = 1/240;
const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
car.place(track, 0);
car.input.brake = 1;
for (let t = 0; t < 2; t += dt) car.step(dt, track);
car.input.brake = 0;
const speed = kmh/3.6;
car.body.velocity.set(0, 0, speed); car.speed = speed;
for (const tire of car.tires) tire.omega = speed / tire.radius;
console.log('setup brakeBias', car.setup?.brakeBias, 'mass', car.body.mass);
car.input.brake = 1;
let prev = car.speed; let tick=0;
const z0 = car.body.position.z;
for (; tick*dt < 20 && car.speed > 0.2; tick++) {
  car.step(dt, track);
  if (tick % 24 === 23) {
    const t = car.tires;
    console.log((tick*dt).toFixed(2), 'v', car.speed.toFixed(2), 'a', ((prev-car.speed)/(24*dt)).toFixed(2),
      'fx', t.map(x=>x.fx.toFixed(0)).join(','), 'load', t.map(x=>x.load.toFixed(0)).join(','), 'bottom', car.bottomEnergy?.toFixed?.(1), 'drag', car.aero.drag.toFixed(0), 'fan', car.fanForce.toFixed(0), 'rh', car.frontRideHeight.toFixed(3), car.rearRideHeight.toFixed(3));
    prev = car.speed;
  }
}
console.log('dist', (car.body.position.z - z0).toFixed(2));
