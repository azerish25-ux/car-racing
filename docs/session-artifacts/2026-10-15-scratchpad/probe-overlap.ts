import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
import { trackPoint } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/track.ts';
import { clamp } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/core/math.ts';
const world = openWorld();
const net = world.network;
const p = trackPoint();
function surf(i: number, x: number, z: number) {
  const j = i + 1, ax = net.x[i], az = net.z[i], dx = net.x[j] - ax, dz = net.z[j] - az, len2 = dx*dx+dz*dz||1;
  const t = clamp(((x-ax)*dx+(z-az)*dz)/len2, 0, 1);
  const px = ax+dx*t, pz = az+dz*t, d = Math.hypot(x-px, z-pz);
  const e = net.edges[net.edgeOf[i]];
  if (d > e.spec.halfWidth + e.spec.shoulder) return null;
  net.pointOnSegment(i, t, p);
  const lat = (x-p.x)*p.nx + (z-p.z)*p.nz;
  const hw = e.spec.halfWidth, l = clamp(lat, -hw, hw), crownLeft = Math.max(0, e.spec.crown - Math.abs(p.bank));
  let h = p.y + p.bank*l - crownLeft*Math.abs(l);
  if (Math.abs(lat) > hw) h -= 0.06 + (Math.abs(lat)-hw)*0.03;
  return { h, edge: e.index, margin: hw + e.spec.shoulder - d, d };
}
const g = net.grid;
const hist: Record<string, number> = {};
const worst: any[] = [];
for (const node of net.nodes) {
  if (node.edges.length < 2) continue;
  for (let x = node.x - 60; x <= node.x + 60; x += 0.5)
  for (let z = node.z - 60; z <= node.z + 60; z += 0.5) {
    const cx = Math.floor((x - g.x0)/32), cz = Math.floor((z - g.z0)/32), cell = cz*g.cols+cx;
    const byEdge = new Map<number, any>();
    for (let k = g.start[cell]; k < g.start[cell+1]; k++) {
      const s = surf(g.items[k], x, z);
      if (!s) continue;
      const prev = byEdge.get(s.edge);
      if (!prev || s.d < prev.d) byEdge.set(s.edge, s);
    }
    if (byEdge.size < 2) continue;
    const hs = [...byEdge.values()].map(v=>v.h);
    const diff = Math.max(...hs) - Math.min(...hs);
    const b = diff < 0.02 ? '<2cm' : diff < 0.05 ? '<5cm' : diff < 0.15 ? '<15cm' : diff < 0.4 ? '<40cm' : '>40cm';
    hist[b] = (hist[b] ?? 0) + 0.25;
    if (diff > 0.4) worst.push({ node: node.index, x, z, diff: +diff.toFixed(2), edges: [...byEdge.keys()].map(e=>net.edges[e].id) });
  }
}
console.log(hist);
const byNode: Record<string, any> = {};
for (const w of worst) { const k = w.node + ' ' + w.edges.join('/'); byNode[k] = byNode[k] ? { n: byNode[k].n + 0.25, max: Math.max(byNode[k].max, w.diff) } : { n: 0.25, max: w.diff }; }
console.log(byNode);
