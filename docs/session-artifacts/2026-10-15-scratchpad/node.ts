const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/';
const { OpenWorld } = await import(W + 'open-world/world.ts');
const { OpenWorldTrack } = await import(W + 'open-world/open-world-track.ts');
const { surfaceSample, trackPoint } = await import(W + 'track.ts');
const world = new OpenWorld();
const track = new OpenWorldTrack(world, 'clear', undefined, 2048);
const net = world.network;
const s = surfaceSample();
for (const id of [19, 10, 2, 18]) {
  const node = net.nodes[id];
  console.log('node', id, 'xz', node.x.toFixed(1), node.z.toFixed(1), 'y', node.y.toFixed(2), node.kind);
  for (const ei of node.edges) {
    const e = net.edges[ei];
    const atFrom = e.from === id;
    const i = atFrom ? e.first : e.last;
    const j = atFrom ? e.first + 3 : e.last - 3;
    const ds = Math.abs(net.s[j] - net.s[i]);
    console.log('  edge', e.id, e.roadClass, 'end', atFrom ? 'from' : 'to', 'xz', net.x[i].toFixed(1), net.z[i].toFixed(1), 'y', net.y[i].toFixed(2), 'grade', ((net.y[j] - net.y[i]) / ds).toFixed(3), 'hw', e.spec.halfWidth, 'sh', e.spec.shoulder, 'crown', e.spec.crown, 'bank', net.bank[i].toFixed(3));
  }
  // walk a line across the node along x and z and print the sampled heights
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    const line: string[] = [];
    for (let k = -12; k <= 12; k += 1.5) {
      track.sample(node.x + ax * k, node.z + az * k, s, node.y + 0.6);
      line.push(`${k}:${s.height.toFixed(2)}${track.query.onRoad ? '' : '*'}(${net.edges[track.query.edge].id})`);
    }
    console.log('  ', ax ? 'x' : 'z', line.join(' '));
  }
}
