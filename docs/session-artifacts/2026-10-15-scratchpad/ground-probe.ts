const root = process.argv[2];
const { makeTire, solveTire } = await import(`${root}/src/simulation/tire.ts`);
const { surfaceSample } = await import(`${root}/src/simulation/track.ts`);
const { MATERIAL, surfaceMaterial } = await import(`${root}/src/simulation/surface-material.ts`);
for (const id of [MATERIAL.GRASS, MATERIAL.GRAVEL, MATERIAL.DIRT, MATERIAL.MUD, MATERIAL.SAND, MATERIAL.SNOW]) {
  for (const load of [1500, 2200, 3500]) {
    const t = makeTire('medium'),
      s = surfaceSample(),
      m = surfaceMaterial(id);
    s.surface = id;
    s.grip = m.grip;
    s.resistance = m.rolling;
    t.omega = 20 / t.radius;
    for (let i = 0; i < 480; i++) {
      t.deflection = load / 330000;
      solveTire(t, 20, 0, load, 0, 0, s, 0, 1 / 240);
    }
    console.log(
      `${m.name.padEnd(8)} load ${load} sink ${(t.sinkage * 1000).toFixed(1)} mm patch ${t.patchLength.toFixed(3)} rolling ${t.rolling.toFixed(3)} drag@20 ${t.groundDrag.toFixed(0)} N`,
    );
  }
}
