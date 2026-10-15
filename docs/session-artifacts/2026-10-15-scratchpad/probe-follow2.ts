import { DEFAULT_SETUP } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/config.ts';
import { AmbientTraffic } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/ambient-traffic.ts';
import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/world.ts';
import { Vehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/vehicle.ts';
import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/vehicles.ts';

const world = openWorld();
const edge = world.network.edges.find((e) => e.roadClass === 'country' && e.length > 500)!;
const traffic = new AmbientTraffic(world.network, 7);
const lead = traffic.place(edge.index, 1, 260, 0),
  follower = traffic.place(edge.index, 1, 180, 18);
lead.stunned = 30;
const player = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.tc1);
const fx = Math.sin(follower.yaw),
  fz = Math.cos(follower.yaw);
player.body.position.set(follower.position.x + fz * 40, 0, follower.position.z - fx * 40);
for (let i = 0; i < 120 * 20; i++) traffic.step(1 / 120, player);
const other = new AmbientTraffic(world.network, 8),
  marker = other.place(edge.index, 1, 420, 0);
player.body.position.copy(marker.position);
player.body.orientation.yaw(marker.yaw);
other.cars.splice(other.cars.indexOf(marker), 1);
const chaser = other.place(edge.index, 1, 330, 16);
for (let i = 0; i < 120 * 15; i++) other.step(1 / 120, player);
console.log('player v', player.body.velocity, 'omega', player.body.omega);
for (const c of other.cars) {
  const d = Math.hypot(c.position.x - player.body.position.x, c.position.z - player.body.position.z);
  if (d < 12) console.log('near', c.id, d.toFixed(2), 'v', c.speed.toFixed(2), 'edge', c.edge, 'dir', c.dir, 'lat', c.lateral.toFixed(2), 'y', c.position.y.toFixed(2), 'py', player.body.position.y.toFixed(2), c === chaser);
}
other.collide(player);
console.log('collisions', other.collisions);
