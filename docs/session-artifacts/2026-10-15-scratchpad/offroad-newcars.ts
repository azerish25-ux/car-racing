// Scratch check: the catalogue's newer loose-surface cars on the terrain venues.
const ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/';
const { DEFAULT_OPTIONS } = await import(ROOT + 'config.ts');
const { sessionIncompatibilities } = await import(ROOT + 'events.ts');
const { PHASE } = await import(ROOT + 'race.ts');
const { Simulation } = await import(ROOT + 'world.ts');
const DT = 1 / 120;
const races = [
  { circuit: 'pinewood-stage', ruleset: 'rally-stage', laps: 1, vehicles: ['gb4', 'rl7', 'rl2', 'bg2'], seed: 7 },
  { circuit: 'kestrel-rx', ruleset: 'rallycross-joker', laps: 4, vehicles: ['rxe', 'gb4', 'rcx6', 'rl7', 'bg2'], seed: 8 },
];
for (const r of races) {
  const options = { ...DEFAULT_OPTIONS, mode: 'race', weather: 'clear', opponents: r.vehicles.length - 1, ...r };
  console.log(r.circuit, 'incompatibilities', JSON.stringify(sessionIncompatibilities(options)));
  const sim = new Simulation(options);
  sim.autoPlayer = true;
  let t = 0, longest = 0;
  const stopped = new Float64Array(sim.cars.length);
  for (; t < 700 && sim.race.phase !== PHASE.FINISHED; t += DT) {
    sim.step(DT);
    if (sim.race.phase !== PHASE.RACING) continue;
    sim.cars.forEach((c: any, id: number) => {
      const e = sim.offroad.entrants[id];
      const waiting = e.start <= 1 || e.parked || c.finishTime > 0 || c.inPit;
      stopped[id] = c.speed < 1 && !waiting ? stopped[id] + DT : 0;
      longest = Math.max(longest, stopped[id]);
    });
  }
  console.log(
    r.circuit,
    'finished', sim.race.phase === PHASE.FINISHED, 't', t.toFixed(1),
    'times', sim.cars.map((c: any) => (c.finishTime > 0 ? c.finishTime.toFixed(1) : 'DNF')).join(','),
    'jokers', sim.offroad.entrants.map((e: any) => e.jokers).join(','),
    'longestStop', longest.toFixed(1),
  );
}
