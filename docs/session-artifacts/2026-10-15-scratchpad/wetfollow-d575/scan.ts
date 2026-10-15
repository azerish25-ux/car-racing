// Start-sensitive scenarios for one source root.
// node --experimental-transform-types scan.ts <root> <scenario: e2e|wetstart|midfield>
const root = process.argv[2];
const scenario = process.argv[3];
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS, startingGrid } = await import(`${root}/src/simulation/config.ts`);
const { H } = await import(`${root}/src/simulation/protocol.ts`);
const { PHASE } = await import(`${root}/src/simulation/race.ts`);
const { RaceReviewEvents, raceReviewFrame, readRaceReviewFrame } = await import(
  `${root}/src/rendering/race-review.ts`
);
const { Effects } = await import(`${root}/src/rendering/effects.ts`);
const { EffectPlayback } = await import(`${root}/src/rendering/effect-playback.ts`);
const tag = root.split('/').pop();

function wetWindows(grid: number[] | undefined, seconds: number, intervals: number[]) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    laps: 5,
    opponents: 7,
    weather: 'rain',
    compound: 'wet',
    ...(grid ? { grid } : {}),
  });
  sim.autoPlayer = true;
  const frame = sim.makeFrame(),
    events = new RaceReviewEvents(),
    sample = raceReviewFrame(),
    effects = new Effects(),
    playback = new EffectPlayback(effects);
  const runs: [number, number][] = [];
  let start = -1,
    len = 0,
    next = 0,
    index = 0,
    qualifiedAt = -1;
  for (let tick = 0; tick < seconds * 120; tick++) {
    sim.step(1 / 120);
    if (tick < next) continue;
    next += intervals[index++ % intervals.length];
    sim.writeFrame(frame);
    playback.update(frame, true, true);
    readRaceReviewFrame(frame, 0, 0, 0, sample);
    sample.sprayParticles = effects.activeSprayCountFor(sample.leader);
    events.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], sample);
    const run = (events as unknown as { wetRun: number }).wetRun;
    if (run > 0) {
      if (start < 0) start = frame[H.TIME] - run;
      len = run;
    } else if (start >= 0) {
      runs.push([+start.toFixed(1), +len.toFixed(2)]);
      start = -1;
    }
    if (qualifiedAt < 0 && events.qualified('wet-following')) qualifiedAt = frame[H.TIME];
  }
  if (start >= 0) runs.push([+start.toFixed(1), +len.toFixed(2)]);
  return { qualifiedAt: +qualifiedAt.toFixed(1), runs: runs.filter((r) => r[1] >= 2) };
}

if (scenario.startsWith('e2e')) {
  const slot = scenario === 'e2e' ? 'midfield' : scenario.slice(3);
  const r = wetWindows(startingGrid(8, slot), Number(process.argv[4] ?? 100), [4]);
  // Post-launch: windows starting at least 15 s after green (~6 s).
  const post = r.runs.filter((w) => w[0] >= 21 && w[1] >= 3).map((w) => w[1]);
  console.log(tag, scenario, JSON.stringify(r.runs), 'postLaunchMax', Math.max(0, ...post));
} else if (scenario === 'wetstart') {
  const out = [[60], [80], [40, 75, 110, 85, 55]].map(
    (iv) => wetWindows([4, 2, 0, 3, 1, 5, 6, 7], 60, iv).qualifiedAt,
  );
  console.log(tag, 'wetstart qualifiedAt', JSON.stringify(out));
} else if (scenario === 'midfield') {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    laps: 2,
    opponents: 7,
    grid: startingGrid(8, 'midfield'),
  });
  sim.autoPlayer = true;
  const length = sim.track.length,
    distance = new Float64Array(8),
    lastS = sim.cars.map((c: any) => c.s);
  let order: number[] = [],
    passes = 0,
    run = 0,
    best = 0,
    last = -1,
    clock = 0;
  for (let tick = 0; tick < 120 * 240 && sim.race.phase !== PHASE.FINISHED; tick++) {
    sim.step(1 / 120);
    if ((clock += 1 / 120) < 1 / 15) continue;
    clock = 0;
    sim.cars.forEach((c: any, i: number) => {
      distance[i] += ((c.s - lastS[i] + length * 1.5) % length) - length / 2;
      lastS[i] = c.s;
    });
    if (sim.race.phase !== PHASE.RACING) continue;
    const now = [...distance.keys()].sort((a, b) => distance[b] - distance[a]);
    for (let k = 0; order.length && k < 7; k++)
      if (order.indexOf(now[k]) > order.indexOf(now[k + 1]) && !sim.cars[now[k]].inPit) passes++;
    order = now;
    const a = sim.cars[0];
    let rival = -1,
      nearest = Infinity;
    for (const b of sim.cars) {
      if (b === a || b.speed < 5 || a.speed < 5) continue;
      const ds = ((b.s - a.s + length * 1.5) % length) - length / 2,
        gap = Math.hypot(
          b.body.position.x - a.body.position.x,
          b.body.position.y - a.body.position.y,
          b.body.position.z - a.body.position.z,
        );
      if (gap <= 18 && Math.abs(ds) <= 22 && gap < nearest) {
        rival = b.id;
        nearest = gap;
      }
    }
    run = rival >= 0 && rival === last ? run + 1 / 15 : 0;
    last = rival;
    best = Math.max(best, run);
  }
  console.log(
    tag,
    'midfield best',
    best.toFixed(2),
    'passes',
    passes,
    'health',
    Math.min(...sim.cars.map((c: any) => c.frontHealth)).toFixed(3),
  );
}
