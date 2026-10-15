const W = process.argv[2];
const { loanerVehicle, vehiclePrice } = await import(`${W}/src/career/ladder.ts`);
const { liveRegistry, disciplineVehicles } = await import(`${W}/src/career/registry.ts`);
const live = liveRegistry();
console.log('loaner', loanerVehicle(live, 'festival')?.id);
console.log(disciplineVehicles(live, 'festival').map((v) => `${v.id}:${v.classId}:${vehiclePrice(live, v)}`).join(' '));
