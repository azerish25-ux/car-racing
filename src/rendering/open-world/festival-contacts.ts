import * as T from 'three';
import {
  F,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';

/** Local contact before the venue conforms it to its road/terrain surface.
 * Four-wheel telemetry measures suspension length from a mounting point;
 * motorcycle definitions already give hub heights relative to the CG. */
export function festivalContactLocal(
  frame: Float32Array,
  car: number,
  wheel: number,
  target: T.Vector3,
) {
  const o = carBase(car),
    p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
  const definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
  const at = definition.wheelPositions[wheel];
  if (definition.dynamicsKind === 'bike' && definition.bike) {
    const bike = definition.bike;
    // The chassis leans about the tyre crown, then the crown radius reaches
    // vertically down to the road. Undo world-up in local coordinates so
    // leaning cannot shift the contact sideways by an extra wheel radius.
    const x = frame[o + F.QX],
      y = frame[o + F.QY],
      z = frame[o + F.QZ],
      w = frame[o + F.QW];
    target.set(
      -bike.crownRadius * 2 * (x * y + z * w),
      bike.crownRadius - bike.cgHeight - bike.crownRadius * (1 - 2 * (x * x + z * z)),
      at[2] - bike.crownRadius * 2 * (y * z - x * w),
    );
  } else {
    target.set(at[0], at[1] - frame[p + W.LENGTH] - frame[p + W.RADIUS], at[2]);
  }
  return target;
}

export function festivalContactEnabled(frame: Float32Array, car: number, wheel: number) {
  return (
    wheel % 2 === 0 ||
    vehicleAt(Math.round(frame[carBase(car) + RACE_BASE + R.VEHICLE])).dynamicsKind !== 'bike'
  );
}

export function festivalDiffuserEnabled(frame: Float32Array, car: number) {
  return vehicleAt(Math.round(frame[carBase(car) + RACE_BASE + R.VEHICLE])).dynamicsKind !== 'bike';
}

/** Adapt the local emitter to the real surface and return its world ground
 * offset, including road pitch/camber. Scratch state is owned by this venue. */
export function createFestivalContactOffset(height: (x: number, z: number, y?: number) => number) {
  const quaternion = new T.Quaternion();
  return (frame: Float32Array, car: number, wheel: number, plume: boolean, target: T.Vector3) => {
    const o = carBase(car);
    const diffuser = plume && festivalDiffuserEnabled(frame, car);
    festivalContactLocal(frame, car, wheel, target);
    if (diffuser) {
      target.x *= 0.2;
      target.z -= 0.65;
    }
    quaternion.fromArray(frame, o + F.QX);
    target.applyQuaternion(quaternion);
    // Supply the current contact layer before conforming its height, so a
    // tyre beneath a bridge cannot emit on the upper deck at the same X/Z.
    const floor =
      height(frame[o + F.X] + target.x, frame[o + F.Z] + target.z, frame[o + F.Y] + target.y) -
      frame[o + F.Y];
    target.y = floor + (diffuser ? 0.22 : 0.035);
    target.applyQuaternion(quaternion.invert());
    return floor;
  };
}
