const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation';
const { openWorld } = await import(W + '/open-world/world.ts');
const { OpenWorldTrack } = await import(W + '/open-world/open-world-track.ts');
const { surfaceSample } = await import(W + '/track.ts');
const world = openWorld();
const track = new OpenWorldTrack(world, 'clear', undefined, 600);
const net = world.network;
const out = surfaceSample();
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
  let over = 0, worst = 0;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const h = H[j * (N + 1) + i]; if (Number.isNaN(h)) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      if (i + di > N || j + dj > N) continue;
      const g = H[(j + dj) * (N + 1) + i + di]; if (Number.isNaN(g)) continue;
      const d = Math.abs(g - h);
      if (d > 0.15) over++;
      worst = Math.max(worst, d);
    }
  }
  if (over) console.log('node', node.index, node.edges.map((e: number) => net.edges[e].id).join(','), 'pairs>15cm', over, 'worst', worst.toFixed(2));
}
