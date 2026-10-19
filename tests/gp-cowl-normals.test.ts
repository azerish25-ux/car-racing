import { afterAll, describe, expect, it } from 'vitest';
import * as T from 'three';
import type { BikeMaterials } from '../src/rendering/bike.ts';
import { gpBodywork, gpUpperCowl } from '../src/rendering/gp-bodywork.ts';
import source from '../src/rendering/assets/gp-bodywork.mesh.json';

const material = new T.MeshStandardMaterial();
const materials = Object.fromEntries(
  ['paint', 'secondary', 'accent', 'carbon', 'dark', 'seat', 'aluminium'].map((name) => [
    name,
    material,
  ]),
) as unknown as BikeMaterials;
afterAll(() => material.dispose());
const release = (group: T.Group) =>
  group.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });

describe('GP instrument-well specular continuity', () => {
  it.each(['high', 'mid'] as const)(
    '%s has a smooth well rim without changing geometry or the other bodywork normals',
    (detail) => {
      const group = gpBodywork(materials, detail);
      try {
        for (const [i, part] of source[detail].entries()) {
          const mesh = group.children[i] as T.Mesh;
          const geometry = mesh.geometry;
          expect(geometry.getAttribute('position').array).toEqual(new Float32Array(part.position));
          expect(geometry.getAttribute('uv').array).toEqual(new Float32Array(part.uv));
          expect(Array.from(geometry.index!.array)).toEqual(part.index);
          if (part.material !== 'paint')
            expect(geometry.getAttribute('normal').array).toEqual(new Float32Array(part.normal));
        }
        const paint = (group.children[0] as T.Mesh).geometry,
          positions = paint.getAttribute('position'),
          normals = paint.getAttribute('normal'),
          original = new Float32Array(source[detail][0].normal),
          a = new T.Vector3(),
          b = new T.Vector3();
        for (let i = 0; i < positions.count; i++) {
          a.fromBufferAttribute(normals, i);
          expect(a.length()).toBeCloseTo(1, 5);
          // Tank, tail and lower service panels are outside the nose component.
          if (positions.getZ(i) < 0.35)
            expect(a.toArray()).toEqual(Array.from(original.subarray(i * 3, i * 3 + 3)));
        }
        for (const side of [-1, 1]) {
          const rim = new Map<string, number>();
          for (let i = 0; i < positions.count; i++) {
            a.fromBufferAttribute(positions, i);
            if (
              Math.abs(a.x - side * 0.125) < 0.00035 &&
              a.y > 0.25 &&
              a.y < 0.31 &&
              a.z > 0.4 &&
              a.z < 0.675
            )
              rim.set(a.toArray().join(','), i);
          }
          const ordered = [...rim.values()].sort((a, b) => positions.getZ(a) - positions.getZ(b));
          expect(ordered.length).toBeGreaterThan(detail === 'high' ? 20 : 2);
          for (let i = 1; i < ordered.length; i++) {
            a.fromBufferAttribute(normals, ordered[i - 1]);
            b.fromBufferAttribute(normals, ordered[i]);
            // The baked fan jumped by up to 115 degrees at neighbouring rim
            // vertices. The actual continuous lip changes less than 12 degrees.
            expect(a.angleTo(b)).toBeLessThan(T.MathUtils.degToRad(12));
          }
        }
      } finally {
        release(group);
      }
    },
  );

  it('preserves the independent catalogue cowl at both LODs', () => {
    for (const detail of ['high', 'mid'] as const) {
      const group = gpUpperCowl(materials, detail);
      try {
        const mesh = group.children[0] as T.Mesh;
        expect(mesh.geometry.getAttribute('normal').array).toEqual(
          new Float32Array((detail === 'high' ? source.upperHigh : source.upperMid)[0].normal),
        );
      } finally {
        release(group);
      }
    }
  });
});
