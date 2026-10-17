import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { bikeSurfaceMaps } from '../src/rendering/bike-surface-detail.ts';

describe('MotoGP painted composite PBR finish', () => {
  it('gives painted fairings bounded deterministic orange-peel normal and roughness maps', () => {
    const first = bikeSurfaceMaps('paint', 64);
    const second = bikeSurfaceMaps('paint', 64);
    try {
      for (const key of ['normalMap', 'roughnessMap'] as const) {
        const a = first[key];
        expect(a.colorSpace).toBe(T.NoColorSpace);
        expect(a.generateMipmaps).toBe(true);
        expect(a.repeat.x).toBe(12);
        expect(a.repeat.y).toBe(12);
        expect(a.image.data).toEqual(second[key].image.data);
        expect(a.minFilter).toBe(T.LinearMipmapLinearFilter);
      }
      const rough = first.roughnessMap.image.data as Uint8Array;
      const values = Array.from({ length: rough.length / 4 }, (_, i) => rough[i * 4]);
      expect(Math.min(...values)).toBeGreaterThan(180);
      expect(Math.max(...values)).toBeLessThanOrEqual(255);
      expect(new Set(values).size).toBeGreaterThan(3);
    } finally {
      for (const key of ['normalMap', 'roughnessMap'] as const) {
        first[key].dispose();
        second[key].dispose();
      }
    }
  });
});