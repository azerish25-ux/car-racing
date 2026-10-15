const W = '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src';
const { Simulation } = await import(W + '/simulation/world.ts');
const { DEFAULT_OPTIONS, controls } = await import(W + '/simulation/config.ts');
const { PHASE } = await import(W + '/simulation/race.ts');
for (const tap of [0.05, 0.1, 0.15, 0.2]) {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 2, seed: 51007, circuit: 'valley-ridge-mx', ruleset: 'motocross-moto', opponents: 3, vehicles: Array(4).fill('mx450') });
  const t0 = sim.race.greenAt - 2;
  let maxSpeed = 0;
  for (let i = 0; i < 12 * 120 && sim.race.phase !== PHASE.RACING; i++) {
    const t = sim.race.time;
    sim.setInput({ ...controls(), throttle: t > t0 && t < t0 + tap ? 1 : 0 });
    sim.step(1 / 120);
    maxSpeed = Math.max(maxSpeed, sim.cars[0].speed);
  }
  const c = sim.control ?? sim.race.control;
  console.log('tap', tap, 'maxSpeed', maxSpeed.toFixed(2), 'penalty', sim.race.laps[0].penalty, 'rdJumped', sim.race.laps[0].jumped, 'gateJumped', sim.offroad.entrants[0].jumped, 'msg', sim.race.message);
}
