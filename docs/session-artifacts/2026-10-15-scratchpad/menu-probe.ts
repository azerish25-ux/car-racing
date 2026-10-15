const W = '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src';
const { machineChoices, machineOptions } = await import(W + '/ui/machine-options.ts');
const { sessionIncompatibilities } = await import(W + '/simulation/events.ts');
const { DEFAULT_OPTIONS } = await import(W + '/simulation/config.ts');
const { VEHICLES } = await import(W + '/simulation/vehicles.ts');
const groups = machineChoices();
const seen = new Map<string, number>();
const labels = new Map<string, number>();
for (const g of groups) { console.log('#', g.label); for (const o of g.options) { console.log('   ', o.value, '|', o.label); seen.set(o.value, (seen.get(o.value) ?? 0) + 1); labels.set(o.label, (labels.get(o.label) ?? 0) + 1); } }
console.log('dup values', [...seen].filter(([, n]) => n > 1));
console.log('dup labels', [...labels].filter(([, n]) => n > 1));
console.log('missing', Object.keys(VEHICLES).filter((v) => !seen.has(v)));
for (const mode of ['race', 'practice', 'qualifying', 'time-trial', 'endurance']) {
  for (const g of groups) for (const o of g.options) {
    const opts: any = { ...DEFAULT_OPTIONS, mode, opponents: 7, laps: 5 };
    const m = machineOptions(opts, o.value);
    const errs = sessionIncompatibilities({ ...opts, ...m });
    if (errs.length) console.log(mode, o.value, '->', errs.join(' | '));
  }
}
