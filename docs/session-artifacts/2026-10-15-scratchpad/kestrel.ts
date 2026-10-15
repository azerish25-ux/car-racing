const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/';
const { OpenWorld } = await import(W + 'open-world/world.ts');
const { OpenWorldTrack, WORLD_SURFACE_NAMES } = await import(W + 'open-world/open-world-track.ts');
const { resolveEvents } = await import(W + 'open-world/festival-events.ts');
const { pathPoint } = await import(W + 'open-world/route-path.ts');
const { surfaceSample } = await import(W + 'track.ts');
const world = new OpenWorld();
const track = new OpenWorldTrack(world, 'clear', undefined, 2048);
const net = world.network;
const s = surfaceSample();
const pp = pathPoint();
const ev = resolveEvents(world).find((e: any) => e.spec.id === 'kestrel-circuit');
const path = ev.path;
// distance from point to each edge centreline (min over segments)
const distTo = (x: number, z: number, ei: number) => {
  const e = net.edges[ei]; let best = Infinity;
  for (let i = e.first; i < e.last; i++) {
    const ax = net.x[i], az = net.z[i], dx = net.x[i + 1] - ax, dz = net.z[i + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
};
const ids = ['airfield#0', 'airfield#1', 'thornwood#0'].map((id) => net.edges.findIndex((e: any) => e.id === id));
for (const id of ids) console.log(net.edges[id].id, 'hw', net.edges[id].spec.halfWidth, 'shoulder', net.edges[id].spec.shoulder, 'surface', net.edges[id].spec.surface);
for (let d = 1588; d <= 1603; d += 1) {
  path.at(d, pp);
  const lat = path.lineAt(d);
  const x = pp.x + pp.nx * lat, z = pp.z + pp.nz * lat;
  track.sample(x, z, s, pp.y + 0.6);
  console.log(`d=${d} line=${lat.toFixed(2)} pathHalfWidth=${pp.halfWidth} pathEdge=${net.edges[pp.edge].id} h=${s.height.toFixed(2)} grip=${s.grip.toFixed(2)} surf=${WORLD_SURFACE_NAMES[track.query.surface]} onRoad=${track.query.onRoad} nearest=${net.edges[track.query.edge].id} | dists ${ids.map((i) => distTo(x, z, i).toFixed(1)).join(' ')}`);
}
