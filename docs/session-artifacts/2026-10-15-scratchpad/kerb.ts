const W = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation';
const { DEFAULT_SETUP } = await import(`${W}/config.ts`);
const { BikeVehicle } = await import(`${W}/bike-vehicle.ts`);
const { Track, trackPoint } = await import(`${W}/track.ts`);
const { vehicleDefinition } = await import(`${W}/vehicles.ts`);
const { SURFACE } = await import(`${W}/protocol.ts`).catch(() => ({ SURFACE: null }));
const GPR1 = vehicleDefinition('gpr1');
const track = new Track();
const p = track.at(120, trackPoint());
console.log('width', p.width);
for (const click of [0, 0.5, 1]) {
  const bike = new BikeVehicle(0, 'medium', { ...DEFAULT_SETUP, frontDamping: click, rearDamping: click }, 'sport', GPR1);
  bike.place(track, 120, p.width + 0.5);
  bike.dynamics.speed = 30;
  bike.gear = 3; bike.autoShift = false; bike.input.throttle = 0.5;
  bike.step(1 / 120, track);
  bike.step(1 / 120, track);
  console.log('kerb', click, bike.contacts[0].surface, bike.contacts[2].surface, bike.dynamics.grip);
}
for (const click of [0, 0.5, 1]) {
  const bike = new BikeVehicle(0, 'medium', { ...DEFAULT_SETUP, frontDamping: click, rearDamping: click }, 'sport', GPR1);
  bike.place(track, 120);
  bike.dynamics.speed = 40;
  bike.gear = 4; bike.autoShift = false; bike.input.throttle = 0.3;
  for (let t = 0; t < 0.5; t += 1 / 120) bike.step(1 / 120, track);
  const f0 = bike.fork;
  bike.input.throttle = 0; bike.input.brake = 1;
  for (let t = 0; t < 0.05; t += 1 / 120) bike.step(1 / 120, track);
  const f1 = bike.fork;
  for (let t = 0; t < 0.4; t += 1 / 120) bike.step(1 / 120, track);
  console.log('fork', click, f0.toFixed(4), f1.toFixed(4), bike.fork.toFixed(4), bike.dynamics.state);
}
