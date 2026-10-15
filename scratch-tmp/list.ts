import { CIRCUITS } from '../src/simulation/circuits.ts';
import { EVENTS } from '../src/simulation/events.ts';
for (const e of EVENTS) if (CIRCUITS[e.circuit].offroad) console.log(e.id, e.circuit, e.ruleset, e.laps, e.opponents, e.weather, JSON.stringify(e.vehicles), e.seed, CIRCUITS[e.circuit].offroad?.kind);
console.log(Object.keys(CIRCUITS).filter(k=>CIRCUITS[k].offroad));
