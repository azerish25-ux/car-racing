const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation';
const { OpenWorldSimulation } = await import(W + '/open-world/session.ts');
const { pathPoint } = await import(W + '/open-world/route-path.ts');
const sim = new OpenWorldSimulation({ vehicle: 'tc1' });
sim.command({ type: 'start', event: 'valley-sprint' });
for (let i = 0; i < 120 * 3.2; i++) sim.step(1 / 120);
const path = sim.events.find((e: any) => e.spec.id === 'valley-sprint').path, p = pathPoint();
const at = () => path.locate(sim.player.body.position.x, sim.player.body.position.z, 0, 400);
const legal = at();
const run = (sim as any).run;
console.log('legal', legal, 'progress', run.participants[0].progress.edge, run.participants[0].progress.s, run.participants[0].progress.distance);
path.at(legal + 90, p);
sim.placeAt(sim.player, p.x, p.z, Math.atan2(p.tx, p.tz), p.y + 0.5);
for (let i = 0; i < 12; i++) sim.step(1 / 120);
sim.command({ type: 'reset' });
console.log('after reset at', at(), 'progress', run.participants[0].progress.s, 'legalD', path.progressDistance(run.participants[0].progress.edge, run.participants[0].progress.s));
sim.command({ type: 'autopilot', value: true });
for (let t = 0; t < 12; t++) { for (let i = 0; i < 120; i++) sim.step(1 / 120); const st = sim.status(); console.log(t, st.mode, 'd', at().toFixed(1), 'speed', sim.player.speed.toFixed(1), 'prog', run.participants[0].progress.distance.toFixed(1), run.participants[0].progress.s.toFixed(1), 'off', st.event?.offRoute, 'pos', st.event?.position); }
