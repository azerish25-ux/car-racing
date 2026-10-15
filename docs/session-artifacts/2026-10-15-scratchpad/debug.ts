const root = '/home/user/Experiment-3/.claude/worktrees/agent-a726b8c5722e56270';
const { Simulation } = await import(root + '/src/simulation/world.ts');
const { DEFAULT_OPTIONS } = await import(root + '/src/simulation/config.ts');
const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: 'aurel', mode: 'practice', opponents: 0, vehicles: ['gpr1'], seed: 7 });
sim.autoPlayer = true;
const c = sim.cars[0] as any;
const d = c.dynamics;
for (let i = 0; i < 120 * 6; i++) {
  sim.step(1 / 120);
  if (i > 120 * 3.5 && i % 6 === 0)
    console.log(
      `t=${(i / 120).toFixed(2)} v=${c.speed.toFixed(1)} lean=${d.lean.toFixed(2)} steer=${d.steer.toFixed(3)} thr=${c.throttle.toFixed(2)} cmd=${c.input.steer.toFixed(2)} drive=${d.driveForce.toFixed(0)} rearL=${d.rearLoad.toFixed(0)} frontL=${d.frontLoad.toFixed(0)} fu=${d.frontUse.toFixed(2)} ru=${d.rearUse.toFixed(2)} int=${d.intervention.toFixed(2)} state=${d.state} assists=${JSON.stringify(d.assists)} grip=${d.grip.toFixed(2)} slope=${d.slope.toFixed(3)}`,
    );
  if (d.state !== 'riding') break;
}
