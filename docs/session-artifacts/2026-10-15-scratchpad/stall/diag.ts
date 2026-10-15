const repo = process.argv[2];
const watch = (process.argv[3] ?? '2,4,6').split(',').map(Number);
const until = Number(process.argv[4] ?? 30);
const every = Number(process.argv[5] ?? 60);
const { DEFAULT_OPTIONS, controls } = await import(`${repo}/src/simulation/config.ts`);
const { Simulation } = await import(`${repo}/src/simulation/world.ts`);
const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 5, opponents: 7, weather: 'rain', compound: 'wet' });
const input = { ...controls(), brake: 1 };
const L = sim.track.length;
console.log('L', L, 'width', sim.cars[0].trackPosition.width);
for (let i = 0; i < 120 * until; i++) {
  sim.setInput(input);
  sim.step(1 / 120);
  if (i % every === 0) {
    const p = sim.cars[0];
    const parts = watch.map((n) => {
      const c = sim.cars[n]; const ai = sim.ai[n] as any;
      const ds = ((c.s - p.s + L / 2) % L + L) % L - L / 2;
      return `#${n} ds=${ds.toFixed(1)} lat=${c.lateral.toFixed(2)} v=${c.speed.toFixed(1)} tgt=${c.aiTarget.toFixed(1)} off=${c.aiOffset.toFixed(2)} des=${ai.desiredOffset.toFixed(2)} ${ai.decision} pt=${ai.planner.passTarget} ab=${ai.planner.lastAbort} contacts=${(c as any).contactCount ?? ''}`;
    });
    console.log(`t=${sim.race.time.toFixed(1)} ph=${sim.race.phase} pl lat=${p.lateral.toFixed(2)} | ` + parts.join(' | '));
  }
}
