const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { encodeControl, decodeServerMessage } = await import(W + '/src/net/codec.ts');
const { Lobby } = await import(W + '/src/net/lobby.ts');
const { sessionIdentity } = await import(W + '/src/core/session-identity.ts');
const { DEFAULT_OPTIONS, validateOptions } = await import(W + '/src/simulation/config.ts');
const cars = 12;
const created = Lobby.create('L', { name: 'x', options: validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', laps: 60, opponents: 0, seed: 3 }), capacity: cars, fieldSize: cars });
if (!created.ok) throw new Error(created.reasons.join());
const options = created.lobby.sessionOptions();
const entries = Array.from({ length: cars }, (_, car) => ({ car, name: 'Driver name ' + car, player: 'p' + car, vehicle: 'apx01' }));
for (const laps of [10, 20, 25, 30, 40]) {
  const events = [];
  for (let lap = 1; lap <= laps; lap++) for (let car = 0; car < cars; car++)
    events.push({ type: 'lap', car, lap, time: 51.689896971517314 + car * 0.01 + lap * 1e-3, valid: true, tick: lap * 6200 + car * 7 });
  const grid = { kind: 'grid', options, identity: sessionIdentity(options), entries, car: 3, startTick: 0, serverTick: laps * 6200, startInMs: 0, events };
  const bytes = encodeControl(grid);
  const d = decodeServerMessage(bytes, 'reliable');
  console.log(`rejoin grid after ${laps} laps x ${cars} cars: ${bytes.length} B ->`, d.ok ? 'ok' : d.reason);
}
for (const laps of [100, 130, 140, 200]) {
  const classification = Array.from({ length: cars }, (_, car) => ({ position: car + 1, car, name: 'Driver name ' + car, player: 'p' + car, laps, lapTimes: Array.from({ length: laps }, (_, i) => 51.689896971517314 + i * 1e-3 + car * 1e-4), best: 51.689896971517314, status: 'finished' }));
  const bytes = encodeControl({ kind: 'results', results: { endTick: 1, reason: 'finished', classification, recordDigest: 'deadbeef', progressDisputes: [] } });
  const d = decodeServerMessage(bytes, 'reliable');
  console.log(`results ${laps} laps x ${cars} cars: ${bytes.length} B ->`, d.ok ? 'ok' : d.reason);
}
