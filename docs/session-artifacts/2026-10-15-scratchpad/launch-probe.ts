const root = process.argv[2];
const assist = process.argv[3] ?? 'raw';
const { Vehicle } = await import(`${root}/src/simulation/vehicle.ts`);
const { DEFAULT_SETUP } = await import(`${root}/src/simulation/config.ts`);
const { DynamicsTrack } = await import(`${root}/scripts/dynamics-fixtures.ts`);
const track = new DynamicsTrack();
const car = new Vehicle(0, 'medium', { ...DEFAULT_SETUP, brakeBias: 0.66 }, assist);
car.place(track, 0);
car.input.brake = 1;
for (let i = 0; i < 480; i++) car.step(1 / 240, track);
car.input.brake = 0;
car.input.throttle = 1;
car.input.ers = 2;
for (let i = 0; i < 240 * 6; i++) {
  car.step(1 / 240, track);
  if (i % 60 === 0)
    console.log(
      `t=${(i / 240).toFixed(2)} v=${car.speed.toFixed(2)} x=${car.body.position.x.toFixed(2)} gear=${car.gear} rpm=${car.rpm.toFixed(0)} slip=${car.tires.map((t: any) => t.slip.toFixed(2)).join('/')} fx=${car.tires.map((t: any) => t.fx.toFixed(0)).join('/')} fy=${car.tires.map((t: any) => t.fy.toFixed(0)).join('/')} ang=${car.tires.map((t: any) => t.angle.toFixed(3)).join('/')} load=${car.tires.map((t: any) => t.load.toFixed(0)).join('/')} T=${car.tires.map((t: any) => t.surfaceTemp.toFixed(0)).join('/')} yaw=${car.body.omega.y.toFixed(3)} clutch=${car.clutch.engagement.toFixed(2)}`,
    );
}
