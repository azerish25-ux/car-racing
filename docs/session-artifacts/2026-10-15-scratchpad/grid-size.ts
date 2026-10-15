const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { DEFAULT_OPTIONS, validateOptions } = await import(W + '/src/simulation/config.ts');
const { sessionIdentity } = await import(W + '/src/core/session-identity.ts');
const { encodeControl, decodeServerMessage } = await import(W + '/src/net/codec.ts');
const cars = 12;
const options = validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', laps: 50, opponents: cars - 1, seed: 99 });
const entries = Array.from({ length: cars }, (_, car) => ({ car, name: `Driver ${car + 1}`, player: `p${car + 1}`, vehicle: 'apx01' }));
for (const laps of [10, 20, 25, 30, 40]) {
  const events: any[] = [];
  for (let lap = 1; lap <= laps; lap++) for (let car = 0; car < cars; car++)
    events.push({ type: 'lap', car, lap, time: 80 + Math.random() * 5, valid: true, tick: lap * 9700 + car * 13 });
  const msg = { kind: 'grid', options, identity: sessionIdentity(options), entries, car: 3, startTick: 0, serverTick: laps * 9700, startInMs: 0, events };
  const bytes = encodeControl(msg as never);
  const d = decodeServerMessage(bytes, 'reliable');
  console.log(`${cars} cars, rejoin after lap ${laps}: grid message ${bytes.length} B ->`, d.ok ? 'accepted' : d.reason);
}
