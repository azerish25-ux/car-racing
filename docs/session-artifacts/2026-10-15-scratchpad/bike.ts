const root = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { CIRCUITS, CIRCUIT_IDS } = await import(root + '/src/simulation/circuits.ts');
const { Track, trackPoint, SURFACE } = await import(root + '/src/simulation/track.ts');
for (const id of CIRCUIT_IDS.filter((i: string) => CIRCUITS[i].bikeSafe)) {
  const t = new Track('clear', false, undefined, CIRCUITS[id]);
  const p = trackPoint();
  const runs: string[] = [];
  let start = -1, minR = Infinity;
  for (let s = 0; s < t.length; s += 1) {
    t.at(s, p);
    const corner = Math.abs(p.curvature) > 1 / 250;
    const outside = p.curvature < 0 ? 1 : -1;
    const grass = corner && t.runoffSurface(p, outside * (p.width + 6)) === SURFACE.GRASS;
    if (grass) { if (start < 0) { start = s; minR = Infinity; } minR = Math.min(minR, 1 / Math.abs(p.curvature)); }
    else if (start >= 0) { runs.push(`${start}-${s}(${s - start}m,R${minR.toFixed(0)})`); start = -1; }
  }
  console.log(id, runs.filter(r => true).join(' '));
}
