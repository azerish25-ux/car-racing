import { expect, it } from 'vitest';
import { Random, Vec3 } from '../src/core/math.ts';
import { wakeOverlap } from '../src/simulation/aero.ts';

it('§23.4 the 101 m wake cull never discards a non-zero wake', () => {
  const rng = new Random(91);
  const r = () => rng.next() * 2 - 1;
  for (let i = 0; i < 20000; i++) {
    const leader = new Vec3(r() * 300, r() * 5, r() * 300),
      follower = new Vec3(r() * 300, r() * 5, r() * 300),
      forward = new Vec3(r(), r() * 0.1, r());
    if (follower.distanceSq(leader) >= 101 * 101)
      expect(wakeOverlap(follower, leader, forward, 80, forward)).toBe(0);
  }
});
