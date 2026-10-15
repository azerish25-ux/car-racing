const repo = process.argv[2];
const { DEFAULT_OPTIONS, controls } = await import(`${repo}/src/simulation/config.ts`);
const { Simulation } = await import(`${repo}/src/simulation/world.ts`);
const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 5, opponents: 7, weather: 'rain', compound: 'wet' });
const input = { ...controls(), brake: 1 };
let met = -1; const win: number[] = [];
for (let i = 0; i < 120 * 120; i++) {
  sim.setInput(input);
  sim.step(1 / 120);
  const p = sim.cars[0];
  const L = sim.track.length;
  if (sim.race.phase === 2) {
    for (let n = 1; n < 8; n++) {
      const ds = (sim.cars[n].s - p.s + L) % L;
      if (ds > 5 && ds < 45) { win.push(+sim.race.time.toFixed(2)); break; }
    }
  }
  if (i % (120 * 10) === 0) console.log(`t=${(i/120).toFixed(0)} phase=${sim.race.phase} player s=${p.s.toFixed(1)} v=${p.speed?.toFixed?.(1)} rivals ds=${sim.cars.slice(1).map((c) => ((c.s - p.s + L) % L).toFixed(0)).join(',')}`);
  if (sim.race.time > 40) break;
}
console.log("window samples", win.length, "first", win[0], "last", win.at(-1), "gaps>0.5s", win.filter((t,i)=>i>0&&t-win[i-1]>0.5).length);
