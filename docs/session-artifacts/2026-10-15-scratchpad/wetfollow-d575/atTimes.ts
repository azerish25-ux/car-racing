// Headless observations at the browser probe's presented simulation times.
const root = process.argv[2];
const times = process.argv.slice(3).map(Number);
const { Simulation } = await import(`${root}/src/simulation/world.ts`);
const { DEFAULT_OPTIONS, startingGrid } = await import(`${root}/src/simulation/config.ts`);
const { H, F, carBase } = await import(`${root}/src/simulation/protocol.ts`);
const { raceReviewFrame, readRaceReviewFrame } = await import(`${root}/src/rendering/race-review.ts`);
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'race',
  laps: 5,
  opponents: 7,
  weather: 'rain',
  compound: 'wet',
  grid: startingGrid(8, 'midfield'),
});
sim.autoPlayer = true;
const frame = sim.makeFrame(),
  obs = raceReviewFrame();
const end = Math.max(...times);
for (let tick = 0; sim.race.time <= end + 0.01; tick++) {
  sim.step(1 / 120);
  for (const t of times)
    if (Math.abs(sim.race.time - t) < 1 / 240) {
      sim.writeFrame(frame);
      readRaceReviewFrame(frame, 0, 0, 0, obs);
      console.log(
        `t=${frame[H.TIME].toFixed(3)} phase=${obs.racePhase} speed=${obs.speed.toFixed(2)} leader=${obs.leader} gap=${obs.leaderGap.toFixed(2)} cw=${obs.contactWater.toFixed(2)} lw=${obs.leaderWater.toFixed(2)} s=${frame[carBase(0) + F.S].toFixed(2)}`,
      );
    }
}
