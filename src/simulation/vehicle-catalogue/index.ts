import { catalogue } from './builder.ts';
import { CLUB_ROADSTER, TOURING_TC2 } from './touring-club.ts';
import { ELECTRIC_HYPERCAR, SHIFTER_KART, SUPERCAR } from './small-road.ts';
import { GT_FRONT_V8, GT_MID_V10, GT_SPORT } from './gt.ts';
import { HISTORIC_FORMULA, JUNIOR_FORMULA } from './formula.ts';
import { HYPERCAR, PROTOTYPE } from './endurance.ts';
import { RALLY_CAR, RALLYCROSS_CAR, TROPHY_TRUCK } from './dirt.ts';

/** Destination catalogue additions (masterplan §10.1, WP17–WP18, WP30). Order
 * is the registry order after APX-01 and TC-1, and therefore the snapshot
 * vehicle index: append new vehicles at the end, never reorder. */
const BUILT = catalogue([
  JUNIOR_FORMULA,
  HISTORIC_FORMULA,
  HYPERCAR,
  PROTOTYPE,
  GT_FRONT_V8,
  GT_MID_V10,
  GT_SPORT,
  TOURING_TC2,
  CLUB_ROADSTER,
  RALLY_CAR,
  RALLYCROSS_CAR,
  TROPHY_TRUCK,
  SHIFTER_KART,
  ELECTRIC_HYPERCAR,
  SUPERCAR,
]);
export const CATALOGUE = BUILT.definitions;
/** Design-brief calibration bands (scripts/vehicle-calibration.ts). */
export const CATALOGUE_BANDS = BUILT.bands;
export const CATALOGUE_BRIEFS = BUILT.briefs;
export type { CatalogueSheet, DesignBands } from './builder.ts';
