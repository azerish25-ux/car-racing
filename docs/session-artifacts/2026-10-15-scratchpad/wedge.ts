const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/';
const { OpenWorld } = await import(W + 'open-world/world.ts');
const { OpenWorldTrack, WORLD_SURFACE_NAMES } = await import(W + 'open-world/open-world-track.ts');
const { surfaceSample } = await import(W + 'track.ts');
const world = new OpenWorld();
const track = new OpenWorldTrack(world, 'clear', undefined, 2048);
const net = world.network;
const s = surfaceSample();
const distTo = (x: number, z: number, ei: number) => {
  const e = net.edges[ei]; let best = Infinity;
  for (let i = e.first; i < e.last; i++) {
    const ax = net.x[i], az = net.z[i], dx = net.x[i + 1] - ax, dz = net.z[i + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
};
let total = 0;
for (const node of net.nodes) {
  if (node.edges.length < 3) continue;
  const widths = node.edges.map((ei: number) => net.edges[ei].spec.halfWidth + net.edges[ei].spec.shoulder);
  let area = 0, gripLoss = 0, example = '';
  const step = 0.5;
  for (let dx = -20; dx <= 20; dx += step)
    for (let dz = -20; dz <= 20; dz += step) {
      const x = node.x + dx, z = node.z + dz;
      // inside the paved width of some incident edge (true distance)?
      let inside = -1;
      node.edges.forEach((ei: number, k: number) => { if (inside < 0 && distTo(x, z, ei) <= net.edges[ei].spec.halfWidth) inside = ei; });
      if (inside < 0) continue;
      track.sample(x, z, s, node.y + 0.6);
      if (!track.query.onRoad) {
        area += step * step;
        if (!example) example = `(${dx},${dz}) on ${net.edges[inside].id} reads ${WORLD_SURFACE_NAMES[track.query.surface]} grip ${s.grip.toFixed(2)} nearest ${net.edges[track.query.edge].id}`;
      }
    }
  if (area > 0) { total += area; console.log(`node ${node.index} [${node.edges.map((e: number) => net.edges[e].id + '/' + net.edges[e].spec.halfWidth).join(' ')}] paved area read as off-road: ${area.toFixed(1)} m2  e.g. ${example}`); }
}
console.log('total', total.toFixed(0), 'm2');
