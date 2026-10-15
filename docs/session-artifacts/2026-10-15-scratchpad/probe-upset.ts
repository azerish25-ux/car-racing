const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation';
const { OpenWorldSimulation } = await import(W + '/open-world/session.ts');
const { roadCandidates } = await import(W + '/open-world/road-network.ts');
const sim = new OpenWorldSimulation({ vehicle: 'tc1' });
const car = sim.player;
sim.placeAt(car, 2600, 600, 0);
car.body.orientation.x = 1; car.body.orientation.y = 0; car.body.orientation.z = 0; car.body.orientation.w = 0;
for (let i = 0; i < 120 * 5; i++) sim.step(1 / 120);
let st = sim.status(); const pos = sim.player.body.position;
console.log('after upset', st.road, pos.x.toFixed(2), pos.y.toFixed(2), pos.z.toFixed(2), st.message);
const net = sim.world.network, c = roadCandidates();
const n = net.covering(pos.x, pos.z, pos.y, 4, c);
for (let k = 0; k < n; k++) { const e = net.edges[net.edgeOf[c.segment[k]]]; console.log(e.id, 'seg', c.segment[k], 'first', e.first, 'last', e.last, 't', c.t[k].toFixed(3), 'd', c.distance[k].toFixed(2), 'out', c.outside[k].toFixed(3), 'y', net.y[c.segment[k]].toFixed(2)); }
sim.placeAt(sim.player, 0, -3400, 0);
for (let i = 0; i < 120 * 4; i++) { sim.step(1 / 120); const m = sim.status().message; if (i % 60 === 0) console.log(i, m, sim.player.body.position.x.toFixed(1), sim.player.body.position.y.toFixed(2), sim.player.body.position.z.toFixed(1), sim.status().road.onRoad, sim.track.query.waterDepth.toFixed(2)); }
st = sim.status(); const q = sim.player.body.position;
console.log('after sea', st.road, q.x.toFixed(2), q.y.toFixed(2), q.z.toFixed(2), st.message);
const n2 = net.covering(q.x, q.z, q.y, 4, c);
for (let k = 0; k < n2; k++) { const e = net.edges[net.edgeOf[c.segment[k]]]; console.log(e.id, 'seg', c.segment[k], 'first', e.first, 'last', e.last, 't', c.t[k].toFixed(3), 'd', c.distance[k].toFixed(2), 'out', c.outside[k].toFixed(3), 'y', net.y[c.segment[k]].toFixed(2), 'bridge', c.bridge[k]); }
