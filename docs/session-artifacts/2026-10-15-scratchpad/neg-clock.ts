const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { DEFAULT_OPTIONS, validateOptions } = await import(W + '/src/simulation/config.ts');
const { RaceClient } = await import(W + '/src/net/client.ts');
const { EventLoop } = await import(W + '/src/net/event-loop.ts');
const { Lobby } = await import(W + '/src/net/lobby.ts');
const { RaceServer } = await import(W + '/src/net/server.ts');
const { NetworkSimulator, TARGET_LINK } = await import(W + '/src/net/transport.ts');
const { ShadowPilot } = await import(W + '/src/net/bots.ts');
const { poseDistance } = await import(W + '/src/net/prediction.ts');

const loop = new EventLoop(), net = new NetworkSimulator(loop, 17);
const session = validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', laps: 3, opponents: 1, seed: 99 });
const created = Lobby.create('T', { name: 'Test', options: session, capacity: 2, fieldSize: 2, minPlayers: 2 });
if (!created.ok) throw new Error('lobby');
const server = new RaceServer({ loop, lobby: created.lobby, raceSeconds: 20 });
const pilots = new Map();
const offsets: Record<string, number[]> = { pos: [], neg: [] };
const connect = (name: string, clockOffsetMs: number) => {
  const pair = net.connect(TARGET_LINK);
  server.accept(pair.server);
  const client: any = new RaceClient({
    loop, transport: pair.client, name, vehicle: 'apx01', advertised: session, autoReady: true, clockOffsetMs,
    input: () => {
      const world = server.world; if (!world || client.car < 0) return null;
      let p = pilots.get(client.car); if (!p) { p = new ShadowPilot(world, client.car, 'humanized', 3 + client.car); pilots.set(client.car, p); }
      return p.sample(1 / 60);
    },
    onRender: (view: any) => {
      if (!view.local) return;
      const predicted = client.predictor.predictedAt(client.predictor.tick);
      if (predicted) offsets[name].push(poseDistance(view.local.pose, predicted));
    },
  });
  client.join();
  return client;
};
const a = connect('pos', 250000), b = connect('neg', -250000);
loop.runWhile(() => server.phase !== 'results', 60000);
const stat = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return { n: s.length, p50: s[Math.floor(s.length / 2)]?.toFixed(3), p95: s[Math.floor(s.length * 0.95)]?.toFixed(3), max: s[s.length - 1]?.toFixed(3), last: xs[xs.length - 1]?.toFixed(3) }; };
for (const [name, c] of [['pos', a], ['neg', b]] as const) {
  console.log(name, 'rendered-vs-predicted offset m', JSON.stringify(stat(offsets[name])), 'visualStep samples', c.predictor.stats.visualStep.length, 'corrections', c.predictor.stats.correction.length, 'internal offset', Math.hypot(...c.predictor.offset).toFixed(3));
}
