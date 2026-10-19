import { clamp, mod } from '../core/math.ts';
import { GP_MAX_TOW_DRAG_REDUCTION } from '../simulation/bike-slipstream.ts';
import { FLAG, yellowFlag } from '../simulation/marshal.ts';
import { B, BIKE_BASE, F, H, R, RACE_BASE, carBase } from '../simulation/protocol.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
import { vehicleAt } from '../simulation/vehicles.ts';

export interface GPRidingCue {
  corner: string;
  direction: 'left' | 'right' | 'straight';
  distance: string;
  action: string;
  detail: string;
  tone: 'neutral' | 'brake' | 'flow' | 'caution';
  tow: number;
}

/** Recover the applied tow from the recorded drag, not the different dirty-air
 * WAKE channel. Project velocity along the bike heading to remove contact
 * slide: F.SPEED includes that slide but the longitudinal drag solver does not.
 * This is only a readout; it neither grants acceleration nor changes grip. */
export function gpTowFraction(frame: Float32Array) {
  const o = carBase(0),
    b = o + BIKE_BASE;
  if (frame.length <= b + B.STATE || frame[b + B.STATE] !== 0) return 0;
  const definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
  if (definition.classId !== 'gp-bike' || !definition.bike) return 0;
  const qx = frame[o + F.QX],
    qy = frame[o + F.QY],
    qz = frame[o + F.QZ],
    qw = frame[o + F.QW];
  const fx = 2 * (qx * qz + qw * qy),
    fz = 1 - 2 * (qx * qx + qy * qy);
  const length = Math.hypot(fx, fz);
  if (!Number.isFinite(length) || length < 0.2) return 0;
  const forwardSpeed = (frame[o + F.VX] * fx + frame[o + F.VZ] * fz) / length;
  const drag = frame[o + F.DRAG],
    tuck = frame[b + B.TUCK];
  if (![forwardSpeed, drag, tuck].every(Number.isFinite) || forwardSpeed < 20 || drag <= 0)
    return 0;
  const soloDrag =
    definition.bike.drag * forwardSpeed ** 2 * (1 - clamp(tuck, 0, 1) * definition.bike.tuckDrag);
  return clamp((1 - drag / soloDrag) / GP_MAX_TOW_DRAG_REDUCTION, 0, 1);
}

/** Compact road-riding advice from the presented snapshot and named apexes.
 * Corner distances are explicitly to the apex, never claimed braking points.
 * No ideal-speed estimate, AI command, hidden score or wall clock is involved;
 * pause and replay seek reproduce the same cue immediately. */
export class GPRidingCues {
  private readonly road = trackPoint();
  private readonly apex = trackPoint();

  read(frame: Float32Array, track: Track): GPRidingCue | null {
    const o = carBase(0),
      b = o + BIKE_BASE;
    if (frame.length <= b + B.INTERVENTION || frame[H.CARS] < 1 || frame[H.PHASE] !== 2)
      return null;
    const definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
    if (
      definition.classId !== 'gp-bike' ||
      frame[o + F.RETIRED] ||
      frame[o + F.FINISH] ||
      frame[o + F.IN_PIT] ||
      frame[b + B.STATE] !== 0
    )
      return null;
    const station = frame[o + F.S],
      speed = frame[o + F.SPEED],
      lateral = frame[o + F.LATERAL],
      lean = Math.abs(frame[b + B.LEAN]),
      brake = frame[o + F.BRAKE];
    if (![station, speed, lateral, lean, brake].every(Number.isFinite) || speed < 4) return null;
    track.at(station, this.road);
    const forward = frame[o + F.VX] * this.road.tx + frame[o + F.VZ] * this.road.tz;
    if (!Number.isFinite(forward) || forward < 2 || Math.abs(lateral) > this.road.width + 0.3)
      return null;

    let cornerIndex = -1,
      distance = Infinity;
    // Retain the apex for the first 24 m of its exit, then show the next turn.
    // This signed wrapped distance works across the start/finish line as well.
    for (let i = 0; i < track.circuit.corners.length; i++) {
      const d = mod(track.circuit.corners[i].s - station + 24, track.length) - 24;
      if (d < distance) {
        cornerIndex = i;
        distance = d;
      }
    }
    const close = cornerIndex >= 0 && distance < clamp(speed * 5 + 50, 180, 450);
    const cue: GPRidingCue = {
      corner: 'STRAIGHT',
      direction: 'straight',
      distance: '',
      action: 'BUILD YOUR RUN',
      detail: 'Build speed with smooth inputs',
      tone: 'neutral',
      tow: gpTowFraction(frame),
    };
    if (close) {
      const corner = track.circuit.corners[cornerIndex];
      track.at(corner.s, this.apex);
      cue.corner = `T${cornerIndex + 1} · ${corner.name}`;
      cue.direction = this.apex.curvature >= 0 ? 'left' : 'right';
      cue.distance = distance < 0 ? 'EXIT' : `${Math.round(distance / 5) * 5} M TO APEX`;
      cue.action = 'LOOK THROUGH THE TURN';
      cue.detail = 'Set your entry speed';
      if (distance < 0) {
        cue.action = 'CORNER EXIT';
        cue.detail = 'Pick up the bike · feed in power';
        cue.tone = 'flow';
      } else if (brake > 0.12) {
        cue.action = lean > 0.22 ? 'TRAIL BRAKING' : 'BRAKING';
        cue.detail = lean > 0.22 ? 'Ease the brake as lean builds' : 'Set speed before turn-in';
        cue.tone = 'brake';
      } else if (lean > 0.35 && distance < Math.max(65, speed * 1.5)) {
        cue.action = 'HOLD YOUR LINE';
        cue.detail = 'Keep the throttle smooth';
        cue.tone = 'flow';
      }
    } else if (cue.tow > 0.08 && brake < 0.12 && lean < 0.35) {
      cue.action = 'SLIPSTREAM';
      cue.detail =
        frame[b + B.TUCK] < 0.65
          ? 'Hold a steady line · build the run'
          : 'Tow active · plan your pass';
      cue.tone = 'flow';
    }
    if (yellowFlag(frame[o + F.LOCAL_FLAG]) || frame[H.SC_PHASE] > 0) {
      cue.action = 'CAUTION';
      cue.detail = 'Slow down · hold position';
      cue.tone = 'caution';
      cue.tow = 0;
    } else if (frame[o + F.LOCAL_FLAG] === FLAG.BLUE) {
      cue.action = 'BLUE FLAG';
      cue.detail = 'Let the faster rider through';
      cue.tone = 'caution';
      cue.tow = 0;
    }
    return cue;
  }
}
