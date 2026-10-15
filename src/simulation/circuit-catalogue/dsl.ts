import type { PitLaneDefinition } from '../circuits.ts';
import type { Segment } from './builder.ts';

/** Motorcycle race classes a bike-safe circuit clears (`bikeClasses`): each
 * listed class has a passing seeded race there (docs/bike-clearance.json). */
export const ALL_BIKE_CLASSES = Object.freeze([
  'gp-bike',
  'superbike',
  'supersport',
  'classic-bike',
] as const);
/** The modern classes only: the classic class falls in tight hairpins. */
export const MODERN_BIKE_CLASSES = Object.freeze(['gp-bike', 'superbike', 'supersport'] as const);
/** Authoring shorthand: a straight of `length` metres. */
export const S = (length: number, props: Omit<Segment, 's' | 'r' | 'turn'> = {}): Segment => ({
  s: length,
  ...props,
});
/** An arc of `radius` metres turning `turn` degrees (+ left, - right). */
export const A = (
  radius: number,
  turn: number,
  props: Omit<Segment, 's' | 'r' | 'turn'> = {},
): Segment => ({ r: radius, turn, ...props });

/** About `length` metres of road as a symmetric chain of bends (+angle,
 * -2 angle, +angle, radius `r`) with short straights between: the heading and
 * the line are the same at both ends, so a long country-road straight gains
 * corners without disturbing the layout's closure. Elevation runs linearly
 * from `from` to `to` (segment-end heights); `names` label the three bends. */
export function bends(
  length: number,
  r: number,
  angle: number,
  from: number,
  to: number,
  names: readonly (string | undefined)[] = [],
  props: Omit<Segment, 's' | 'r' | 'turn' | 'y' | 'name'> = {},
): Segment[] {
  const arc = (r * Math.abs(angle) * Math.PI) / 180,
    rest = Math.max(40, length - 4 * arc),
    pieces: [number, number?][] = [
      [rest * 0.3],
      [arc, angle],
      [rest * 0.2],
      [2 * arc, -2 * angle],
      [rest * 0.2],
      [arc, angle],
      [rest * 0.3],
    ],
    total = pieces.reduce((a, [l]) => a + l, 0);
  let travelled = 0,
    bend = 0;
  return pieces.map(([l, turn]) => {
    travelled += l;
    const y = Math.round((from + ((to - from) * travelled) / total) * 10) / 10;
    if (turn === undefined) return S(Math.round(l), { ...props, y });
    const name = names[bend++];
    return A(r, turn, { ...props, y, ...(name ? { name } : {}) });
  });
}

/** The validated grand-prix paddock template (circuits.ts STANDARD_PIT): the
 * straight must run from 220 m before the line to 330 m after it. Grid slots
 * keep the standard spacing so painted boxes and launch rubber agree. */
export function gpPit(side: 1 | -1, overrides: Partial<PitLaneDefinition> = {}): PitLaneDefinition {
  return Object.freeze({
    side,
    offset: 22,
    divergeStart: 220,
    divergeEnd: 100,
    mergeStart: 215,
    mergeEnd: 330,
    sectionBefore: 190,
    sectionAfter: 300,
    limitBefore: 160,
    limitAfter: 220,
    entry: 210,
    firstBox: 102,
    boxSpacing: 7,
    boxLateral: 24.1,
    holdLine: 268,
    exitAfter: 330,
    exitBefore: 250,
    gridStart: 32,
    gridRow: 10,
    gridColumn: 2.2,
    ...overrides,
  });
}
/** A short-straight paddock (street and compact venues): the straight must run
 * from 150 m before the line to 230 m after it; the lane sits 16 m out. */
export function compactPit(
  side: 1 | -1,
  overrides: Partial<PitLaneDefinition> = {},
): PitLaneDefinition {
  return gpPit(side, {
    offset: 16,
    divergeStart: 145,
    divergeEnd: 85,
    mergeStart: 160,
    mergeEnd: 230,
    sectionBefore: 125,
    sectionAfter: 210,
    limitBefore: 115,
    limitAfter: 165,
    entry: 135,
    firstBox: 26,
    boxSpacing: 9,
    boxLateral: 18.1,
    holdLine: 190,
    exitAfter: 230,
    exitBefore: 135,
    ...overrides,
  });
}
