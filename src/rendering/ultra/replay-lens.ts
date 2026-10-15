import * as T from 'three';
import { DepthOfFieldPass } from '../studio/dof-pass.ts';

/**
 * Physically based replay lens (ULTRA `replayDof`).
 *
 * A thin lens of focal length f = h / (2 tan(fov / 2)) on a Super 35 16:9 gate
 * (h = 14 mm) at a fixed f-number. The signed circle of confusion of a point at
 * depth d with focus distance s is
 *
 *   c(d) = (f / N) · f / (s − f) · (1 − s / d)            (metres on the sensor)
 *
 * and the gather radius is c / h of the screen height. Background blur tends to
 * K = f² / (N (s − f) h) at infinity, so a wide chase lens stays almost sharp and
 * a trackside telephoto separates the subject, as a real camera does. The radius
 * is capped (`maxBlur`) so a held shot never reads as a miniature (QA note in
 * trackside.ts TELEPHOTO). Used only for recorded playback on live broadcast or
 * chase views, never in photo mode (its own lens) or when another depth of
 * field already owns the frame.
 */
export const REPLAY_LENS = Object.freeze({
  /** Sensor gate height, metres (Super 35, 16:9). */
  sensorHeight: 0.014,
  fNumber: 2.8,
  /** Largest circle of confusion as a fraction of the screen height. */
  maxBlur: 0.0065,
  /** Bokeh gather taps (ULTRA). */
  taps: 48,
  /** Nearest focus distance, metres. */
  minFocus: 1.5,
});

/** Focal length (metres) of a lens with this vertical field of view on the gate. */
export function focalLength(fovDegrees: number, sensorHeight: number = REPLAY_LENS.sensorHeight) {
  if (!(fovDegrees > 0 && fovDegrees < 179) || !(sensorHeight > 0)) throw new Error('Invalid lens');
  return sensorHeight / (2 * Math.tan((fovDegrees * Math.PI) / 360));
}
/** K of c(d) = K (1 − s/d), in screen-height units. */
export function thinLensScale(
  fovDegrees: number,
  focus: number,
  fNumber: number = REPLAY_LENS.fNumber,
  sensorHeight: number = REPLAY_LENS.sensorHeight,
) {
  const f = focalLength(fovDegrees, sensorHeight);
  if (!(fNumber > 0) || !(focus > f)) throw new Error('Invalid focus distance');
  return (f * f) / (fNumber * (focus - f) * sensorHeight);
}
/** Signed thin-lens circle of confusion (screen-height units) at `depth`. */
export function circleOfConfusion(
  depth: number,
  focus: number,
  k: number,
  maxBlur: number = REPLAY_LENS.maxBlur,
) {
  const c = k * (1 - focus / Math.max(depth, 1e-3));
  return Math.min(maxBlur, Math.max(-maxBlur, c));
}

export class ReplayLens {
  readonly pass: DepthOfFieldPass;
  frames = 0;
  private readonly scratch = new T.Vector3();
  constructor(
    private readonly camera: T.PerspectiveCamera,
    depth: T.DepthTexture,
  ) {
    this.pass = new DepthOfFieldPass(
      camera,
      { focus: 10, aperture: 0, maxblur: REPLAY_LENS.maxBlur },
      depth,
      {
        taps: REPLAY_LENS.taps,
        thinLens: true,
      },
    );
    this.pass.enabled = false;
  }
  /** Focus on `subject` (optical-axis depth) for this frame, or disable. */
  update(active: boolean, subject: T.Vector3) {
    if (!active) {
      this.pass.enabled = false;
      return false;
    }
    this.camera.updateMatrixWorld();
    const depth = -this.scratch.copy(subject).applyMatrix4(this.camera.matrixWorldInverse).z;
    const focus = Math.max(REPLAY_LENS.minFocus, depth);
    const u = this.pass.materialBokeh.uniforms;
    u.focus.value = focus;
    u.lensK.value = thinLensScale(this.camera.fov, focus);
    u.maxblur.value = REPLAY_LENS.maxBlur;
    this.pass.enabled = true;
    this.frames++;
    return true;
  }
  diagnostics() {
    const u = this.pass.materialBokeh.uniforms;
    return {
      enabled: this.pass.enabled,
      focus: u.focus.value as number,
      backgroundBlur: u.lensK.value as number,
      fNumber: REPLAY_LENS.fNumber,
      taps: REPLAY_LENS.taps,
      frames: this.frames,
      extraDraws: this.pass.enabled ? 1 : 0,
    };
  }
  dispose() {
    this.pass.dispose();
  }
}
