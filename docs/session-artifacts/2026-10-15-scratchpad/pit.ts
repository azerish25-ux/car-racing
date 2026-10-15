const root = '/home/user/Experiment-3/.claude/worktrees/agent-a726b8c5722e56270';
const { Simulation } = await import(root + '/src/simulation/world.ts');
const { DEFAULT_OPTIONS } = await import(root + '/src/simulation/config.ts');
const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0, vehicles: ['gpr1'] });
sim.autoPlayer = true;
for (let i = 0; i < 120 * 5; i++) sim.step(1 / 120);
sim.requestPit('soft');
const c = sim.cars[0] as any;
let last = '';
for (let i = 0; i < 120 * 160; i++) {
  sim.step(1 / 120);
  const t = i / 120;
  const line = `inPit=${c.inPit} phase=${c.pitPhase} stops=${c.pitStops} state=${c.dynamics.state}`;
  if (line !== last || i % 240 === 0) {
    console.log(`t=${t.toFixed(1)} s=${c.s.toFixed(1)} lat=${c.lateral.toFixed(2)} v=${(c.speed * 3.6).toFixed(0)} tgt=${(c.aiTarget * 3.6).toFixed(0)} ${line} dec=${(sim.ai[0] as any).decision} box=${sim.track.boxS(0)} boxLat=${sim.track.boxLateral()} entry=${sim.track.pitEntryS().toFixed(0)} steerCmd=${c.input.steer.toFixed(2)} thr=${c.input.throttle.toFixed(2)} brk=${c.input.brake.toFixed(2)}`);
    last = line;
  }
  if (c.pitStops > 0 && !c.inPit) break;
}
