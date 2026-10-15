const W = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation';
const { DEFAULT_SETUP } = await import(`${W}/config.ts`);
const { DirtBikeVehicle } = await import(`${W}/offroad/dirt-bike-vehicle.ts`);
const { Track } = await import(`${W}/track.ts`);
const { vehicleDefinition } = await import(`${W}/vehicles.ts`);
const MX = vehicleDefinition('mx450');
console.log(MX.wheelRadius ?? '', JSON.stringify(Object.keys(MX)).slice(0, 300));
const track = new Track();
for (const gearing of [1, 1.08, 0.92]) {
  const bike = new DirtBikeVehicle(0, 'medium', { ...DEFAULT_SETUP, gearing }, 'sport', MX);
  bike.place(track, 120);
  bike.dynamics.speed = 15;
  bike.gear = 3; bike.autoShift = false; bike.input.throttle = 0.4;
  for (let t = 0; t < 0.5; t += 1 / 120) bike.step(1 / 120, track);
  bike.vy = 3.5;
  let before = bike.rpm, after = NaN, steps = 0;
  while (!bike.airborne && steps < 200) { before = bike.rpm; bike.step(1 / 120, track); steps++; }
  after = bike.rpm;
  let landed = NaN; let s2 = 0;
  const preLand: number[] = [];
  while (bike.airborne && s2 < 600) { preLand.push(bike.rpm); bike.step(1 / 120, track); s2++; }
  landed = bike.rpm;
  console.log(gearing, steps, before.toFixed(0), after.toFixed(0), (after / before).toFixed(4), 'air', s2, preLand.at(-1)?.toFixed(0), landed.toFixed(0), bike.dynamics.state);
}
