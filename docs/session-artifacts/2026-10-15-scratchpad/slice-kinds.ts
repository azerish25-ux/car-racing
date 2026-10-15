import { runOnlineSlice } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/net/slice.ts';
const { everyClient } = runOnlineSlice({
  clients: 4,
  seed: 2026,
  raceSeconds: 25,
  verify: false,
  disconnect: { client: 2, atSeconds: 12, offlineSeconds: 3 },
});
for (const c of everyClient)
  console.log(
    'car',
    c.car,
    'state',
    c.state,
    JSON.stringify(c.stats.renderKinds),
    'stalled',
    c.stats.stalledFrames,
    'lost',
    c.stats.lostSnapshots,
    'snaps',
    c.stats.snapshots,
  );
