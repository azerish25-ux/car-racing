// Elevation diagnostics: profile.ts <id> — sharpest crests/dips and steepest grades.
const R = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1/src/simulation';
process.env.CATALOGUE_DEV = '1';
const { CIRCUITS } = await import(`${R}/circuits.ts`);
const { Track, trackPoint } = await import(`${R}/track.ts`);
for (const id of process.argv.slice(2)) {
  const t = new Track('clear', false, undefined, CIRCUITS[id]);
  const step = 4,
    n = Math.floor(t.length / step),
    p = trackPoint(),
    ys: number[] = [];
  for (let i = 0; i < n; i++) ys.push(t.at(i * step, p).y);
  const crest: [number, number][] = [],
    grade: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const c = (ys[(i + 1) % n] - 2 * ys[i] + ys[(i - 1 + n) % n]) / (step * step);
    if (c < 0) crest.push([-1 / c, i * step]);
    grade.push([Math.abs(ys[(i + 1) % n] - ys[i]) / step, i * step]);
  }
  crest.sort((a, b) => a[0] - b[0]);
  grade.sort((a, b) => b[0] - a[0]);
  const near = (list: [number, number][], k: number) => {
    const out: [number, number][] = [];
    for (const e of list) {
      if (out.every((o) => Math.abs(o[1] - e[1]) > 60)) out.push(e);
      if (out.length >= k) break;
    }
    return out;
  };
  console.log(id, 'crests', near(crest, 6).map(([r, s]) => `R${r.toFixed(0)}@${s}`).join(' '));
  console.log(id, 'grades', near(grade, 6).map(([g, s]) => `${(g * 100).toFixed(1)}%@${s}`).join(' '));
}
