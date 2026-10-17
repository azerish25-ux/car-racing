import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  bindGpTyre,
  gpDrainageStyle,
  installGpTyreFinish,
} from '../src/rendering/gp-tyre-finish.ts';
import {
  GP_BOOT_ENVELOPE,
  gpRacingBoot,
  installGpLeatherFinish,
} from '../src/rendering/gp-rider-gear.ts';

const shaderFor = (material: T.Material) => {
  const shader = {
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
    uniforms: T.UniformsUtils.clone(T.ShaderLib.physical.uniforms),
  };
  material.onBeforeCompile(
    shader as Parameters<T.Material['onBeforeCompile']>[0],
    {} as T.WebGLRenderer,
  );
  return shader;
};

describe('GP R5 recorded tyre material state', () => {
  it('binds axle-local metric coordinates without changing the contact mesh or existing attributes', () => {
    const geometry = new T.TorusGeometry(0.27, 0.06, 8, 32);
    const attributes = Object.fromEntries(
      Object.entries(geometry.attributes).map(([k, a]) => [k, Array.from(a.array)]),
    );
    const index = Array.from(geometry.index!.array);
    bindGpTyre(geometry, 0.06);
    for (const [name, expected] of Object.entries(attributes))
      expect(Array.from(geometry.getAttribute(name).array)).toEqual(expected);
    expect(Array.from(geometry.index!.array)).toEqual(index);
    const bind = geometry.getAttribute('gpTyreBind');
    for (let i = 0; i < bind.count; i++) {
      expect(bind.getX(i)).toBe(geometry.getAttribute('position').getX(i));
      expect(bind.getY(i)).toBe(geometry.getAttribute('position').getY(i));
      expect(bind.getZ(i)).toBe(geometry.getAttribute('position').getZ(i));
      expect(bind.getW(i)).toBeCloseTo(0.06, 7);
    }
    geometry.dispose();
  });
  it('rejects malformed geometry and impossible carcass widths', () => {
    for (const width of [NaN, Infinity, 0, 0.029, 0.161]) {
      const geometry = new T.BoxGeometry();
      expect(() => bindGpTyre(geometry, width)).toThrow();
      geometry.dispose();
    }
    expect(() => bindGpTyre(new T.BufferGeometry(), 0.06)).toThrow('Missing');
    const bad = new T.BufferGeometry().setAttribute(
      'position',
      new T.Float32BufferAttribute([NaN, 0, 0], 3),
    );
    expect(() => bindGpTyre(bad, 0.06)).toThrow('Non-finite');
    bad.dispose();
  });
  it('uses existing compound indices and no inferred livery colour', () => {
    expect([0, 1, 2, 3, 4].map(gpDrainageStyle)).toEqual([0, 0, 0, 1, 2]);
    for (const value of [undefined, NaN, Infinity, -1, 7]) expect(gpDrainageStyle(value)).toBe(0);
  });
  it('holds and restores exactly the same uniforms after wet/worn/hot replay observations', () => {
    const material = new T.MeshStandardMaterial();
    const finish = installGpTyreFinish(material);
    const dry = {
      compound: 1,
      frontWear: 0.17,
      rearWear: 0.35,
      frontSurfaceTemp: 80,
      rearSurfaceTemp: 90,
      frontWater: 0,
      rearWater: 0.1,
      speed: 40,
    };
    const wet = {
      compound: 4,
      frontWear: 0.41,
      rearWear: 0.63,
      frontSurfaceTemp: 61,
      rearSurfaceTemp: 66,
      frontWater: 0.7,
      rearWater: 0.9,
      speed: 28,
    };
    const snapshot = () => [
      ...finish.front.value.toArray(),
      ...finish.rear.value.toArray(),
      ...finish.style.value.toArray(),
    ];
    finish.update(dry);
    const a = snapshot();
    finish.update(wet);
    const b = snapshot();
    expect(b).not.toEqual(a);
    finish.update(wet);
    expect(snapshot()).toEqual(b);
    finish.update(dry);
    expect(snapshot()).toEqual(a);
    finish.update(wet, false);
    expect(finish.style.value.y).toBe(0);
    const shader = shaderFor(material);
    expect(shader.uniforms.gpTyreFront).toBe(finish.front);
    expect(shader.uniforms.gpTyreRear).toBe(finish.rear);
    expect(material.customProgramCacheKey()).toContain('gp-tyre-drainage-v1');
    material.dispose();
  });
  it('bounds damaged telemetry and does not allocate replacement uniform vectors', () => {
    const material = new T.MeshStandardMaterial(),
      finish = installGpTyreFinish(material);
    const f = finish.front.value,
      r = finish.rear.value,
      s = finish.style.value;
    finish.update({
      compound: 4,
      frontWear: 10,
      rearWear: -7,
      frontSurfaceTemp: Infinity,
      rearSurfaceTemp: 500,
      frontWater: NaN,
      rearWater: 30,
      speed: Infinity,
    });
    expect(finish.front.value).toBe(f);
    expect(finish.rear.value).toBe(r);
    expect(finish.style.value).toBe(s);
    expect(f.toArray()).toEqual([1, 80, 0, 0]);
    expect(r.toArray()).toEqual([0, 200, 5, 0]);
    material.dispose();
  });
});

