import { clamp } from '../core/math.ts';

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
