import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { gpRadialBrakeCaliper, GP_RADIAL_BRAKE } from '../src/rendering/gp-radial-caliper.ts';
const materials = () => ({
  caliper: new T.MeshStandardMaterial({ metalness: 0.8 }),
  aluminium: new T.MeshStandardMaterial({ metalness: 0.9 }),
  steel: new T.MeshStandardMaterial({ metalness: 0.8 }),
  dark: new T.MeshStandardMaterial({ roughness: 0.85 }),
});
describe('MotoGP forged radial brake: geometry and ownership', () => {
  it('builds both sides with finite sculpted indexed meshes inside the draw/triangle budget', () => {
    for (const side of [-1, 1] as const) {
      const m = materials();
      const group = gpRadialBrakeCaliper(side, m);
      expect(group.scale.x).toBe(side);
      expect(group.children.length).toBeLessThanOrEqual(GP_RADIAL_BRAKE.maxDraws);
      let triangles = 0;
      for (const node of group.children) {
        const mesh = node as T.Mesh<T.BufferGeometry>;
        const geometry = mesh.geometry;
        expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
        expect(geometry.index).toBeNull();
        expect(geometry.boundingBox).toBeTruthy();
        expect(geometry.boundingSphere).toBeTruthy();
        const v = geometry.getAttribute('position');
        for (let i = 0; i < v.count; i++)
          expect(Number.isFinite(v.getX(i) + v.getY(i) + v.getZ(i))).toBe(true);
        triangles += v.count / 3;
        geometry.dispose();
      }
      expect(triangles).toBeGreaterThan(300);
      expect(triangles).toBeLessThan(GP_RADIAL_BRAKE.maxTriangles);
      for (const material of Object.values(m)) material.dispose();
    }
  });
  it('does not accept a non-physical left/right side', () => {
    expect(() => gpRadialBrakeCaliper(0 as -1, materials())).toThrow();
  });
});
