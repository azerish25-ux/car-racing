import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { BikeMaterials, BikeModel } from '../src/rendering/bike.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import {
  bindGpBareMetal,
  calibrateGpMaterials,
  gpFrontFender,
  gpSilencer,
} from '../src/rendering/gp-appearance.ts';

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

const release = (group: T.Object3D) =>
  group.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });

describe('GP refined surface and mechanical contracts', () => {
  it('calibrates shared GP LOD materials once without compounding their colour', () => {
    const m = new BikeMaterials(0);
    try {
      expect(calibrateGpMaterials(m, 'gpr1')).toBe(true);
      const colour = m.paint.color.clone();
      for (let i = 0; i < 12; i++) calibrateGpMaterials(m, 'gpr1');
      expect(m.paint.color.equals(colour)).toBe(true);
      expect(m.screen.transmission).toBe(1);
      expect(m.screen.opacity).toBe(1);
      expect(m.screen.transparent).toBe(false);
      expect(m.paint.metalness).toBe(0);
      expect(m.paint.roughness).toBe(0.36);
    } finally {
      m.dispose();
    }
  });
  it.each(['mx250', 'mx450', 'sbk1000', 'road600'])(
    'leaves the %s material values untouched',
    (id) => {
      const m = new BikeMaterials(0);
      try {
        const original = [
          m.paint.color.getHex(),
          m.paint.roughness,
          m.paint.clearcoat,
          m.screen.transmission,
          m.screen.opacity,
        ];
        expect(calibrateGpMaterials(m, id)).toBe(false);
        expect([
          m.paint.color.getHex(),
          m.paint.roughness,
          m.paint.clearcoat,
          m.screen.transmission,
          m.screen.opacity,
        ]).toEqual(original);
        expect(m.titanium.userData.gpBareTitanium).toBeUndefined();
      } finally {
        m.dispose();
      }
    },
  );
  it('fills only the missing GP titanium colour attribute and preserves heat-painted headers', () => {
    const g = new T.CylinderGeometry(0.05, 0.05, 0.3, 12);
    const m = new T.MeshStandardMaterial({ vertexColors: true });
    try {
      bindGpBareMetal(g, m);
      expect(g.hasAttribute('color')).toBe(false);
      m.userData.gpBareTitanium = true;
      bindGpBareMetal(g, m);
      const c = g.getAttribute('color');
      expect(Array.from(c.array).every((value) => value === 1)).toBe(true);
      c.setXYZ(0, 0.2, 0.4, 0.7);
      bindGpBareMetal(g, m);
      expect(g.getAttribute('color')).toBe(c);
      expect(c.getX(0)).toBeCloseTo(0.2);
    } finally {
      g.dispose();
      m.dispose();
    }
  });
  it.each(['high', 'mid', 'far'] as const)(
    '%s fender is a closed thin shell with outward outer normals',
    (detail) => {
      const radius = 0.31,
        g = gpFrontFender(radius, detail);
      try {
        const p = g.getAttribute('position'),
          idx = g.index!;
        const edges = new Map<string, { count: number; direction: number }>();
        const a = new T.Vector3(),
          b = new T.Vector3(),
          c = new T.Vector3();
        for (let i = 0; i < idx.count; i += 3) {
          const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
          a.fromBufferAttribute(p, ids[0]);
          b.fromBufferAttribute(p, ids[1]);
          c.fromBufferAttribute(p, ids[2]);
          expect(
            new T.Vector3().subVectors(b, a).cross(new T.Vector3().subVectors(c, a)).lengthSq(),
          ).toBeGreaterThan(1e-17);
          for (let e = 0; e < 3; e++) {
            const u = ids[e],
              v = ids[(e + 1) % 3],
              key = [Math.min(u, v), Math.max(u, v)].join(':');
            const value = edges.get(key) ?? { count: 0, direction: 0 };
            value.count++;
            value.direction += u < v ? 1 : -1;
            edges.set(key, value);
          }
        }
        for (const edge of edges.values()) expect(edge).toEqual({ count: 2, direction: 0 });
        a.fromBufferAttribute(p, idx.getX(0));
        b.fromBufferAttribute(p, idx.getX(1));
        c.fromBufferAttribute(p, idx.getX(2));
        const normal = b.sub(a).cross(c.sub(a)).normalize();
        expect(normal.dot(new T.Vector3(0, a.y, a.z).normalize())).toBeGreaterThan(0.1);
        expect(idx.count / 3).toBeLessThan(900);
        expect(Array.from(g.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
      } finally {
        g.dispose();
      }
    },
  );
  it('rejects malformed fender radii', () => {
    for (const r of [NaN, Infinity, 0, -1, 0.7]) expect(() => gpFrontFender(r, 'high')).toThrow();
  });
  it('keeps the silencer bore behind its outlet and reuses owned entrant materials', () => {
    const m = new BikeMaterials(0);
    calibrateGpMaterials(m, 'gpr1');
    const root = gpSilencer('high', m);
    try {
      expect(root.children).toHaveLength(4);
      const baffle = root.getObjectByName('Recessed exhaust baffle')!;
      expect(baffle.position.y).toBeGreaterThan(-0.153);
      const shell = root.getObjectByName('Rolled titanium shell and open outlet') as T.Mesh;
      expect(shell.material).toBe(m.titanium);
      expect(shell.geometry.hasAttribute('color')).toBe(true);
    } finally {
      release(root);
      m.dispose();
    }
  });
  it.each(['gpr1', 'gpr2'])(
    '%s integrates the fender and silencer without exceeding the original complete-model gate',
    (id) => {
      const m = new BikeMaterials(0),
        model = new BikeModel(VEHICLES[id], 0, 'high', m, true);
      try {
        // Static batching legitimately removes individual mesh names. Locate
        // the separate returned-edge carbon material and its actual geometry.
        const fenders: T.Mesh[] = [];
        model.root.traverse((o) => {
          if (
            o instanceof T.Mesh &&
            o.material instanceof T.Material &&
            o.material !== m.carbon &&
            o.material.name === m.carbon.name &&
            o.material.side === T.DoubleSide &&
            o.geometry.getAttribute('position').count === 406
          )
            fenders.push(o);
        });
        expect(fenders).toHaveLength(1);
        if (id === 'gpr1')
          expect(model.root.getObjectByName('GP formed titanium silencer')).toBeDefined();
        else expect(model.root.getObjectByName('GP formed titanium silencer')).toBeUndefined();
        let triangles = 0;
        model.root.traverse((o) => {
          if (o instanceof T.Mesh)
            triangles +=
              ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) *
              (o instanceof T.InstancedMesh ? o.count : 1);
        });
        expect(triangles).toBeLessThan(110000);
      } finally {
        model.dispose();
        m.dispose();
      }
    },
  );
});
