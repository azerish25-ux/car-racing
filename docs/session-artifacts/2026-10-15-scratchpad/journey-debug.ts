// Replays scripts/integrated-driving.ts driver phases and logs the
// contact/recovery phase. Usage: journey-debug.ts <root> [variant]
const root = process.argv[2];
const variant = process.argv[3] ?? 'none';
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS, VEHICLE } = await import(`${root}/src/simulation/config.ts`);
const { clamp, Vec3 } = await import(`${root}/src/core/math.ts`);
const { trackPoint } = await import(`${root}/src/simulation/track.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'race',
  laps: 8,
  opponents: 5,
  assist: 'raw',
  weather: 'changeable',
  setup: { ...DEFAULT_OPTIONS.setup, brakeBias: 0.66 },
  seed: 4417,
});
if (variant.includes('circle')) {
  const tf = await import(`${root}/src/simulation/tyre-force.ts`);
  if (tf.DEBUG) tf.DEBUG.circle = true;
}
for (const car of (sim.cars as any[]).filter((c) => c.dynamics))
  if (variant.includes('rigid')) {
    for (const t of car.tires) t.construction = { ...t.construction };
  }
const c = sim.cars[0] as any,
  dt = 1 / 120,
  point = trackPoint(),
  delta = new Vec3(),
  local = new Vec3();
let phase = 'start',
  phaseTime = 0,
  pathOffset = 0;
function enter(p: string) {
  phase = p;
  phaseTime = sim.race.raceTime;
  console.log('EVENT', p, sim.race.raceTime.toFixed(1), c.s.toFixed(0), c.lateral.toFixed(1));
}
function drive(offset: number, target: number) {
  const rate = phase === 'contact' ? 6 : 2;
  pathOffset += clamp(offset - pathOffset, -rate * dt, rate * dt);
  offset = pathOffset;
  const look = clamp(12 + c.speed * 0.75, 14, 35);
  sim.track.at(c.s + look, point);
  delta.set(point.x + point.nx * offset - c.body.position.x, 0, point.z + point.nz * offset - c.body.position.z);
  c.body.orientation.inverseRotate(delta, local);
  const angle = Math.atan2(2 * VEHICLE.wheelbase * local.x, Math.max(10, local.x * local.x + local.z * local.z));
  c.input.steer = clamp(angle / VEHICLE.maxSteer, -1, 1);
  c.input.throttle = clamp((target - c.speed) * 0.22, 0, 0.8);
  c.input.brake = clamp((c.speed - target) * 0.16, 0, 0.8);
}
for (let tick = 0; tick < 120 * 340; tick++) {
  const t = sim.race.raceTime;
  sim.ai[0].update(dt, sim.track, sim.cars, sim.race);
  if (t < 2.5) {
    c.input.throttle = 0;
    c.input.brake = 1;
  } else if (phase === 'start') {
    c.input.throttle = 1;
    c.input.brake = 0;
    c.input.ers = 2;
    if (c.speed > 22) enter('follow');
  } else if (phase === 'follow' && t > 25 && c.speed > 50 && Math.abs(c.trackPosition.curvature) < 0.006)
    enter('brake');
  if (phase === 'brake') {
    c.input.brake = 1;
    c.input.throttle = 0;
    if (t - phaseTime > 0.45) enter('release');
  } else if (phase === 'release') {
    c.input.brake = 0;
    c.input.throttle = 0.25;
    if (t - phaseTime > 1) enter('prepare-excursion');
  } else if (phase === 'prepare-excursion' && t > 50 && c.s < 180) enter('decelerate');
  else if (phase === 'decelerate') {
    drive(0, 12);
    if (c.speed < 14) enter('grass');
  } else if (phase === 'grass') {
    drive(-14.5, 9);
    if (t - phaseTime > 14) enter('return');
  } else if (phase === 'return') {
    drive(0, 12);
    if (t - phaseTime > 10 && Math.abs(c.lateral) < 2) enter('weather');
  } else if (phase === 'weather') {
    c.input.ers = 2;
    if (c.pitStops > 0 && !c.inPit) enter('rejoined');
  } else if (phase === 'rejoined' && t - phaseTime > 18 && c.s < 200) enter('contact');
  else if (phase === 'contact') {
    drive(-22, 18);
    if (c.frontHealth < 0.97 || t - phaseTime > 22) enter('recover-contact');
  } else if (phase === 'recover-contact') {
    drive(0, 12);
    if (t - phaseTime > 14 && Math.abs(c.lateral) < 2) enter('finish');
  }
  sim.step(dt);
  if ((phase === 'contact' || phase === 'recover-contact') && tick % 30 === 0)
    console.log(
      `t=${t.toFixed(1)} ${phase} s=${c.s.toFixed(1)} lat=${c.lateral.toFixed(2)} v=${c.speed.toFixed(2)} steer=${c.input.steer.toFixed(2)} thr=${c.input.throttle.toFixed(2)} rev=${c.input.reverse} gear=${c.gear} yaw=${c.body.omega.y.toFixed(2)} fwd=${c.forward.x.toFixed(2)},${c.forward.z.toFixed(2)} surf=${c.tires.map((w: any) => w.surface).join('')} slip=${c.tires.map((w: any) => w.slip.toFixed(1)).join('/')} sink=${c.tires.map((w: any) => ((w.sinkage ?? 0) * 1000).toFixed(0)).join('/')} drag=${c.tires.map((w: any) => (w.groundDrag ?? 0).toFixed(0)).join('/')} load=${c.tires.map((w: any) => w.load.toFixed(0)).join('/')} impact=${c.impact.toFixed(2)} health=${c.frontHealth.toFixed(3)} bottom=${c.bottomEnergy.toFixed(0)}`,
    );
  if (phase === 'recover-contact' && t - phaseTime > 25) break;
}
