const root = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { CIRCUITS, CIRCUIT_IDS } = await import(root + '/src/simulation/circuits.ts');
const { Track, trackPoint } = await import(root + '/src/simulation/track.ts');
const { trackGeometryReport, bikeSafetyReport } = await import(root + '/src/simulation/circuit-catalogue/geometry-checks.ts');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : CIRCUIT_IDS.filter((id: string) => CIRCUITS[id].catalogue && !['aurel','vellamar'].includes(id));
for (const id of ids) {
  const def = CIRCUITS[id];
  const t = new Track('clear', false, undefined, def);
  const r = trackGeometryReport(t);
  const p = trackPoint();
  let lo = Infinity, hi = -Infinity, maxBank = 0, maxGrad = 0, maxCurv = 0;
  for (let s = 0; s < t.length; s += 2) { t.at(s, p); lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); maxBank = Math.max(maxBank, Math.abs(p.bank)); maxGrad = Math.max(maxGrad, Math.abs(p.gradient)); maxCurv = Math.max(maxCurv, Math.abs(p.curvature)); }
  // surfaces overlapping in plan on different layers with insufficient clearance
  const step = 4, n = Math.floor(t.length / step);
  const P = [] as any[];
  for (let i = 0; i < n; i++) { const q = trackPoint(); t.at(i * step, q); P.push({ x: q.x, z: q.z, y: q.y, w: q.width, s: q.s, nx: q.nx, nz: q.nz, bl: t.boundaryAt(q, -1), br: t.boundaryAt(q, 1) }); }
  let worstRoad = Infinity, worstRoadAt = '';
  let worstCorr = Infinity, worstCorrAt = '';
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const ds = Math.min((j - i) * step, t.length - (j - i) * step);
    if (ds < 150) continue;
    const a = P[i], b = P[j];
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d > 80) continue;
    if (ds < 4 * d) continue;
    const dy = Math.abs(a.y - b.y);
    // road surface overlap
    if (d < a.w + b.w + 2 && dy < 6.5) { const m = dy; if (m < worstRoad) { worstRoad = m; worstRoadAt = `${a.s.toFixed(0)}/${b.s.toFixed(0)} d=${d.toFixed(1)} dy=${dy.toFixed(2)}`; } }
    // barrier corridor overlap on a different layer (skipped by validator) with low separation
    if (dy > 4) { const tj = dx * a.nx + dz * a.nz, ti = -dx * b.nx - dz * b.nz; const bi = tj < 0 ? a.bl : a.br, bj = ti < 0 ? b.bl : b.br; const margin = d - bi - bj; if (margin < -0.5 && dy < 6.5) { if (margin < worstCorr) { worstCorr = margin; worstCorrAt = `${a.s.toFixed(0)}/${b.s.toFixed(0)} d=${d.toFixed(1)} dy=${dy.toFixed(2)} m=${margin.toFixed(1)}`; } } }
  }
  const bike = def.bikeSafe ? bikeSafetyReport(t) : null;
  console.log(id.padEnd(22), 'L', t.length.toFixed(0), 'err', JSON.stringify(r.errors), 'margin', r.minimumMargin.toFixed(1), 'cross', r.crossings.map((c: any) => `${c.s.toFixed(0)}/${c.other.toFixed(0)}:${c.clearance.toFixed(1)}`).join(','), 'grad', (maxGrad*100).toFixed(1)+'%', 'bank', (Math.atan(maxBank)*180/Math.PI).toFixed(1)+'deg', 'yrange', (hi-lo).toFixed(0), 'minR', (1/maxCurv).toFixed(0), 'crest', r.minimumCrestRadius.toFixed(0), 'roadOverlapLowDy', worstRoadAt, 'corrOverlapDy4-6.5', worstCorrAt, bike ? 'bike ' + JSON.stringify(bike.errors) + ` minCB ${bike.minimumCornerBarrier.toFixed(1)} minB ${bike.minimumBarrier.toFixed(1)} kerb ${bike.maximumKerbHeight.toFixed(3)} grass ${bike.grassOutsideMetres}` : '');
}
