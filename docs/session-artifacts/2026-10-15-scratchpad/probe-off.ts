const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation';
const { openWorld } = await import(W + '/open-world/world.ts');
const { OpenWorldTrack } = await import(W + '/open-world/open-world-track.ts');
const { surfaceSample, trackPoint } = await import(W + '/track.ts');
const { roadCandidates, ROAD_FLAG } = await import(W + '/open-world/road-network.ts');
const world = openWorld(); const net = world.network;
const track = new OpenWorldTrack(world, 'clear', undefined, 256);
const s = surfaceSample(); const c = roadCandidates(); const p = trackPoint();
let shown = 0;
for (const node of net.nodes) {
  if (node.edges.length < 2) continue;
  for (const edge of node.edges) {
    const e = net.edges[edge], hw = e.spec.halfWidth;
    for (let i = e.first; i < e.last; i++) {
      if (Math.hypot(net.x[i] - node.x, net.z[i] - node.z) >= 30 || (net.flags[i] & ROAD_FLAG.BRIDGE)) continue;
      for (let f = 0; f < 1; f += 0.25) {
        net.pointOnSegment(i, f, p);
        for (let l = -hw + 0.1; l <= hw - 0.1; l += 0.5) {
          const x = p.x + p.nx * l, z = p.z + p.nz * l;
          track.sample(x, z, s, p.y + 0.6);
          if (!track.query.onRoad && shown++ < 6) {
            console.log(e.id, 'node', node.index, 'seg', i, 'first', e.first, 'last', e.last, 'f', f, 'l', l.toFixed(2), 'py', p.y.toFixed(2));
            const n = net.covering(x, z, p.y + 0.6, 4, c);
            for (let k = 0; k < n; k++) console.log('   ', net.edges[net.edgeOf[c.segment[k]]].id, 'seg', c.segment[k], 'd', c.distance[k].toFixed(2), 'out', c.outside[k].toFixed(2));
            const n2 = net.covering(x, z, NaN, 4, c);
            console.log('   unlayered', n2, [...Array(n2).keys()].map(k => net.edges[net.edgeOf[c.segment[k]]].id + ':' + c.outside[k].toFixed(2) + ':y' + net.y[c.segment[k]].toFixed(2)).join(' '));
          }
        }
      }
    }
  }
}
