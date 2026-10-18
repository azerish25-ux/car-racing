import { clamp } from '../../core/math.ts';
import { FESTIVAL_SKILLS } from './skill-chain.ts';

export interface DriftCue {
  action: 'build' | 'hold' | 'recover';
  angleDegrees: number;
  side: 'left' | 'right';
  /** Marker on a 0..90 degree gauge. */
  marker: number;
  scoring: boolean;
}
/** Uses chassis motion and the SAME admission limits as the skill chain.
 * The advisory never awards points, claims countersteer input was correct,
 * or calls wheelspin at rest a drift. The session controls road/assist gating. */
export function driftFeedback(
  lateral: number,
  forward: number,
  grounded: boolean,
): DriftCue | null {
  if (!Number.isFinite(lateral) || !Number.isFinite(forward) || !grounded || forward <= 3)
    return null;
  const speed = Math.hypot(lateral, forward),
    angle = Math.atan2(Math.abs(lateral), forward);
  if (speed < FESTIVAL_SKILLS.minDriftSpeed || angle < FESTIVAL_SKILLS.minDriftAngle * 0.7)
    return null;
  return {
    action: angle < FESTIVAL_SKILLS.minDriftAngle ? 'build' : angle > 0.88 ? 'recover' : 'hold',
    angleDegrees: (angle * 180) / Math.PI,
    side: lateral >= 0 ? 'left' : 'right',
    marker: clamp(angle / (Math.PI / 2), 0, 1),
    scoring: angle >= FESTIVAL_SKILLS.minDriftAngle && angle <= FESTIVAL_SKILLS.maxDriftAngle,
  };
}
