const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { onlineFixture } = await import(W + '/tests/net-helpers.ts');
const { encodeInput } = await import(W + '/src/net/codec.ts');
const { controls } = await import(W + '/src/simulation/config.ts');
const f = onlineFixture({ capacity: 2, raceSeconds: 4 });
const a = f.connect('Alice');
const b = f.connect('Bob');
f.loop.runUntil(3500);
console.log('phase', f.server.phase, 'alice car', a.client.car, 'bob car', b.client.car);
// Alice derives Bob's token from her own: xorshift32 state == each 8-hex word.
const xs = (x) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
let s = parseInt(a.client.token.slice(24), 16), derived = '';
for (let i = 0; i < 4; i++) { s = xs(s); derived += s.toString(16).padStart(8, '0'); }
console.log('alice token', a.client.token, '\nbob token  ', b.client.token, '\nderived    ', derived, derived === b.client.token);
// Attacker connects with Bob's token while Bob is connected and driving.
const evil = f.connect('Mallory', { token: derived });
f.loop.runUntil(5000);
console.log('bob client state', b.client.state, b.client.reason ?? '', '| evil state', evil.client.state, 'car', evil.client.car);
console.log('server view of bob car', f.server.playerByCar(b.client.car), 'rejoins', f.server.stats.rejoins);

// Seen-map flood through the real server path from Alice's transport.
let seq = 5_000_000;
const t0 = f.loop.now;
const timer = f.loop.every(1000 / 75, () => {
  const cmds = Array.from({ length: 16 }, (_, k) => ({ seq: seq + k, tick: 0xfff00000 + k, ticks: 1, controls: controls() }));
  seq += 17;
  a.transport.send(encodeInput({ sentAt: 0, ackTick: 0, commands: cmds }), 'unreliable');
});
f.loop.runUntil(t0 + 1500);
timer();
const p = [...(f.server as any).players.values()].find((p) => p.name === 'Alice');
console.log('alice seen size', p.queue.seen.size, 'rejected', p.queue.stats.rejected, 'strikes', p.connection?.strikes, 'invalid', f.server.stats.invalidMessages, 'rateLimited', f.server.stats.rateLimited, 'kicks', f.server.stats.kicks);
