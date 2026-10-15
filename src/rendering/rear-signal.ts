import * as T from 'three';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../simulation/protocol.ts';

/** Preserve the existing original rear-signal behaviour, shared by the visible
 * lamp and its near-spray tint. Simulation time is the only phase source. */
export function rearSignalIntensity(brake: number, time: number) {
  if (![brake, time].every(Number.isFinite)) return 0;
  return brake > 0.1 ? 2.5 : Math.sin(time * 12) > 0 ? 1.4 : 0.1;
}

/** Radiance gain of the visible rain lights (not their spray tint). ULTRA's
 * energy-conserving bloom only redistributes a few per cent of a pixel, so the
 * lamp carries a physical LED radiance there and its own glare draws the glow;
 * the threshold bloom presets keep 1. Set by the renderer per frame. */
export const REAR_LAMP = { gain: 1 };
export const REAR_LAMP_PHYSICAL_GAIN = 6;
/** Emissive intensity of a car's visible rain light. */
export function rearLampIntensity(brake: number, time: number) {
  return rearSignalIntensity(brake, time) * REAR_LAMP.gain;
}

/** All supported cars fit in a fixed twelve-source uniform array. Keeping their
 * identities stable avoids nearest-light switching/pop at a pack boundary.
 * This is bounded, unshadowed single-scatter tint, not a volumetric light solver. */
export class RearSignalField {
  readonly positions = Array.from({ length: 12 }, () => new T.Vector4());
  readonly directions = Array.from({ length: 12 }, () => new T.Vector3(0, 0, -1));
  readonly count = { value: 0 };
  private q = new T.Quaternion();
  private p = new T.Vector3();
  update(frame: Float32Array, enabled = true) {
    this.count.value = 0;
    const cars = frame[H.CARS];
    if (!enabled) return;
    if (
      !Number.isInteger(cars) ||
      cars < 0 ||
      cars > 12 ||
      frame.length < HEADER + CAR_STRIDE * cars ||
      !Number.isFinite(frame[H.TIME])
    )
      throw new Error('Invalid rear-signal frame');
    for (let id = 0; id < cars; id++) {
      const o = carBase(id);
      const x = frame[o + F.X],
        y = frame[o + F.Y],
        z = frame[o + F.Z],
        qx = frame[o + F.QX],
        qy = frame[o + F.QY],
        qz = frame[o + F.QZ],
        qw = frame[o + F.QW],
        brake = frame[o + F.BRAKE];
      // No per-car array per frame: the pose is checked field by field.
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z) ||
        !Number.isFinite(qx) ||
        !Number.isFinite(qy) ||
        !Number.isFinite(qz) ||
        !Number.isFinite(qw) ||
        !Number.isFinite(brake)
      )
        throw new Error('Non-finite rear-signal pose');
      this.q.set(qx, qy, qz, qw);
      if (Math.abs(this.q.lengthSq() - 1) > 0.02)
        throw new Error('Invalid rear-signal orientation');
      this.q.normalize();
      this.p.set(0, -0.23, -2.28).applyQuaternion(this.q);
      this.positions[id].set(
        x + this.p.x,
        y + this.p.y,
        z + this.p.z,
        rearSignalIntensity(brake, frame[H.TIME]),
      );
      this.directions[id].set(0, 0, -1).applyQuaternion(this.q);
    }
    this.count.value = cars;
  }
}
