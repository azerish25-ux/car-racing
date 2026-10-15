const W = process.argv[2];
const { newCareer } = await import(`${W}/career/save.ts`);
const { disciplineTiers, disciplineEvents, championshipCalendar } = await import(`${W}/career/ladder.ts`);
const { liveRegistry, disciplineStatus } = await import(`${W}/career/registry.ts`);
const { careerHub } = await import(`${W}/ui/career-hub.ts`);
const reg = liveRegistry();
const save = newCareer();
save.credits = 1e6; save.reputation['circuit-cars'] = 100;
for (const id of ['braking','cornering','wet']) save.licences[id] = { medal: 'gold', best: 0, attempts: 1 };
save.owned = reg.vehicles.map((v) => ({ id: v.id, source: 'purchase' }));
const venues = disciplineStatus(reg, 'circuit-cars').venues;
disciplineTiers(reg, 'circuit-cars').forEach((t, i) => {
  const ev = disciplineEvents(reg, save, 'circuit-cars').find((e) => e.kind === 'championship' && e.tier === t.id);
  const cal = championshipCalendar(venues, i, t);
  console.log(t.id, 'card venue', ev.definition?.circuit, 'calendar', cal.map((r) => `${r.circuit}/${r.weather}`).join(' '));
});
