const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/';
const { OpenWorld } = await import(W + 'open-world/world.ts');
const { OpenWorldTrack, asTrack } = await import(W + 'open-world/open-world-track.ts');
const { resolveEvents } = await import(W + 'open-world/festival-events.ts');
const { pathPoint } = await import(W + 'open-world/route-path.ts');
const { RouteDriver } = await import(W + 'open-world/route-driver.ts');
const { festivalDefaultVehicle } = await import(W + 'open-world/session.ts');
const { Vehicle } = await import(W + 'vehicle.ts');
const { vehicleDefinition } = await import(W + 'vehicles.ts');
const world = new OpenWorld();
const track = new OpenWorldTrack(world, 'clear', undefined, 256);
const physics = asTrack(track);
const ev = resolveEvents(world).find((e: any) => e.spec.id === 'kestrel-circuit');
const path = ev.path;
const car = new Vehicle(0, 'medium', undefined, 'sport', vehicleDefinition(festivalDefaultVehicle()));
const p = pathPoint();
path.at(1450, p);
const ground = track.groundHeight(p.x, p.z, p.y + 0.5);
car.body.position.set(p.x, ground + 0.62, p.z);
car.body.orientation.yaw(Math.atan2(p.tx, p.tz));
const driver = new RouteDriver(car, path, 0.9);
const dt = 1 / 120;
for (let k = 0; k < 120 * 20; k++) {
  driver.update(dt, [car]);
  for (let sub = 0; sub < 2; sub++) car.step(dt / 2, physics);
  if (driver.d > 1585 && driver.d < 1606 && k % 2 === 0) {
    console.log(`d=${driver.d.toFixed(1)} lat=${driver.lateral.toFixed(2)} v=${(car.speed * 3.6).toFixed(0)} wheels surf/grip ${car.contacts.map((c: any) => c.surface + '/' + c.grip.toFixed(2)).join(' ')} heights ${car.contacts.map((c: any) => c.height.toFixed(2)).join(' ')}`);
  }
  if (driver.d > 1610) break;
}
