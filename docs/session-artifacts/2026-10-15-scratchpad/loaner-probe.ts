const R = process.env.ROOT!;
const { liveRegistry } = await import(R + '/src/career/registry.ts');
const { loanerVehicle, licenceAvailability } = await import(R + '/src/career/ladder.ts');
const { newCareer } = await import(R + '/src/career/save.ts');
const reg = liveRegistry();
const save = newCareer();
for (const d of ['circuit-cars', 'road-bikes']) console.log(d, loanerVehicle(reg, d)?.id);
for (const id of ['braking', 'cornering', 'wet', 'lean']) { const a = licenceAvailability(reg, save, id); console.log(id, a.status, a.vehicle, a.venue, a.definition?.ruleset, a.reasons.join('|')); }
