// Stalled-car scenarios: 'grid' (pole sitter never leaves) or 'mid' (player
// stops on the racing line mid-race). Reports when each rival passes the
// stalled car and every car-car contact.
const repo = process.argv[2];
const mode = process.argv[3] ?? 'grid';
const weather = process.argv[4] ?? 'rain';
const opponents = Number(process.argv[5] ?? 7);
const stopAt = Number(process.argv[6] ?? 75);
const seedArg = process.argv[7];
const { DEFAULT_OPTIONS, controls } = await import(`${repo}/src/simulation/config.ts`);
const { Simulation } = await import(`${repo}/src/simulation/world.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'race',
  laps: 5,
  opponents,
  weather,
  compound: weather === 'rain' ? 'wet' : DEFAULT_OPTIONS.compound,
  ...(seedArg ? { seed: Number(seedArg) } : {}),
});
const contacts: string[] = [];
const solver = sim.collisions as any;
const impulse = solver.impulse.bind(solver);
solver.impulse = (a: any, b: any, c: any, n: any, d: number) => {
  if (b && contacts.length < 200) contacts.push(`${sim.race.time.toFixed(2)} ${a.id}-${b.id} depth=${d.toFixed(3)}`);
  return impulse(a, b, c, n, d);
};
const L = sim.track.length;
const p = sim.cars[0];
const signed = (c: any) => ((((c.s - p.s) % L) + L * 1.5) % L) - L / 2;
let stopped = mode === 'grid' ? sim.race.greenAt : -1;
const passedAt = new Array(sim.cars.length).fill(NaN);
const behindAtStop = new Array(sim.cars.length).fill(false);
const brake = { ...controls(), brake: 1 };
if (mode === 'mid') sim.autoPlayer = true;
let maxImpact = 0;
for (let i = 0; i < 120 * 400; i++) {
  if (mode === 'grid' || (mode === 'mid' && sim.race.time > stopAt)) {
    if (sim.autoPlayer) {
      sim.autoPlayer = false;
      stopped = sim.race.time;
      // Every rival that is not about to lap it must pass it.
    }
    sim.setInput(brake);
  }
  sim.step(1 / 120);
  if (stopped >= 0 && sim.race.time >= stopped && p.speed < 0.5 && !behindAtStop.some(Boolean) && mode === 'mid') {
    for (let n = 1; n < sim.cars.length; n++) behindAtStop[n] = true;
  }
  if (mode === 'grid' && i === 0) for (let n = 1; n < sim.cars.length; n++) behindAtStop[n] = true;
  for (let n = 1; n < sim.cars.length; n++) {
    const c = sim.cars[n];
    maxImpact = Math.max(maxImpact, c.impact);
    const g = signed(c);
    if (behindAtStop[n] && Number.isNaN(passedAt[n]) && g > 8 && g < 200 && stopped >= 0 && p.speed < 1)
      passedAt[n] = sim.race.time - stopped;
  }
  if (stopped >= 0 && sim.race.time > stopped + 120) break;
  if (behindAtStop.some(Boolean) && passedAt.slice(1).every((t) => !Number.isNaN(t))) break;
}
console.log(
  JSON.stringify({
    mode,
    weather,
    stoppedAt: +stopped.toFixed(2),
    playerS: +p.s.toFixed(1),
    playerLat: +p.lateral.toFixed(2),
    passedAfter: passedAt.slice(1).map((t: number) => (Number.isNaN(t) ? null : +t.toFixed(2))),
    contacts: contacts.length,
    firstContacts: contacts.slice(0, 8),
    maxImpact: +maxImpact.toFixed(3),
    recoveries: Array.from(sim.recoveries),
    decisions: sim.ai.slice(1).map((a: any) => a.decision),
  }),
);
