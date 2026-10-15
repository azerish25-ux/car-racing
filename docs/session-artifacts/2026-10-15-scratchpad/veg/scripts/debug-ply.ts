import { readFileSync } from 'node:fs';
import { parsePly } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/ply.ts';

const mesh = parsePly(new Uint8Array(readFileSync(process.argv[2])));
const P = mesh.positions, I = mesh.indices;
let area = 0, maxEdge = 0, degenerate = 0, bad = 0;
const n = P.length / 3;
for (let t = 0; t < I.length; t += 3) {
  const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
  if (a >= n || b >= n || c >= n) { bad++; continue; }
  const u = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]);
  const v = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
  const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const ar = 0.5 * Math.hypot(...cr);
  if (ar < 1e-9) degenerate++;
  area += ar;
  maxEdge = Math.max(maxEdge, Math.hypot(...u), Math.hypot(...v));
}
console.log('verts', n, 'tris', I.length / 3, 'area', area.toFixed(2), 'maxEdge', maxEdge.toFixed(2), 'degenerate', degenerate, 'bad', bad);
console.log('first tris', Array.from(I.slice(0, 12)));
console.log('first verts', Array.from(P.slice(0, 9)).map((v) => v.toFixed(2)));
