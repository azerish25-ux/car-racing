import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
const world = openWorld();
const net = world.network;
for (const id of (process.argv[2] ?? 'pass').split(',')) {
  for (const e of net.edges.filter((x) => x.road.id === id)) {
    console.log(e.id, 'len', e.length.toFixed(0), 'from', e.from, 'to', e.to);
    let next = 0,
      top = -Infinity,
      topAt = '';
    for (let i = e.first; i <= e.last; i++) {
      const s = net.s[i] - e.offset;
      if (net.y[i] > top) {
        top = net.y[i];
        topAt = `${net.x[i].toFixed(0)},${net.z[i].toFixed(0)} s=${s.toFixed(0)}`;
      }
      if (s >= next) {
        console.log('  s', s.toFixed(0), 'x', net.x[i].toFixed(0), 'z', net.z[i].toFixed(0), 'y', net.y[i].toFixed(0), 'k', net.curvature[i].toFixed(4));
        next += Number(process.argv[3] ?? 500);
      }
    }
    console.log('  top', top.toFixed(0), topAt);
  }
}
