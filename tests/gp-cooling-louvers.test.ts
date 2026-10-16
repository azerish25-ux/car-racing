import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { gpCoolingLouvers } from '../src/rendering/gp-cooling-louvers.ts';

describe('Blender-modeled MotoGP cooling outlet', () => {
  const carbon = new T.MeshStandardMaterial();
  const steel = new T.MeshStandardMaterial();

  it.each([
    ['high', 2, 896],
    ['mid', 1, 216],
    ['far', 0, 0],
  ] as const)('%s stays on the sprung fairing with a bounded draw and triangle budget', (detail, draws, triangles) => {
    const group = gpCoolingLouvers(detail, carbon, steel);
    const meshes = group.children as T.Mesh<T.BufferGeometry>[];
    expect(meshes).toHaveLength(draws);
    expect(meshes.reduce((count, m) => count + (m.geometry.index?.count ?? 0) / 3, 0)).toBe(
      triangles,
    );
    for (const mesh of meshes) {
      const positions = mesh.geometry.getAttribute('position') as T.BufferAttribute;
      const normals = mesh.geometry.getAttribute('normal') as T.BufferAttribute;
      const uvs = mesh.geometry.getAttribute('uv') as T.BufferAttribute;
      expect(uvs.count).toBe(positions.count);
      expect(normals.count).toBe(positions.count);
      for (let i = 0; i < positions.count; i++) {
        const [x, y, z] = [positions.getX(i), positions.getY(i), positions.getZ(i)];
        expect([x, y, z, normals.getX(i), normals.getY(i), normals.getZ(i)].every(Number.isFinite)).toBe(true);
        expect(Math.abs(x)).toBeGreaterThan(0.235);
        expect(Math.abs(x)).toBeLessThan(0.251);
        expect(y).toBeGreaterThan(-0.095);
        expect(y).toBeLessThan(0.03);
        expect(z).toBeGreaterThan(0.225);
        expect(z).toBeLessThan(0.352);
      }
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
      mesh.geometry.dispose();
    }
  });

  it('mirrors the original outlets without asymmetric engine-side geometry', () => {
    const group = gpCoolingLouvers('mid', carbon, steel);
    const p = (group.children[0] as T.Mesh<T.BufferGeometry>).geometry.getAttribute('position');
    const side = p.count / 2;
    for (let i = 0; i < side; i++) {
      expect(p.getX(i)).toBeCloseTo(-p.getX(i + side), 5);
      expect(p.getY(i)).toBeCloseTo(p.getY(i + side), 5);
      expect(p.getZ(i)).toBeCloseTo(p.getZ(i + side), 5);
    }
    (group.children[0] as T.Mesh<T.BufferGeometry>).geometry.dispose();
  });
});
