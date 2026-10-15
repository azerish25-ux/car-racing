const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/';
const { OpenWorld } = await import(W + 'open-world/world.ts');
const { OpenWorldTrack } = await import(W + 'open-world/open-world-track.ts');
const { surfaceSample } = await import(W + 'track.ts');
const world = new OpenWorld();
const track = new OpenWorldTrack(world, 'clear', undefined, 2048);
const net = world.network;
const s = surfaceSample();
const h = 0.25;
const rows: string[] = [];
for (const node of net.nodes) {
  if (node.edges.length < 2) continue;
  let worst = 0, at = '';
  for (let dx = -14; dx <= 14; dx += h)
    for (let dz = -14; dz <= 14; dz += h) {
      const x = node.x + dx, z = node.z + dz;
      track.sample(x, z, s, node.y + 0.6); const h0 = s.height, on0 = track.query.onRoad, e0 = track.query.edge;
      if (!on0) continue;
      track.sample(x + h, z, s, node.y + 0.6); const h1 = s.height, on1 = track.query.onRoad, e1 = track.query.edge;
      track.sample(x, z + h, s, node.y + 0.6); const h2 = s.height, on2 = track.query.onRoad, e2 = track.query.edge;
      for (const [hh, on, e] of [[h1, on1, e1], [h2, on2, e2]] as const) {
        if (!on) continue;
        const d = Math.abs(hh - h0);
        if (d > worst) { worst = d; at = `(${dx},${dz}) edges ${net.edges[e0].id}->${net.edges[e].id}`; }
      }
    }
  rows.push(`${worst.toFixed(3)} node ${node.index} deg ${node.edges.length} ${at}`);
}
rows.sort((a, b) => parseFloat(b) - parseFloat(a));
console.log(rows.slice(0, 15).join('\n'));
