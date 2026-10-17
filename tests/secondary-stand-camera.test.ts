import { expect, it, vi } from 'vitest';
import * as T from 'three';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import {
  MotocrossChaseCamera,
  type MotocrossCameraFrame,
} from '../src/rendering/offroad/chase-camera.ts';
import type { Track } from '../src/simulation/track.ts';
import {
  selectSecondaryStandView,
  secondaryStandCameraEvidence,
  requireSecondaryStandChaseCamera,
} from '../e2e/fixtures/secondary-stand-camera.ts';

const flat: Pick<Track, 'at' | 'sample'> = {
  at(s, out) {
    Object.assign(out, { x: 0, y: 0, z: s, s, tx: 0, tz: 1, nx: 1, nz: 0, width: 5 });
    return out;
  },
  sample(x, z, out) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.s = z;
    out.lateral = x;
    return out;
  },
};
const landed: MotocrossCameraFrame = {
  anchor: new T.Vector3(0, 0.86, 0),
  heading: 0,
  s: 0,
  speed: 15,
  cgHeight: 0.86,
  lean: 0.2,
  airborne: false,
  airTime: 0,
  landingSpeed: 5,
  bottom: 0.2,
  motion: 0.35,
};
const cameraPose = (camera: MotocrossChaseCamera) => ({
  eye: camera.eye.toArray(),
  gaze: camera.gaze.toArray(),
  up: camera.up.toArray(),
  fov: camera.fov,
});
function primeLanding(camera: MotocrossChaseCamera) {
  camera.update(0, flat, { ...landed, airborne: true, airTime: 0.7, lean: 0.5 });
  camera.update(1 / 60, flat, landed);
  return cameraPose(camera);
}

function view() {
  const reset = vi.fn();
  // The production constructor owns this stateful controller in every mode.
  // Keep it real so a view cut must actually clear flight/landing history.
  const motocrossCamera = new MotocrossChaseCamera();
  const motocrossReset = vi.spyOn(motocrossCamera, 'reset');
  const target = {
    mode: 'cockpit',
    initialized: true,
    lookX: 1,
    lookY: 1,
    composition: { reset },
    motionBlur: { reset },
    audioView: { reset },
    cameraClock: { reset },
    inertia: { reset },
    viewOrientation: { reset },
    motocrossCamera,
    trackside: { reset },
    changeCamera: RacingRenderer.prototype.changeCamera,
  } as unknown as RacingRenderer;
  return { target, reset, motocrossCamera, motocrossReset };
}
it('switches a held cockpit to chase through the production camera transaction', () => {
  const { target, reset, motocrossCamera, motocrossReset } = view();
  const continuing = primeLanding(motocrossCamera);
  const fresh = cameraPose(new MotocrossChaseCamera().update(0, flat, landed));
  expect(continuing).not.toEqual(fresh);
  selectSecondaryStandView(target, 'chase');
  expect(target.mode).toBe('chase');
  expect((target as unknown as { initialized: boolean }).initialized).toBe(false);
  expect(target.lookX).toBe(0);
  expect(target.lookY).toBe(0);
  expect(reset).toHaveBeenCalledTimes(7);
  expect(motocrossReset).toHaveBeenCalledOnce();
  expect(cameraPose(motocrossCamera.update(0, flat, landed))).toEqual(fresh);
});
it('does not reset camera continuation when consecutive samples keep the same view', () => {
  const { target, reset, motocrossCamera, motocrossReset } = view();
  const initial = primeLanding(motocrossCamera);
  selectSecondaryStandView(target, 'cockpit');
  expect(reset).not.toHaveBeenCalled();
  expect(motocrossReset).not.toHaveBeenCalled();
  expect(cameraPose(motocrossCamera.update(0, flat, landed))).toEqual(initial);
  selectSecondaryStandView(target, 'chase');
  reset.mockClear();
  motocrossReset.mockClear();
  const continuing = primeLanding(motocrossCamera);
  selectSecondaryStandView(target, 'chase');
  expect(reset).not.toHaveBeenCalled();
  expect(motocrossReset).not.toHaveBeenCalled();
  expect(cameraPose(motocrossCamera.update(0, flat, landed))).toEqual(continuing);
  selectSecondaryStandView(target, 'cockpit');
  expect(reset).toHaveBeenCalledTimes(7);
  expect(motocrossReset).toHaveBeenCalledOnce();
  expect(cameraPose(motocrossCamera.update(0, flat, landed))).toEqual(
    cameraPose(new MotocrossChaseCamera().update(0, flat, landed)),
  );
});
it('measures the actual translated/rotated car eye and visible body centre', () => {
  const car = new T.Group();
  car.position.set(125, 8, -60);
  car.rotation.y = 1.2;
  car.updateMatrixWorld(true);
  const camera = new T.PerspectiveCamera(58, 16 / 9, 0.1, 2000);
  camera.position.copy(car.localToWorld(new T.Vector3(0, 2, -6)));
  camera.lookAt(car.localToWorld(new T.Vector3(0, 0.7, 0)));
  camera.updateMatrixWorld(true);
  const measured = secondaryStandCameraEvidence(camera, car);
  expect(measured.eye[0]).toBeCloseTo(0);
  expect(measured.eye[1]).toBeCloseTo(2);
  expect(measured.eye[2]).toBeCloseTo(-6);
  expect(() => requireSecondaryStandChaseCamera(measured)).not.toThrow();
  // The current P5 production rig is 4.5 m behind the car, not the old 5.7 m.
  expect(() =>
    requireSecondaryStandChaseCamera({ eye: [0, 1.3, -4.5], bodyCentre: [0, 0, 0.5] }),
  ).not.toThrow();
});
it('rejects the original inside-head chase witness and non-visible/non-finite views', () => {
  const good = { eye: [0, 2, -6], bodyCentre: [0, 0, 0.9] };
  for (const bad of [
    { ...good, eye: [0, 1.1, 0] },
    { ...good, eye: [0, 0, -6] },
    { ...good, eye: [0, 2, 6] },
    { ...good, eye: [0, 1.3, -3.5] },
    { ...good, eye: [0, 2, NaN] },
    { ...good, bodyCentre: [2, 0, 0.9] },
    { ...good, bodyCentre: [0, -2, 0.9] },
    { ...good, bodyCentre: [0, 0, 1.1] },
    { ...good, bodyCentre: [0, 0, -1.1] },
    { ...good, bodyCentre: [0, 0, Infinity] },
    { ...good, eye: [] },
  ])
    expect(() => requireSecondaryStandChaseCamera(bad)).toThrow('chase camera');
});
