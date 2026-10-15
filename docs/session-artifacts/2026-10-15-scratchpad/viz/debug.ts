import { TerrainField } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/terrain-field.ts';
import { SOLVANE } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/region-data.ts';
import { RoadNetwork } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/road-network.ts';
const f = new TerrainField(SOLVANE);
const net = new RoadNetwork(SOLVANE, f);
const id = process.argv[2] ?? 'valley#4';
const e = net.edges.find((x) => x.id === id)!;
console.log(e.id, e.from, e.to, e.length);
for (let i = e.first; i < e.first + 6; i++)
  console.log(i - e.first, net.x[i].toFixed(2), net.z[i].toFixed(2), net.y[i].toFixed(2), net.s[i].toFixed(2), net.gradient[i].toFixed(3));
const prev = net.edges.find((x) => x.road.id === e.road.id && x.to === e.from);
if (prev)
  for (let i = prev.last - 4; i <= prev.last; i++)
    console.log('prev', i - prev.first, net.x[i].toFixed(2), net.z[i].toFixed(2), net.y[i].toFixed(2), net.s[i].toFixed(2), net.gradient[i].toFixed(3));
