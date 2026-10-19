import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { motocrossHelmetShell } from '../src/rendering/offroad/motocross-gear.ts';
import {
  motocrossRadiatorShroud,
  motocrossTread,
} from '../src/rendering/offroad/motocross-detail.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('motocross equipment surface and ownership', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s helmet has a real open eye port, supported temples and a projected chin',
    (detail) => {
      const geometry = motocrossHelmetShell(detail),
        material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
        shell = new T.Mesh(geometry, material),
        ray = new T.Raycaster();
      const firstSurface = (x: number, y: number) => {
        ray.set(new T.Vector3(x, y, 0.4), new T.Vector3(0, 0, -1));
        return ray.intersectObject(shell)[0]?.point.z;
      };
      try {
        // A ray through the front opening must reach the rear of the shell.
        // Painting a dark rectangle on a closed head cannot satisfy this.
        expect(firstSurface(0, 0.005)).toBeLessThan(-0.13);
        expect(firstSurface(0.13, 0.005)).toBeGreaterThan(0);
        expect(firstSurface(0, -0.089)).toBeGreaterThan(0.21);
        expect(firstSurface(0, 0.094)).toBeGreaterThan(0.12);
        expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBeLessThan(0.28);
        expect(geometry.index!.count / 3).toBeLessThan(4500);
        for (const attribute of Object.values(geometry.attributes))
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      } finally {
        geometry.dispose();
        material.dispose();
      }
    },
  );

  it('bends shrouds into a crown while keeping physical thickness, mirrored envelopes and UVs', () => {
    const counts: number[] = [];
    for (const detail of ['high', 'mid', 'far'] as const) {
      const left = motocrossRadiatorShroud(-1, detail),
        right = motocrossRadiatorShroud(1, detail);
      try {
        counts.push(right.getAttribute('position').count / 3);
        expect(right.boundingBox!.max.x - right.boundingBox!.min.x).toBeGreaterThan(0.04);
        expect(left.boundingBox!.max.x).toBeCloseTo(-right.boundingBox!.min.x, 6);
        expect(left.boundingBox!.min.x).toBeCloseTo(-right.boundingBox!.max.x, 6);
        for (const geometry of [left, right]) {
          const p = geometry.getAttribute('position'),
            normal = geometry.getAttribute('normal'),
            uv = geometry.getAttribute('uv');
          for (let i = 0; i < p.count; i++) {
            expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
            expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-6);
            expect(uv.getX(i)).toBeLessThanOrEqual(1 + 1e-6);
            expect(uv.getY(i)).toBeGreaterThanOrEqual(-1e-6);
            expect(uv.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
          }
        }
      } finally {
        left.dispose();
        right.dispose();
      }
    }
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
  });

  it.each([
    [0.352, 0.042, 44],
    [0.338, 0.06, 44],
    [0.352, 0.042, 24],
    [0.338, 0.06, 24],
  ])('chamfered lugs preserve the %f m physical tyre contact envelope', (radius, width, count) => {
    const g = motocrossTread(radius, width, 0.016, count);
    try {
      const p = g.getAttribute('position');
      let outer = 0;
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getY(i), p.getZ(i));
        expect(r).toBeLessThanOrEqual(radius + 1e-7);
        expect(Number.isFinite(p.getX(i))).toBe(true);
        outer = Math.max(outer, r);
      }
      expect(outer).toBeGreaterThan(radius - 0.001);
      expect(p.count / 3).toBeLessThan(7000);
    } finally {
      g.dispose();
    }
  });

  it('disposing one MX LOD leaves the shared rubber textures usable by the other LOD', () => {
    const materials = new BikeMaterials(0),
      uniforms = mudUniforms(),
      high = new DirtBikeModel(VEHICLES.mx450, 0, 'high', materials, uniforms),
      mid = new DirtBikeModel(VEHICLES.mx450, 0, 'mid', materials, uniforms);
    let textureDisposals = 0;
    const grain = materials.rubber.normalMap!;
    grain.addEventListener('dispose', () => textureDisposals++);
    const rubber = (model: DirtBikeModel) => {
      const found = new Set<T.MeshStandardMaterial>();
      model.root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        for (const material of Array.isArray(o.material) ? o.material : [o.material])
          if (material.name === 'Motocross moulded knobby rubber') found.add(material);
      });
      return [...found];
    };
    try {
      expect(rubber(high)).toHaveLength(1);
      expect(rubber(mid)).toHaveLength(1);
      expect(rubber(high)[0]).not.toBe(rubber(mid)[0]);
      expect(rubber(high)[0]).not.toBe(materials.rubber);
      expect(rubber(mid)[0].normalMap).toBe(grain);
      high.dispose();
      expect(textureDisposals).toBe(0);
      expect(rubber(mid)[0].normalMap!.image).toBe(grain.image);
      mid.dispose();
      expect(textureDisposals).toBe(0);
    } finally {
      high.dispose();
      mid.dispose();
      materials.dispose();
    }
    expect(textureDisposals).toBe(1);
  });
});
