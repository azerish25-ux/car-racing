const root = process.argv[2];
const { Vehicle } = await import(`${root}/src/simulation/vehicle.ts`);
const { DEFAULT_SETUP } = await import(`${root}/src/simulation/config.ts`);
const { DynamicsTrack } = await import(`${root}/scripts/dynamics-fixtures.ts`);
const track = new DynamicsTrack();
const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport');
car.place(track, 0);
car.input.brake = 1;
for (let i = 0; i < 480; i++) car.step(1 / 240, track);
car.input.brake = 0;
car.input.throttle = 1;
car.input.ers = 2;
let peak = 0;
for (let t = 0; t < 60; t += 1 / 240) {
  car.step(1 / 240, track);
  peak = Math.max(peak, car.speed);
}
const rolling = car.tires.reduce((s: number, t: any) => s + (t.rolling ?? 0.015) * t.load + (t.groundDrag ?? 0), 0);
console.log(
  JSON.stringify({
    kmh: +(peak * 3.6).toFixed(2),
    front: +car.frontRideHeight.toFixed(4),
    rear: +car.rearRideHeight.toFixed(4),
    drag: +car.aero.drag.toFixed(0),
    downforce: +(car.aero.front + car.aero.rear + car.aero.floor).toFixed(0),
    split: [car.aero.front, car.aero.rear, car.aero.floor].map((v: number) => Math.round(v)),
    rolling: +rolling.toFixed(0),
    loads: car.tires.map((t: any) => Math.round(t.load)),
    pressure: car.tires.map((t: any) => +t.pressure.toFixed(1)),
    rpm: Math.round(car.rpm),
    gear: car.gear,
    motor: car.motorPower,
    battery: Math.round(car.battery),
  }),
);
