const W = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { CIRCUITS } = await import(W + '/src/simulation/circuits.ts');
const { Track, trackPoint } = await import(W + '/src/simulation/track.ts');
for (const id of process.argv.slice(2)) {
  const t = new Track('clear', false, undefined, CIRCUITS[id]);
  const p = trackPoint();
  // list local minima of radius < 30
  let out: string[] = [];
  let prev = 0;
  for (let s = 0; s < t.length; s += 5) {
    t.at(s, p);
    const r = 1 / Math.abs(p.curvature);
    if (r < 30) { if (s - prev > 60) out.push(`${s}:R${r.toFixed(0)} g${(p.gradient*100).toFixed(1)}%`); prev = s; }
  }
  console.log(id, out.join(' '));
}