describe('GP R5 anatomical boot and leather finish', () => {
  it.each(['high', 'mid', 'far'] as const)(
    'keeps %s boots owned, finite, small, shaded and inside the unchanged ankle envelope',
    (detail) => {
      const material = {
        leather: new T.MeshStandardMaterial(),
        panel: new T.MeshStandardMaterial(),
        sole: new T.MeshStandardMaterial(),
        armour: new T.MeshStandardMaterial(),
        slider: new T.MeshStandardMaterial(),
      };
      for (const side of [-1, 1] as const) {
        const boot = gpRacingBoot(detail, side, material),
          bounds = new T.Box3().setFromObject(boot),
          size = bounds.getSize(new T.Vector3());
        expect(size.x).toBeLessThanOrEqual(GP_BOOT_ENVELOPE.width);
        expect(size.y).toBeLessThanOrEqual(GP_BOOT_ENVELOPE.height);
        expect(size.z).toBeLessThanOrEqual(GP_BOOT_ENVELOPE.length);
        let draws = 0,
          triangles = 0;
        boot.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          draws++;
          triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3;
          expect(o.castShadow && o.receiveShadow).toBe(true);
          for (const a of Object.values((o.geometry as T.BufferGeometry).attributes))
            expect(Array.from(a.array).every(Number.isFinite)).toBe(true);
          if (o.geometry.index)
            expect(Math.max(...o.geometry.index.array)).toBeLessThan(
              o.geometry.getAttribute('position').count,
            );
          expect(Object.values(material)).toContain(o.material);
          o.geometry.dispose();
        });
        expect(draws).toBeLessThanOrEqual(detail === 'far' ? 3 : 5);
        expect(triangles).toBeLessThan(4200);
      }
      Object.values(material).forEach((m) => m.dispose());
    },
  );
  it('rejects an invalid foot handedness rather than silently inverting its slider', () => {
    const m = new T.MeshStandardMaterial();
    expect(() =>
      gpRacingBoot('high', 0 as -1, { leather: m, panel: m, sole: m, armour: m, slider: m }),
    ).toThrow();
    m.dispose();
  });
  it('chains the previous shader and filters metre-scale leather without a clock or new textures', () => {
    const material = new T.MeshPhysicalMaterial();
    let previous = 0;
    material.onBeforeCompile = () => {
      previous++;
    };
    installGpLeatherFinish(material);
    const shader = shaderFor(material);
    expect(previous).toBe(1);
    expect(shader.vertexShader).toContain('vGpLeatherBind = position;');
    expect(shader.fragmentShader).toContain('smoothstep(.0012,.005,px)');
    expect(shader.fragmentShader).toContain('*.00007*fine');
    expect(shader.fragmentShader).not.toContain('gpLeatherTime');
    expect(material.map).toBeNull();
    expect(material.normalMap).toBeNull();
    material.dispose();
  });
});
