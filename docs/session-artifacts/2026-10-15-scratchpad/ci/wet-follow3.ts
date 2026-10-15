const repo = process.argv[2];
const { DEFAULT_OPTIONS, startingGrid } = await import(`${repo}/src/simulation/config.ts`);
const { Simulation } = await import(`${repo}/src/simulation/world.ts`);
const P = await import(`${repo}/src/simulation/protocol.ts`);
const { H, F, W, carBase, WHEEL_BASE, WHEEL_STRIDE } = P;
for (const slot of ['back', 'midfield']) {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 5, opponents: 7, weather: 'rain', compound: 'wet', grid: startingGrid(8, slot) });
  sim.autoPlayer = true;
  const frame = sim.makeFrame();
  let total = 0, first = -1; const spans: string[] = []; let spanStart = -1;
  for (let tick = 1; tick <= 240 * 120; tick++) {
    sim.step(1 / 120);
    if (tick % 12) continue;
    const f = sim.writeFrame ? (sim.writeFrame(frame), frame) : sim.makeFrame();
    const p = carBase(0);
    let close = false;
    if (f[p + F.SPEED] >= 5) for (let n = 1; n < 8; n++) {
      const o = carBase(n), ds = (f[o + F.S] - f[p + F.S] + f[H.LENGTH]) % f[H.LENGTH];
      const water = [2, 3].some((w) => f[o + WHEEL_BASE + w * WHEEL_STRIDE + W.WATER] > 0);
      if (ds > 3 && ds < 45 && Math.abs(f[o + F.Y] - f[p + F.Y]) < 3 && f[o + F.SPEED] > 5 && water) { close = true; break; }
    }
    const t = tick / 120 - sim.race.greenAt;
    if (close) { total += 0.1; if (first < 0) first = t; if (spanStart < 0) spanStart = t; }
    else if (spanStart >= 0) { spans.push(`${spanStart.toFixed(0)}-${t.toFixed(0)}`); spanStart = -1; }
  }
  console.log(`${slot}: first following at green+${first.toFixed(1)} s, total ${total.toFixed(1)} s in 240 s; spans ${spans.slice(0, 12).join(' ')}`);
}
