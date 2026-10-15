const root = process.argv[2], venue = process.argv[3], seed = +process.argv[4];
const { DEFAULT_OPTIONS } = await import(root + '/src/simulation/config.ts');
const { PHASE } = await import(root + '/src/simulation/race.ts');
const { Simulation } = await import(root + '/src/simulation/world.ts');
const options = venue === 'valley'
  ? { ...DEFAULT_OPTIONS, mode: 'race', weather: 'clear', circuit: 'valley-ridge-mx', ruleset: 'motocross-moto', laps: 3, opponents: 7, vehicles: Array.from({ length: 8 }, (_, i) => (i % 3 === 2 ? 'mx250' : 'mx450')), seed }
  : { ...DEFAULT_OPTIONS, mode: 'race', weather: 'clear', circuit: 'arena-nord-sx', ruleset: 'motocross-moto', laps: 3, opponents: 7, vehicles: Array(8).fill('mx450'), seed };
const sim = new Simulation(options);
sim.autoPlayer = true;
for (let t = 0; t < 600 && sim.race.phase !== PHASE.FINISHED; t += 1 / 120) sim.step(1 / 120);
const crashes = sim.cars.map((c: any) => c.dynamics.crashes);
const causes: Record<string, number> = {};
for (const c of sim.cars as any[]) for (const k of c.crashCauses) causes[k.cause] = (causes[k.cause] ?? 0) + 1;
console.log(JSON.stringify({ venue, seed, mean: +(crashes.reduce((a: number, b: number) => a + b, 0) / 24).toFixed(3), crashes, causes, finished: sim.race.phase === PHASE.FINISHED }));
