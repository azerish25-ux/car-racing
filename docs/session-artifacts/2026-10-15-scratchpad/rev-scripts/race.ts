const root = process.argv[2];
const { OpenWorldSimulation, festivalDefaultVehicle } = await import(`${root}/src/simulation/open-world/session.ts`);
const vehicle = festivalDefaultVehicle();
const sim = new OpenWorldSimulation({ vehicle });
sim.command({ type: 'autopilot', value: true });
sim.command({ type: 'start', event: 'valley-sprint' });
let race = null;
for (let i = 0; i < 120 * 200 && !race; i++) { sim.step(1 / 120); race = sim.takeResult(); }
console.log(vehicle, JSON.stringify({ pos: race?.position, t: race?.time, st: race?.standings.map((s) => [s.vehicleId, s.time]) }));
