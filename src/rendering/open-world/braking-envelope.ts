import { clamp } from '../../core/math.ts';

/** Advisory road ribbon, not a vehicle-specific optimum or an AI control.
 * Backward v² integration warns before a bend rather than inside it.
 * Wetness is normalized to [0,1]; malformed samples fail conservatively. */
export function brakingEnvelope(
  curvature: ArrayLike<number>,
  count: number,
  spacing: number,
  wetness: number,
  output: Float64Array,
): void {
  const wet = Number.isFinite(wetness) ? clamp(wetness, 0, 1) : 1;
  const lateral = 7.2 - wet * 3.4,
    deceleration = 6.5 - wet * 3.1;
  const step = Number.isFinite(spacing) ? clamp(spacing, 0.1, 30) : 5;
  const n = Math.min(curvature.length, output.length, Math.max(0, Math.floor(count)));
  let nextSquared = 110 * 110;
  for (let i = n - 1; i >= 0; i--) {
    const k = Number.isFinite(curvature[i]) ? Math.abs(curvature[i]) : 1;
    const curveSquared = Math.min(110 * 110, lateral / Math.max(0.0001, k));
    const allowed = Math.min(curveSquared, nextSquared + 2 * deceleration * step);
    output[i] = Math.sqrt(allowed);
    nextSquared = allowed;
  }
}
