const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { AuthoritativeWorld } = await import(W + '/src/net/authority.ts');
const { createRecord, verifyRecord, recordDigest } = await import(W + '/src/net/records.ts');
const { DEFAULT_OPTIONS, validateOptions } = await import(W + '/src/simulation/config.ts');
const options = validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', laps: 1, opponents: 0, seed: 7 });
// Forger: nobody drives; the server's own AI is told to drive car 0 from tick 0.
const w = new AuthoritativeWorld(options);
w.setMode(0, 'ai');
const t0 = performance.now();
while (w.sim.cars[0].finishTime <= 0 && w.tick < 120 * 400) w.step();
console.log('sim ticks', w.tick, 'ms', (performance.now() - t0).toFixed(0), 'lapTimes', w.lapTimes[0], 'best', w.sim.race.laps[0].best);
const rec = createRecord(w);
console.log('journal entries', rec.journalEntries);
console.log('AI-driven record verify:', JSON.stringify(verifyRecord(JSON.parse(JSON.stringify(rec)))));
// Forged checkpoints: same count, wrong ticks / bogus hashes.
const forged = JSON.parse(JSON.stringify(rec));
forged.claim.checkpoints = forged.claim.checkpoints.map((c, i) => ({ tick: -1 - i, hash: 'deadbeef' }));
forged.claim.best = [...forged.claim.best, 1.234];
forged.digest = recordDigest(forged);
console.log('forged checkpoints/best verify:', JSON.stringify(verifyRecord(forged)), 'checkpoints', rec.claim.checkpoints.length);
// No checkpoints claimed at all? (count must match, so only works on endTick<1200) -> skip
