const W = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/repo/src';
const { newCareer } = await import(`${W}/career/save.ts`);
const { disciplineTiers, disciplineEvents, licenceAvailability, vehiclePrice, tierVehicles, loanerVehicle } = await import(`${W}/career/ladder.ts`);
const { liveRegistry, disciplineStatus, DISCIPLINE_IDS, vehicleDiscipline } = await import(`${W}/career/registry.ts`);
const { LICENCE_IDS } = await import(`${W}/career/licences.ts`);
const reg = liveRegistry();
console.log('vehicles', reg.vehicles.map((v) => `${v.id}:${v.classId}:${v.dynamicsKind}:${v.family ?? ''}->${vehicleDiscipline(v)} ¤${vehiclePrice(reg, v)}`).join('\n  '));
console.log('venues', reg.venues.length, 'channels has LEAN', reg.channels.includes('LEAN'));
for (const d of DISCIPLINE_IDS) {
  const s = disciplineStatus(reg, d);
  console.log('\n==', d, s.state, s.reasons, s.caveat, 'venues', s.venues.length, 'loaner', loanerVehicle(reg, d)?.id);
  for (const t of disciplineTiers(reg, d)) console.log('  tier', t.id, t.classes.join(','), '->', tierVehicles(reg, t).map((v) => v.id).join(','), 'licences', t.licences.map(l=>l.id+':'+l.medal).join(','));
  const evs = disciplineEvents(reg, newCareer(), d);
  const counts = {};
  for (const e of evs) { const k = `${e.tier}/${e.kind}/${e.status}`; counts[k] = (counts[k] ?? 0) + 1; }
  console.log('  events', counts);
  const rec = evs.find((e) => e.kind === 'recovery'); console.log('  recovery', rec.status, rec.reasons, rec.definition?.ruleset, rec.definition?.circuit);
}
for (const id of LICENCE_IDS) { const a = licenceAvailability(reg, newCareer(), id); console.log('licence', id, a.status, a.reasons, a.vehicle, a.venue, a.definition?.ruleset, a.definition?.mode); }
