const W = '/home/user/Experiment-3/.claude/worktrees/wf_79603d95-dab-1/src';
const { newCareer } = await import(`${W}/career/save.ts`);
const { settleRace, startChampionship } = await import(`${W}/career/economy.ts`);
const { championshipCalendar, disciplineTiers, disciplineEvents } = await import(`${W}/career/ladder.ts`);
const { liveRegistry, disciplineStatus } = await import(`${W}/career/registry.ts`);
const reg = liveRegistry();
const tiers = disciplineTiers(reg, 'circuit-cars');
const club = tiers[0];
const venues = disciplineStatus(reg, 'circuit-cars').venues;
const rounds = championshipCalendar(venues, 0, club);
let save = newCareer();
save.owned.push({ id: 'tc1', source: 'purchase' });
save.active['circuit-cars'] = 'tc1';
save.reputation['circuit-cars'] = 10;
save.licences.braking = { medal: 'bronze', best: 5, attempts: 1 };
const ev = disciplineEvents(reg, save, 'circuit-cars').find((e) => e.kind === 'championship' && e.tier === 'club');
console.log('champ status', ev.status, ev.reasons, 'rounds', rounds.length);
save = startChampionship(save, ev.key, 'tc1', rounds, 8);
const order = [0, 1, 2, 3, 4, 5, 6, 7];
for (let r = 0; r < rounds.length; r++) {
  const demo = r < rounds.length - 1; // AI drives every round except the last
  const outcome = {
    session: `s${r}`, position: 1, cars: 8, classified: true, demonstration: demo, penalties: 0,
    contactEnergy: 0, gridSlot: 4, bestLap: 90,
    round: { order, retired: [], grid: [1, 2, 3, 4, 0, 5, 6, 7], demonstration: demo, session: `s${r}` },
  };
  const res = settleRace(save, ev, outcome, 'apx01');
  save = res.save;
  console.log('round', r + 1, 'demo', demo, 'paid', res.payout.paid, 'total', res.payout.total, 'awarded', res.payout.awarded, res.payout.lines.filter(l=>/Champ/.test(l.label)));
}
console.log('credits', save.credits, 'owned', save.owned, 'rep', save.reputation['circuit-cars']);
