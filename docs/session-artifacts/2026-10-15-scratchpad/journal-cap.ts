const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { controls } = await import(W + '/src/simulation/config.ts');
const { encodeJournal, decodeJournal } = await import(W + '/src/net/authority.ts');
const { quantizeControls } = await import(W + '/src/net/input.ts');
const { MAX_RECORD_TICKS } = await import(W + '/src/net/records.ts');
// 8 cars, a controls change per car every 2 ticks (60 Hz commands), for 75 minutes
const ticks = 75 * 60 * 120, entries: any[] = [];
for (let t = 0; t < ticks; t += 2) for (let car = 0; car < 8; car++)
  entries.push({ tick: t, car, kind: 'controls', controls: quantizeControls({ ...controls(), throttle: ((t / 2 + car) % 2) ? 0.8 : 0.9 }) });
console.log('ticks', ticks, '<= MAX_RECORD_TICKS', ticks <= MAX_RECORD_TICKS, 'entries', entries.length);
try { decodeJournal(encodeJournal(entries)); console.log('decoded'); } catch (e) { console.log('decode failed:', (e as Error).message); }
