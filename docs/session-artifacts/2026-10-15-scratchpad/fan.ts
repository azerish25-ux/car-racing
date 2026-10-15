const root = process.argv[2];
const { VEHICLES } = await import(root + '/src/simulation/vehicles.ts');
const { Vehicle } = await import(root + '/src/simulation/vehicle.ts');
const { DEFAULT_SETUP } = await import(root + '/src/simulation/config.ts');
const { DynamicsTrack } = await import(root + '/scripts/dynamics-fixtures.ts');
const def = VEHICLES.xf2;
const dt = 1/240;
for (const health of [1, 0.25, 0.1]) {
  for (const kmh of [60, 100, 150]) {
  const track = new DynamicsTrack('runway');
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
  car.place(track, 0);
  car.input.brake = 1;
  for (let t = 0; t < 2; t += dt) car.step(dt, track);
  car.input.brake = 0;
  const speed = kmh/3.6;
  car.body.velocity.set(0, 0, speed); car.speed = speed;
  for (const tire of car.tires) tire.omega = speed / tire.radius;
  car.floorHealth = health;
  car.input.brake = 1;
  // settle 0.4 s then measure decel over next 0.3 s
  for (let t = 0; t < 0.4; t += dt) car.step(dt, track);
  const v0 = car.speed;
  for (let t = 0; t < 0.3; t += dt) car.step(dt, track);
  console.log('health', health, 'from', kmh, 'v', v0.toFixed(1), 'decel m/s2', ((v0-car.speed)/0.3).toFixed(2), 'fan', car.fanForce.toFixed(0), 'floorHealth', car.floorHealth);
  }
}
