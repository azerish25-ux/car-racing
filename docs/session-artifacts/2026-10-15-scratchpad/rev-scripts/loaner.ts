const W = process.argv[2];
const { settleFestival, festivalKey } = await import(`${W}/src/career/festival.ts`);
const { liveRegistry } = await import(`${W}/src/career/registry.ts`);
const { newCareer } = await import(`${W}/src/career/save.ts`);
const { buyVehicle } = await import(`${W}/src/career/economy.ts`);
const { CareerController } = await import(`${W}/src/career/controller.ts`);
const { festivalDefaultVehicle } = await import(`${W}/src/simulation/open-world/festival-machines.ts`);
const live = liveRegistry();
const base = { kind: 'festival-result', version: 2, regionId: live.festival[0].id, eventId: 'coast-trap', eventName: 'Coast Highway Speed Trap', eventKind: 'speed-trap', vehicleId: 'rs5', completed: true, abandoned: false, position: null, entrants: 1, time: null, trapKmh: 265, averageKmh: null, driftScore: null, driftLines: [], stars: 3, legalDistance: 400, offRouteSeconds: 0, standings: [], at: 10, assisted: false };
// Path A: first run on the loaner (3 stars), then the same in an owned machine.
let a = newCareer();
const l = settleFestival(a, live, { ...base, runId: 's:1' }, { loaner: 'rs5' });
let owned = buyVehicle({ ...l.save, credits: 1e6 }, live, 'rs5');
const o = settleFestival(owned, live, { ...base, runId: 's:2' });
console.log('loaner first: rep', l.payout.reputation, 'total', l.payout.total, '| owned after: rep', o.payout.reputation, 'total', o.payout.total);
// Path B: first run directly in the owned machine.
const b = settleFestival(buyVehicle({ ...newCareer(), credits: 1e6 }, live, 'rs5'), live, { ...base, runId: 's:3' });
console.log('owned first: rep', b.payout.reputation, 'total', b.payout.total);
// Non-career festival player: default festival machine, not owned.
const toasts = []; const data = new Map();
const host = { store: { read: async (k) => data.get(k), write: async (k, v) => void data.set(k, v), writeWithBackup: async (k, v) => void data.set(k, v) }, toast: (m) => toasts.push(m), modal: () => {}, modalRoot: () => ({ querySelector: () => null }), state: () => 'menu', pause: () => {} };
const career = new CareerController(host, live);
await career.load({});
console.log('default festival vehicle', festivalDefaultVehicle(), 'stored career before:', data.has('career'));
await career.festivalResult({ ...base, vehicleId: festivalDefaultVehicle(), runId: 'x:1' });
console.log('stored career after:', data.has('career'), 'toast:', toasts.at(-1));
