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
  it('preserves the authored envelope and open rotor slot on both mirrored sides', () => {
    // Observed envelope of the incoming R4 caliper before tessellation repair.
    const originalMin = [-0.04969999939203262, -0.058975204825401306, -0.05208366736769676];
    const originalMax = [0.09161368757486343, 0.15692932903766632, 0.06553204357624054];
    for (const side of [-1, 1] as const) {
      const m = materials();
      const group = gpRadialBrakeCaliper(side, m);
      try {
        group.updateMatrixWorld(true);
        const bounds = new T.Box3().setFromObject(group);
        const min = bounds.min.toArray(),
          max = bounds.max.toArray();
        for (let axis = 0; axis < 3; axis++) {
          expect(min[axis]).toBeCloseTo(
            axis === 0 && side === -1 ? -originalMax[axis] : originalMin[axis],
            8,
          );
          expect(max[axis]).toBeCloseTo(
            axis === 0 && side === -1 ? -originalMin[axis] : originalMax[axis],
            8,
          );
        }
        // Independent rays start within the actual rotor gap and first hit
        // the pad backing at either 11 mm rotor face, never a housing bridge.
        for (const y of [-0.025, 0, 0.025]) {
          for (const direction of [-1, 1]) {
            const hits = new T.Raycaster(
              new T.Vector3(0, y, 0.015),
              new T.Vector3(direction, 0, 0),
            ).intersectObject(group);
            expect(hits.length).toBeGreaterThan(0);
            expect(hits[0].object.name).toBe('Pads and braided hose');
            expect(hits[0].distance).toBeCloseTo(GP_RADIAL_BRAKE.rotorThickness / 2, 8);
          }
        }
      } finally {
        group.traverse((object) => {
          if (object instanceof T.Mesh) object.geometry.dispose();
        });
        for (const material of Object.values(m)) material.dispose();
      }
    }
  });
});
