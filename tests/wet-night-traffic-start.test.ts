import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS, startingGrid } from '../src/simulation/config.ts';
import {
  CAR_STRIDE,
  carBase,
  F,
  H,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
} from '../src/simulation/protocol.ts';

// The hosted review (e2e/28 '27H.6 wet-night traffic') records this exact
// session: the menu's default circuit, seed and setup, five laps, eight cars,
// rain, full wets, the paddock START option 'back' and the AI driving the
// player from the grid. It needs a rival 3-45 m ahead on the same level,
// both above 5 m/s, throwing water from its rear tyres. Hosted software GL can
// present one frame every few seconds, so the following must last long enough
// for a slow poll to see it, not only pass through a short window.
describe('hosted wet-night traffic session', () => {
  it('follows a wet car for long, observable stretches from the back of the grid', () => {
    const cars = 8;
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'race',
      laps: 5,
      opponents: cars - 1,
      weather: 'rain',
      compound: 'wet',
      grid: startingGrid(cars, 'back'),
    });
    sim.autoPlayer = true;
    const frame = new Float32Array(HEADER + cars * CAR_STRIDE),
      p = carBase(0);
    let total = 0,
      run = 0,
      longest = 0;
    for (let tick = 1; tick <= Math.ceil((sim.race.greenAt + 120) * 120); tick++) {
      sim.step(1 / 120);
      if (tick % 12) continue;
      sim.writeFrame(frame);
      let close = false;
      if (frame[H.PHASE] === 2 && frame[p + F.SPEED] >= 5)
        for (let n = 1; n < cars && !close; n++) {
          const o = carBase(n),
            ds = (frame[o + F.S] - frame[p + F.S] + frame[H.LENGTH]) % frame[H.LENGTH],
            water = [2, 3].some((w) => frame[o + WHEEL_BASE + w * WHEEL_STRIDE + W.WATER] > 0);
          close =
            ds > 3 &&
            ds < 45 &&
            Math.abs(frame[o + F.Y] - frame[p + F.Y]) < 3 &&
            frame[o + F.SPEED] > 5 &&
            water;
        }
      run = close ? run + 0.1 : 0;
      if (close) total += 0.1;
      longest = Math.max(longest, run);
    }
    // Measured: about 70 s of following in the first two minutes after the
    // green, the longest unbroken stretch about 30 s.
    expect(total).toBeGreaterThan(20);
    expect(longest).toBeGreaterThan(10);
  }, 120000);
});
