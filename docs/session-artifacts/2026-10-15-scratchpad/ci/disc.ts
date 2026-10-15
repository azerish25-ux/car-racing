const r = await import('/home/user/Experiment-3/src/career/registry.ts');
const reg = r.liveRegistry();
for (const id of ['circuit-cars', 'road-bikes', 'off-road', 'festival']) {
  try { const s = r.disciplineStatus(reg, id as never); console.log(id, s.state, (s.reasons ?? []).join(' | ')); } catch (e) { console.log(id, 'ERR', (e as Error).message); }
}
