const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation';
const { openWorld } = await import(W + '/open-world/world.ts');
const { OpenWorldTrack } = await import(W + '/open-world/open-world-track.ts');
const { surfaceSample } = await import(W + '/track.ts');
const { ROAD_FLAG } = await import(W + '/open-world/road-network.ts');
const world = openWorld();
const track = new OpenWorldTrack(world, 'clear', undefined, 600);
const net = world.network;
const out = surfaceSample();
// 1. Junction continuity: grid steps of 0.25 m within 40 m of each junction node.
let worst = 0, worstAt: any = null, over5 = 0, over15 = 0;
const step = 0.25;
for (const node of net.nodes) {
  if (node.edges.length < 2) continue;
  const N = Math.round(80 / step);
  const H = new Float64Array((N + 1) * (N + 1)).fill(NaN);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = node.x - 40 + i * step, z = node.z - 40 + j * step;
    track.sample(x, z, out, track.groundHeight(x, z) + 1);
    if (!track.query.onRoad || track.query.bridge) continue;
    if (Math.abs(out.height - node.y) > 6) continue;
    H[j * (N + 1) + i] = out.height;
  }
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const h = H[j * (N + 1) + i]; if (Number.isNaN(h)) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      if (i + di > N || j + dj > N) continue;
      const g = H[(j + dj) * (N + 1) + i + di]; if (Number.isNaN(g)) continue;
      const d = Math.abs(g - h);
      if (d > 0.05) over5++;
      if (d > 0.15) over15++;
      if (d > worst) { worst = d; worstAt = { node: node.index, x: node.x - 40 + i * step, z: node.z - 40 + j * step }; }
    }
  }
}
console.log('junction grid steps: worst', worst.toFixed(3), worstAt, '>5cm', over5, '>15cm', over15);
// 2. Shoulder edge step along every non-bridge, non-junction sample
let n15 = 0, worstS = 0, wAt: any = null;
for (const e of net.edges) {
  const edge = e.spec.halfWidth + e.spec.shoulder;
  for (let i = e.first; i <= e.last; i++) {
    if (net.flags[i] & (ROAD_FLAG.BRIDGE | ROAD_FLAG.JUNCTION)) continue;
    const nx = net.tz[i], nz = -net.tx[i];
    for (const side of [-1, 1]) {
      const a = edge - 0.05, b = edge + 0.05;
      const y = net.y[i] + 1;
      track.sample(net.x[i] + nx * side * a, net.z[i] + nz * side * a, out, y); const h1 = out.height;
      track.sample(net.x[i] + nx * side * b, net.z[i] + nz * side * b, out, y); const h2 = out.height;
      const d = Math.abs(h1 - h2);
      if (d > 0.15) n15++;
      if (d > worstS) { worstS = d; wAt = { id: e.id, x: net.x[i], z: net.z[i] }; }
    }
  }
}
console.log('shoulder edge: >15cm', n15, 'worst', worstS.toFixed(3), wAt);
// 3. Dead ends: 20 m past the end vs tile height
for (const node of net.nodes) {
  if (node.edges.length !== 1) continue;
  const e = net.edges[node.edges[0]];
  const i = e.from === node.index ? e.first : e.last;
  const dir = e.from === node.index ? -1 : 1;
  const x = node.x + net.tx[i] * dir * 20, z = node.z + net.tz[i] * dir * 20;
  track.sample(x, z, out, net.y[i] + 1);
  const tile = track.tiles.height(x, z);
  console.log('dead end', e.id, 'onRoad', track.query.onRoad, 'h', out.height.toFixed(2), 'tile', tile.toFixed(2), 'road', net.y[i].toFixed(2));
}
