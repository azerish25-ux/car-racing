const W = '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src';
const { machineOptions } = await import(W + '/ui/machine-options.ts');
const { DEFAULT_OPTIONS } = await import(W + '/simulation/config.ts');
const { rulesetFor, sessionIncompatibilities } = await import(W + '/simulation/events.ts');
const { Simulation } = await import(W + '/simulation/world.ts');
for (const [circuit, machine] of [['kestrel-rx', 'rcx6'], ['pinewood-stage', 'rl2'], ['valley-ridge-mx', 'mx450'], ['kestrel-rx', 'rxe']]) {
  const base = { ...DEFAULT_OPTIONS, mode: 'race', circuit, opponents: 7 };
  const o = { ...base, ...machineOptions(base, machine) };
  const rules = rulesetFor(o);
  const sim = new Simulation(o);
  console.log(circuit, machine, '->', rules.id, 'format', rules.format?.kind ?? null, 'errors', sessionIncompatibilities(o), 'session.format', sim.offroad?.format?.kind ?? null);
}
