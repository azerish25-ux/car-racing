const W = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const reg = await import(W + '/src/career/registry.ts');
const ladder = await import(W + '/src/career/ladder.ts');
const { CIRCUITS } = await import(W + '/src/simulation/circuits.ts');
const live = reg.liveRegistry();
const disc = process.argv[2] ?? 'circuit-cars';
const ids = live.vehicles.filter((v: any) => reg.vehicleDiscipline(v) === disc).map((v: any) => ({ id: v.id }));
const rep = Object.fromEntries(reg.DISCIPLINE_IDS.map((d: string) => [d, 100]));
const view = { credits: 1e9, reputation: rep, licences: new Proxy({}, { get: () => ({ medal: 'gold' }) }), owned: ids, active: {} };
const evs = ladder.disciplineEvents(live, view, disc);
for (const e of evs) {
  const d = e.definition;
  if (!d) continue;
  const len = CIRCUITS[d.circuit]?.catalogue?.length ?? 0;
  if (len > 7500 || process.argv[3]) console.log(e.key, d.circuit, Math.round(len), 'laps', d.laps, d.mode, d.durationSeconds ?? '', d.vehicles?.[0], d.ruleset, 'km', (len * d.laps / 1000).toFixed(0));
  for (const r of e.calendar ?? []) { const c = r.venue ?? r.circuit; const l = CIRCUITS[c]?.catalogue?.length ?? 0; if (l > 7500) console.log('  round', JSON.stringify(r), Math.round(l)); }
}
