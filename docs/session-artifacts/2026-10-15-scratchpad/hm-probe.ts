const R = process.env.ROOT!;
const { liveRegistry } = await import(R + '/src/career/registry.ts');
const { disciplineEvents } = await import(R + '/src/career/ladder.ts');
const reg = liveRegistry();
for (const owned of ['hf76', 'hf67', 'hf86', 'fe4']) {
  const view = { credits: 0, reputation: { 'circuit-cars': 100, 'road-bikes': 0, 'off-road': 0, festival: 0 }, licences: { braking: { medal: 'gold' }, cornering: { medal: 'gold' }, wet: { medal: 'gold' } }, owned: [{ id: owned }], active: { 'circuit-cars': owned } };
  const evs = disciplineEvents(reg, view, 'circuit-cars').filter((e: any) => e.tier === 'formula' && e.kind === 'invitational' && e.key.includes('.event.'));
  console.log(owned, evs.map((e: any) => `${e.key.split('.').pop()}=${e.status}${e.reasons.length ? '(' + e.reasons.join(';') + ')' : ''}`).join('\n   '));
}
