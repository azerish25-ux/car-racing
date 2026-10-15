const W = '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src';
const { liveRegistry, vehicleDiscipline, rulesetsFor, disciplineStatus } = await import(W + '/career/registry.ts');
const { disciplineTiers, disciplineEvents, vehiclePrice, purchaseReasons } = await import(W + '/career/ladder.ts');
const reg = liveRegistry();
const view = { credits: 0, reputation: { 'circuit-cars': 100, 'road-bikes': 100, 'off-road': 100, festival: 100 }, licences: {}, owned: reg.vehicles.map((v: any) => ({ id: v.id })), active: {} };
for (const d of ['circuit-cars', 'road-bikes', 'off-road', 'festival']) {
  const st = disciplineStatus(reg, d);
  console.log('==', d, st.state, st.reasons);
  for (const t of disciplineTiers(reg, d)) console.log('  tier', t.id, t.classes.join(','));
  const evs = disciplineEvents(reg, view, d);
  for (const e of evs) if (e.status !== 'open' || e.kind === 'championship') console.log('   ', e.key, e.status, e.reasons.slice(0, 3).join(' | '), e.definition?.ruleset ?? '');
}
for (const v of reg.vehicles) {
  console.log(v.id, v.classId, vehicleDiscipline(v), vehiclePrice(reg, v), rulesetsFor(reg, v.classId, 'race').map((r: any) => r.id)[0], purchaseReasons(reg, v).join('|'));
}
