import * as T from 'three';
import {
  B,
  BIKE_BASE,
  F,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { SPRAY_PLUME, tireSmokeSliding } from './effects.ts';
import { GpTyreContactProjector } from './gp-tyre-contacts.ts';
import { SPRAY_PROFILE } from './spray-clouds.ts';

/** Contact effects start just above the recovered road, inside the tyre's
 * compact footprint. REF 010/036/038/096 keep wet tyres and the road readable;
 * they do not specify numerical particle velocities or water emission rates. */
export const GP_CONTACT_CLEARANCE = 0.035;

// All projector inputs, including discrete state. Comparing the values rather
// than only H.TIME or Float32Array identity handles held-frame edits, replay
// seeks and EffectPlayback's reused interpolation buffer without stale contacts.
const POSE_FIELDS = [
  F.X,
  F.Y,
  F.Z,
  F.QX,
  F.QY,
  F.QZ,
  F.QW,
  F.IN_PIT,
  F.JACK_HEIGHT,
  RACE_BASE + R.VEHICLE,
  BIKE_BASE + B.LEAN,
  BIKE_BASE + B.PITCH,
  BIKE_BASE + B.STATE,
  BIKE_BASE + B.RIDER_OFFSET,
] as const;

/** GP-only adapter for the circuit's existing bounded Effects pool. A snapshot
 * duplicates the front/rear wheel channels into 0/1 and 2/3 for car consumers;
 * that must not create four tyre plumes. The same crown projection drives the
 * indirect ground contact, so spray stays with the visible tyre through lean.
 * No model traversal, ground query, random draws or GPU resources are added.
 * Non-GP entrants retain the circuit's existing emitters byte for byte. */
export class GpContactEffects {
  private readonly projector = new GpTyreContactProjector();
  private readonly position = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private readonly inverse = new T.Quaternion();
  private readonly forward = new T.Vector3();
  private readonly front = new T.Vector4();
  private readonly rear = new T.Vector4();
  private readonly shape = new T.Vector4();
  private readonly values = new Float64Array(POSE_FIELDS.length).fill(NaN);
  private car = -1;

  private project(frame: Float32Array, id: number) {
    const o = carBase(id),
      definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
    if (definition.classId !== 'gp-bike' || !definition.bike) return false;
    let changed = this.car !== id;
    for (let i = 0; i < POSE_FIELDS.length; i++) {
      const value = frame[o + POSE_FIELDS[i]];
      if (value !== this.values[i]) changed = true;
      this.values[i] = value;
    }
    if (changed) {
      this.car = id;
      this.position.fromArray(frame, o + F.X);
      this.quaternion.fromArray(frame, o + F.QX).normalize();
      this.inverse.copy(this.quaternion).invert();
      this.forward.set(0, 0, 1).applyQuaternion(this.quaternion);
      this.projector.project(
        frame,
        o,
        definition,
        this.position,
        this.quaternion,
        Math.atan2(this.forward.x, this.forward.z),
        this.front,
        this.rear,
        this.shape,
      );
    }
    return true;
  }

  readonly contactEnabled = (frame: Float32Array, id: number, wheel: number) => {
    if (!this.project(frame, id)) return true;
    if (wheel !== 0 && wheel !== 2) return false;
    const o = carBase(id),
      contact = wheel === 0 ? this.front : this.rear;
    // Force can remain in a published wheel channel during a fall or a wheel
    // lift. Contact geometry and rider state both gate new ground emissions.
    return (
      frame[o + BIKE_BASE + B.STATE] === 0 &&
      contact.w > 0.98 &&
      frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD] > 1
    );
  };

  readonly diffuserEnabled = (frame: Float32Array, id: number) => {
    const definition = vehicleAt(Math.round(frame[carBase(id) + RACE_BASE + R.VEHICLE]));
    return definition.classId !== 'gp-bike' || !definition.bike;
  };

  readonly sprayProfile = (frame: Float32Array, id: number) => {
    const definition = vehicleAt(Math.round(frame[carBase(id) + RACE_BASE + R.VEHICLE]));
    return definition.classId === 'gp-bike' && definition.bike
      ? SPRAY_PROFILE.GP
      : SPRAY_PROFILE.DEFAULT;
  };

  readonly smokeSliding = (frame: Float32Array, id: number, wheel: number) => {
    const o = carBase(id),
      p = o + WHEEL_BASE + wheel * WHEEL_STRIDE,
      definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
    // BikeVehicle writes handlebar steer into the old front W.ANGLE slot.
    // It is not tyre sideslip. The rear W.SLIP channel is a clipped demand/
    // slip proxy, not measured angular wheelspin; keep that existing signal
    // and its work threshold, but never treat front steering as sliding.
    return tireSmokeSliding(
      frame[p + W.SLIP],
      definition.classId === 'gp-bike' && definition.bike ? 0 : frame[p + W.ANGLE],
    );
  };

  readonly contactOffset = (
    frame: Float32Array,
    id: number,
    wheel: number,
    plume: boolean,
    target: T.Vector3,
  ) => {
    if (!this.project(frame, id)) {
      // Exactly the existing circuit defaults, including the diffuser height
      // and lateral position. This GP correction does not retune other modes.
      target.set(
        plume ? (wheel % 2 === 0 ? -0.18 : 0.18) : wheel % 2 === 0 ? -0.83 : 0.83,
        plume ? -0.12 : -0.37,
        plume ? SPRAY_PLUME.offset : wheel < 2 ? 1.82 : -1.62,
      );
      return -0.37;
    }
    const contact = wheel < 2 ? this.front : this.rear;
    // Effects applies the chassis quaternion after this callback. Convert the
    // projected world contact back to that local frame; do not subtract fork
    // travel or a full wheel radius from an already crown-corrected contact.
    target
      .set(
        contact.x - this.position.x,
        contact.z + GP_CONTACT_CLEARANCE - this.position.y,
        contact.y - this.position.z,
      )
      .applyQuaternion(this.inverse);
    return contact.z - this.position.y;
  };
}
