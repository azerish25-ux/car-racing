const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/';
const { OpenWorldSimulation } = await import(W + 'open-world/session.ts');
const sim = new OpenWorldSimulation({ tileBudget: 256 });
for (const ev of sim.events) {
  const legs = ev.path.legs.map((l: any) => Math.abs(l.to - l.from).toFixed(0));
  const graphLens = ev.graph.spec.edges.map((e: any) => ev.graph.length(e.id).toFixed(0));
  sim.command({ type: 'start', event: ev.spec.id });
  const run = (sim as any).run;
  const parts = run.participants.map((p: any) => `${p.progress.edge}@${p.progress.s.toFixed(0)}${p.progress.offRoute ? '!OFF' : ''}`);
  console.log(ev.spec.id, ev.spec.kind, 'closed', ev.path.closed, 'len', ev.path.length.toFixed(0), 'laps', ev.laps, 'legs', legs.slice(0, 4).join(','), '...', legs.length, 'gates', ev.graph.spec.checkpoints.length, 'start', parts.join(' '));
  sim.command({ type: 'cancel' });
  sim.command({ type: 'continue' });
}
