import { describe, expect, it } from 'vitest';
import { Rumble, rumbleFrom, validateRumble } from '../src/input/rumble.ts';
import { CAR_STRIDE, F, H, HEADER, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';

const frame = () => {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[H.CARS] = 1;
  return f;
};
describe('D088 rumble with separate channel strengths', () => {
  it('maps wheelspin to the weak motor and impacts to the strong one, each scaled by its own setting', () => {
    const f = frame();
    f[carBase(0) + F.SPEED] = 30;
    f[carBase(0) + WHEEL_BASE + W.SLIP] = 0.5;
    expect(rumbleFrom(f, { traction: 1, impact: 1, engine: 0 }).weak).toBeGreaterThan(0.9);
    expect(rumbleFrom(f, { traction: 0, impact: 1, engine: 0 }).weak).toBe(0);
    f[carBase(0) + F.IMPACT] = 0.8;
    expect(rumbleFrom(f, { traction: 0, impact: 0.5, engine: 0 }).strong).toBeCloseTo(0.4, 6);
    expect(validateRumble({ traction: 4, impact: 'x' })).toEqual({
      traction: 1,
      impact: 0.5,
      engine: 0,
    });
  });
  it('rate-limits effects and resets on stop', () => {
    const calls: Record<string, number>[] = [];
    let resets = 0;
    const pad = {
      vibrationActuator: {
        playEffect: async (_: string, p: Record<string, number>) => calls.push(p),
        reset: async () => resets++,
      },
    } as unknown as Gamepad;
    const rumble = new Rumble();
    rumble.update(pad, { weak: 0.5, strong: 0 }, 0);
    rumble.update(pad, { weak: 0.5, strong: 0 }, 50);
    rumble.update(pad, { weak: 0.5, strong: 0 }, 150);
    expect(calls).toHaveLength(2);
    rumble.stop(pad);
    expect(resets).toBe(1);
    rumble.update(null, { weak: 1, strong: 1 }, 400);
  });
});
