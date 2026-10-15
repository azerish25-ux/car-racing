const W = '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src';
const { Simulation } = await import(W + '/simulation/world.ts');
const { DEFAULT_OPTIONS } = await import(W + '/simulation/config.ts');
const { PHASE } = await import(W + '/simulation/race.ts');
const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 2, seed: 51007, circuit: 'kestrel-rx', ruleset: 'rallycross-joker', opponents: 2, vehicles: ['rcx6','rcx6','rcx6'] });
sim.autoPlayer = true;
const s = sim.offroad;
let i = 0;
for (; i < 600 * 120 && sim.race.phase !== PHASE.FINISHED; i++) {
  // Simulate every driver skipping the joker (as a player who ignores it would).
  for (const e of s.entrants) e.jokers = 0;
  sim.step(1 / 120);
}
console.log('phase', sim.race.phase, 't', sim.race.time.toFixed(2));
for (const c of sim.cars) console.log(c.id, 'finish', c.finishTime.toFixed(2), 'pen', sim.race.laps[c.id].penalty, 'judged', s.entrants[c.id].jokerJudged, 'retired', c.retired);
console.log('order', sim.race.order);
