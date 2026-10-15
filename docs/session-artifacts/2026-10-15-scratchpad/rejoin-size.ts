const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { onlineFixture } = await import(W + '/tests/net-helpers.ts');
const f = onlineFixture({ capacity: 2, raceSeconds: 6 });
f.connect('Stays');
const lost = f.connect('Lost');
f.loop.runUntil(3500);
// Stand-in for ~31 laps x 12 cars of real lap events (each ~85 B of JSON).
const ev = (f.server as any).events;
for (let i = 0; i < 400; i++) ev.push({ type: 'lap', car: i % 12, lap: 1 + Math.floor(i / 12), time: 51.689896971517314, valid: true, tick: 6200 * (1 + Math.floor(i / 12)) });
const token = lost.client.token, car = lost.client.car;
lost.link.sever();
lost.client.dispose?.();
f.loop.runUntil(5000);
const back = f.connect('Lost', { token });
f.loop.runUntil(8000);
console.log('rejoined client state', back.client.state, 'car', back.client.car, 'invalidMessages', back.client.stats.invalidMessages);
console.log('server view', f.server.playerByCar(car), 'phase', f.server.phase);
