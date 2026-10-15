const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/';
const { OpenWorldSimulation } = await import(W + 'open-world/session.ts');
const { pathPoint } = await import(W + 'open-world/route-path.ts');
const sim = new OpenWorldSimulation({ tileBudget: 256 });
const id = process.argv[2] ?? 'valley-sprint';
const jump = Number(process.argv[3] ?? 90);
sim.command({ type: 'start', event: id });
const run = (sim as any).run;
const path = run.event.path;
const dt = 1 / 120;
const drive = (sec: number, throttle = 0.4) => { for (let k = 0; k < sec * 120; k++) { sim.setInput({ throttle, brake: 0, steer: 0, shift: 0, ers: 1, reverse: false, manualClutch: false, clutch: 0 } as any); sim.step(dt); } };
drive(3.2, 0); // countdown
const me = run.participants[0];
const at = path.locate(sim.player.body.position.x, sim.player.body.position.z, 0, 200);
console.log('mode', sim.mode, 'player path d', at.toFixed(1), 'progress', me.progress.edge, me.progress.s.toFixed(1), 'dist', me.progress.distance.toFixed(1));
// Simulate a cut that rejoins the route `jump` metres further on (teleport onto the route ahead).
(sim as any).placeOnPath(sim.player, path, at + jump, -1);
drive(0.3, 0);
console.log('after cut: offRoute', me.progress.offRoute, 'lost', run.lost.toFixed(2));
sim.command({ type: 'reset' });
const d2 = path.locate(sim.player.body.position.x, sim.player.body.position.z, at + jump, 200);
console.log('reset placed car at path d', d2.toFixed(1), 'legal progress s', me.progress.s.toFixed(1));
for (let t = 0; t < 30; t += 2) {
  drive(2, 0.35);
  console.log(`t+${t + 2}s mode=${sim.mode} offRoute=${me.progress.offRoute} lost=${run.lost?.toFixed(1)} progress.s=${me.progress.s.toFixed(1)} v=${(sim.player.speed*3.6).toFixed(0)} result=${sim.results.length ? JSON.stringify({c: sim.results[0].completed, a: sim.results[0].abandoned}) : '-'}`);
  if (sim.mode !== 'running') break;
}
