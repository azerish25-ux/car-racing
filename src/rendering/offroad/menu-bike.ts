import { menuPreview } from '../menu-preview.ts';
import { staticSag } from '../bike.ts';
import {
  F,
  R,
  RACE_BASE,
  B,
  BIKE_BASE,
  O,
  OFFROAD_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { VEHICLES, vehicleIndex } from '../../simulation/vehicles.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';

/** A static, unscored showroom pose of the chosen motocross machine. The
 * authored wheel radii and sag feed the same rig used by the actual race. */
export function motocrossMenuPreview(track: Track, machine: string) {
  const definition = VEHICLES[machine];
  if (definition?.classId !== 'motocross' || !definition.bike)
    throw new Error('A motocross showroom requires a motocross machine');
  const frame = menuPreview(track);
  const o = carBase(0),
    bike = definition.bike,
    sag = staticSag(definition);
  const p = track.at(frame[o + F.S], trackPoint());
  frame[o + F.Y] = p.y + bike.cgHeight;
  frame[o + F.RPM] = definition.spec.idleRPM;
  frame[o + F.FUEL] = bike.fuel;
  frame[o + F.BATTERY] = 0;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(machine);
  frame[o + BIKE_BASE + B.FORK] = sag.fork;
  frame[o + BIKE_BASE + B.SHOCK] = sag.shock;
  frame[o + OFFROAD_BASE + O.STANDING] = 0.05;
  for (let i = 0; i < 4; i++) {
    const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
    frame[w + W.RADIUS] = i < 2 ? bike.frontWheelRadius : bike.rearWheelRadius;
    frame[w + W.LENGTH] = definition.spec.restLength - (i < 2 ? sag.fork : sag.shock);
  }
  return frame;
}
