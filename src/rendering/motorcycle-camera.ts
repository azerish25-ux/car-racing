import { angleDifference, clamp, smooth } from '../core/math.ts';
import { trackPoint, type Track } from '../simulation/track.ts';

/** GP chase looks down the approaching road before the rider begins to lean.
 * The pitch follows road grade rather than fork dive or a wheelie. Bounded
 * anticipation leaves the rider centered and releases if riding off-line or
 * backwards. Reusable samples keep the camera path allocation-free. */
export class MotorcycleRoadPreview {
  private readonly here = trackPoint();
  private readonly ahead = trackPoint();
  private readonly view = { yaw: 0, pitch: 0 };

  read(
    track: Track,
    station: number,
    lateral: number,
    speed: number,
    heading: number,
    reducedMotion = false,
  ) {
    if (
      !Number.isFinite(station) ||
      !Number.isFinite(lateral) ||
      !Number.isFinite(speed) ||
      !Number.isFinite(heading)
    )
      return null;
    track.at(station, this.here);
    if (
      Math.abs(lateral) > this.here.width + 0.3 ||
      speed < 4 ||
      Math.cos(angleDifference(Math.atan2(this.here.tx, this.here.tz), heading)) < 0.65
    )
      return null;
    const reach = clamp(12 + speed * 0.3, 14, 40);
    track.at(station + reach, this.ahead);
    this.view.yaw = reducedMotion
      ? 0
      : clamp(angleDifference(Math.atan2(this.ahead.tx, this.ahead.tz), heading), -0.14, 0.14) *
        smooth(4, 16, speed);
    this.view.pitch = clamp(
      Math.atan(this.here.gradient) * 0.75 + Math.atan(this.ahead.gradient) * 0.25,
      -0.24,
      0.24,
    );
    return this.view;
  }
}

/** Rider-scale chase composition. Distances are relative to the bike's CG,
 * not the Formula car's longer body. The modest look into a bend is derived
 * from the recorded lean and speed, so seeking/holding a replay is reversible.
 * REF 013/055/074/077/089: retain the rider, useful road and apex together. */
export function motorcycleChase(speed: number, brake: number, lean: number, reducedMotion = false) {
  const v = Number.isFinite(speed) ? clamp(Math.abs(speed), 0, 110) : 0;
  const braking = Number.isFinite(brake) ? clamp(brake, 0, 1) : 0;
  const angle = Number.isFinite(lean) ? clamp(lean, -1.12, 1.12) : 0;
  return {
    height: 0.88 + (reducedMotion ? 0 : 0.08 * braking),
    heightPerMS: reducedMotion ? 0 : 0.0008,
    distance: 3.2,
    distancePerMS: reducedMotion ? 0 : 0.0025,
    lookAhead: 9.5 + Math.min(4.5, v * 0.065),
    lookLift: 0.06,
    fov: 51,
    fovGain: reducedMotion ? 0 : 4,
    // Preview ~0.22 s of the steady-turn angular rate; cap at 6.3 degrees.
    // Below walking speed there is no corner anticipation from a static lean.
    yaw: reducedMotion
      ? 0
      : clamp((9.81 * Math.tan(angle) * 0.22) / Math.max(12, v), -0.11, 0.11) * Math.min(1, v / 8),
  };
}
