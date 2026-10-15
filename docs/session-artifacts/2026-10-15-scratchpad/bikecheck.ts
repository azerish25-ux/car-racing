const R = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1/src/simulation';
process.env.CATALOGUE_DEV = '1';
const { CIRCUITS } = await import(`${R}/circuits.ts`);
const { Track } = await import(`${R}/track.ts`);
const { bikeSafetyReport } = await import(`${R}/circuit-catalogue/geometry-checks.ts`);
for (const id of process.argv.slice(2)) {
  const r = bikeSafetyReport(new Track('clear', false, undefined, CIRCUITS[id]));
  console.log(id, JSON.stringify({ ...r, errors: undefined }), r.errors);
}
