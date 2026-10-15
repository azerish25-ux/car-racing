const W = '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src';
const { Simulation } = await import(W + '/simulation/world.ts');
const { DEFAULT_OPTIONS, controls } = await import(W + '/simulation/config.ts');
const { PHASE } = await import(W + '/simulation/race.ts');
const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 2, seed: 51007, circuit: 'valley-ridge-mx', ruleset: 'motocross-moto', opponents: 3, vehicles: Array(4).fill('mx450') });
sim.setInput({ ...controls(), throttle: 1 });
for (let i = 0; i < 12 * 120 && sim.race.phase !== PHASE.RACING; i++) sim.step(1 / 120);
console.log('penalty', sim.race.laps[0].penalty, 'raceDirectorJumped', sim.race.laps[0].jumped, 'offroadJumped', sim.offroad.entrants[0].jumped);
console.log(sim.offroad.log);
// Scenario 2: player only blips throttle 0.3 s before green
const sim2 = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 2, seed: 51007, circuit: 'valley-ridge-mx', ruleset: 'motocross-moto', opponents: 3, vehicles: Array(4).fill('mx450') });
for (let i = 0; i < 12 * 120 && sim2.race.phase !== PHASE.RACING; i++) {
  sim2.setInput({ ...controls(), throttle: sim2.race.time > sim2.race.greenAt - 0.3 ? 1 : 0 });
  sim2.step(1 / 120);
}
console.log('blip penalty', sim2.race.laps[0].penalty, sim2.race.laps[0].jumped, sim2.offroad.entrants[0].jumped, sim2.offroad.log.map(l=>l.text));
