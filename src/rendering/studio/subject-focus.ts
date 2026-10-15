import type * as T from 'three';
import { SHOWROOM } from '../menu-preview.ts';
import { TELEPHOTO } from '../trackside.ts';
import { REPLAY_LENS, thinLensScale } from '../ultra/replay-lens.ts';
import type { DepthOfFieldPass } from './dof-pass.ts';

/**
 * Depth of field on the subject car outside photo mode (D29 showroom, D30
 * broadcast telephoto): the menu's showroom lens, or a trackside lens tighter
 * than `TELEPHOTO.dofBelow` degrees. Photo mode keeps its own lens settings.
 *
 * The trackside lens is a real broadcast camera's: a thin lens on a 2/3-inch
 * B4 gate (5.4 mm high) at f/4. Its circle of confusion grows with the
 * distance ratio to the focus (`thinLensScale`), so a 60-150 m pack keeps
 * almost the whole frame sharp, as on television, with a little softening of
 * the near catch fence; a close pit-lane shot still separates. The pass skips
 * pixels under half a pixel of blur, so this is cheaper than the old
 * depth-proportional blur on every preset.
 */
export interface SubjectLens {
  aperture: number;
  maxblur: number;
  /** Thin-lens model (gate height, f-number): lensK from the camera's fov. */
  thinLens?: Readonly<{ fNumber: number; sensorHeight: number }>;
}
export const BROADCAST_LENS: SubjectLens = Object.freeze({
  aperture: 0,
  maxblur: 0.004,
  thinLens: Object.freeze({ fNumber: 4, sensorHeight: 0.0054 }),
});
export function subjectLens(
  menu: boolean,
  photo: boolean,
  camera: string,
  fov: number,
): SubjectLens | null {
  if (photo) return null;
  if (menu) return SHOWROOM;
  return camera === 'trackside' && fov < TELEPHOTO.dofBelow ? BROADCAST_LENS : null;
}

/** Focus the pass on `subject` (optical-axis depth, as the depth shader sees it). */
export function focusOnSubject(
  pass: DepthOfFieldPass,
  camera: T.PerspectiveCamera,
  subject: T.Vector3,
  lens: SubjectLens,
  scratch: T.Vector3,
) {
  camera.updateMatrixWorld();
  const uniforms = pass.materialBokeh.uniforms;
  const depth = -scratch.copy(subject).applyMatrix4(camera.matrixWorldInverse).z;
  uniforms.aperture.value = lens.aperture;
  uniforms.maxblur.value = lens.maxblur;
  if (lens.thinLens) {
    if (!uniforms.lensK) throw new Error('Thin-lens subject focus needs a thin-lens pass');
    const focus = Math.max(REPLAY_LENS.minFocus, depth);
    uniforms.focus.value = focus;
    uniforms.lensK.value = thinLensScale(
      camera.fov,
      focus,
      lens.thinLens.fNumber,
      lens.thinLens.sensorHeight,
    );
  } else uniforms.focus.value = depth;
  pass.enabled = true;
}
