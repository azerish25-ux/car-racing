import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, staticSag } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { MotocrossChainDrive } from '../src/rendering/offroad/motocross-chain-drive.ts';
import { installMudOn, mudUniforms } from '../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const point = (mesh: T.InstancedMesh, i: number) => {
  const matrix = new T.Matrix4();
  mesh.getMatrixAt(i, matrix);
  return new T.Vector3().setFromMatrixPosition(matrix);
};
const triangles = (mesh: T.Mesh) =>
  ((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3) *
  (mesh instanceof T.InstancedMesh ? mesh.count : 1);
const make = (detail: 'high' | 'mid' = 'high') => {
  const material = new T.MeshStandardMaterial(),
    mud = mudUniforms();
  const chain = new MotocrossChainDrive(0.52, detail, material, mud);
  const dispose = () => {
    for (const mesh of [chain.rollers, chain.plates]) {
      mesh.dispose();
      mesh.geometry.dispose();
    }
    material.dispose();
  };
  return { chain, material, mud, dispose };
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
afterAll(() => vi.unstubAllGlobals());

describe('MX chain geometry, snapshot motion and ownership', () => {
  it.each(['high', 'mid'] as const)(
    '%s uses two bounded draws with all repeated triangles counted',
    (detail) => {
      const { chain, dispose } = make(detail);
      try {
        expect(chain.root.children).toEqual([chain.rollers, chain.plates]);
        expect(chain.rollers.count).toBe(96);
        expect(chain.plates.count).toBe(192);
        expect(chain.plates.geometry.getAttribute('position').count / 3).toBe(
          detail === 'high' ? 44 : 8,
        );
        const plateTriangles = triangles(chain.plates) / chain.plates.count;
        expect(plateTriangles).toBe(detail === 'high' ? 44 : 12);
        expect(triangles(chain.rollers) + triangles(chain.plates)).toBeLessThan(12000);
        for (const mesh of [chain.rollers, chain.plates]) {
          expect(mesh.frustumCulled).toBe(true);
          expect(mesh.castShadow).toBe(true);
          expect(mesh.receiveShadow).toBe(true);
          expect(mesh.instanceMatrix.usage).toBe(T.DynamicDrawUsage);
        }
        if (detail === 'high') {
          const p = chain.plates.geometry.getAttribute('position');
          const waist: number[] = [],
            lobes: number[] = [];
          for (let i = 0; i < p.count; i++) {
            if (Math.abs(p.getZ(i)) < 1e-6) waist.push(Math.abs(p.getY(i)));
            if (Math.abs(Math.abs(p.getZ(i)) - 0.015875 / 2) < 1e-6)
              lobes.push(Math.abs(p.getY(i)));
          }
          expect(Math.max(...waist)).toBeCloseTo(0.0028, 7);
          expect(Math.max(...lobes)).toBeCloseTo(0.0043, 7);
        }
      } finally {
        dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s plates bridge both actual neighbouring rollers, including the seam',
    (detail) => {
      const { chain, dispose } = make(detail),
        matrix = new T.Matrix4();
      try {
        for (const phase of [0, 0.071, 1.123, -7.2]) {
          chain.update(phase);
          for (let i = 0; i < chain.links; i++) {
            const a = point(chain.rollers, i),
              b = point(chain.rollers, (i + 1) % chain.links);
            for (let side = 0; side < 2; side++) {
              chain.plates.getMatrixAt(i * 2 + side, matrix);
              const from = new T.Vector3(0, 0, -0.015875 / 2).applyMatrix4(matrix);
              const to = new T.Vector3(0, 0, 0.015875 / 2).applyMatrix4(matrix);
              expect(Math.hypot(from.y - a.y, from.z - a.z)).toBeLessThan(1e-6);
              expect(Math.hypot(to.y - b.y, to.z - b.z)).toBeLessThan(1e-6);
            }
          }
        }
      } finally {
        dispose();
      }
    },
  );

  it('moves rear-wrap rollers in the direction of the supplied wheel and holds repeated snapshots', () => {
    const { chain, dispose } = make();
    try {
      const i = Array.from({ length: chain.links }, (_, i) => i).find(
        (i) => point(chain.rollers, i).z < -0.58,
      )!;
      expect(i).toBeDefined();
      const old = point(chain.rollers, i);
      chain.update(0.0001);
      const delta = point(chain.rollers, i).sub(old);
      expect(delta.dot(new T.Vector3(0, -(old.z + 0.52), old.y))).toBeGreaterThan(0);
      chain.update(1.123, 1.06);
      const meshes = [chain.rollers, chain.plates];
      const original = meshes.map((m) => Array.from(m.instanceMatrix.array));
      const versions = meshes.map((m) => m.instanceMatrix.version);
      const identities = meshes.map((m) => [
        m.geometry,
        m.material,
        m.instanceMatrix,
        m.boundingBox,
        m.boundingSphere,
      ]);
      chain.update(1.123, 1.06);
      expect(meshes.map((m) => m.instanceMatrix.version)).toEqual(versions);
      chain.update(-12, 0.96);
      chain.update(1.123, 1.06);
      expect(meshes.map((m) => Array.from(m.instanceMatrix.array))).toEqual(original);
      expect(
        meshes.map((m) => [
          m.geometry,
          m.material,
          m.instanceMatrix,
          m.boundingBox,
          m.boundingSphere,
        ]),
      ).toEqual(identities);
    } finally {
      dispose();
    }
  });

  it('retains circular front and rear wraps in the scaled, rotated parent through suspension travel', () => {
    const { chain, dispose } = make(),
      parent = new T.Group();
    parent.rotation.set(0.27, -0.6, 0.08);
    parent.position.set(2, -3, 4);
    parent.add(chain.root);
    try {
      for (const stretch of [0.86, 1, 1.14]) {
        parent.scale.z = stretch;
        chain.update(0.13, stretch);
        parent.updateMatrixWorld(true);
        const rear = new T.Vector3(0.095, 0, -0.52).applyMatrix4(parent.matrixWorld);
        const front = new T.Vector3(0.095, 0, 0).applyMatrix4(parent.matrixWorld);
        let rearSamples = 0,
          frontSamples = 0;
        for (let i = 0; i < chain.links; i++) {
          const local = point(chain.rollers, i),
            world = local.clone().applyMatrix4(chain.root.matrixWorld);
          if (local.z < -0.52 * stretch - 0.004) {
            expect(world.distanceTo(rear)).toBeCloseTo(0.112, 6);
            rearSamples++;
          }
          if (local.z > 0.012) {
            expect(world.distanceTo(front)).toBeCloseTo(0.036, 6);
            frontSamples++;
          }
        }
        expect(rearSamples).toBeGreaterThan(10);
        expect(frontSamples).toBeGreaterThan(3);
      }
    } finally {
      dispose();
    }
  });

  it('keeps every expanded vertex inside stable culling bounds while the loop changes', () => {
    const { chain, dispose } = make(),
      matrix = new T.Matrix4(),
      vertex = new T.Vector3();
    try {
      for (const [rotation, stretch] of [
        [0, 0.86],
        [1.2, 1.14],
        [-12, 1],
        [Number.MAX_VALUE, 1.04],
      ]) {
        chain.update(rotation, stretch);
        for (const mesh of [chain.rollers, chain.plates]) {
          const p = mesh.geometry.getAttribute('position');
          let outside = 0;
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, matrix);
            for (let j = 0; j < p.count; j++) {
              vertex.fromBufferAttribute(p, j).applyMatrix4(matrix);
              if (
                !mesh.boundingBox!.containsPoint(vertex) ||
                !mesh.boundingSphere!.containsPoint(vertex)
              )
                outside++;
            }
          }
          expect(outside).toBe(0);
        }
      }
    } finally {
      dispose();
    }
  });

  it('guards malformed phases and closes wheel revolutions without transient resource creation', () => {
    const { chain, material, mud, dispose } = make();
    try {
      const zero = [chain.rollers, chain.plates].map((m) => Array.from(m.instanceMatrix.array));
      for (const phase of [Math.PI * 2, -Math.PI * 2, NaN, Infinity, -Infinity]) {
        chain.update(phase);
        expect(
          [chain.rollers, chain.plates].map((m) => Array.from(m.instanceMatrix.array)),
        ).toEqual(zero);
      }
      for (const phase of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
        chain.update(phase);
        expect(Array.from(chain.plates.instanceMatrix.array).every(Number.isFinite)).toBe(true);
      }
      for (const arm of [NaN, Infinity, 0.02, 1.2])
        expect(() => new MotocrossChainDrive(arm, 'high', material, mud)).toThrow(
          'Invalid motocross swingarm length',
        );
    } finally {
      dispose();
    }
  });

  it('applies entrant mud to instance positions while the shared rigid sprocket keeps its local coordinates', () => {
    const { chain, material, mud, dispose } = make();
    try {
      const version = material.version;
      installMudOn(chain.root, mud);
      expect(material.version).toBe(version);
      const shader = {
        uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
        vertexShader: T.ShaderLib.standard.vertexShader,
        fragmentShader: T.ShaderLib.standard.fragmentShader,
      };
      material.onBeforeCompile(
        shader as T.WebGLProgramParametersWithUniforms,
        {} as T.WebGLRenderer,
      );
      const local = shader.vertexShader.indexOf('vOffroadMudPos = position;');
      const instanced = shader.vertexShader.indexOf('vOffroadMudPos = ( instanceMatrix');
      expect(local).toBeGreaterThan(0);
      expect(instanced).toBeGreaterThan(local);
      expect(shader.vertexShader).toContain(
        '#ifdef USE_INSTANCING\nvOffroadMudPos = ( instanceMatrix',
      );
      expect(shader.uniforms.offroadMud).toBe(mud.offroadMud);
      expect(shader.uniforms.offroadMudWet).toBe(mud.offroadMudWet);
    } finally {
      dispose();
    }
  });

  for (const id of ['mx250', 'mx450'])
    it.each(['high', 'mid', 'far'] as const)(
      `${id} %s integrates wheel phase, keeps its LOD budget and disposes owned buffers exactly once`,
      (detail) => {
        const definition = VEHICLES[id],
          materials = new BikeMaterials(0);
        const model = new DirtBikeModel(definition, 0, detail, materials, mudUniforms()),
          sag = staticSag(definition);
        const geometries = new Set<T.BufferGeometry>(),
          instances: T.InstancedMesh[] = [];
        let total = 0;
        model.root.traverse((o) => {
          if (o instanceof T.Mesh) {
            geometries.add(o.geometry);
            total += triangles(o);
          }
          if (o instanceof T.InstancedMesh) instances.push(o);
        });
        const geometryDisposals = new Map([...geometries].map((g) => [g, 0]));
        for (const geometry of geometries)
          geometry.addEventListener('dispose', () =>
            geometryDisposals.set(geometry, geometryDisposals.get(geometry)! + 1),
          );
        const instanceDisposals = instances.map(() => 0);
        instances.forEach((mesh, i) =>
          mesh.addEventListener('dispose', () => instanceDisposals[i]++),
        );
        let sharedMaterialDisposals = 0;
        materials.aluminium.addEventListener('dispose', () => sharedMaterialDisposals++);
        try {
          expect(total).toBeLessThan(130000);
          expect(instances).toHaveLength(detail === 'far' ? 0 : 2);
          const pose = (rotation: number) =>
            model.pose({
              fork: sag.fork + 0.04,
              shock: sag.shock - 0.01,
              steer: 0.15,
              frontRotation: -2,
              rearRotation: rotation,
              chassisLean: 0,
              riderOffset: 0,
              tuck: 0,
              brake: 0,
              rearBrake: 0,
              discTemp: 0,
              compoundColour: 0xffffff,
              riding: false,
            });
          pose(0);
          const original = instances.map((m) => Array.from(m.instanceMatrix.array));
          pose(1.123);
          if (detail !== 'far')
            expect(instances.map((m) => Array.from(m.instanceMatrix.array))).not.toEqual(original);
          pose(0);
          expect(instances.map((m) => Array.from(m.instanceMatrix.array))).toEqual(original);
        } finally {
          model.dispose();
          model.dispose();
          expect([...geometryDisposals.values()].every((n) => n === 1)).toBe(true);
          expect(instanceDisposals).toEqual(instances.map(() => 1));
          expect(sharedMaterialDisposals).toBe(0);
          materials.dispose();
          expect(sharedMaterialDisposals).toBe(1);
        }
      },
    );
});
