import { clamp } from '../../core/math.ts';

export interface PaceCue {
  direction: 'left' | 'right';
  severity: 'bend' | 'tight' | 'hairpin';
  distance: number;
  /** Advisory corner speed and braking envelope at the driver's reaction point, m/s. */
  targetSpeed: number;
  allowedSpeed: number;
  action: 'prepare' | 'lift' | 'brake';
  loose: boolean;
  wet: boolean;
}

/** Original, conservative route-reading aid. It does not drive the car,
 * score events, assume a vehicle's tyre model, or claim an optimal lap.
 * Integrates v² backwards through sampled grip/grade, then reads ahead by
 * 0.7 seconds for the driver cue. Positive path curvature means LEFT. */
export function paceEnvelope(
  curvature: ArrayLike<number>,
  grip: ArrayLike<number>,
  height: ArrayLike<number>,
  count: number,
  spacing: number,
  wetness: number,
  speed: number,
  output: Float64Array,
): PaceCue | null {
  const n = Number.isFinite(count)
    ? Math.min(
        curvature.length,
        grip.length,
        height.length,
        output.length,
        Math.max(0, Math.floor(count)),
      )
    : 0;
  const step = Number.isFinite(spacing) ? clamp(spacing, 0.1, 30) : 5;
  const wet = Number.isFinite(wetness) ? clamp(wetness, 0, 1) : 1;
  output.fill(0);
  let nextSquared = 110 ** 2;
  for (let i = n - 1; i >= 0; i--) {
    const k = Number.isFinite(curvature[i]) ? Math.abs(curvature[i]) : 1;
    const surface = Number.isFinite(grip[i]) ? clamp(grip[i] / 0.92, 0.3, 1.03) : 0.3;
    const grade =
      i + 1 < n
        ? Number.isFinite(height[i]) && Number.isFinite(height[i + 1])
          ? clamp((height[i + 1] - height[i]) / step, -0.18, 0.18)
          : -0.18
        : 0;
    const lateral = (7.2 - wet * 3.4) * surface;
    // Downhill reduces net deceleration. Do not award optimistic uphill credit.
    const braking = Math.max(1.2, (6.5 - wet * 3.1) * surface + 9.81 * Math.min(0, grade));
    const squared = Math.min(
      110 ** 2,
      lateral / Math.max(0.0001, k),
      nextSquared + 2 * braking * step,
    );
    output[i] = Math.sqrt(squared);
    nextSquared = squared;
  }
  if (n < 2 || !Number.isFinite(speed) || speed < -1) return null;
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(curvature[i]) && Math.abs(curvature[i]) >= 1 / 140) {
      first = i;
      break;
    }
  }
  if (first < 0) return null;
  let apex = first;
  const direction = Math.sign(curvature[first]);
  // Describe the next bend, not a stronger unrelated bend beyond it.
  for (let i = first + 1; i < n && (i - first) * step <= 85; i++) {
    const k = curvature[i];
    if (
      !Number.isFinite(k) ||
      Math.sign(k) !== direction ||
      Math.abs(k) < Math.abs(curvature[apex]) * 0.5
    )
      break;
    if (Math.abs(k) > Math.abs(curvature[apex])) apex = i;
  }
  const reaction = clamp((Math.max(0, speed) * 0.7) / step, 0, n - 1);
  const lo = Math.floor(reaction),
    hi = Math.min(n - 1, lo + 1);
  const allowedSpeed = output[lo] + (output[hi] - output[lo]) * (reaction - lo);
  const ratio = Math.max(0, speed) / Math.max(1, allowedSpeed);
  const k = Math.abs(curvature[apex]);
  return {
    direction: direction > 0 ? 'left' : 'right',
    severity: k >= 1 / 42 ? 'hairpin' : k >= 1 / 75 ? 'tight' : 'bend',
    distance: 7 + apex * step,
    targetSpeed: output[apex],
    allowedSpeed,
    action: ratio > 1.08 ? 'brake' : ratio > 0.94 ? 'lift' : 'prepare',
    loose: grip[apex] < 0.8,
    wet: wet > 0.25,
  };
}
