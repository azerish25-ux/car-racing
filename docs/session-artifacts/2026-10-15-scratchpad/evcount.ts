const R = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1/src';
const { EVENTS } = await import(`${R}/simulation/events.ts`);
const { CATALOGUE_CIRCUIT_IDS } = await import(`${R}/simulation/circuit-catalogue/venue-data.ts`);
const { CIRCUITS } = await import(`${R}/simulation/circuits.ts`);
const w1 = new Set(CATALOGUE_CIRCUIT_IDS.slice(0, 20)), w2 = new Set(CATALOGUE_CIRCUIT_IDS.slice(20));
console.log('w1', EVENTS.filter((e) => w1.has(e.circuit)).length, 'w2', EVENTS.filter((e) => w2.has(e.circuit)).length, 'total', EVENTS.length);
console.log('venues', new Set(CATALOGUE_CIRCUIT_IDS.map((id) => CIRCUITS[id].catalogue.venue)).size, 'layouts', CATALOGUE_CIRCUIT_IDS.length);
console.log('bikeSafe', Object.keys(CIRCUITS).filter((id) => CIRCUITS[id].bikeSafe).join(','));
