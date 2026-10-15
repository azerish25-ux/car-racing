import { catalogue } from './builder.ts';
import { CLUB_ROADSTER, TOURING_TC2 } from './touring-club.ts';
import { ELECTRIC_HYPERCAR, SHIFTER_KART, SUPERCAR } from './small-road.ts';
import { GT_FRONT_V8, GT_MID_V10, GT_SPORT } from './gt.ts';
import { HISTORIC_FORMULA, JUNIOR_FORMULA } from './formula.ts';
import { HYPERCAR, PROTOTYPE } from './endurance.ts';
import { RALLY_CAR, RALLYCROSS_CAR, TROPHY_TRUCK } from './dirt.ts';
import {
  ENTRY_FE4,
  FEEDER_FR3,
  FORMULA_FX26,
  HISTORIC_HF76,
  HISTORIC_HF86,
} from './single-seaters.ts';
import { HISTORIC_SP71, HYPERCAR_HY11, PROTOTYPE_PR3 } from './prototypes.ts';
import { GT_FRONT_I6, GT_REAR_FLAT6, GT_SPORT_MID_V6 } from './gt-layouts.ts';
import { HOT_HATCH_HH2, TOURING_TC3, VINTAGE_VC62 } from './touring-club-2.ts';
import {
  CLASSIC_RALLY_RL7,
  DESERT_BUGGY_BG2,
  ELECTRIC_RALLYCROSS_RXE,
  GROUP_RALLY_GB4,
} from './dirt-2.ts';
import {
  DIRECT_KART_DK100,
  ELECTRIC_TIME_ATTACK_XE1,
  FAN_CAR_XF2,
  HYDROGEN_XH3,
  TRACK_HYPERCAR_XT1,
} from './experimental.ts';
import {
  CLASSIC_GT_RG63,
  HOT_HATCH_RH3,
  LUXURY_GT_LX12,
  MUSCLE_COUPE_RM8,
  PICKUP_RP6,
  RALLY_ROAD_RR4,
  ROADSTER_RD2,
  SPORTS_SEDAN_RS5,
} from './road-festival.ts';

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
  // Catalogue growth (CONTENT_PIPELINE.md §1.3): appended in this order.
  FORMULA_FX26,
  FEEDER_FR3,
  ENTRY_FE4,
  HISTORIC_HF76,
  HISTORIC_HF86,
  HYPERCAR_HY11,
  PROTOTYPE_PR3,
  HISTORIC_SP71,
  GT_REAR_FLAT6,
  GT_FRONT_I6,
  GT_SPORT_MID_V6,
  TOURING_TC3,
  HOT_HATCH_HH2,
  VINTAGE_VC62,
  CLASSIC_RALLY_RL7,
  GROUP_RALLY_GB4,
  ELECTRIC_RALLYCROSS_RXE,
  DESERT_BUGGY_BG2,
  DIRECT_KART_DK100,
  FAN_CAR_XF2,
  ELECTRIC_TIME_ATTACK_XE1,
  HYDROGEN_XH3,
  TRACK_HYPERCAR_XT1,
  HOT_HATCH_RH3,
  SPORTS_SEDAN_RS5,
  MUSCLE_COUPE_RM8,
  CLASSIC_GT_RG63,
  PICKUP_RP6,
  RALLY_ROAD_RR4,
  LUXURY_GT_LX12,
  ROADSTER_RD2,
]);
export const CATALOGUE = BUILT.definitions;
/** Design-brief calibration bands (scripts/vehicle-calibration.ts). */
export const CATALOGUE_BANDS = BUILT.bands;
export const CATALOGUE_BRIEFS = BUILT.briefs;
export type { CatalogueSheet, DesignBands } from './builder.ts';
