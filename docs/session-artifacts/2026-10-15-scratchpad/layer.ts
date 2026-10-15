const root = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { CIRCUITS, CIRCUIT_IDS } = await import(root + '/src/simulation/circuits.ts');
const { Track, trackPoint } = await import(root + '/src/simulation/track.ts');
for (const id of CIRCUIT_IDS.filter((i: string) => CIRCUITS[i].catalogue)) {
  const t = new Track('clear', false, undefined, CIRCUITS[id]);
  const step = 4, n = Math.floor(t.length / step), P: any[] = [];
  for (let i = 0; i < n; i++) { const q = trackPoint(); t.at(i * step, q); P.push({ x: q.x, z: q.z, y: q.y, w: q.width, s: q.s, nx: q.nx, nz: q.nz, bl: t.boundaryAt(q, -1), br: t.boundaryAt(q, 1) }); }
  let worst = Infinity, at = '', count = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const ds = Math.min((j - i) * step, t.length - (j - i) * step);
    if (ds < 150) continue;
    const a = P[i], b = P[j];
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d > 120 || ds < 4 * d) continue;
    const dy = Math.abs(a.y - b.y);
    if (dy <= 4) continue;
    const tj = dx * a.nx + dz * a.nz, ti = -dx * b.nx - dz * b.nz; const bi = tj < 0 ? a.bl : a.br, bj = ti < 0 ? b.bl : b.br; const margin = d - bi - bj;
    if (margin < -0.5) { count++; if (margin < worst) { worst = margin; at = `${a.s.toFixed(0)}/${b.s.toFixed(0)} d=${d.toFixed(1)} dy=${dy.toFixed(1)} wsum=${(a.w+b.w).toFixed(1)}`; } }
  }
  if (count) console.log(id.padEnd(22), 'cross-layer corridor overlaps', count, 'worst', worst.toFixed(1), at);
}
