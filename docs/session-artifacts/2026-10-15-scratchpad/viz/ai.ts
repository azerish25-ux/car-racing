import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
import { OpenWorldTrack, asTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/open-world-track.ts';
import { planRoute, RoutePath, pathPoint } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/route-path.ts';
import { RouteDriver } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/route-driver.ts';
import { Vehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/vehicle.ts';
import { vehicleDefinition } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/vehicles.ts';
import { CollisionSolver } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/collision.ts';
import { SOLVANE } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/region-data.ts';
const world = openWorld();
const owt = new OpenWorldTrack(world);
const track = asTrack(owt);
const ev = SOLVANE.events.find((e) => e.id === (process.argv[2] ?? 'coast-to-summit'))!;
const legs = planRoute(world.network, ev.waypoints, ev.kind === 'circuit');
const path = new RoutePath(world.network, legs, ev.kind === 'circuit');
console.log(
  'route',
  ev.id,
  'legs',
  path.legs.length,
  'length',
  path.length.toFixed(0),
  legs.map((l) => world.network.edges[l.edge].id + (l.dir > 0 ? '+' : '-')).join(' '),
);
const car = new Vehicle(0, 'medium', undefined, 'sport', vehicleDefinition(process.argv[3] ?? 'tc1'));
const start = pathPoint();
path.at(10, start);
const h = owt.groundHeight(start.x, start.z, start.y + 1);
car.body.position.set(start.x, h + 0.55, start.z);
car.body.orientation.yaw(Math.atan2(start.tx, start.tz));
const ai = new RouteDriver(car, path, 0.9);
const col = new CollisionSolver();
const t0 = performance.now();
let t = 0,
  maxTrouble = 0;
for (let tick = 0; tick < 120 * 900; tick++) {
  ai.update(1 / 120, [car]);
  for (let sub = 0; sub < 2; sub++) {
    car.step(1 / 240, track);
    col.solve([car], track);
  }
  owt.evolve(1 / 120, tick / 120);
  if (tick % 60 === 0) owt.tiles.want(car.body.position.x, car.body.position.z, car.body.velocity.x, car.body.velocity.z);
  owt.tiles.prefetch(2);
  t += 1 / 120;
  maxTrouble = Math.max(maxTrouble, ai.trouble);
  if (tick % (120 * 15) === 0)
    console.log(
      t.toFixed(0),
      'd',
      ai.d.toFixed(0),
      'v',
      (car.speed * 3.6).toFixed(0),
      'lat',
      ai.lateral.toFixed(1),
      ai.decision,
      'trouble',
      ai.trouble.toFixed(1),
      'up',
      car.up.y.toFixed(2),
      'surf',
      owt.query.surface,
    );
  if (ai.wantsReset) {
    console.log('RESET requested at', ai.d.toFixed(0), car.body.position.x.toFixed(0), car.body.position.z.toFixed(0));
    break;
  }
  if (!path.closed && ai.d > path.length - 5) {
    console.log('finished in', t.toFixed(1), 's avg', ((path.length / t) * 3.6).toFixed(1), 'km/h');
    break;
  }
}
console.log('wall ms', (performance.now() - t0).toFixed(0), JSON.stringify(owt.tiles.stats), 'maxTrouble', maxTrouble.toFixed(1));
