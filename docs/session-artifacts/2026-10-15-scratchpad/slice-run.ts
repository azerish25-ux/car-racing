import { runOnlineSlice } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/net/slice.ts';
const n = Number(process.argv[2] ?? 2), secs = Number(process.argv[3] ?? 8);
const t0 = performance.now();
const { report } = runOnlineSlice({ clients: n, seed: 11, raceSeconds: secs, progress: (m) => console.log(m), disconnect: process.argv[4] ? { client: 1, atSeconds: 9, offlineSeconds: 2 } : undefined });
console.log(JSON.stringify(report, null, 1));
console.log('wall ms', performance.now() - t0);
