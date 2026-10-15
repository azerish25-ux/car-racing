import { clamp } from '../core/math.ts';
import { O, OFFROAD_BASE, carBase } from '../simulation/protocol.ts';

/** Airborne and landing cues (D047/D048 audio, WP41): read from the recorded
 * off-road block, so live play and replays sound the same. A machine in the
 * air has no tyre resisting its drive: the engine note unloads (the harmonic
 * bands and the brightness that follow load fall away while the revs, which
 * the simulation lets flare on the free-spinning wheel, keep tracking the
 * throttle). On touchdown a suspension thump scales with the impact speed. */

/** Share of the measured engine load an airborne machine's voice keeps. */
export const AIRBORNE_LOAD = 0.25;
/** Is entrant `id` airborne in this snapshot (O.AIRBORNE: dirt bikes and
 * cars on terrain venues; zero on paved circuits)? */
export function airborneAt(frame: Float32Array, id: number) {
  return frame[carBase(id) + OFFROAD_BASE + O.AIRBORNE] > 0.5;
}
/** Engine load multiplier for the voice of entrant `id`. */
export function engineUnload(frame: Float32Array, id: number) {
  return airborneAt(frame, id) ? AIRBORNE_LOAD : 1;
}
/** Landing thump gain for a touchdown at `impact` m/s (normal speed): a soft
 * roll-in is a murmur, a flat 6-7 m/s case landing a full-scale thud. */
export function landingThump(impact: number) {
  if (!Number.isFinite(impact) || impact <= 0.4) return 0;
  return 0.6 * clamp((impact - 0.4) / 6.5, 0, 1) ** 1.2;
}
/** The thump's length (s): heavier landings ring longer through the chassis. */
export const landingDuration = (impact: number) => 0.1 + 0.2 * clamp(impact / 7, 0, 1);
