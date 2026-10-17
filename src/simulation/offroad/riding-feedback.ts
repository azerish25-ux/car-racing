import { clamp } from '../../core/math.ts';
import type { OffroadBikeSpec } from './types.ts';

/** The adapter's existing landing rules, shared with explanatory UI. These
 * are game calibration values in SI units, not measurements from screenshots. */
export const LANDING_RULES = Object.freeze({
  rollingHopSpeed: 6.5,
  minimumAirTime: 0.12,
  noseDownNormalSpeed: 1.5,
  noseUpNormalSpeed: 2,
  roughTolerance: 1.5,
  bottomedShaftSpeed: 0.05,
  settleSeconds: 0.25,
});

export interface MotocrossLandingFeedback {
  kind: 'clean' | 'firm' | 'hard' | 'nose-low' | 'nose-high' | 'crash';
  label: string;
  cue: string;
  tone: 'good' | 'neutral' | 'warning';
}

const MX_LIMITS = Object.freeze({ noseDownLimit: 0.46, noseUpLimit: 0.62 });

/** Readable feedback from the existing snapshot channels. `bottomIntensity`
 * is O.BOTTOM (0..1, decaying), not the shaft speed that decides a bottom-out
 * crash. `crashed` must come from actual rider state; these presentation
 * grades never decide whether a rider falls. Call after a real flight, once
 * the adapter has published its touchdown, and refresh during the 0.25 s
 * suspension settlement so a later bottom-out replaces an early clean grade.
 * Pass the selected machine's limits to keep supermoto's tolerances correct. */
export function assessMotocrossLanding(
  pitchError: number,
  normalSpeed: number,
  bottomIntensity: number,
  crashed: boolean,
  spec: Pick<OffroadBikeSpec, 'noseDownLimit' | 'noseUpLimit'> = MX_LIMITS,
  rough = false,
): MotocrossLandingFeedback {
  if (crashed)
    return {
      kind: 'crash',
      label: 'RECOVER',
      cue: 'Reset your approach and match the slope before the next touchdown.',
      tone: 'warning',
    };
  // A partial/invalid replay packet must not be celebrated as a clean jump.
  if (![pitchError, normalSpeed, bottomIntensity].every(Number.isFinite))
    return {
      kind: 'firm',
      label: 'LANDING',
      cue: 'Hold a steady line as the suspension settles.',
      tone: 'neutral',
    };
  const normal = Math.max(0, normalSpeed),
    bottom = clamp(bottomIntensity, 0, 1),
    tolerance = rough ? LANDING_RULES.roughTolerance : 1;
  if (bottom > 0.35 || normal > 6)
    return {
      kind: 'hard',
      label: 'HARD LANDING',
      cue: 'Ease the approach speed and aim for the downslope.',
      tone: 'warning',
    };
  if (pitchError < -spec.noseDownLimit * tolerance * 0.55 && normal > 1.5)
    return {
      kind: 'nose-low',
      label: 'NOSE LOW',
      cue: 'A little throttle in the air raises the front wheel.',
      tone: 'warning',
    };
  if (pitchError > spec.noseUpLimit * tolerance * 0.65 && normal > 1.5)
    return {
      kind: 'nose-high',
      label: 'NOSE HIGH',
      cue: 'Tap a brake in the air to bring the front wheel down.',
      tone: 'warning',
    };
  if (bottom <= 0.06 && normal <= 3.6 && Math.abs(pitchError - 0.1) <= 0.24 * tolerance)
    return {
      kind: 'clean',
      label: 'CLEAN LANDING',
      cue: 'Carry the drive into the next section.',
      tone: 'good',
    };
  return {
    kind: 'firm',
    label: 'LANDED',
    cue: 'Match the landing slope for a smoother exit.',
    tone: 'neutral',
  };
}
