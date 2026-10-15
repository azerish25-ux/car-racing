const root = process.argv[2];
const { runOnlineSlice } = await import(root + '/src/net/slice.ts');
const { TARGET_LINK } = await import(root + '/src/net/transport.ts');
const { report } = runOnlineSlice({ clients: 8, seed: Number(process.argv[4] ?? 2026), raceSeconds: Number(process.argv[3] ?? 70), link: TARGET_LINK, disconnect: { client: 5, atSeconds: 20, offlineSeconds: 3 }, verify: false });
console.log(root.includes('headsrc') ? 'HEAD' : 'WORK', process.argv[4] ?? 2026, JSON.stringify(report.classification.map((r) => [r.car, r.lapTimes.map((t) => +t.toFixed(2))])));
