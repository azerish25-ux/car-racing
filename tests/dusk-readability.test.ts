import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  circuitLightState,
  daylightState,
  lightingDirection,
  skyCosineRadiance,
  SUNSET_OFFSET,
} from '../src/rendering/daylight.ts';
import { applyCircuitLightPalette } from '../src/rendering/lighting-coherence.ts';
import { skyLight } from '../src/rendering/sky-light.ts';

describe('shared dusk skylight balance', () => {
  it('lifts indirect readability without changing the key, camera exposure, sky or fog', () => {
    for (const cover of [0, 0.12, 0.5, 0.9, 1]) {
      const a = circuitLightState(cover, 14, 'sunset');
      // The physical golden-hour sky lights the shade: its PMREM at full
      // share plus a small fill, and the camera opens up for the low sun.
      expect(a.environment).toBe(1);
      expect(a.fill).toBeGreaterThan(0);
      expect(a.fill).toBeLessThanOrEqual(0.6);
      expect(a.sun).toBe(skyLight(cover, 'sunset').sunIrradiance * (1 - cover * 0.88));
      expect(a.exposure).toBe(1.62 - cover * 0.2);
      expect(a.skyRadiance).toBe(skyLight(cover, 'sunset').skyScale);
      // Readable shade: exposed indirect irradiance on open ground stays at
      // least what the authored dusk fill gave (about 0.6).
      const dome = skyCosineRadiance(cover, 'sunset'),
        indirect = Math.PI * (0.2126 * dome.r + 0.7152 * dome.g + 0.0722 * dome.b) + a.fill;
      expect(indirect * a.exposure).toBeGreaterThan(0.55);
      expect(a.fogDensity).toBe(daylightState(cover, 14).fogDensity * 1.18);
      expect(lightingDirection('sunset')).toBe(SUNSET_OFFSET);
      expect(circuitLightState(cover, 14, 'day')).toEqual(daylightState(cover, 14));
    }
  });
  it('separates a warm key from cooler sky fill and restores exact palette after day/night cuts', () => {
    const sun = new T.DirectionalLight(),
      fill = new T.HemisphereLight();
    applyCircuitLightPalette(sun, fill, 0.12, 'sunset');
    const original = [sun.color.toArray(), fill.color.toArray(), fill.groundColor.toArray()];
    expect(sun.color.r).toBeGreaterThan(sun.color.b);
    expect(fill.color.b).toBeGreaterThan(fill.color.r);
    for (const mode of ['day', 'night', 'sunset'] as const)
      applyCircuitLightPalette(sun, fill, 0.12, mode);
    expect([sun.color.toArray(), fill.color.toArray(), fill.groundColor.toArray()]).toEqual(
      original,
    );
    expect([sun.intensity, fill.intensity]).toEqual([1, 1]);
  });
});
