import { describe, expect, it } from 'vitest';
import { gpDiscGlow } from '../src/rendering/gp-disc-glow.ts';
describe('GP carbon rotor physical heat visibility', () => {
  it('does not radiate unrealistic orange light at normal race temperatures', () => {
    for (const temp of [20, 300, 500, 620]) expect(gpDiscGlow(temp)).toBe(0);
  });
  it('grows continuously, stays bounded and reverses after cooling', () => {
    const r650 = gpDiscGlow(650);
    const r850 = gpDiscGlow(850);
    const r1000 = gpDiscGlow(1000);
    expect(r650).toBeGreaterThan(0);
    expect(r850).toBeGreaterThan(r650);
    expect(r1000).toBeGreaterThan(r850);
    expect(gpDiscGlow(1800)).toBeCloseTo(0.58);
    expect(gpDiscGlow(450)).toBe(0);
  });
  it('ignores non-finite readings safely', () => {
    for (const t of [Number.NaN, Infinity, -Infinity]) expect(gpDiscGlow(t)).toBe(0);
  });
});
