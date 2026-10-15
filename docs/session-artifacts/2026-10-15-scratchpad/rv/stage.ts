const W = '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src';
const { Simulation } = await import(W + '/simulation/world.ts');
const { DEFAULT_OPTIONS, controls } = await import(W + '/simulation/config.ts');
const { PHASE } = await import(W + '/simulation/race.ts');
const { O, OFFROAD_BASE, HEADER, CAR_STRIDE, carBase } = await import(W + '/simulation/protocol.ts');
const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 1, seed: 51007, circuit: 'pinewood-stage', ruleset: 'rally-stage', opponents: 1, vehicles: ['rl2','rl2'] });
const s = sim.offroad;
const frame = new Float32Array(HEADER + sim.cars.length * CAR_STRIDE);
let shown = new Set();
for (let i = 0; i < 20 * 120; i++) {
  // Player launches when the lights go out (green), as on any race start.
  sim.setInput({ ...controls(), throttle: sim.race.phase === PHASE.RACING ? 1 : 0 });
  sim.step(1 / 120);
  sim.writeFrame(frame, 0, 0);
  const f = frame[carBase(0) + OFFROAD_BASE + O.FORMAT];
  const key = f < 0 ? 'AT THE CONTROL' : 'clock';
  if (!shown.has(key)) { shown.add(key); console.log('t-green', (sim.race.time - sim.race.greenAt).toFixed(2), 'HUD', key, 'msg', sim.race.message); }
}
console.log('player stageStart', s.entrants[0].stageStart, 'jumped', s.entrants[0].jumped, 'penalty', sim.race.laps[0].penalty, s.log.map(l => l.text));
