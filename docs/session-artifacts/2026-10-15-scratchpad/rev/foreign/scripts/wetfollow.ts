// Geometric part of the race-review "wet-following" criterion for the
// wet-review-start test scenario: the longest run with the same car 3-35 m
// ahead, within 3.5 m laterally and 40 m along the lap, in the first 60 s.
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';

const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'race',
  laps: 5,
  opponents: 7,
  weather: 'rain',
  compound: 'wet',
  grid: [4, 2, 0, 3, 1, 5, 6, 7],
});
sim.autoPlayer = true;
const L = sim.track.length,
  a = sim.cars[0];
let run = 0,
  best = 0,
  last = -1,
  clock = 0,
  next = 0;
const log: string[] = [];
for (let tick = 0; tick < 60 * 120; tick++) {
  sim.step(1 / 120);
  if ((clock += 1 / 120) < 0.5) continue;
  clock = 0;
  if (sim.race.phase !== PHASE.RACING) continue;
  const f = a.forward;
  let leader = -1,
    leaderGap = Infinity,
    nearest = '';
  for (const b of sim.cars) {
    if (b === a || b.speed <= 5 || a.speed <= 5) continue;
    const dx = b.body.position.x - a.body.position.x,
      dz = b.body.position.z - a.body.position.z;
    const h = Math.hypot(f.x, f.z),
      ahead = (dx * f.x + dz * f.z) / h,
      lateral = Math.abs(dx * f.z - dz * f.x) / h;
    let ds = b.s - a.s;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    if (ds > 0 && ds < 60) nearest += ` ${b.id}@${ahead.toFixed(0)}/${lateral.toFixed(1)}`;
    if (ahead >= 3 && ahead <= 35 && ds > 0 && ds <= 40 && lateral <= 3.5) {
      const gap = Math.hypot(dx, dz);
      if (gap < leaderGap) {
        leader = b.id;
        leaderGap = gap;
      }
    }
  }
  run = leader >= 0 && leader === last ? run + 0.5 : 0;
  last = leader;
  best = Math.max(best, run);
  if (sim.race.time >= next) {
    next += 2;
    log.push(`t${sim.race.time.toFixed(0)} v${(a.speed * 3.6).toFixed(0)} lead${leader} run${run.toFixed(1)} |${nearest}`);
  }
}
console.log(log.join('\n'));
console.log(JSON.stringify({ bestFollowingSeconds: best }));
