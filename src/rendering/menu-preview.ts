import { Track, trackPoint } from '../simulation/track.ts';
import { DEFAULT_SETUP, VEHICLE } from '../simulation/config.ts';
import { vehicleDefinition, vehicleIndex } from '../simulation/vehicles.ts';
import { B, BIKE_BASE, R, RACE_BASE } from '../simulation/protocol.ts';
import {
  F,
  H,
  W,
  HEADER,
  CAR_STRIDE,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';

/** Front-end showroom camera (D29, AB-B §4.2): a low 1.2 m eye, a 32 degree
 * lens and a slow orbit, the car framed right of the menu with the background
 * softly out of focus (the D09 depth-of-field pass, focused on the car). */
export const SHOWROOM = Object.freeze({
  height: 1.2,
  fov: 32,
  radius: 9.4,
  /** Orbit: base angle (rad, car frame), sway amplitude and rate (rad/s). */
  angle: 0.72,
  sway: 0.16,
  rate: 0.035,
  /** Aim this far left of the car (m, across the view) so it sits right of the menu. */
  shift: 1.35,
  /** Eye and aim heights above the road (m). */
  aim: 0.55,
  aperture: 0.0011,
  maxblur: 0.012,
});
/** The same three-quarter showroom composition scaled to a 2 m motorcycle. */
export const BIKE_SHOWROOM = Object.freeze({
  ...SHOWROOM,
  height: 1.12,
  fov: 34,
  radius: 4.8,
  shift: 0.76,
  aim: 0.72,
});

/** The preview car's origin above the road (FormulaCar hub anchor datum). */
export const MENU_CAR_DATUM = VEHICLE.restLength + VEHICLE.wheelRadius - 0.05;

/** Static menu presentation, not a simulated or award-eligible driving session.
 * Keep the track coordinate, world pose and wheel dimensions consistent: the
 * studio/HQ floor samples F.S, not the position of an unrelated grid-start cell.
 * A bike carries its static suspension loads; no pose advances race time,
 * consumes fuel, or invents a simulated contact-work sample. */
export function menuPreview(
  track: Track,
  distance = track.length - 32,
  machine = 'apx01',
): Float32Array {
  if (!Number.isFinite(distance)) throw new Error('Invalid menu preview position');
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  const definition = vehicleDefinition(machine),
    spec = definition.spec,
    bike = definition.bike;
  // Quantize the coordinate once, then derive world height from that same value.
  frame[o + F.S] = track.at(distance, trackPoint()).s;
  const p = track.at(frame[o + F.S], trackPoint()),
    yaw = Math.atan2(p.tx, p.tz);
  frame[H.CARS] = 1;
  frame[H.LENGTH] = track.length;
  frame[H.AMBIENT] = 24;
  frame[H.CLOUD] = 0.12;
  frame[o + F.X] = p.x;
  // FormulaCar's actual hub anchor is +0.05 m; the wheel extends down by
  // restLength + radius. Previously the preview was a further 19 mm too low.
  frame[o + F.Y] = p.y + (bike ? bike.cgHeight : spec.restLength + spec.wheelRadius - 0.05);
  frame[o + F.Z] = p.z;
  frame[o + F.QY] = Math.sin(yaw / 2);
  frame[o + F.QW] = Math.cos(yaw / 2);
  frame[o + F.GEAR] = 1;
  frame[o + F.RPM] = spec.idleRPM;
  frame[o + F.FUEL] = bike?.fuel ?? 24;
  frame[o + F.BATTERY] = Math.min(3.2e6, spec.maxBatteryJ);
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(definition.id);
  if (bike) {
    // Match BikeModel's static sprung datum. This is an explicit showroom pose,
    // not a driveable session, and does not synthesize any lap or contact work.
    const mass = spec.dryMass + bike.fuel;
    const frontLoad = (mass * 9.81 * bike.cgToRear) / spec.wheelbase;
    const rearLoad = (mass * 9.81 * bike.cgToFront) / spec.wheelbase;
    frame[o + BIKE_BASE + B.FORK] = frontLoad / bike.forkRate;
    frame[o + BIKE_BASE + B.SHOCK] = rearLoad / bike.shockRate;
    frame[o + BIKE_BASE + B.FRONT_LOAD] = frontLoad;
    frame[o + BIKE_BASE + B.REAR_LOAD] = rearLoad;
  }
  frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = frame[o + F.FLOOR_HEALTH] = 1;
  frame[o + F.COMPOUND] = 1;
  for (let i = 0; i < 4; i++) {
    const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
    frame[w + W.LENGTH] = spec.restLength;
    frame[w + W.RADIUS] = bike
      ? i < 2
        ? bike.frontWheelRadius
        : bike.rearWheelRadius
      : spec.wheelRadius;
    frame[w + W.PRESSURE] = i < 2 ? DEFAULT_SETUP.frontPressure : DEFAULT_SETUP.rearPressure;
  }
  return frame;
}

/** Editors freeze immediately. An Academy control or a real viewport resize
 * may request one invalidated frame; a generic editor action may not. Settings
 * ownership overrides both requests. The caller consumes the resize only after
 * a real submission, so GPU backpressure cannot discard a pending redraw. */
export function shouldDrawMenu(state: {
  covered: boolean;
  preview: boolean;
  invalidated: boolean;
  resizePending: boolean;
  settingsBusy: boolean;
}): boolean {
  return (
    !state.settingsBusy &&
    (!state.covered || (state.invalidated && (state.preview || state.resizePending)))
  );
}
