import { describe, expect, it } from 'vitest';
import { BIKE, Bike, NOVICE } from '../src/simulation/bike.ts';
import { bikeSlipstreamDragScale, GP_MAX_TOW_DRAG_REDUCTION } from '../src/simulation/bike-slipstream.ts';

const controls = { lean: 0, throttle: 0, frontBrake: 0, rearBrake: 0, rider: 0, drive: 0 };

describe('MotoGP tow uses the same drag in physical acceleration and telemetry', () => {
  it('has no boost outside the slipstream and is reversible for changing camera/replay frames', () => {
    expect(bikeSlipstreamDragScale(0, 0.09, 0)).toBe(1);
    expect(bikeSlipstreamDragScale(1, 0.09, 0)).toBeCloseTo(0.91);
    expect(bikeSlipstreamDragScale(0, 0.09, 1)).toBeCloseTo(1 - GP_MAX_TOW_DRAG_REDUCTION);
    expect(bikeSlipstreamDragScale(1, 0.09, 1)).toBeCloseTo(0.91 * 0.82);
    expect(bikeSlipstreamDragScale(0.4, 0.09, 0.65)).toBe(
      bikeSlipstreamDragScale(0.4, 0.09, 0.65),
    );
    expect(bikeSlipstreamDragScale(1, 0.09, 0)).toBeCloseTo(0.91);
  });

  it('bounds out-of-range/non-finite network or fixture data without inverted drag', () => {
    for (const tow of [NaN, Infinity, -Infinity, -1, 0, 0.5, 1, 2]) {
      const scale = bikeSlipstreamDragScale(1, 0.1, tow);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThanOrEqual(0.9 * (1 - GP_MAX_TOW_DRAG_REDUCTION));
      expect(scale).toBeLessThanOrEqual(0.9);
    }
    expect(bikeSlipstreamDragScale(NaN, Infinity, NaN)).toBe(1);
  });

  it('actually changes acceleration and drag for two otherwise identical tyre-level motorcycles', () => {
    const solo = new Bike(NOVICE, BIKE),
      inWake = new Bike(NOVICE, BIKE);
    solo.speed = inWake.speed = 48;
    solo.dragScale = bikeSlipstreamDragScale(0.8, 0.09, 0);
    inWake.dragScale = bikeSlipstreamDragScale(0.8, 0.09, 0.85);
    solo.step(controls, 1 / 240);
    inWake.step(controls, 1 / 240);
    expect(inWake.longitudinal).toBeGreaterThan(solo.longitudinal);
    expect(inWake.speed).toBeGreaterThan(solo.speed);
    expect(inWake.state).toBe('riding');
    expect(solo.state).toBe('riding');
  });
});
