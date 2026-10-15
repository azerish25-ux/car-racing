const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation';
const { openWorld } = await import(W + '/open-world/world.ts');
const { OpenWorldTrack } = await import(W + '/open-world/open-world-track.ts');
const { surfaceSample, trackPoint } = await import(W + '/track.ts');
const { roadCandidates } = await import(W + '/open-world/road-network.ts');
const world = openWorld(); const net = world.network;
const track = new OpenWorldTrack(world, 'clear', undefined, 256);
const s = surfaceSample(); const c = roadCandidates(); const p = trackPoint();
const id = Number(process.argv[2] ?? 20);
const node = net.nodes[id];
const ground = (x: number, z: number) => track.sample(x, z, s, track.groundHeight(x, z) + 0.6).height;
let worst = 0, wx = 0, wz = 0, wx2 = 0, wz2 = 0;
const step = 0.5;
for (let x = node.x - 30; x < node.x + 30; x += step) for (let z = node.z - 30; z < node.z + 30; z += step) {
  const a = ground(x, z); if (!track.query.onRoad) continue;
  for (const [x2, z2] of [[x + step, z], [x, z + step]]) { const b = ground(x2, z2); if (!track.query.onRoad) continue; if (Math.abs(b - a) > worst) { worst = Math.abs(b - a); wx = x; wz = z; wx2 = x2; wz2 = z2; } }
}
console.log('worst', worst, wx - node.x, wz - node.z);
for (const [x, z] of [[wx, wz], [wx2, wz2]]) {
  const y = track.groundHeight(x, z) + 0.6;
  track.sample(x, z, s, y);
  console.log('h', s.height.toFixed(3), 'surf', track.query.surface, 'edge', net.edges[track.query.edge].id);
  const n = net.covering(x, z, y, 4, c);
  for (let k = 0; k < n; k++) { const i = c.segment[k]; net.pointOnSegment(i, c.t[k], p); const e = net.edges[net.edgeOf[i]]; console.log('  ', e.id, 'd', c.distance[k].toFixed(2), 'out', c.outside[k].toFixed(2), 'cy', p.y.toFixed(3), 'bank', p.bank.toFixed(3), 'lat', ((x - p.x) * p.nx + (z - p.z) * p.nz).toFixed(2), 's', (p.s - e.offset).toFixed(1)); }
}
