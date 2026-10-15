const root = process.argv[2];
const { Vehicle } = await import(`${root}/src/simulation/vehicle.ts`);
const { DEFAULT_SETUP } = await import(`${root}/src/simulation/config.ts`);
const { DynamicsTrack } = await import(`${root}/scripts/dynamics-fixtures.ts`);
const { clamp, G } = await import(`${root}/src/core/math.ts`);
function lateral(kmh: number, water: number, compound: string) {
  const track = new DynamicsTrack('runway', water);
  const car = new Vehicle(0, compound, DEFAULT_SETUP, 'raw');
  car.place(track, 0);
  car.input.brake = 1;
  for (let i = 0; i < 480; i++) car.step(1 / 240, track);
  car.input.brake = 0;
  const speed = kmh / 3.6;
  car.body.velocity.set(0, 0, speed);
  car.speed = speed;
  for (const t of car.tires) t.omega = speed / t.radius;
  const spec = car.spec;
  let gear = spec.gearRatios.length - 2;
  while (gear > 1 && ((speed / spec.wheelRadius) * spec.gearRatios[gear + 1] * spec.finalDrive * 30) / Math.PI < spec.downshiftRPM) gear--;
  car.gear = gear;
  car.clutch.engineOmega = (speed / spec.wheelRadius) * spec.gearRatios[gear + 1] * spec.finalDrive;
  let steer = 0, filtered = 0, peak = 0;
  for (let t = 0; t < 60; t += 1 / 240) {
    steer += 0.012 / 240;
    car.input.steer = steer;
    car.input.throttle = clamp((speed - car.speed) * 0.6 + 0.2, 0, 1);
    car.step(1 / 240, track);
    filtered += (Math.abs(car.gLat) - filtered) * Math.min(1, 1 / 240 / 0.25);
    peak = Math.max(peak, filtered);
    if (t > 2 && filtered < peak * 0.85) break;
    if (car.speed < speed * 0.8) break;
  }
  return peak;
}
for (const [compound, water] of [['medium', 0], ['medium', 0.5], ['medium', 1], ['intermediate', 1], ['wet', 1.5]] as const) {
  const row = [80, 150].map((kmh) => lateral(kmh, water, compound).toFixed(2));
  console.log(`${compound.padEnd(12)} water ${water} mm: lateral g @80 ${row[0]} @150 ${row[1]}`);
}
