// Headless reproduction of e2e/29 '27H.6 wet-following': aurel, race, 5 laps,
// 7 opponents, rain, wet, mid-field start, autopilot player, full particles.
// Usage: node --experimental-transform-types wet-repro.ts <repoRoot> [seconds]
const root = process.argv[2];
const limit = Number(process.argv[3] ?? 400);
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS, startingGrid } = await import(`${root}/src/simulation/config.ts`);
const { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } = await import(
  `${root}/src/simulation/protocol.ts`
);
const { RaceReviewEvents, raceReviewFrame, readRaceReviewFrame } = await import(
  `${root}/src/rendering/race-review.ts`
);
const { Effects } = await import(`${root}/src/rendering/effects.ts`);
const { EffectPlayback } = await import(`${root}/src/rendering/effect-playback.ts`);

const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  circuit: 'aurel',
  mode: 'race',
  laps: 5,
  opponents: 7,
  weather: 'rain',
  compound: 'wet',
  grid: startingGrid(8, process.argv[4] ?? 'midfield'),
});
sim.autoPlayer = true;
const frame = sim.makeFrame(),
  obs = raceReviewFrame(),
  events = new RaceReviewEvents(),
  effects = new Effects(),
  playback = new EffectPlayback(effects);
effects.density = 1;
let lastPrint = -1,
  bestRun = 0,
  leaderFrames = 0,
  frames = 0,
  playerWetFrames = 0,
  leaderWetFrames = 0,
  sprayFrames = 0;
const hist: Record<string, number> = {};
const runs: number[][] = [];
let curStart = -1, curLen = 0;
for (let tick = 0; tick < limit * 120; tick++) {
  sim.step(1 / 120);
  if (tick % 4) continue;
  sim.writeFrame(frame);
  playback.update(frame);
  readRaceReviewFrame(frame, 0, 0, 0, obs);
  obs.sprayParticles = effects.activeSprayCountFor(obs.leader);
  events.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], obs);
  if (frame[H.PHASE] === 2) {
    frames++;
    if (obs.leader >= 0) leaderFrames++;
    if (obs.contactWater > 0.04) playerWetFrames++;
    if (obs.leader >= 0 && obs.leaderWater > 0.04) leaderWetFrames++;
    if (obs.leader >= 0 && obs.sprayParticles > 0) sprayFrames++;
  }
  // Raw wheel water for the player, by wheel.
  const b = carBase(0);
  const t = Math.floor(frame[H.TIME]);
  if (process.env.VERBOSE && t % 30 === 0 && t !== lastPrint) {
    lastPrint = t;
    const wheels = [0, 1, 2, 3].map((w) => {
      const o = b + WHEEL_BASE + w * WHEEL_STRIDE;
      return `${frame[o + W.WATER].toFixed(3)}@${frame[o + W.LOAD].toFixed(0)}`;
    });
    // nearest car ahead by ds
    let near = '';
    let best = 1e9;
    for (let id = 1; id < frame[H.CARS]; id++) {
      let ds = frame[carBase(id) + F.S] - frame[b + F.S];
      const L = frame[H.LENGTH];
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      if (ds > 0 && ds < best) {
        best = ds;
        near = `id${id} ds=${ds.toFixed(1)} lat=${(frame[carBase(id) + F.LATERAL] - frame[b + F.LATERAL]).toFixed(2)}`;
      }
    }
    console.log(
      `t=${frame[H.TIME].toFixed(1)} ph=${frame[H.PHASE]} rank=${frame[b + F.RANK]} v=${frame[b + F.SPEED].toFixed(1)} meanW=${frame[H.WATER].toFixed(3)} rain=${frame[H.RAIN].toFixed(2)} wheels=${wheels.join(' ')} cw=${obs.contactWater.toFixed(3)} leader=${obs.leader} lw=${obs.leaderWater.toFixed(3)} spray=${obs.sprayParticles} ahead:${near} wet=${events.wetFollowingSeconds.toFixed(2)}`,
    );
  }
  bestRun = events.wetFollowingSeconds;
  const run = (events as any).wetRun as number;
  if (run > 0) { if (curStart < 0) curStart = frame[H.TIME] - run; curLen = run; }
  else if (curStart >= 0) { runs.push([+curStart.toFixed(1), +curLen.toFixed(2), frame[carBase(0) + F.LAPS]]); curStart = -1; curLen = 0; }
  if (sim.cars[0].finishTime > 0) {
    console.log('player finished at', sim.race.time.toFixed(1));
    break;
  }
}
console.log(
  JSON.stringify({
    time: sim.race.time,
    qualified: events.qualified('wet-following'),
    wetFollowingSeconds: bestRun,
    racingFrames: frames,
    leaderFrames,
    playerWetFrames,
    leaderWetFrames,
    sprayFrames,
    hist,
    runs: runs.filter((r) => r[1] >= 1),
  }),
);
