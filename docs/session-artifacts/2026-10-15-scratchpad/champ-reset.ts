const W = process.argv[2];
const { newCareer } = await import(`${W}/career/save.ts`);
const { settleRace, startChampionship, setActive } = await import(`${W}/career/economy.ts`);
const { disciplineTiers, disciplineEvents, championshipCalendar } = await import(`${W}/career/ladder.ts`);
const { liveRegistry, disciplineStatus } = await import(`${W}/career/registry.ts`);
const reg = liveRegistry();
let save = newCareer();
save.reputation['circuit-cars'] = 30;
save.licences.braking = { medal: 'bronze', best: 5, attempts: 1 };
save.licences.cornering = { medal: 'bronze', best: 2, attempts: 1 };
save.owned = [{ id: 'sk125', source: 'purchase' }, { id: 'tc1', source: 'purchase' }, { id: 'gs4', source: 'purchase' }];
save.active['circuit-cars'] = 'sk125';
const venues = disciplineStatus(reg, 'circuit-cars').venues;
const club = disciplineTiers(reg, 'circuit-cars')[0];
const rounds = championshipCalendar(venues, 0, club);
const ev = () => disciplineEvents(reg, save, 'circuit-cars').find((e) => e.kind === 'championship' && e.tier === 'club');
console.log('entry before', ev().vehicle);
save = startChampionship(save, ev().key, ev().vehicle, rounds, 8);
for (let r = 0; r < 2; r++) {
  const o = { session: `s${r}`, position: 1, cars: 8, classified: true, demonstration: false, penalties: 0, contactEnergy: 0, gridSlot: 4, bestLap: 50,
    round: { order: [0,1,2,3,4,5,6,7], retired: [], grid: [1,2,3,4,0,5,6,7], demonstration: false, session: `s${r}` } };
  save = settleRace(save, ev(), o).save;
}
console.log('after 2 rounds', save.championships[ev().key].season.results.length, 'rounds recorded');
save = setActive(save, reg, 'circuit-cars', 'gs4'); // to race the GT tier
const e = ev();
console.log('club entry now', e.vehicle, 'card button would read START ROUND', save.championships[e.key].season.results.length + 1);
save = startChampionship(save, e.key, e.vehicle, rounds, 8);
console.log('after clicking START ROUND 3: results recorded =', save.championships[e.key].season.results.length, 'vehicle', save.championships[e.key].vehicle);
