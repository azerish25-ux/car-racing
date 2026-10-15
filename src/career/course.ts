import { racingLineFor } from '../simulation/racing-line.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
import type { LicenceCourse, LicenceTest } from './licences.ts';
import type { CareerVehicle } from './registry.ts';

/** Fallback envelope when a machine publishes no AI capability numbers. */
const DEFAULT_ENVELOPE = { topSpeed: 60, lateralBase: 12 };
/** Gate and pace requirements as fractions of what the machine can do, so a
 * licence measures the skill, not which car the player owns. */
export const LICENCE_PACE = Object.freeze({
  /** Braking gate speed: share of the machine's straight-line ceiling. */
  gate: 0.45,
  /** Corner pace: share of the grip-limited speed at the corner's radius. */
  corner: 0.62,
  /** Wet lap pace: share of the ceiling, averaged over the lap. */
  wetLap: 0.3,
});
/** Where a licence test is measured on this venue, from its geometry:
 * the braking marker sits at the end of the longest straight, the corner
 * test uses the tightest named corner and the racing line the AI drives. */
export function licenceCourse(
  test: LicenceTest,
  track: Track,
  vehicle: Pick<CareerVehicle, 'ai'>,
): LicenceCourse {
  const envelope = vehicle.ai ?? DEFAULT_ENVELOPE,
    length = track.length,
    step = 5,
    n = Math.max(8, Math.floor(length / step)),
    p = trackPoint(),
    curvature = new Float64Array(n);
  for (let i = 0; i < n; i++) curvature[i] = Math.abs(track.at(i * step, p).curvature);
  // Longest run below a gentle curvature (radius > 400 m), wrapping the lap.
  let bestStart = 0,
    bestLength = 0;
  for (let i = 0; i < n; i++) {
    if (curvature[i] >= 1 / 400 || curvature[(i - 1 + n) % n] < 1 / 400) continue;
    let k = 0;
    while (k < n && curvature[(i + k) % n] < 1 / 400) k++;
    if (k > bestLength) {
      bestLength = k;
      bestStart = i;
    }
  }
  const runEnd = (bestStart + bestLength) * step;
  const marker = (runEnd - Math.min(60, bestLength * step * 0.2) + length) % length;
  const gate = (marker - Math.min(140, bestLength * step * 0.45) + length) % length;
  // The tightest named corner (sharpest point within 80 m of its label).
  const corners = track.circuit.corners.length
    ? track.circuit.corners
    : [{ s: length / 2, name: 'TURN 1' }];
  let corner = corners[0].s,
    cornerName = corners[0].name,
    sharpest = -1;
  for (const c of corners)
    for (let d = -80; d <= 80; d += step) {
      const k = Math.abs(track.at((c.s + d + length) % length, p).curvature);
      if (k > sharpest) {
        sharpest = k;
        corner = (c.s + d + length) % length;
        cornerName = c.name;
      }
    }
  const radius = 1 / Math.max(1e-4, sharpest);
  const line = racingLineFor(track);
  return {
    length,
    marker,
    gate,
    gateSpeed: envelope.topSpeed * LICENCE_PACE.gate,
    corner,
    window: 45,
    paceSpeed:
      test.id === 'wet'
        ? envelope.topSpeed * LICENCE_PACE.wetLap
        : Math.min(envelope.topSpeed, Math.sqrt(envelope.lateralBase * radius)) *
          LICENCE_PACE.corner,
    lineAt: (s) => line.offsetAt(s),
    landingPitch: 0,
    cornerName,
  };
}
