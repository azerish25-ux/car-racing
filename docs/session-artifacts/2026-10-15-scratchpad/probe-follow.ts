import { DEFAULT_SETUP } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/config.ts';
import { AmbientTraffic } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/ambient-traffic.ts';
import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/world.ts';
import { Vehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/vehicle.ts';
import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/vehicles.ts';

const world = openWorld();
const edge = world.network.edges.find((e) => e.roadClass === 'country' && e.length > 500)!;
const other = new AmbientTraffic(world.network, 8);
const marker = other.place(edge.index, 1, 420, 0);
const player = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.tc1);
player.body.position.copy(marker.position);
player.body.orientation.yaw(marker.yaw);
other.cars.splice(other.cars.indexOf(marker), 1);
const chaser = other.place(edge.index, 1, 330, 16);
console.log('edge', edge.index, edge.length, 'player', player.body.position, 'yaw', marker.yaw, 'chaser', chaser.position, chaser.yaw);
for (let i = 0; i < 120 * 15; i++) {
  other.step(1 / 120, player);
  const before = other.collisions;
  other.collide(player);
  if (i % 60 === 0 || other.collisions !== before) {
    const dx = player.body.position.x - chaser.position.x,
      dz = player.body.position.z - chaser.position.z;
    console.log(i / 120, 's', chaser.s.toFixed(1), 'v', chaser.speed.toFixed(2), 'a', chaser.accel.toFixed(2), 'along', (dx * Math.sin(chaser.yaw) + dz * Math.cos(chaser.yaw)).toFixed(2), 'across', (dx * Math.cos(chaser.yaw) - dz * Math.sin(chaser.yaw)).toFixed(2), 'col', other.collisions, 'cars', other.cars.length, 'edge', chaser.edge);
  }
}
