const root = '/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3';
const { DEFAULT_SETUP } = await import(`${root}/src/simulation/config.ts`);
const { Vehicle } = await import(`${root}/src/simulation/vehicle.ts`);
const { VEHICLES } = await import(`${root}/src/simulation/vehicles.ts`);
const { DynamicsTrack } = await import(`${root}/scripts/dynamics-fixtures.ts`);
const id = process.argv[2] ?? 'sc7';
const dt = Number(process.argv[3] ?? 1 / 240);
const assist = (process.argv[4] ?? 'sport') as 'sport' | 'raw';
const def = VEHICLES[id];
const track = new DynamicsTrack();
const car = new Vehicle(0, 'medium', DEFAULT_SETUP, assist, def);
car.place(track, 0);
car.input.brake = 1;
for (let t = 0; t < 2; t += dt) car.step(dt, track);
console.log('settled y', car.body.position.y.toFixed(3), 'loads', Array.from(car.normalLoads).map((x) => x.toFixed(0)).join(' '));
car.input.brake = 0;
car.input.throttle = 1;
car.input.ers = 2;
let next = 0;
for (let t = 0; t < 6; t += dt) {
  car.step(dt, track);
  if (t >= next) {
    next += 0.25;
    console.log(
      t.toFixed(2),
      (car.speed * 3.6).toFixed(1),
      'g',
      car.gear,
      'rpm',
      car.rpm.toFixed(0),
      'slip',
      car.tires.map((x) => x.slip.toFixed(2)).join(','),
      'thr',
      car.throttle.toFixed(2),
      'eng',
      car.clutch.engagement.toFixed(2),
      'Fz',
      Array.from(car.normalLoads).map((x) => x.toFixed(0)).join(' '),
    );
  }
}
