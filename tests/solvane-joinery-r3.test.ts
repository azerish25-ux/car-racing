import { describe, expect, it } from 'vitest';
import * as T from 'three';
import source from '../src/rendering/assets/solvane-joinery.mesh.json' with { type: 'json' };
import { FacadeJoinery, JOINERY_BUDGETS } from '../src/rendering/open-world/facade-joinery.ts';
import type { FacadePlacement, JoineryKind } from '../src/rendering/open-world/facade-layout.ts';
function placements(n = 1000): FacadePlacement[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: (['casement', 'shop', 'shuttered'] as JoineryKind[])[i % 3],
    centre: [(i % 15) * 2 - 14, (Math.floor(i / 15) % 8) * 2, Math.floor(i / 120) * -10],
    tangent: [1, 0, 0],
    normal: [0, 0, 1],
    width: 1.5,
    height: 1.7,
    room: 0.5,
  }));
}
function camera() {
  const c = new T.PerspectiveCamera(65, 1, 0.1, 500);
  c.position.set(0, 8, 23);
  c.lookAt(0, 8, 0);
  c.updateMatrixWorld();
  return c;
}
describe('Bounded native Blender joinery', () => {
  it('contains real bevel normals, finite indexed triangles and safe wall projection', () => {
    expect(Object.keys(source.templates).sort()).toEqual(['casement', 'shop', 'shuttered']);
    for (const parts of Object.values(source.templates))
      for (const p of parts) {
        expect(p.position.length).toBe(p.normal.length);
        expect(p.index.length % 3).toBe(0);
        expect(Math.max(...p.index)).toBeLessThan(p.position.length / 3);
        let diagonal = 0;
        for (let i = 0; i < p.position.length; i += 3) {
          expect(Math.abs(p.position[i] / 10000)).toBeLessThan(1);
          expect(Math.abs(p.position[i + 1] / 10000)).toBeLessThan(0.56);
          expect(p.position[i + 2] / 10000).toBeLessThan(0.12);
          expect(p.position[i + 2] / 10000).toBeGreaterThan(-0.221);
          const n = new T.Vector3().fromArray(p.normal, i).multiplyScalar(1 / source.normalScale);
          expect(n.length()).toBeCloseTo(1, 4);
          if (Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)) < 0.99) diagonal++;
        }
        expect(diagonal).toBeGreaterThan(0);
      }
  });
  for (const quality of ['low', 'medium', 'high', 'ultra'] as const)
    it(`enforces ${quality} instance AND triangle limits`, () => {
      const kit = new FacadeJoinery(placements()),
        c = camera(),
        budget = JOINERY_BUDGETS[quality];
      kit.update(c, quality);
      expect(kit.stats.active).toBeGreaterThan(0);
      expect(kit.stats.active).toBeLessThanOrEqual(budget.instances);
      expect(kit.stats.triangles).toBeLessThanOrEqual(budget.triangles);
      expect(kit.stats.draws).toBeLessThanOrEqual(7);
      for (const node of kit.root.children) {
        const mesh = node as T.InstancedMesh;
        expect(mesh.count).toBeLessThanOrEqual(192);
        expect(mesh.instanceMatrix.array.every(Number.isFinite)).toBe(true);
      }
      kit.dispose();
    });
  it('does not submit the far side of the facade or leave stale instances after travel', () => {
    const kit = new FacadeJoinery(placements()),
      c = camera();
    kit.update(c, 'ultra');
    expect(kit.stats.active).toBeGreaterThan(0);
    c.position.set(0, 8, -140);
    c.lookAt(0, 8, 0);
    c.updateMatrixWorld();
    kit.update(c, 'ultra');
    expect(kit.stats.active).toBe(0);
    c.position.set(30000, 8, 30000);
    c.updateMatrixWorld();
    kit.update(c, 'low');
    expect(kit.stats.draws).toBe(0);
    kit.dispose();
  });
  it('selects the same nearest instances on repeated frames and releases each owned resource once', () => {
    const kit = new FacadeJoinery(placements()),
      c = camera();
    kit.update(c, 'medium');
    const before = kit.root.children.map((n) =>
      Array.from((n as T.InstancedMesh).instanceMatrix.array),
    );
    kit.update(c, 'medium');
    expect(
      kit.root.children.map((n) => Array.from((n as T.InstancedMesh).instanceMatrix.array)),
    ).toEqual(before);
    let instances = 0,
      geometries = 0,
      materials = 0;
    const seen = new Set<T.Material>();
    for (const node of kit.root.children) {
      const m = node as T.InstancedMesh;
      m.addEventListener('dispose', () => instances++);
      m.geometry.addEventListener('dispose', () => geometries++);
      const mat = m.material as T.Material;
      if (!seen.has(mat)) {
        seen.add(mat);
        mat.addEventListener('dispose', () => materials++);
      }
    }
    kit.dispose();
    kit.dispose();
    expect(instances).toBe(7);
    expect(geometries).toBe(7);
    expect(materials).toBe(3);
    expect(kit.root.children).toHaveLength(0);
  });
});
