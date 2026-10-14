import { describe, expect, it } from 'vitest';
import { ReplayClock } from '../src/session/replay-clock.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

/** In-memory page store: the replay service with no IndexedDB or renderer. */
class MemoryStore implements ReplayPageStore {
  pages = new Map<number, ReplayPage>();
  async put(page: ReplayPage) {
    this.pages.set(page.id, structuredClone(page));
  }
  async get(id: number) {
    const page = this.pages.get(id);
    if (!page) throw new Error('missing');
    return structuredClone(page);
  }
  async dispose() {}
}
async function recording(seconds: number) {
  const replay = new SessionReplay(1, new MemoryStore(), () => undefined, 30);
  for (let i = 0, t = 0; t <= seconds + 1e-9; i++, t = i / 15) {
    // The live recorder yields between batches; sealed pages finish writing.
    if (i % 30 === 0) await replay.settle();
    const f = new Float32Array(HEADER + CAR_STRIDE);
    f[H.CARS] = 1;
    f[H.TIME] = 10 + t;
    f[carBase(0) + F.QW] = 1;
    f[carBase(0) + F.S] = t * 50;
    replay.append(f);
  }
  expect(replay.error).toBeNull();
  return replay;
}
/** One presentation callback: advance, sample, commit when presented. */
async function callback(clock: ReplayClock, replay: SessionReplay, wall: number) {
  const a = replay.makeFrame(),
    b = replay.makeFrame();
  const target = clock.target(wall, replay.duration, true);
  let fraction = replay.sample(target, a, b);
  for (let i = 0; i < 20 && fraction === null; i++) {
    await replay.settle();
    fraction = replay.sample(target, a, b);
  }
  if (fraction === null) throw new Error(`could not present ${target}`);
  clock.presented(target, replay.duration);
  return a[H.TIME] + (b[H.TIME] - a[H.TIME]) * fraction;
}
describe('§24.2 replay clock over a deterministic recording', () => {
  it('advances, pauses, seeks across sealed pages and stops exactly at the end', async () => {
    const replay = await recording(12),
      clock = new ReplayClock();
    await replay.settle();
    expect(replay.duration).toBeCloseTo(12, 4);
    let presented = await callback(clock, replay, 0.25);
    expect(presented).toBeCloseTo(10.25, 4);
    clock.playing = false;
    expect(await callback(clock, replay, 0.25)).toBeCloseTo(presented, 6);
    // Seek before and after earlier pages (2 s pages: several are sealed).
    clock.seek(3.5, 0, replay.duration);
    expect(clock.seekPending).toBe(true);
    clock.playing = true;
    // The seek is presented once before playback advances again.
    expect(await callback(clock, replay, 0.25)).toBeCloseTo(13.5, 4);
    expect(clock.seekPending).toBe(false);
    presented = await callback(clock, replay, 0.25);
    expect(presented).toBeCloseTo(13.75, 4);
    // Continuous play over page boundaries reaches the last frame and stops.
    for (let i = 0; i < 100 && clock.playing; i++) presented = await callback(clock, replay, 0.2);
    expect(clock.playing).toBe(false);
    expect(presented).toBeCloseTo(22, 4);
    // Resume at the end restarts from the floor instead of sticking.
    expect(clock.toggle(0, replay.duration)).toBe(true);
    expect(await callback(clock, replay, 0.1)).toBeCloseTo(10, 4);
  });
  it('caps each callback step and honours rate and rapid repeated controls', async () => {
    const replay = await recording(6),
      clock = new ReplayClock();
    clock.setRate(0.25);
    expect(await callback(clock, replay, 5)).toBeCloseTo(10 + 0.5 * 0.25, 4);
    for (let i = 0; i < 9; i++) clock.toggle(0, replay.duration);
    expect(clock.playing).toBe(false);
    clock.seek(-5, 1, replay.duration);
    expect(clock.position).toBe(1);
    clock.seek(99, 0, replay.duration);
    expect(clock.position).toBeCloseTo(replay.duration, 6);
  });
});
