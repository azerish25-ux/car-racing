import type { PitLaneDefinition } from '../circuits.ts';
import type { Segment } from './builder.ts';

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
