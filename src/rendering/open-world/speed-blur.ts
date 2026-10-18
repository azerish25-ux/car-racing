import * as T from 'three';
import { F, H, carBase } from '../../simulation/protocol.ts';
import { MotionBlur } from '../motion-blur.ts';

/** Festival speed sensation, measured from the reference chase and pass-by
 * frames (FH6 ref 001/024/041/042/053): the followed car stays sharp while
 * road and verge streak radially from the vanishing point, about 2-4 % of
 * the frame width at the edges at 60-110 km/h and longer at the screen
 * bottom. It reuses the depth-reprojected camera blur gathered inside the
 * scene pass composite (no re-render, no extra draw), with a festival
 * shutter and streak bound; the circuit renderer's own settings are left as
 * they were. */
export const FESTIVAL_BLUR = Object.freeze({
  /** Shutter = settings strength x (1/60 s) x this. */
  shutterScale: 2.4,
  /** Longest streak as a fraction of the render width. */
  maxWidth: 0.06,
  /** Below this speed (m/s) the frame stays still; full shutter by `full`. */
  start: 4,
  full: 22,
});

/** Builds the followed car's chassis matrix from the presented snapshot and
 * hands the festival camera to the shared velocity field. */
export class FestivalSpeedBlur {
  readonly motion: MotionBlur;
  private readonly carNow = [new T.Matrix4()];
  private readonly poses = [new T.Vector4()];
  private readonly position = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private readonly unit = new T.Vector3(1, 1, 1);
  constructor(supported: boolean) {
    this.motion = new MotionBlur(supported);
  }
  /** `strength` is the graphics shutter setting (0 disables), `live` is false
   * in photo mode; `groundY` is the road height under the followed car and
   * `width` the scene pass width in pixels. */
  prepare(
    presented: Float32Array,
    camera: T.Camera,
    groundY: number,
    strength: number,
    live: boolean,
    width: number,
  ) {
    const o = carBase(0),
      speed = Math.abs(presented[o + F.SPEED]);
    const ramp = Math.min(
      1,
      Math.max(0, (speed - FESTIVAL_BLUR.start) / (FESTIVAL_BLUR.full - FESTIVAL_BLUR.start)),
    );
    const motion = this.motion;
    motion.setStrength(strength, live);
    // The scene pass's TAA reads `live` for its jitter. Before this blur was
    // attached it always treated festival frames as live; keep that.
    motion.live = true;
    if (!motion.enabled || presented[H.CARS] < 1 || ramp <= 0) {
      motion.field.still();
      return;
    }
    this.position.set(presented[o + F.X], presented[o + F.Y], presented[o + F.Z]);
    this.quaternion.set(
      presented[o + F.QX],
      presented[o + F.QY],
      presented[o + F.QZ],
      presented[o + F.QW],
    );
    this.carNow[0].compose(this.position, this.quaternion, this.unit);
    this.poses[0].set(this.position.x, this.position.z, 0, groundY);
    const shutter = (Math.min(0.6, strength) / 60) * FESTIVAL_BLUR.shutterScale * ramp;
    motion.field.update(presented, camera, 0, 'attached', shutter, this.carNow, this.poses, 1);
    motion.uniforms.motionMaxPixels.value = FESTIVAL_BLUR.maxWidth * Math.max(1, width);
  }
  dispose() {
    this.motion.dispose();
  }
}
