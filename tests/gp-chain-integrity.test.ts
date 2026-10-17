import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GPChainDrive } from '../src/rendering/gp-chain-drive.ts';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const materials = [
  new T.MeshStandardMaterial(),
  new T.MeshStandardMaterial(),
  new T.MeshStandardMaterial(),
] as const;
const triangles = (mesh: T.Mesh) =>
  ((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3) *
  (mesh instanceof T.InstancedMesh ? mesh.count : 1);
const point = (mesh: T.InstancedMesh, i: number) => {
  const m = new T.Matrix4();
  mesh.getMatrixAt(i, m);
  return new T.Vector3().setFromMatrixPosition(m);
};
const dispose = (chain: GPChainDrive) => {
  chain.rollers.dispose();
  chain.plates.dispose();
  for (const mesh of [chain.rollers, chain.plates, chain.sprocket]) mesh.geometry.dispose();
};

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
afterAll(() => {
  vi.unstubAllGlobals();
  for (const m of materials) m.dispose();
});

describe('GP chain real instance cost and mechanical continuity', () => {
  it('keeps the complete repeated 0.52 m chain below 16000 triangles', () => {
    const c = new GPChainDrive(0.52, ...materials);
    try {
      expect(
        [c.rollers, c.plates, c.sprocket].reduce((n, mesh) => n + triangles(mesh), 0),
      ).toBeLessThan(16000);
    } finally {
      dispose(c);
    }
  });
  it.each(['gpr1', 'gpr2'])(
    '%s retains the existing 110000-triangle model gate after expanding instances',
    (id) => {
      const m = new BikeMaterials(0),
        model = new BikeModel(VEHICLES[id], 0, 'high', m, true);
      try {
        let total = 0;
        model.root.traverse((o) => {
          if (o instanceof T.Mesh) total += triangles(o);
        });
        expect(total).toBeLessThan(110000);
        expect(model.root.getObjectByName('Paired articulated link plates')).toBeInstanceOf(
          T.InstancedMesh,
        );
      } finally {
        model.dispose();
        m.dispose();
      }
    },
  );
  it('centres every plate between its two pins, not on a single pin', () => {
    const c = new GPChainDrive(0.52, ...materials);
    try {
      for (const phase of [0, 0.071, 1.123, -7.2]) {
        c.update(phase);
        for (let i = 0; i < c.links; i++) {
          const a = point(c.rollers, i),
            b = point(c.rollers, (i + 1) % c.links);
          const mid = a.add(b).multiplyScalar(0.5),
            p = point(c.plates, i * 2);
          expect(p.y).toBeCloseTo(mid.y, 6);
          expect(p.z).toBeCloseTo(mid.z, 6);
        }
      }
    } finally {
      dispose(c);
    }
  });
  it('moves wrapped chain rollers in the same direction as the rear wheel', () => {
    const c = new GPChainDrive(0.52, ...materials);
    try {
      c.update(0);
      const candidates = Array.from({ length: c.links }, (_, i) => ({
        i,
        p: point(c.rollers, i),
      })).filter(({ p }) => p.z < -0.54);
      const item = candidates[Math.floor(candidates.length / 2)];
      c.update(0.0001);
      const delta = point(c.rollers, item.i).sub(item.p);
      const wheelTangent = new T.Vector3(0, -(item.p.z + 0.52), item.p.y);
      expect(delta.dot(wheelTangent)).toBeGreaterThan(0);
    } finally {
      dispose(c);
    }
  });
  it('holds buffers on a repeated snapshot and restores exact transforms after a seek', () => {
    const c = new GPChainDrive(0.52, ...materials);
    try {
      c.update(1.123);
      const before = Array.from(c.plates.instanceMatrix.array),
        version = c.plates.instanceMatrix.version;
      c.update(1.123);
      expect(c.plates.instanceMatrix.version).toBe(version);
      c.update(-12);
      c.update(1.123);
      expect(Array.from(c.plates.instanceMatrix.array)).toEqual(before);
    } finally {
      dispose(c);
    }
  });
  it('uses an even link count and survives wrapped, negative and extreme finite rotations', () => {
    const c = new GPChainDrive(0.52, ...materials);
    try {
      expect(c.links % 2).toBe(0);
      for (const angle of [
        0,
        2 * Math.PI,
        -2 * Math.PI,
        NaN,
        Infinity,
        -Infinity,
        Number.MAX_VALUE,
        -Number.MAX_VALUE,
      ]) {
        expect(() => c.update(angle)).not.toThrow();
        expect(Array.from(c.plates.instanceMatrix.array).every(Number.isFinite)).toBe(true);
      }
    } finally {
      dispose(c);
    }
  });
  it('retains bounded culling volumes through every chain phase', () => {
    const c = new GPChainDrive(0.52, ...materials);
    try {
      for (const mesh of [c.rollers, c.plates]) {
        expect(mesh.frustumCulled).toBe(true);
        expect(mesh.boundingSphere).not.toBeNull();
      }
      for (let k = 0; k < 12; k++) {
        c.update(k * 0.123);
        for (const mesh of [c.rollers, c.plates]) {
          const m = new T.Matrix4(),
            p = new T.Vector3();
          const v = mesh.geometry.getAttribute('position');
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, m);
            for (let j = 0; j < v.count; j++) {
              p.fromBufferAttribute(v, j).applyMatrix4(m);
              expect(mesh.boundingSphere!.containsPoint(p)).toBe(true);
            }
          }
        }
      }
    } finally {
      dispose(c);
    }
  });
  it.each(['mid', 'far'] as const)('does not create animated links on %s detail', (detail) => {
    const m = new BikeMaterials(0),
      model = new BikeModel(VEHICLES.gpr1, 0, detail, m, true);
    try {
      const sag = staticSag(VEHICLES.gpr1);
      model.pose({
        fork: sag.fork,
        shock: sag.shock,
        steer: 0,
        frontRotation: 1,
        rearRotation: 1,
        chassisLean: 0,
        riderOffset: 0,
        tuck: 0,
        brake: 0,
        rearBrake: 0,
        discTemp: 200,
        compoundColour: 0xffffff,
        riding: true,
      });
      expect(model.root.getObjectByName('Paired articulated link plates')).toBeUndefined();
    } finally {
      model.dispose();
      m.dispose();
    }
  });
});
