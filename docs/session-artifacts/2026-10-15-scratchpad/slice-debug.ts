import { runOnlineSlice } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/net/slice.ts';
const { report, clients, server } = runOnlineSlice({
  clients: Number(process.argv[2] ?? 4),
  seed: 11,
  raceSeconds: Number(process.argv[3] ?? 20),
  verify: false,
  disconnect: process.argv[4] ? { client: 1, atSeconds: 9, offlineSeconds: 2 } : undefined,
});
console.log(JSON.stringify(report.interpolation));
console.log(JSON.stringify(report.prediction.positionErrorM), JSON.stringify(report.inputs));
for (const c of clients) {
  const e = c.predictor.stats.positionError;
  const large = e.map((v, i) => [i, Number(v.toFixed(2))]).filter(([, v]) => v > 0.5);
  console.log(
    'client car',
    c.car,
    'samples',
    e.length,
    'max',
    Math.max(...e).toFixed(3),
    'large',
    JSON.stringify(large.slice(0, 12)),
    'ai',
    c.predictor.stats.aiDriven,
    'snaps',
    c.predictor.stats.snaps,
  );
}
console.log(JSON.stringify(server.inputStats()));
console.log(JSON.stringify(server.stats.takeovers), JSON.stringify(server.stats.rejoins));
