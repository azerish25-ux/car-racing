import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
import { OpenWorldTrack, asTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/open-world-track.ts';
import { Vehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/vehicle.ts';
import { TOURING_TC1 } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/vehicles.ts';
import { CollisionSolver } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/collision.ts';
let t0 = performance.now();
const world = openWorld();
console.log('world ms', (performance.now() - t0).toFixed(0), world.buildMs.toFixed(0));
const owt = new OpenWorldTrack(world);
const track = asTrack(owt);
const e = world.network.edges.find((x) => x.id === (process.argv[2] ?? 'h1#0'))!;
const car = new Vehicle(0, 'medium', undefined, 'sport', TOURING_TC1);
car.place(track, e.offset + 100, 0);
const col = new CollisionSolver();
t0 = performance.now();
for (let tick = 0; tick < 120 * 20; tick++) {
  car.input.throttle = 0.7;
  car.input.steer = 0;
  for (let sub = 0; sub < 2; sub++) {
    car.step(1 / 240, track);
    col.solve([car], track);
  }
  owt.evolve(1 / 120, tick / 120);
  if (tick % 240 === 0) {
    const g = owt.groundHeight(car.body.position.x, car.body.position.z, car.body.position.y);
    console.log(
      (tick / 120).toFixed(0),
      'v',
      car.speed.toFixed(1),
      'pos',
      car.body.position.x.toFixed(0),
      car.body.position.z.toFixed(0),
      'y-g',
      (car.body.position.y - g).toFixed(3),
      'lat',
      car.lateral.toFixed(2),
      'gear',
      car.gear,
      'surf',
      owt.query.surface,
    );
  }
}
console.log('ms per tick', ((performance.now() - t0) / 2400).toFixed(3), JSON.stringify(owt.tiles.stats));
