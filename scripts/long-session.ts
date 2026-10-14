// Long-duration resilience check (masterplan §24.8, WP15 trend): a headless
// AI-driven practice session with a mixed field, sampling heap and checking
// every snapshot stays finite. Reports the heap slope per simulated hour
// after warmup; exits 1 on non-finite state or unbounded growth.
import { performance } from 'node:perf_hooks';
import { allFinite } from '../src/core/math.ts';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';

const MINUTES = Number(process.argv[2] ?? 20),
  TICK = 120;
const sim = new Simulation(
  validateOptions({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    ruleset: 'open-exhibition',
    opponents: 5,
    weather: 'changeable',
    vehicles: ['apx01', 'tc1', 'apx01', 'tc1', 'apx01', 'tc1'],
    seed: 777,
  }),
);
sim.autoPlayer = true;
const frame = sim.makeFrame();
const samples: { minute: number; heapMB: number }[] = [];
const start = performance.now();
let nonFinite = 0;
for (let minute = 1; minute <= MINUTES; minute++) {
  for (let i = 0; i < 60 * TICK; i++) {
    sim.step(1 / TICK);
    if (i % TICK === 0) {
      sim.writeFrame(frame);
      if (!allFinite(frame)) nonFinite++;
    }
  }
  global.gc?.();
  samples.push({ minute, heapMB: process.memoryUsage().heapUsed / 1e6 });
}
const settled = samples.slice(Math.min(3, samples.length - 1));
const slope =
  settled.length > 1
    ? ((settled.at(-1)!.heapMB - settled[0].heapMB) / (settled.at(-1)!.minute - settled[0].minute)) * 60
    : 0;
const report = {
  simulatedMinutes: MINUTES,
  cpuSeconds: (performance.now() - start) / 1000,
  nonFiniteSnapshots: nonFinite,
  retired: sim.cars.filter((c) => c.retired).length,
  laps: sim.race.laps.map((l) => l.completed),
  heapMB: samples.map((s) => Number(s.heapMB.toFixed(1))),
  heapSlopeMBPerHour: Number(slope.toFixed(1)),
};
console.log(JSON.stringify(report, null, 2));
if (nonFinite || slope > 50) process.exitCode = 1;
