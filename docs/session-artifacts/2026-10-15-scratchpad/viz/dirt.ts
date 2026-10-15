import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
import { asTrack, OpenWorldTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/open-world-track.ts';
import { resolveEvents } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/festival-events.ts';
import { RouteDriver } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/route-driver.ts';
import { pathPoint } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/route-path.ts';
import { Vehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/vehicle.ts';
import { vehicleDefinition } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/vehicles.ts';
import { CollisionSolver } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/collision.ts';
const world = openWorld();
const ev = resolveEvents(world).find((e) => e.spec.id === (process.argv[2] ?? 'thornwood-rally'))!;
const track = new OpenWorldTrack(world),
  phys = asTrack(track),
  path = ev.path;
const car = new Vehicle(0, 'medium', undefined, 'sport', vehicleDefinition(process.argv[3] ?? 'tc1'));
const p = pathPoint();
path.at(4, p);
car.body.position.set(p.x, track.groundHeight(p.x, p.z, p.y + 0.5) + 0.62, p.z);
car.body.orientation.yaw(Math.atan2(p.tx, p.tz));
const ai = new RouteDriver(car, path, Number(process.env.SKILL ?? 0.9), 0, Number(process.env.CAP ?? Infinity) / 3.6);
const col = new CollisionSolver();
let t = 0,
  wasOff = false,
  offs = 0,
  offTime = 0;
const quiet = !!process.env.QUIET;
for (let tick = 0; tick < 120 * 400; tick++) {
  ai.update(1 / 120, [car]);
  for (let s = 0; s < 2; s++) {
    try {
      car.step(1 / 240, phys);
    } catch (e) {
      const b = car.body.position;
      console.log('ERROR', (e as Error).message, 't', t.toFixed(2), 'd', ai.d.toFixed(1), 'pos', b.x.toFixed(1), b.y.toFixed(2), b.z.toFixed(1), 'ground', track.groundHeight(b.x, b.z, b.y).toFixed(2), 'up', car.up.y.toFixed(2), 'v', car.speed.toFixed(1), 'vy', car.body.velocity.y.toFixed(1));
      process.exit(1);
    }
    col.solve([car], phys);
  }
  t += 1 / 120;
  if (tick % 30 === 0) track.tiles.want(car.body.position.x, car.body.position.z, car.body.velocity.x, car.body.velocity.z);
  track.tiles.prefetch(1);
  path.at(ai.d, p);
  const off = Math.abs(ai.lateral) > p.halfWidth + 1;
  if (off && !wasOff) offs++;
  if (off) offTime += 1 / 120;
  if (!quiet && (off !== wasOff || tick % 1200 === 0))
    console.log(t.toFixed(1), off ? 'OFF' : 'on ', 'd', ai.d.toFixed(0), 'lat', ai.lateral.toFixed(1), 'v', (car.speed * 3.6).toFixed(0), 'target', (car.aiTarget * 3.6).toFixed(0), 'k', path.curvature[path.index(ai.d)].toFixed(4), 'grip', car.contacts[0].grip.toFixed(2), ai.decision);
  wasOff = off;
  if (t > Number(process.env.T0 ?? 1e9) && t < Number(process.env.T1 ?? 0) && tick % 30 === 0)
    console.log('   ', t.toFixed(1), 'lat', ai.lateral.toFixed(2), 'line', path.lineAt(ai.d + 30).toFixed(2), 'steerCmd', car.input.steer.toFixed(3), 'steer', car.steer.toFixed(3), 'vx', car.localVelocity.x.toFixed(2), 'gLat', car.gLat.toFixed(2), 'vk', path.verticalCurvatureAt(ai.d).toFixed(4), 'y', p.y.toFixed(1), 'thr', car.input.throttle.toFixed(2), 'slip', car.tires.map((w) => w.slip.toFixed(2)).join('/'), 'dirt', car.tires[0].dirt.toFixed(2), 'surf', car.contacts.map((c) => c.surface).join(''));
  if (path.length - ai.d < 10) break;
}
console.log('SUMMARY', process.argv[2], process.argv[3], 'finished', path.length - ai.d < 10, 't', t.toFixed(1), 'd', ai.d.toFixed(0), '/', path.length.toFixed(0), 'offs', offs, 'offTime', offTime.toFixed(1));
