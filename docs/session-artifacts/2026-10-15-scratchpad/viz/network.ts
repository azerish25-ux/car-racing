import { writePng } from './png.ts';
import { TerrainField } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/terrain-field.ts';
import { SOLVANE } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/region-data.ts';
import { RoadNetwork, ROAD_FLAG } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/road-network.ts';
import { validateRoute } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/route-graph.ts';
const f = new TerrainField(SOLVANE);
let t0 = performance.now();
const net = new RoadNetwork(SOLVANE, f);
console.log('build ms', (performance.now() - t0).toFixed(1));
console.log(JSON.stringify(net.stats()));
t0 = performance.now();
const spec = net.routeSpec();
console.log('routeSpec ms', (performance.now() - t0).toFixed(1), 'edges', spec.edges.length, 'errors', validateRoute(spec));
// cut / fill stats per road
const roads = new Map<string, { cut: number; fill: number; grade: number; at: string; gat: string }>();
for (const e of net.edges) {
  const r = roads.get(e.road.id) ?? { cut: 0, fill: 0, grade: 0, at: '', gat: '' };
  for (let i = e.first; i <= e.last; i++) {
    const d = net.y[i] - net.ground[i];
    if (!(net.flags[i] & ROAD_FLAG.BRIDGE)) {
      if (d < r.cut) r.at = `${Math.round(net.x[i])},${Math.round(net.z[i])} s=${Math.round(net.s[i]-e.offset)}/${Math.round(e.length)} ${e.id}`;
      r.cut = Math.min(r.cut, d);
      r.fill = Math.max(r.fill, d);
    }
    if (Math.abs(net.gradient[i]) > r.grade) r.gat = `${Math.round(net.x[i])},${Math.round(net.z[i])} ${e.id} i=${i - e.first}/${e.last - e.first}`;
    r.grade = Math.max(r.grade, Math.abs(net.gradient[i]));
  }
  roads.set(e.road.id, r);
}
for (const [id, r] of roads) console.log(id.padEnd(12), 'cut', r.cut.toFixed(1), 'fill', r.fill.toFixed(1), 'grade', r.grade.toFixed(3), 'cutAt', r.at, 'gradeAt', r.gat);
for (const n of net.nodes) if (n.edges.length) console.log('node', n.index, n.kind, n.edges.length, Math.round(n.x), Math.round(n.z), n.y.toFixed(1));
const N = 1024,
  half = Number(process.argv[3] ?? 4300),
  cxw = Number(process.argv[4] ?? 0),
  czw = Number(process.argv[5] ?? 0),
  step = (2 * half) / N;
const rgb = new Uint8Array(N * N * 3);
const hs = new Float32Array(N * N);
for (let j = 0; j < N; j++)
  for (let i = 0; i < N; i++) hs[j * N + i] = f.height(cxw - half + i * step, czw + half - j * step, step);
for (let j = 0; j < N; j++)
  for (let i = 0; i < N; i++) {
    const h = hs[j * N + i];
    const hx = hs[j * N + Math.min(N - 1, i + 1)] - h,
      hz = hs[Math.min(N - 1, j + 1) * N + i] - h;
    const shade = Math.max(0.3, Math.min(1.3, 0.85 + ((-hx + hz) / step) * 1.2));
    const k = (j * N + i) * 3;
    const c = h < 0 ? [40, 80, 130] : h > 560 ? [235, 235, 240] : [90 + h * 0.2, 130 + h * 0.1, 70];
    rgb[k] = Math.min(255, c[0] * shade);
    rgb[k + 1] = Math.min(255, c[1] * shade);
    rgb[k + 2] = Math.min(255, c[2] * shade);
  }
const colors: Record<string, number[]> = {
  highway: [255, 220, 60],
  country: [255, 255, 255],
  mountain: [255, 120, 40],
  town: [200, 200, 255],
  dirt: [160, 100, 50],
  runway: [60, 60, 60],
};
const plot = (x: number, z: number, c: number[], r = 1) => {
  const i = Math.round((x - cxw + half) / step),
    j = Math.round((czw + half - z) / step);
  for (let a = -r; a <= r; a++)
    for (let b = -r; b <= r; b++) {
      if (i + a < 0 || j + b < 0 || i + a >= N || j + b >= N) continue;
      const k = ((j + b) * N + i + a) * 3;
      rgb[k] = c[0];
      rgb[k + 1] = c[1];
      rgb[k + 2] = c[2];
    }
};
for (const e of net.edges)
  for (let i = e.first; i <= e.last; i++) {
    const c = net.flags[i] & ROAD_FLAG.BRIDGE ? [255, 0, 255] : net.flags[i] & (ROAD_FLAG.BARRIER_LEFT | ROAD_FLAG.BARRIER_RIGHT) ? [255, 0, 0] : colors[e.roadClass];
    plot(net.x[i], net.z[i], c, Math.max(0, Math.round(e.spec.halfWidth / step)));
  }
for (const n of net.nodes) if (n.edges.length) plot(n.x, n.z, n.kind === 'junction' ? [0, 255, 255] : [0, 0, 255], 3);
writePng(process.argv[2] ?? '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/viz/network.png', N, N, rgb);
