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
