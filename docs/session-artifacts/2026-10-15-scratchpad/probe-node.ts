const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation';
const { openWorld } = await import(W + '/open-world/world.ts');
const world = openWorld();
const net = world.network;
for (const id of [19, 20, 18, 5, 16]) {
  const node = net.nodes[id];
  console.log('node', id, node.x.toFixed(1), node.z.toFixed(1), node.y.toFixed(2));
  for (const ei of node.edges) {
    const e = net.edges[ei];
    const fromStart = e.from === id;
    const idx = (k: number) => fromStart ? e.first + k : e.last - k;
    const i0 = idx(0), i1 = idx(1), i3 = idx(3), i6 = idx(6);
    const ang = Math.atan2(net.x[i1] - net.x[i0], net.z[i1] - net.z[i0]) * 180 / Math.PI;
    const r = (i: number) => Math.hypot(net.x[i] - node.x, net.z[i] - node.z).toFixed(1);
    console.log('  ', e.id, e.roadClass, 'hw', e.spec.halfWidth, 'dir', ang.toFixed(0), 'y@', r(i1), (net.y[i1]-node.y).toFixed(2), r(i3), (net.y[i3]-node.y).toFixed(2), r(i6), (net.y[i6]-node.y).toFixed(2), 'bank', net.bank[i3].toFixed(3));
  }
}
