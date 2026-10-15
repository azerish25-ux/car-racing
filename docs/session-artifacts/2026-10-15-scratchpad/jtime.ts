const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { controls } = await import(W + '/src/simulation/config.ts');
const { encodeJournal, decodeJournal, journalEntryLimit } = await import(W + '/src/net/authority.ts');
const { quantizeControls } = await import(W + '/src/net/input.ts');
const t0 = performance.now();
const ticks = 75 * 60 * 120, entries: any[] = [];
const a = quantizeControls({ ...controls(), throttle: 0.8 }), b = quantizeControls({ ...controls(), throttle: 0.9 });
for (let t = 0; t < ticks; t += 2) for (let car = 0; car < 8; car++)
  entries.push({ tick: t, car, kind: 'controls', controls: ((t / 2 + car) % 2) ? a : b });
const t1 = performance.now();
const enc = encodeJournal(entries);
const t2 = performance.now();
const dec = decodeJournal(enc, journalEntryLimit(ticks, 8));
const t3 = performance.now();
console.log(entries.length, enc.length, 'build', (t1-t0).toFixed(0), 'enc', (t2-t1).toFixed(0), 'dec', (t3-t2).toFixed(0), dec.length);
