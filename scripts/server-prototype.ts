// Authoritative simulation server prototype (WP49, masterplan §22.2).
// Runs the unchanged headless Simulation as a server workload: measures CPU
// cost per simulated second and per car, heap growth, a same-machine
// determinism check (two runs from the same seed and inputs must produce an
// identical final snapshot hash), and the bandwidth of a compact network
// state at a separately chosen cadence versus shipping full render
// snapshots. Writes docs/server-prototype.json. This is a measurement, not
// an online service: authority, prediction and reconciliation remain WP50+.
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';

const TICK = 120,
  SECONDS = Number(process.argv[2] ?? 90),
  NETWORK_HZ = 20,
  CARS = 8;
/** Compact per-car network state: position, orientation, velocity, steer,
 * throttle, brake, gear and lap progress, quantized to 16 bits where safe. */
const NETWORK_BYTES_PER_CAR = 3 * 4 + 4 * 2 + 3 * 2 + 3 * 1 + 1 + 4;
function hash(frame: Float32Array) {
  const words = new Uint32Array(frame.buffer, frame.byteOffset, frame.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 0x01000193);
  return (h >>> 0).toString(16);
}
function run() {
  const sim = new Simulation(
    validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', laps: 10, opponents: CARS - 1, seed: 909 }),
  );
  sim.autoPlayer = true;
  const frame = sim.makeFrame();
  const heap0 = process.memoryUsage().heapUsed;
  const start = performance.now();
  let worstStep = 0;
  for (let tick = 0; tick < SECONDS * TICK; tick++) {
    const t0 = performance.now();
    sim.step(1 / TICK);
    // The first second includes one-off contact-mesh/BVH construction.
    if (tick >= TICK) worstStep = Math.max(worstStep, performance.now() - t0);
    if (tick % (TICK / NETWORK_HZ) === 0) sim.writeFrame(frame);
  }
  const elapsed = performance.now() - start;
  sim.writeFrame(frame);
  return {
    elapsedMs: elapsed,
    worstStepMs: worstStep,
    heapGrowthBytes: process.memoryUsage().heapUsed - heap0,
    finalHash: hash(frame),
    leaderLaps: Math.max(...sim.race.laps.map((l) => l.completed)),
    progress: Array.from({ length: CARS }, (_, id) => frame[carBase(id) + F.S]),
  };
}
const first = run(),
  second = run();
const simulatedMs = SECONDS * 1000;
const report = {
  fixture: `${CARS}-car Aurel race, AI-driven, ${TICK} Hz, ${SECONDS} s simulated`,
  runtime: `node ${process.version}`,
  cpuMsPerSimulatedSecond: first.elapsedMs / SECONDS,
  cpuMsPerCarPerSimulatedSecond: first.elapsedMs / SECONDS / CARS,
  realtimeFactor: simulatedMs / first.elapsedMs,
  /** Races one core could host at this cost (upper bound, no networking). */
  racesPerCore: Math.floor(simulatedMs / first.elapsedMs),
  /** Worst single 120 Hz step after the one-off first-second warmup. */
  worstStepMs: first.worstStepMs,
  tickBudgetMs: 1000 / TICK,
  heapGrowthBytes: first.heapGrowthBytes,
  determinism: {
    sameMachine: first.finalHash === second.finalHash,
    firstHash: first.finalHash,
    secondHash: second.finalHash,
    note: 'Same-process, same-seed repetition only; cross-platform float determinism is not claimed.',
  },
  bandwidth: {
    networkHz: NETWORK_HZ,
    compactBytesPerCar: NETWORK_BYTES_PER_CAR,
    compactKbitPerClient: (NETWORK_BYTES_PER_CAR * CARS * NETWORK_HZ * 8) / 1000,
    fullSnapshotBytes: (HEADER + CARS * CAR_STRIDE) * 4,
    fullSnapshotKbitAt120Hz: ((HEADER + CARS * CAR_STRIDE) * 4 * TICK * 8) / 1000,
  },
  leaderLaps: first.leaderLaps,
};
writeFileSync('docs/server-prototype.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.determinism.sameMachine) process.exitCode = 1;
