import * as T from 'three';
import type { RacingRenderer } from '../../src/rendering/renderer.ts';

/** Use the real UI camera transaction. A raw mode assignment leaves the chase
 * spring at the cockpit eye when the held snapshot has zero elapsed time. */
export function selectSecondaryStandView(
  view: Pick<RacingRenderer, 'mode' | 'changeCamera'>,
  mode: 'cockpit' | 'chase',
) {
  if (view.mode !== mode) view.changeCamera(mode);
}

export function secondaryStandCameraEvidence(camera: T.PerspectiveCamera, car: T.Object3D) {
  return {
    eye: car.worldToLocal(camera.position.clone()).toArray(),
    bodyCentre: new T.Vector3(0, 0.7, 0).applyMatrix4(car.matrixWorld).project(camera).toArray(),
  };
}

/** Independently measured placement, not a camera-name assertion. The normal
 * chase starts 4.5 m behind the car (P5 retune) and must actually see its
 * body centre. Allow 0.5 m for camera interpolation and turning. */
export function requireSecondaryStandChaseCamera(evidence: {
  eye: readonly number[];
  bodyCentre: readonly number[];
}) {
  if (
    evidence.eye.length !== 3 ||
    evidence.bodyCentre.length !== 3 ||
    ![...evidence.eye, ...evidence.bodyCentre].every(Number.isFinite) ||
    evidence.eye[2] >= -4 ||
    evidence.eye[1] <= 1 ||
    Math.abs(evidence.bodyCentre[0]) >= 1 ||
    Math.abs(evidence.bodyCentre[1]) >= 1 ||
    evidence.bodyCentre[2] <= -1 ||
    evidence.bodyCentre[2] >= 1
  )
    throw new Error('A12 chase camera is not behind and viewing the car');
}
