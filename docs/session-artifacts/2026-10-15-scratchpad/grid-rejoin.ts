const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { DEFAULT_OPTIONS, controls, validateOptions } = await import(W + '/src/simulation/config.ts');
const { RaceClient } = await import(W + '/src/net/client.ts');
const { EventLoop } = await import(W + '/src/net/event-loop.ts');
const { Lobby } = await import(W + '/src/net/lobby.ts');
const { RaceServer } = await import(W + '/src/net/server.ts');
const { NetworkSimulator, TARGET_LINK } = await import(W + '/src/net/transport.ts');

const loop = new EventLoop(), net = new NetworkSimulator(loop, 17);
const session = validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', laps: 1, opponents: 1, seed: 99 });
const created = Lobby.create('T', { name: 'Test', options: session, capacity: 2, fieldSize: 2, minPlayers: 2 });
if (!created.ok) throw new Error('lobby');
const server = new RaceServer({ loop, lobby: created.lobby, raceSeconds: 3 });
const cruise = () => ({ ...controls(), throttle: 0.35 });
const connect = (name: string, token?: string) => {
  const pair = net.connect(TARGET_LINK);
  server.accept(pair.server);
  const client = new RaceClient({ loop, transport: pair.client, name, vehicle: 'apx01', advertised: session, input: cruise, autoReady: true, ...(token ? { token } : {}) });
  client.join();
  return { client, link: pair.link };
};
const a = connect('A'), b = connect('B');
loop.runWhile(() => server.phase === 'lobby', 10000);
console.log('grid at', loop.now, 'phase', server.phase);
// client B's process restarts 100 ms into the countdown and rejoins with its token
loop.runUntil(loop.now + 100);
const token = b.client.token, car = b.client.car;
b.client.dispose();
const b2 = connect('B', token);
loop.runUntil(loop.now + 300);
console.log('after rejoin: b2 state', b2.client.state, 'server conn', server.playerByCar(car));
loop.runWhile(() => server.phase !== 'results', 30000);
console.log('takeovers', JSON.stringify(server.stats.takeovers));
console.log('rejoins', JSON.stringify(server.stats.rejoins));
console.log('b2 state', b2.client.state, 'reason', b2.client.reason);
console.log('results', JSON.stringify(server.results?.classification.map(r => [r.car, r.status])));
