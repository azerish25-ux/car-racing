import { AUREL, STANDARD_PIT, type CircuitDefinition } from './circuits.ts';

/** Development venues that prove venue data, not global formulas, decides pit
 * and grid geometry (WP10 acceptance). Not in the player circuit registry. */

/** Aurel mirrored north-south and stretched 12% east-west: the circuit runs
 * the other way round, so its paddock sits on the LEFT of the cars, and the
 * start straight is a different length. Pit/grid values are venue data. */
export const KESTREL_LEFT_PIT: CircuitDefinition = Object.freeze({
  ...AUREL,
  id: 'aurel',
  name: 'KESTREL / LEFT-PIT TEST COURSE',
  short: 'KESTREL',
  design: Object.freeze(AUREL.design.map(([x, z]) => [x * 1.12, -z] as const)),
  // The analytic Aurel gradient belongs to Aurel's length; use differences.
  gradient: undefined,
  corners: Object.freeze([]),
  drsZones: Object.freeze([]),
  pit: Object.freeze({ ...STANDARD_PIT, side: -1 as const, offset: 21, boxLateral: 23.1 }),
});

/** Figure-eight with a 9 m overpass (WP11 minimum adversarial route test).
 * A Gerono lemniscate crosses itself at the start line (lower road, u = 0)
 * and again at mid-lap (upper road, u = 0.5): the two roads occupy the same
 * horizontal position. Progress, surface, checkpoints and AI lanes must keep
 * the road the car is actually on. */
const EIGHT = Array.from({ length: 32 }, (_, i) => {
  const theta = (i / 32) * Math.PI * 2;
  return [460 * Math.sin(theta), 300 * Math.sin(theta) * Math.cos(theta)] as const;
});
export const FIGURE_EIGHT_OVERPASS: CircuitDefinition = Object.freeze({
  ...AUREL,
  name: 'CROSSOVER / FIGURE-EIGHT OVERPASS TEST',
  short: 'CROSSOVER',
  design: Object.freeze(EIGHT),
  elevation: (u: number, flat: boolean) => (flat ? 0 : 4.5 * (1 - Math.cos(u * Math.PI * 2))),
  gradient: undefined,
  halfWidth: () => 8,
  crossFall: () => 0,
  corners: Object.freeze([]),
  drsZones: Object.freeze([]),
});
