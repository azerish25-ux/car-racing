const root = process.argv[2];
const { runOnlineSlice } = await import(root + '/src/net/slice.ts');
const { TARGET_LINK } = await import(root + '/src/net/transport.ts');
const { report, server } = runOnlineSlice({ clients: 8, seed: 2026, raceSeconds: Number(process.argv[3] ?? 60), link: TARGET_LINK, disconnect: { client: 5, atSeconds: 20, offlineSeconds: 3 }, verify: false });
const w = server.world;
const rows = w.sim.cars.map((c, i) => ({ car: i, s: Math.round(c.s), lap: w.sim.race.laps[i].completed, impact: +c.impact.toFixed(2), speed: +c.speed.toFixed(1) }));
console.log(root.includes('headsrc') ? 'HEAD' : 'WORK', JSON.stringify(rows), 'lead', report.inputs.leadTicks.mean, 'missing', report.inputs.missingTicks, 'late', report.inputs.lateTicks, 'track', w.sim.track.length);
