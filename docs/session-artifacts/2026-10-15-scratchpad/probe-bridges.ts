const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation';
const { openWorld } = await import(W + '/open-world/world.ts');
const { ROAD_FLAG } = await import(W + '/open-world/road-network.ts');
const net = openWorld().network;
for (const e of net.edges) { let on = false, start = 0; for (let i = e.first; i <= e.last; i++) { const b = !!(net.flags[i] & ROAD_FLAG.BRIDGE); if (b && !on) start = i; if (!b && on) console.log(e.road.id, net.x[start].toFixed(0), net.z[start].toFixed(0), (net.s[i]-net.s[start]).toFixed(0)); on = b; } if (on) console.log(e.road.id, net.x[start].toFixed(0), net.z[start].toFixed(0), 'to end'); }
