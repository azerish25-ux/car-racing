const root = process.argv[2];
const { VEHICLES, VEHICLE_IDS } = await import(root + '/src/simulation/vehicles.ts');
const { vehicleHash } = await import(root + '/src/core/session-identity.ts');
for (const id of VEHICLE_IDS) console.log(id, vehicleHash(VEHICLES[id]), JSON.stringify(VEHICLES[id]).length);
