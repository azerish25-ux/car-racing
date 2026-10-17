import { describe, expect, it } from 'vitest';
import { gpBrakeEfficiency } from '../src/simulation/gp-brake-fade.ts';
describe('GP disc heat fade', () => {
  it('retains baseline race feel under normal temperatures', () => {
    for (const t of [40, 200, 500, 850]) expect(gpBrakeEfficiency(t)).toBe(1);
  });
  it('progressively reduces maximum brake torque under thermal abuse, and recovers', () => {
    const mid = gpBrakeEfficiency(1025);
    expect(mid).toBeGreaterThan(0.78);
    expect(mid).toBeLessThan(1);
    expect(gpBrakeEfficiency(1400)).toBeCloseTo(0.78, 7);
    expect(gpBrakeEfficiency(550)).toBe(1);
  });
  it('never produces nonfinite or negative brake gains', () => {
    for (const t of [-1e9, 1e9, Number.NaN, Infinity, -Infinity]) {
      const gain = gpBrakeEfficiency(t);
      expect(Number.isFinite(gain)).toBe(true);
      expect(gain).toBeGreaterThanOrEqual(0.78);
      expect(gain).toBeLessThanOrEqual(1);
    }
  });
});
