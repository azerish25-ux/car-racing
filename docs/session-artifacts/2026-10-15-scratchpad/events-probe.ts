const W = '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src';
const { EVENTS, eventSession, RULESETS } = await import(W + '/simulation/events.ts');
const { VEHICLES } = await import(W + '/simulation/vehicles.ts');
const { DEFAULT_OPTIONS } = await import(W + '/simulation/config.ts').catch(() => ({}));
const base: any = DEFAULT_OPTIONS ?? { assist: 'sport' };
console.log('base keys', Object.keys(base ?? {}).slice(0, 30));
for (const e of EVENTS) {
  try { const s = eventSession(e, base); const cls = [...new Set(s.vehicles.map((v: string) => VEHICLES[v].classId))]; console.log('ok', e.id, e.ruleset, cls.join(',')); }
  catch (err: any) { console.log('ERR', e.id, err.message); }
}
// coverage: each vehicle appears in some event
const used = new Set<string>();
for (const e of EVENTS) (typeof e.vehicles === 'string' ? [e.vehicles] : e.vehicles).forEach((v: string) => used.add(v));
console.log('not in any event:', Object.keys(VEHICLES).filter((v) => !used.has(v)).join(','));
