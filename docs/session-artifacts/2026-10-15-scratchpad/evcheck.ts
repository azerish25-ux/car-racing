const W = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { DEFAULT_OPTIONS, validateOptions } = await import(W + '/src/simulation/config.ts');
const { EVENTS, eventSession, sessionIncompatibilities, rulesetFor } = await import(W + '/src/simulation/events.ts');
const { VEHICLES } = await import(W + '/src/simulation/vehicles.ts');
for (const e of EVENTS) {
  const o = eventSession(e, DEFAULT_OPTIONS);
  const v = validateOptions(o);
  const inc = sessionIncompatibilities(v);
  const r = rulesetFor(v);
  const veh = (v.vehicles ?? []);
  if (inc.length || v.laps !== e.laps || v.opponents !== e.opponents || veh.length !== e.opponents + 1) console.log(e.id, inc, 'laps', e.laps, '->', v.laps, 'opp', e.opponents, '->', v.opponents, 'veh', veh.length, r.id);
}
console.log('done', EVENTS.length);
