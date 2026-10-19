import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import {
  GP_RADIATOR,
  gpRadiator,
  gpRadiatorCore,
  installGpRadiatorFinish,
} from '../src/rendering/gp-radiator.ts';
import { WeatherPresentation } from '../src/rendering/weather-presentation.ts';
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

const release = (root: T.Object3D) =>
  root.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });

const triangleCount = (root: T.Object3D) => {
  let count = 0;
  root.traverse((o) => {
    if (o instanceof T.Mesh)
      count +=
        ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) *
        (o instanceof T.InstancedMesh ? o.count : 1);
  });
  return count;
};

describe('GP recessed radiator and fin resolution', () => {
  it.each(['high', 'mid'] as const)(
    '%s core has outward nondegenerate faces and metric detail coordinates',
    (detail) => {
      const geometry = gpRadiatorCore(detail);
      try {
        const p = geometry.getAttribute('position'),
          binding = geometry.getAttribute('gpRadiatorBind'),
          n = geometry.getAttribute('normal'),
          indices = geometry.index!,
          a = new T.Vector3(),
          b = new T.Vector3(),
          c = new T.Vector3();
        let front = -Infinity,
          edge = Infinity;
        for (let i = 0; i < p.count; i++) {
          expect(binding.getX(i)).toBe(p.getX(i));
          expect(binding.getY(i)).toBe(p.getY(i));
          expect(n.getZ(i)).toBeGreaterThan(0.98);
          front = Math.max(front, p.getZ(i));
          edge = Math.min(edge, p.getZ(i));
        }
        expect(front - edge).toBeGreaterThan(0.012);
        for (let i = 0; i < indices.count; i += 3) {
          a.fromBufferAttribute(p, indices.getX(i));
          b.fromBufferAttribute(p, indices.getX(i + 1));
          c.fromBufferAttribute(p, indices.getX(i + 2));
          expect(b.sub(a).cross(c.sub(a)).z).toBeGreaterThan(1e-6);
        }
      } finally {
        geometry.dispose();
      }
    },
  );

  it('uses the old envelope, a shared owned high/mid finish and no far resources', () => {
    const materials = new BikeMaterials(0),
      originalCount = materials.list.length,
      originalDarkHook = materials.dark.onBeforeCompile,
      high = gpRadiator('high', materials),
      mid = gpRadiator('mid', materials),
      far = gpRadiator('far', materials);
    const core = high.getObjectByName('Curved radiator core and formed tanks') as T.Mesh,
      other = mid.getObjectByName('Curved radiator core and formed tanks') as T.Mesh,
      disposed = vi.fn();
    (core.material as T.Material).addEventListener('dispose', disposed);
    try {
      expect(high.children).toHaveLength(1);
      expect(mid.children).toHaveLength(1);
      expect(far.children).toHaveLength(0);
      expect(triangleCount(high)).toBeLessThan(260);
      expect(triangleCount(mid)).toBeLessThan(triangleCount(high));
      expect(core.material).toBe(other.material);
      expect(materials.list).toHaveLength(originalCount + 1);
      expect(materials.dark.onBeforeCompile).toBe(originalDarkHook);
      for (const root of [high, mid]) {
        const box = new T.Box3().setFromObject(root),
          extent = new T.Vector3();
        box.getSize(extent);
        expect(extent.x).toBeLessThanOrEqual(GP_RADIATOR.width);
        expect(extent.y).toBeLessThanOrEqual(GP_RADIATOR.height);
        expect(extent.z).toBeLessThanOrEqual(GP_RADIATOR.depth);
        expect(box.min.z).toBeGreaterThanOrEqual(-GP_RADIATOR.depth / 2 - 1e-8);
        expect(box.max.z).toBeLessThanOrEqual(GP_RADIATOR.depth / 2);
      }
    } finally {
      release(high);
      release(mid);
      materials.dispose();
    }
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('chains once with prior hooks and leaves wetness after the filtered dry response', () => {
    const material = new T.MeshStandardMaterial(),
      previous = vi.fn();
    material.onBeforeCompile = previous;
    material.customProgramCacheKey = () => 'existing-finish';
    const weather = new WeatherPresentation();
    try {
      expect(installGpRadiatorFinish(material)).toBe(true);
      expect(installGpRadiatorFinish(material)).toBe(false);
      expect(material.customProgramCacheKey()).toBe('existing-finish|gp-radiator-finish-v1');
      // Apply the real tagged material's weather hook, not a synthetic stub.
      const materials = new BikeMaterials(0),
        group = gpRadiator('high', materials),
        actual = (group.children[0] as T.Mesh).material as T.MeshStandardMaterial;
      try {
        weather.installMaterial(actual);
        const shaderFor = (m: T.Material) => {
          const shader = {
            vertexShader: T.ShaderLib.standard.vertexShader,
            fragmentShader: T.ShaderLib.standard.fragmentShader,
            uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
          };
          m.onBeforeCompile(
            shader as Parameters<T.Material['onBeforeCompile']>[0],
            {} as T.WebGLRenderer,
          );
          return shader;
        };
        shaderFor(material);
        expect(previous).toHaveBeenCalledTimes(1);
        const shader = shaderFor(actual),
          source = shader.fragmentShader,
          dry = source.indexOf('roughnessFactor=clamp(roughnessFactor+(-.09*gpRadiatorFins'),
          wet = source.indexOf('roughnessFactor = mix(roughnessFactor, min(roughnessFactor,');
        expect(source.match(/float gpRadiatorLine\(/g)).toHaveLength(1);
        expect(source.indexOf('fwidth(phase)')).toBeLessThan(source.indexOf('fract(phase+.5)'));
        expect(source).toContain('return mix(coverage,line,resolved)');
        expect(dry).toBeGreaterThan(0);
        expect(wet).toBeGreaterThan(dry);
        expect(wet).toBeLessThan(source.indexOf('#include <lights_physical_fragment>'));
        expect(shader.vertexShader).toContain('vGpRadiatorBind=gpRadiatorBind');
      } finally {
        release(group);
        materials.dispose();
      }
    } finally {
      weather.dispose();
      material.dispose();
    }
  });

  it.each(['gpr1', 'gpr2', 'sbk1000', 'ss600'])(
    '%s preserves the complete-model gate and exposes the GP core through the fork opening',
    (id) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        model = new BikeModel(definition, 0, 'high', materials, true);
      try {
        expect(triangleCount(model.root)).toBeLessThan(110000);
        const core = model.root.getObjectByName('Curved radiator core and formed tanks') as
          | T.Mesh
          | undefined;
        if (id !== 'gpr1' && id !== 'gpr2') {
          expect(core).toBeUndefined();
          return;
        }
        expect(core).toBeDefined();
        const sag = staticSag(definition);
        model.pose({
          fork: sag.fork,
          shock: sag.shock,
          steer: 0,
          frontRotation: 0,
          rearRotation: 0,
          chassisLean: 0,
          riderOffset: 0,
          tuck: 0.75,
          brake: 0.05,
          rearBrake: 0,
          discTemp: 280,
          compoundColour: 0xffffff,
          riding: true,
        });
        model.root.position.y = definition.bike!.cgHeight;
        model.root.updateMatrixWorld(true);
        const position = core!.geometry.getAttribute('position'),
          binding = core!.geometry.getAttribute('gpRadiatorBind'),
          indices = core!.geometry.index!,
          ray = new T.Raycaster(),
          origin = new T.Vector3(-2.8, 1.65, 3.35),
          target = new T.Vector3(),
          corner = new T.Vector3();
        let visible = 0;
        for (let i = 0; i < indices.count; i += 3) {
          if (binding.getZ(indices.getX(i)) < 0.5) continue;
          target.set(0, 0, 0);
          for (let j = 0; j < 3; j++)
            target.add(corner.fromBufferAttribute(position, indices.getX(i + j)));
          target.multiplyScalar(1 / 3).applyMatrix4(core!.matrixWorld);
          ray.set(origin, target.clone().sub(origin).normalize());
          const hit = ray.intersectObject(model.root, true).find(({ object }) => {
            const m = (object as T.Mesh).material as T.Material;
            return !m.transparent && !(m instanceof T.MeshPhysicalMaterial && m.transmission > 0);
          });
          if (hit && hit.object === core && hit.face && binding.getZ(hit.face.a) > 0.5) visible++;
        }
        expect(
          visible,
          `Core faces visible from the retained three-quarter review camera: ${visible}`,
        ).toBeGreaterThan(2);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );
});
