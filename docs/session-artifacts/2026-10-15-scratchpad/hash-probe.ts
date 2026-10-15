const R = process.argv[2];
const { vehicleHash } = await import(R + '/src/core/session-identity.ts');
const { VEHICLES, VEHICLE_IDS } = await import(R + '/src/simulation/vehicles.ts');
console.log(JSON.stringify(Object.fromEntries(VEHICLE_IDS.map((id: string) => [id, vehicleHash(VEHICLES[id])]))));
console.log(JSON.stringify(Object.fromEntries(VEHICLE_IDS.map((id: string) => [id, JSON.stringify(VEHICLES[id].ai)]))).slice(0, 0));
