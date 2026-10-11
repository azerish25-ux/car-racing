import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { detailDistance } from '../src/rendering/view-detail.ts';
import { carLod } from '../src/rendering/lod.ts';
import { CrowdCluster } from '../src/rendering/crowd.ts';
import { pitCrewDetail } from '../src/rendering/pit-presentation.ts';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { CameraClock } from '../src/rendering/camera-dynamics.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';

function frame() {
  const f = new Float32Array(HEADER + 2 * CAR_STRIDE);
  f[H.CARS] = 2;
  f[H.TIME] = 1;
  for (let id = 0; id < 2; id++) f[carBase(id) + F.QW] = 1;
  return f;
}
describe('current-view detail and deterministic presentation', () => {
  it('retains wide-lens thresholds and matches the established pit-service optical rule', () => {
    for (const distance of [0, 30, 44.99, 45, 100, 250, 600]) {
      expect(detailDistance(distance)).toBe(distance);
      expect(detailDistance(distance, 90, 2)).toBe(distance);
      for (const fov of [8, 20, 40, 58, 110])
        for (const aspect of [0.5, 1, 16 / 9])
          expect(pitCrewDetail(distance, fov, aspect)).toBe(
            detailDistance(distance, fov, aspect) < 45 ? 0 : 1,
          );
    }
    expect(detailDistance(200, 58, 0.5)).toBe(100);
    expect(carLod(200, 2, 'high', false)).toBe(2);
    expect(carLod(detailDistance(200, 12), 2, 'high', false)).toBe(0);
  });
  it('rejects invalid lens inputs instead of creating missing or corrupt detail ranges', () => {
    for (const bad of [NaN, Infinity, -1]) expect(() => detailDistance(bad)).toThrow();
    for (const bad of [NaN, Infinity, -1, 0, 180]) expect(() => detailDistance(10, bad)).toThrow();
    for (const bad of [NaN, Infinity, -1, 0]) expect(() => detailDistance(10, 58, bad)).toThrow();
  });
  it('uses lens-aware crowd meshes without inventing reactions or allocating new instance storage', () => {
    const material = new T.MeshStandardMaterial();
    const crowd = new CrowdCluster([new T.Matrix4()], [new T.Color()], 17, material);
    const camera = new T.Vector3(600, 0, 0),
      f = frame(),
      untouched = f.slice();
    f[carBase(0) + F.SPEED] = 30;
    untouched.set(f);
    const matrices = crowd.levels.map((m) => m.instanceMatrix),
      geometry = crowd.levels.map((m) => m.geometry);
    try {
      crowd.update(1, camera, 0, f);
      expect(crowd.levels.map((m) => m.visible)).toEqual([false, false, false, true]);
      crowd.update(1, camera, 0, f, 8);
      expect(crowd.levels.map((m) => m.visible)).toEqual([true, false, false, false]);
      expect(crowd.uniforms.crowdReaction.value.toArray()).toEqual([0, 0]);
      const selected = crowd.lodRanges.map((r) => r.toArray());
      for (let i = 0; i < 12; i++) {
        crowd.update(2, camera, 50, f, 58);
        crowd.update(1, camera, 0, f, 8);
        expect(crowd.lodRanges.map((r) => r.toArray())).toEqual(selected);
        crowd.levels.forEach((m, j) => {
          expect(m.instanceMatrix).toBe(matrices[j]);
          expect(m.geometry).toBe(geometry[j]);
        });
      }
      expect(f).toEqual(untouched);
    } finally {
      crowd.levels.forEach((m) => {
        m.dispose();
        m.geometry.dispose();
        (m.material as T.Material).dispose();
        m.customDepthMaterial?.dispose();
        m.customDistanceMaterial?.dispose();
      });
      material.dispose();
    }
  });
  for (const follow of [0, 1])
    it(`poses each car once, after the current view is solved (following ${follow})`, () => {
      // Exercise the actual production draw ordering without a GPU. Stop only at
      // the subsequent shadow stage; all camera math and pose dispatch above it
      // are real. Separate hosted tests exercise the complete renderer.
      const stop = new Error('Reached shadow stage');
      const camera = new T.PerspectiveCamera(58, 16 / 9, 0.02, 500);
      camera.position.set(10000, 0, 0); // the outgoing camera must never decide LOD
      const a = frame(),
        b = frame(),
        opponent = 1 - follow;
      a[carBase(opponent) + F.X] = 40;
      b[carBase(opponent) + F.X] = 120;
      b[H.TIME] = 1.1;
      const savedA = a.slice(),
        savedB = b.slice();
      const sun = new T.DirectionalLight();
      Object.defineProperty(sun.shadow, 'mapSize', {
        get() {
          throw stop;
        },
      });
      const reset = () => ({ reset: vi.fn() });
      const cars = [0, 1].map(() => ({
        root: new T.Group(),
        mirrors: [],
        setLod: vi.fn(),
        update: vi.fn(),
      }));
      const garageUpdate = vi.fn((currentCamera: T.PerspectiveCamera) => {
        // Sample during dispatch so later mutations cannot hide a stale view.
        expect(currentCamera).toBe(camera);
        expect(currentCamera.position.toArray()).toEqual([60, 0.4, 0.2]);
        expect(currentCamera.projectionMatrix.elements).toEqual(
          new T.PerspectiveCamera(
            currentCamera.fov,
            currentCamera.aspect,
            currentCamera.near,
            currentCamera.far,
          ).projectionMatrix.elements,
        );
      });
      const stationUpdate = vi.fn((currentCamera: T.PerspectiveCamera) => {
        expect(currentCamera).toBe(camera);
        expect(currentCamera.position.toArray()).toEqual([60, 0.4, 0.2]);
      });
      const frontageUpdate = vi.fn((currentCamera: T.PerspectiveCamera) => {
        expect(currentCamera).toBe(camera);
        expect(currentCamera.position.toArray()).toEqual([60, 0.4, 0.2]);
        expect(currentCamera.projectionMatrix.elements).toEqual(
          new T.PerspectiveCamera(
            currentCamera.fov,
            currentCamera.aspect,
            currentCamera.near,
            currentCamera.far,
          ).projectionMatrix.elements,
        );
      });
      const fixture = {
        circuit: {
          heroGarage: { update: garageUpdate },
          pitWallStation: { update: stationUpdate },
          pitBuildingFrontage: { update: frontageUpdate },
        },
        frameMs: 16,
        frameSamples: new Float32Array(300),
        sampleIndex: 0,
        sampleCount: 0,
        setCars: vi.fn(),
        orbitTime: 0,
        presented: new PresentedFrame(),
        cameraClock: new CameraClock(),
        composition: reset(),
        motionBlur: reset(),
        trackside: reset(),
        audioView: reset(),
        inertia: {
          ...reset(),
          step: vi.fn(),
          eye: (_p: T.Vector3, _q: T.Quaternion, _pod: boolean, out: T.Vector3) =>
            out.set(60, 0.4, 0.2),
        },
        viewOrientation: { ...reset(), update: () => new T.Quaternion() },
        cars,
        follow,
        quality: 'high',
        mode: 'cockpit',
        photo: null,
        night: false,
        lighting: 'day',
        reflectionFollow: follow,
        reflectionMaterials: [[], []],
        reflection: { setSkyIntensity: vi.fn() },
        venueLighting: { update: vi.fn() },
        lightPools: { update: vi.fn() },
        scene: new T.Scene(),
        sun,
        hemisphere: new T.HemisphereLight(),
        renderer: { toneMappingExposure: 1 },
        sky: {
          material: {
            uniforms: {
              cloudCover: { value: 0 },
              cloudDrift: { value: 0 },
              skyRadiance: { value: 0 },
              nightAmount: { value: 0 },
              sunsetAmount: { value: 0 },
              sunPosition: { value: new T.Vector3() },
            },
          },
        },
        camera,
        target: new T.Vector3(),
        direction: new T.Vector3(),
        gaze: new T.Vector3(),
        desired: new T.Vector3(),
        temporary: new T.Vector3(),
        previousAnchor: new T.Vector3(),
        velocity: new T.Vector3(),
        initialized: false,
        lookX: 0,
        lookY: 0,
      };
      fixture.scene.fog = new T.FogExp2(0xffffff);
      expect(() =>
        RacingRenderer.prototype.draw.call(
          fixture as unknown as RacingRenderer,
          a,
          b,
          0.25,
          1 / 60,
        ),
      ).toThrow(stop);
      expect(camera.position.toArray()).toEqual([60, 0.4, 0.2]);
      expect(garageUpdate).toHaveBeenCalledExactlyOnceWith(camera, 'high', 'day');
      expect(frontageUpdate).toHaveBeenCalledExactlyOnceWith(camera, 'high', 'day');
      expect(frontageUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        stationUpdate.mock.invocationCallOrder[0],
      );
      expect(stationUpdate).toHaveBeenCalledExactlyOnceWith(
        camera,
        'high',
        'day',
        fixture.presented.value,
        'LIVE',
        true,
      );
      expect(stationUpdate.mock.invocationCallOrder[0]).toBeGreaterThan(
        cars[follow].update.mock.invocationCallOrder[0],
      );
      expect(stationUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        cars[opponent].setLod.mock.invocationCallOrder[0],
      );
      expect(garageUpdate.mock.invocationCallOrder[0]).toBeGreaterThan(
        cars[follow].update.mock.invocationCallOrder[0],
      );
      expect(garageUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        cars[opponent].setLod.mock.invocationCallOrder[0],
      );
      for (const car of cars) {
        expect(car.update).toHaveBeenCalledTimes(1);
        expect(car.setLod).toHaveBeenCalledTimes(1);
      }
      expect(cars[follow].setLod.mock.calls[0].slice(1)).toEqual(['high', true, false]);
      const distance = cars[opponent].setLod.mock.calls[0][0];
      expect(distance).toBeCloseTo(Math.hypot(0.4, 0.2), 12);
      expect(cars[opponent].update).toHaveBeenCalledWith(
        a,
        b,
        carBase(opponent),
        0.25,
        1 / 60,
        b[H.TIME],
        false,
      );
      expect(a).toEqual(savedA);
      expect(b).toEqual(savedB);
    });
});
