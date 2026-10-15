import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
import { OpenWorldTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/open-world-track.ts';
import { surfaceSample } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/track.ts';
import { ROAD_FLAG } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/road-network.ts';
const t0 = performance.now();
const world = openWorld();
const track = new OpenWorldTrack(world, 'clear', undefined, 400);
console.log('build', performance.now() - t0);
const net = world.network;
const out = surfaceSample();
let total = 0;
const perNode: Record<number, number> = {};
let maxStep = 0, maxStepNode = -1;
for (const node of net.nodes) {
  if (node.edges.length < 2) continue;
  for (const ei of node.edges) {
    const e = net.edges[ei];
    // samples within 40 m of the node
    for (let i = e.first; i < e.last; i++) {
      if (Math.hypot(net.x[i] - node.x, net.z[i] - node.z) > 40) continue;
      if (net.flags[i] & ROAD_FLAG.BRIDGE) continue;
      const tx = net.tx[i], tz = net.tz[i], nx = tz, nz = -tx;
      const hw = e.spec.halfWidth;
      for (let along = 0; along < Math.hypot(net.x[i+1]-net.x[i], net.z[i+1]-net.z[i]); along += 0.5)
      for (let l = -hw + 0.1; l <= hw - 0.1; l += 0.5) {
        const x = net.x[i] + tx * along + nx * l, z = net.z[i] + tz * along + nz * l;
        const y = net.y[i] + 1;
        track.sample(x, z, out, y);
        if (!track.query.onRoad) { total += 0.25; perNode[node.index] = (perNode[node.index] ?? 0) + 0.25; }
      }
    }
  }
}
console.log('offroad m2 at junctions', total, perNode);
