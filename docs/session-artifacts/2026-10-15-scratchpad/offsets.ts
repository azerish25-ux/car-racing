const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { NetRandom } = await import(W + '/src/net/event-loop.ts');
const r = new NetRandom(2026 ^ 0x51ce);
const offs = Array.from({ length: 9 }, () => Math.round((r.next() - 0.5) * 2e6));
console.log(offs.map((o) => `${o} (${o + 90000 < 0 ? 'negative' : 'positive'} during race)`).join('\n'));
