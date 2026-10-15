const W = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { CIRCUITS, CIRCUIT_IDS } = await import(W + '/src/simulation/circuits.ts');
const { Track } = await import(W + '/src/simulation/track.ts');
const { bikeSafetyReport } = await import(W + '/src/simulation/circuit-catalogue/geometry-checks.ts');
for (const id of CIRCUIT_IDS) {
  const def = CIRCUITS[id];
  const r = bikeSafetyReport(new Track('clear', false, undefined, def));
  console.log(id, def.bikeSafe ? 'FLAG' : '    ', 'errs', r.errors.length, 'minCornerBarrier', r.minimumCornerBarrier.toFixed(1), 'minBarrier', r.minimumBarrier.toFixed(1), 'grassOut', r.grassOutsideMetres, r.errors.slice(0, 2).join(' | ').slice(0, 200));
}
