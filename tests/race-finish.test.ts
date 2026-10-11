import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { FormulaCar } from '../src/rendering/car.ts';
import { installFoliageAtlas } from '../src/rendering/landscape.ts';
import { installCanopyNormals } from '../src/rendering/canopy-normals.ts';
import { installCrewSkin, CrewPose } from '../src/rendering/crew-pose.ts';
import { crewSuitFragment } from '../src/rendering/crew-suit.ts';
import { CREW_BONES, peopleGeometry } from '../src/rendering/people-asset.ts';
import { rearSignalIntensity, RearSignalField } from '../src/rendering/rear-signal.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { disposePhase27Scene } from '../e2e/fixtures/phase27c-resources.ts';

function shaderFor(material: T.Material, kind: 'standard' | 'depth' | 'distanceRGBA') {
  const shader = {
    ...T.ShaderLib[kind],
    uniforms: T.UniformsUtils.clone(T.ShaderLib[kind].uniforms),
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

// Geometry/state-only tests. This no-op canvas is NOT rendered-image evidence.
function stubCanvas() {
  class Canvas {
    width = 300;
    height = 150;
    getContext() {
      const noop = () => {};
      return new Proxy(
        {
          canvas: this,
          measureText: () => ({ width: 40 }),
          createLinearGradient: () => ({ addColorStop: noop }),
          createRadialGradient: () => ({ addColorStop: noop }),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
          }),
        },
        { get: (target, key) => Reflect.get(target, key) ?? noop },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
}
afterEach(() => vi.unstubAllGlobals());

describe('recorded rear signal across the production car LODs', () => {
  it('keeps one visible lamp, matches the spray field and rewinds without stale emission', () => {
    stubCanvas();
    const car = new FormulaCar(1);
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    const o = carBase(0);
    frame[H.CARS] = 1;
    frame[o + F.QW] = 1;
    frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = 1;
    const field = new RearSignalField();
    const lamp = car.rearSignal;
    try {
      for (const [distance, level] of [
        [0, 0],
        [90, 1],
        [220, 2],
        [90, 1],
        [0, 0],
      ]) {
        for (const [brake, time] of [
          [0, 10],
          [0.8, 11],
          [0, 10],
        ]) {
          frame[o + F.BRAKE] = brake;
          frame[H.TIME] = time;
          const original = frame.slice();
          car.setLod(distance, 'high', false);
          car.update(frame, frame, o, 1, 0, time, false);
          field.update(frame);
          expect(car.lodLevel).toBe(level);
          expect(car.rearSignal).toBe(lamp);
          let visible = true;
          for (let parent: T.Object3D | null = lamp; parent; parent = parent.parent)
            visible &&= parent.visible;
          expect(visible).toBe(true);
          expect(lamp.parent).toBe(car.root);
          expect(lamp.material).toBe(car.rainLight);
          expect(car.rainLight.emissiveIntensity).toBe(
            rearSignalIntensity(frame[o + F.BRAKE], time),
          );
          expect(field.positions[0].w).toBe(car.rainLight.emissiveIntensity);
          expect(lamp.getWorldPosition(new T.Vector3()).toArray()).toEqual(
            field.positions[0].toArray().slice(0, 3),
          );
          let copies = 0;
          car.root.traverse((object) => {
            if (object instanceof T.Mesh && object.material === car.rainLight) copies++;
          });
          expect(copies).toBe(1);
          expect(frame).toEqual(original);
        }
      }
      const previous = frame.slice();
      previous[H.TIME] = 1;
      previous[o + F.BRAKE] = 0;
      frame[H.TIME] = 1.2;
      frame[o + F.BRAKE] = 0.08;
      car.setLod(220, 'high', false);
      car.update(previous, frame, o, 0.5, 0, 999, false);
      expect(car.rainLight.emissiveIntensity).toBe(
        rearSignalIntensity(frame[o + F.BRAKE] / 2, (previous[H.TIME] + frame[H.TIME]) / 2),
      );
    } finally {
      disposePhase27Scene(car.root);
    }
  });
});

describe('authored suit regions and shadow agreement', () => {
  it.each(['crew_high', 'crew_mid'] as const)(
    '%s has unambiguous bind-space torso/sleeve/leg regions',
    (role) => {
      const g = peopleGeometry(role);
      try {
        const j = g.getAttribute('crewJoint'),
          w = g.getAttribute('crewWeight');
        const coverage = [0, 0, 0];
        for (let v = 0; v < j.count; v++) {
          const mask = [0, 0, 0];
          for (const component of [0, 1]) {
            const bone = j.getComponent(v, component);
            mask[bone < 2.5 ? 0 : bone < 8.5 ? 1 : 2] += w.getComponent(v, component);
          }
          expect(mask.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
          mask.forEach((m, i) => {
            if (m > 0.9) coverage[i]++;
          });
        }
        for (const count of coverage) expect(count).toBeGreaterThan(20);
      } finally {
        g.dispose();
      }
    },
  );
  it('uses the same skin/bone atlas in colour and both shadows with no additional texture', () => {
    const values = new Float32Array(CREW_BONES * 16);
    const pose = new CrewPose().set(new T.Matrix4(), 0.88, 0, [
      new T.Vector3(-0.245, 0.8, 0),
      new T.Vector3(0.245, 0.8, 0),
    ]);
    pose.write(values, 0);
    const atlas = new T.DataTexture(values, 60, 1, T.RGBAFormat, T.FloatType);
    for (const [m, kind, colour] of [
      [new T.MeshStandardMaterial(), 'standard', true],
      [new T.MeshDepthMaterial(), 'depth', false],
      [new T.MeshDistanceMaterial(), 'distanceRGBA', false],
    ] as const) {
      installCrewSkin(m, atlas, 1, colour);
      const s = shaderFor(m, kind);
      expect(s.uniforms.crewBones.value).toBe(atlas);
      expect(s.uniforms.crewRows.value).toBe(1);
      expect(s.vertexShader).toContain(
        'crewBone(crewJoint.x)*crewWeight.x + crewBone(crewJoint.y)*crewWeight.y',
      );
      expect(s.fragmentShader.includes(crewSuitFragment)).toBe(colour);
      expect(s.vertexShader.includes('vCrewRegion =')).toBe(colour);
      expect(s.fragmentShader).not.toContain('suitEmissive');
      if (colour) {
        expect(s.fragmentShader).toContain('crewFoldHeight(vCrewPattern');
        expect(s.fragmentShader).toContain('#include <lights_fragment_begin>');
        expect(s.vertexShader).toContain('vCrewPattern = position;');
      }
      m.dispose();
    }
    atlas.dispose();
  });
});

describe('aggregate foliage normals', () => {
  it('retains atlas UVs and lighting, only corrects smooth colour normals', () => {
    for (const [m, kind] of [
      [new T.MeshStandardMaterial({ side: T.DoubleSide, alphaTest: 0.45 }), 'standard'],
      [new T.MeshDepthMaterial({ side: T.DoubleSide, alphaTest: 0.45 }), 'depth'],
      [new T.MeshDistanceMaterial({ side: T.DoubleSide, alphaTest: 0.45 }), 'distanceRGBA'],
    ] as const) {
      installFoliageAtlas(m);
      const s = shaderFor(m, kind);
      expect(s.vertexShader).toContain('atlasOffset');
      expect(s.fragmentShader).toContain('#include <alphatest_fragment>');
      expect(s.fragmentShader.includes('nonPerturbedNormal = normal;')).toBe(kind === 'standard');
      expect(m.alphaTest).toBe(0.45);
      expect(m.side).toBe(T.DoubleSide);
      if (kind === 'standard') {
        expect(s.fragmentShader).toContain('defined(DOUBLE_SIDED) && !defined(FLAT_SHADED)');
        expect(s.fragmentShader).toContain('#include <lights_fragment_begin>');
      }
      m.dispose();
    }
  });
  it('composes prior material hooks and fails closed when the shader contract changes', () => {
    const m = new T.MeshStandardMaterial();
    m.customProgramCacheKey = () => 'prior-atlas';
    m.onBeforeCompile = (s) => {
      s.vertexShader = '// preserved\n' + s.vertexShader;
    };
    installCanopyNormals(m);
    expect(shaderFor(m, 'standard').vertexShader).toMatch(/^\/\/ preserved/);
    expect(m.customProgramCacheKey()).toBe('prior-atlas-aggregate-canopy-normals-v1');
    expect(() => shaderFor(m, 'depth')).toThrow('Canopy normal hook missing');
    m.dispose();
  });
});
