import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';
import {
  GHOST_FIELDS,
  GhostPlayer,
  GhostRecorder,
  ghostKey,
  ghostPose,
  validateGhost,
  writeGhostFrame,
  type GhostLap,
} from '../src/core/ghost-lap.ts';

/** Drive the player car through the real worker simulation with an external
 * controller (the AI line follower writing player inputs), exactly as a person
 * would: the laps are not flagged as assisted. */
function drive(autoPlayer: boolean, laps: number) {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  sim.autoPlayer = autoPlayer;
  const recorder = new GhostRecorder({
    circuit: 'aurel',
    trackLength: sim.track.length,
    assist: 'sport',
    compound: 'medium',
    weather: 'clear',
  });
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  const ghosts: GhostLap[] = [];
  const frames: Float32Array[] = [];
  for (let tick = 0; tick < 120 * 100 * laps && sim.race.laps[0].completed < laps; tick++) {
    if (!autoPlayer) sim.ai[0].update(1 / 120, sim.track, sim.cars, sim.race);
    sim.step(1 / 120);
    if (tick % 2) continue;
    sim.writeFrame(frame);
    if (sim.race.laps[0].completed === 1 && tick % 240 === 0) frames.push(frame.slice());
    const ghost = recorder.observe(frame, !autoPlayer);
    if (ghost) ghosts.push(ghost);
  }
  // The loop can stop on an odd tick, before the crossing frame was sampled.
  sim.writeFrame(frame);
  const last = recorder.observe(frame, !autoPlayer);
  if (last) ghosts.push(last);
  return { sim, ghosts, frames };
}

describe('Time Trial ghost laps', () => {
  const driven = drive(false, 2);
  it('records a complete valid lap driven through the production simulation', () => {
    const { sim, ghosts } = driven;
    // The standing start 32 m before the line is an out-lap; both timed laps
    // are offered, and the application keeps the faster one as the ghost.
    expect(ghosts).toHaveLength(2);
    const ghost = ghosts[1];
    expect(ghost.lapTime).toBeCloseTo(sim.race.laps[0].last, 4);
    expect(ghost.lapTime).toBeGreaterThan(45);
    expect(ghost.sectors.reduce((a, b) => a + b)).toBeCloseTo(ghost.lapTime, 3);
    const count = ghost.samples.length / GHOST_FIELDS;
    expect(count).toBeGreaterThan(ghost.lapTime * 25);
    expect(ghost.samples[0]).toBeLessThan(0.1);
    expect(ghost.samples[(count - 1) * GHOST_FIELDS]).toBeCloseTo(ghost.lapTime, 4);
    expect(ghost.samples.byteLength).toBeLessThan(160000);
    // Persisted through structured clone (IndexedDB) and validated on load.
    const loaded = validateGhost(structuredClone(ghost), 'aurel', sim.track.length);
    expect(loaded).not.toBeNull();
    expect(loaded!.lapTime).toBe(ghost.lapTime);
    expect(ghostKey('aurel')).toBe('ghost:v1:aurel');
  });
  it('replays the recorded poses and reports a zero delta against itself', () => {
    const { ghosts, frames } = driven;
    // Frames were kept during the second timed lap, recorded as ghosts[1].
    const player = new GhostPlayer(ghosts[1]);
    const pose = ghostPose();
    const o = carBase(0);
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames) {
      const t = f[o + F.LAP_TIME];
      expect(player.poseAt(t, pose)).toBe(true);
      expect(Math.hypot(pose.x - f[o + F.X], pose.z - f[o + F.Z])).toBeLessThan(0.05);
      expect(Math.hypot(pose.qx, pose.qy, pose.qz, pose.qw)).toBeCloseTo(1, 6);
      expect(Math.abs(player.delta(f[o + F.S], t))).toBeLessThan(0.02);
    }
    expect(player.poseAt(-1, pose)).toBe(false);
    expect(player.poseAt(ghosts[1].lapTime + 1, pose)).toBe(false);
    // A car 0.5 s slower at the same distance reads +0.5 s.
    const f = frames[5];
    expect(player.delta(f[o + F.S], f[o + F.LAP_TIME] + 0.5)).toBeCloseTo(0.5, 2);
    const one = new Float32Array(HEADER + CAR_STRIDE);
    writeGhostFrame(one, pose, 12);
    expect(one[o + F.X]).toBe(Math.fround(pose.x));
    expect(one[o + F.FRONT_HEALTH]).toBe(1);
  });
  it('never saves laps driven by the AI demonstration', () => {
    const { ghosts, sim } = drive(true, 2);
    expect(sim.race.laps[0].completed).toBe(2);
    expect(ghosts).toEqual([]);
  });
  it('rejects ghosts for another circuit, layout or corrupted samples', () => {
    const ghost = driven.ghosts[1];
    const length = driven.sim.track.length;
    expect(validateGhost(ghost, 'vellamar', length)).toBeNull();
    expect(validateGhost(ghost, 'aurel', length + 1)).toBeNull();
    expect(validateGhost({ ...ghost, version: 2 }, 'aurel', length)).toBeNull();
    const shuffled = ghost.samples.slice();
    shuffled[GHOST_FIELDS * 10] = shuffled[GHOST_FIELDS * 9];
    expect(validateGhost({ ...ghost, samples: shuffled }, 'aurel', length)).toBeNull();
    const nan = ghost.samples.slice();
    nan[GHOST_FIELDS * 4 + 3] = NaN;
    expect(validateGhost({ ...ghost, samples: nan }, 'aurel', length)).toBeNull();
    expect(validateGhost(null, 'aurel', length)).toBeNull();
    expect(
      validateGhost({ ...ghost, samples: Array.from(ghost.samples) }, 'aurel', length),
    ).toBeNull();
  });
});
