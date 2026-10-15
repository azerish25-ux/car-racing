import { sessionRulesSummary } from '/home/user/Experiment-3/src/ui/machine-options.ts';
import { CIRCUITS } from '/home/user/Experiment-3/src/simulation/circuits.ts';
const combos: [string, string, number][] = [
  ['poggio-alto', 'gpr1', 7], ['aurel', 'gpr1', 7], ['aurel', 'multiclass', 11], ['parco-reale', 'multiclass', 11],
  ['pinewood-stage', 'dx8', 7], ['pinewood-stage', 'dx8', 0], ['kestrel-rx', 'dx8', 7], ['kestrel-rx', 'rcx6', 7], ['kestrel-rx', 'rcx6', 3],
  ['neon-city', 'gt10m', 7], ['neon-city', 'apx01', 7], ['hochwald', 'hf67', 7], ['hochwald', 'gt8f', 7], ['mount-ardlow', 'gt8f', 7], ['gantry-point', 'gt10m', 7],
  ['valley-ridge-mx', 'mx450', 7], ['valley-ridge-mx', 'mx450', 11], ['arena-nord-sx', 'mx250', 7], ['arena-nord-sx', 'mx450', 11], ['speedbowl', 'xf2', 7], ['aurel', 'sk125', 7], ['aurel','xf2',7],
];
for (const [circuit, vehicle, opponents] of combos)
  console.log(circuit, vehicle, opponents + 1, '=>', sessionRulesSummary({ mode: 'race', opponents, compound: 'medium', vehicle, circuit: circuit as any }));
for (const id of ['valley-ridge-mx','arena-nord-sx']) console.log(id, JSON.stringify((CIRCUITS as any)[id].jumps.map((j:any)=>[j.name,j.kind,+j.start.toFixed(0),+j.takeoff.toFixed(0),+j.landing.toFixed(0),+j.end.toFixed(0)])));
