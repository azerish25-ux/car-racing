const repo = process.argv[2];
const { DEFAULT_OPTIONS, controls } = await import(`${repo}/src/simulation/config.ts`);
const { Simulation } = await import(`${repo}/src/simulation/world.ts`);
for (const hold of [8]) {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 5, opponents: 7, weather: 'rain', compound: 'wet' });
  const input = { ...controls(), brake: 1 };
  let released = -1, follow = -1;
  for (let i = 0; i < 120 * 330; i++) {
    const L = sim.track.length, p = sim.cars[0];
    const green = sim.race.phase === 2 ? sim.race.time - sim.race.greenAt : -1;
    if (released < 0) {
      sim.setInput(input);
      const passed = sim.cars.slice(1).some((c) => { const ds = (c.s - p.s + L) % L; return ds > 5 && ds < L / 2; });
      if (passed && green >= hold) { released = green; sim.autoPlayer = true; }
    } else {
      const ok = sim.cars.slice(1).some((c) => { const ds = (c.s - p.s + L) % L; return ds > 3 && ds < 45 && Math.abs(c.body.position.y - p.body.position.y) < 3 && c.speed > 5 && p.speed > 5; });
      if (ok) { follow = green; break; }
    }
    if (released >= 0 && i % 1200 === 0) console.log(`g=${green.toFixed(0)} v=${p.speed.toFixed(1)} s=${p.s.toFixed(0)} ds=${sim.cars.slice(1).map((c) => ((c.s - p.s + L) % L).toFixed(0)+'/'+c.speed.toFixed(0)+'/'+Math.abs(c.body.position.y - p.body.position.y).toFixed(1)).join(' ')}`);
    sim.step(1 / 120);
  }
  console.log(`hold>=${hold}s: released at green+${released.toFixed(1)} s, following at green+${follow.toFixed(1)} s (${follow > 0 ? (follow - released).toFixed(1) + ' s after release' : 'never in 330 s'})`);
}
