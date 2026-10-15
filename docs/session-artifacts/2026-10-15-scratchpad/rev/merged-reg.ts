const W = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/merged/src';
const { liveRegistry, disciplineStatus, DISCIPLINE_IDS } = await import(`${W}/career/registry.ts`);
const { disciplineTiers, tierVehicles, vehiclePrice, loanerVehicle, licenceAvailability, disciplineEvents } = await import(`${W}/career/ladder.ts`);
const { newCareer } = await import(`${W}/career/save.ts`);
const reg = liveRegistry();
console.log('channels has LEAN', reg.channels.includes('LEAN'));
for (const d of DISCIPLINE_IDS) {
  const s = disciplineStatus(reg, d);
  console.log('==', d, s.state, 'venues', s.venues.length, s.reasons.join(' | '));
  for (const t of disciplineTiers(reg, d)) console.log('  ', t.id, tierVehicles(reg, t).map((v: any) => `${v.id}:${v.classId}:${vehiclePrice(reg, v)}`).join(', '));
  console.log('  loaner', loanerVehicle(reg, d)?.id);
}
for (const id of ['braking','cornering','wet','lean','jump']) { const a = licenceAvailability(reg, newCareer(), id); console.log(id, a.status, a.vehicle, a.venue, a.reasons.join('|')); }
const ev = disciplineEvents(reg, newCareer(), 'road-bikes');
console.log(ev.map((e: any) => `${e.key}:${e.status}`).slice(0, 5));
