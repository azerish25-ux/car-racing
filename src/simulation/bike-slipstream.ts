import { clamp } from '../core/math.ts';

/** The GP tow applies to tyre-level longitudinal dynamics, not only the
 * display of drag in a race snapshot. wakeFields() has already bounded the
 * leading machine's speed, heading, separation and lateral overlap. Keep the
 * rider's tuck and another bike's wake multiplicative: both reduce the same
 * drag force, and neither changes tyre grip or brake authority.
 *
 * 18% is the full-overlap upper bound, not a constant race-wide boost.
 * REF 003/006/019/053/058/079/080/089/090/094/099: closing in a pack,
 * then leaving the narrow drafting lane to pass. */
export const GP_MAX_TOW_DRAG_REDUCTION = 0.18;

export function bikeSlipstreamDragScale(tuck: number, tuckDrag: number, tow: number): number {
  const finite = (n: number) => (Number.isFinite(n) ? n : 0);
  const rider = 1 - clamp(finite(tuck), 0, 1) * clamp(finite(tuckDrag), 0, 0.4);
  const following = 1 - GP_MAX_TOW_DRAG_REDUCTION * clamp(finite(tow), 0, 1);
  return rider * following;
}
