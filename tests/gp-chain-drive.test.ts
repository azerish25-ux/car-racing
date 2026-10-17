import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { GPChainDrive } from '../src/rendering/gp-chain-drive.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const material = () => new T.MeshStandardMaterial();
const positions = (mesh: T.InstancedMesh) => {
  const m = new T.Matrix4();
  const items: string[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    items.push([m.elements[12], m.elements[13], m.elements[14]].map((n) => n.toFixed(5)).join(','));
  }
  return items.sort();
};

describe('GP-R1 high-detail instanced, replay-deterministic chain drive', () => {
  it('keeps the pin-lobed plate dimensions and the complete production chain inside its triangle budget', () => {
    const spec = VEHICLES.gpr1.bike!,
      arm = Math.hypot(spec.rearWheelRadius - spec.cgHeight + 0.13, -spec.cgToRear + 0.2),
      a = new GPChainDrive(arm, material(), material(), material());
    const plate = a.plates.geometry;
    plate.computeBoundingBox();
    const size = plate.boundingBox!.getSize(new T.Vector3()),
      centre = plate.boundingBox!.getCenter(new T.Vector3());
    expect(size.x).toBeCloseTo(0.0028, 7);
    expect(size.y).toBeCloseTo(0.0086, 7);
    expect(size.z).toBeCloseTo(0.015875 + 2 * 0.0043, 7);
    expect(centre.length()).toBeLessThan(1e-8);
    const normal = plate.getAttribute('normal');
    for (let i = 0; i < normal.count; i++)
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
    let expanded = 0;
    for (const mesh of [a.rollers, a.plates, a.sprocket]) {
      expanded +=
        ((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3) *
        (mesh instanceof T.InstancedMesh ? mesh.count : 1);
    }
    expect(expanded).toBeLessThan(14000);
    expect((plate.index?.count ?? plate.getAttribute('position').count) / 3).toBeLessThanOrEqual(
      44,
    );
    for (const mesh of [a.rollers, a.plates, a.sprocket]) {
      if (mesh instanceof T.InstancedMesh) mesh.dispose();
      mesh.geometry.dispose();
    }
  });
  it('uses two instanced draws, a single 42-tooth metal sprocket and no transient clones', () => {
    const a = new GPChainDrive(0.52, material(), material(), material());
    expect(a.root.children).toEqual([a.rollers, a.plates]);
    expect(a.rollers.count).toBe(a.links);
    expect(a.plates.count).toBe(a.links * 2);
    expect(a.links).toBeGreaterThan(70);
    expect(a.sprocket.geometry.getAttribute('position').count).toBeGreaterThan(300);
    expect(a.root.name).toContain('animated');
    expect(a.rollers.castShadow).toBe(true);
    expect(a.plates.receiveShadow).toBe(true);
    for (const mesh of [a.rollers, a.plates, a.sprocket]) mesh.geometry.dispose();
  });
  it('replay seek returns to the same exact link positions and wheel modulo poses', () => {
    const a = new GPChainDrive(0.52, material(), material(), material());
    a.update(1.123);
    const original = Array.from(a.rollers.instanceMatrix.array);
    a.update(3.5);
    a.update(1.123);
    expect(Array.from(a.rollers.instanceMatrix.array)).toEqual(original);
    a.update(0);
    const atZero = positions(a.rollers);
    a.update(Math.PI * 2);
    expect(positions(a.rollers)).toEqual(atZero);
    for (const mesh of [a.rollers, a.plates, a.sprocket]) mesh.geometry.dispose();
  });
  it('bounds invalid swingarm geometry and guards against non-finite phase', () => {
    expect(() => new GPChainDrive(NaN, material(), material(), material())).toThrow(
      'Invalid GP motorcycle swingarm length',
    );
    const a = new GPChainDrive(0.52, material(), material(), material());
    a.update(Number.NaN);
    a.update(Number.POSITIVE_INFINITY);
    for (const value of a.rollers.instanceMatrix.array) expect(Number.isFinite(value)).toBe(true);
    for (const mesh of [a.rollers, a.plates, a.sprocket]) mesh.geometry.dispose();
  });
});
