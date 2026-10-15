import type { Track } from '../simulation/track.ts';
import { catalogueVenuePlan } from './venue-kit/plan.ts';

/** Per-circuit authored venue content. Every site is expressed in the
 * circuit's own lap distance and side (+1 = right of travel, the pit side), so
 * the same construction, clearance and footprint rules apply to any circuit.
 * Aurel's entries are the original constants, unchanged. */
export interface StandSpec {
  readonly s: number;
  readonly side: number;
  readonly length: number;
}
export interface ServiceZoneSpec {
  readonly s: number;
  readonly side: number;
  readonly kind: 'recovery' | 'maintenance';
}
export interface DistrictSpec {
  readonly id: string;
  readonly name: string;
  readonly s: number;
  readonly kind: 'club' | 'terrace' | 'works' | 'concourse';
  readonly side: number;
}
export interface PlantingZoneSpec {
  readonly endFraction: number;
  readonly canopyRatio: number;
  readonly species: string;
}
export interface SignSpec {
  readonly text: string;
  readonly s: number;
  readonly lateral: number;
  readonly width: number;
  readonly height: number;
}
export interface VenuePlan {
  readonly grandstands: readonly StandSpec[];
  readonly serviceZones: readonly ServiceZoneSpec[];
  readonly districts: readonly DistrictSpec[];
  /** Largest ground variation (m) a district plaza may terrace across. */
  readonly districtRelief: number;
  readonly plantingZones: readonly PlantingZoneSpec[];
  readonly signs: readonly SignSpec[];
  /** Lap distances of corners that receive 50/100/150 m braking boards. */
  readonly brakingBoards: readonly number[];
  readonly gantryLabel: string;
  readonly landmark: 'event-hall' | 'lighthouse';
}

export const AUREL_VENUE: VenuePlan = Object.freeze({
  grandstands: Object.freeze([
    { s: -72, side: -1, length: 64 },
    { s: 55, side: -1, length: 80 },
    { s: 450, side: -1, length: 48 },
    { s: 780, side: 1, length: 48 },
    { s: 1220, side: -1, length: 48 },
    { s: 1670, side: 1, length: 48 },
    { s: 2210, side: -1, length: 48 },
    { s: 2600, side: 1, length: 48 },
  ]),
  serviceZones: Object.freeze([
    { s: 420, side: 1, kind: 'recovery' },
    { s: 1010, side: -1, kind: 'maintenance' },
    { s: 1460, side: 1, kind: 'recovery' },
    { s: 1940, side: -1, kind: 'maintenance' },
    { s: 2390, side: 1, kind: 'recovery' },
    { s: 2710, side: -1, kind: 'maintenance' },
  ]),
  districts: Object.freeze([
    { id: 'orchard-club', name: 'ORCHARD / MOTOR CLUB', s: 725, kind: 'club', side: -1 },
    { id: 'quarry-terrace', name: 'QUARRY / TERRACE', s: 1330, kind: 'terrace', side: 1 },
    { id: 'north-works', name: 'NORTH / WORKS', s: 1845, kind: 'works', side: -1 },
    { id: 'south-concourse', name: 'SOUTH / CONCOURSE', s: 2480, kind: 'concourse', side: 1 },
  ]),
  districtRelief: 0.5,
  plantingZones: Object.freeze([
    { endFraction: 0.14, canopyRatio: 0.64, species: 'upright' },
    { endFraction: 0.34, canopyRatio: 0.84, species: 'broadleaf' },
    { endFraction: 0.55, canopyRatio: 1.0, species: 'spreading' },
    { endFraction: 0.76, canopyRatio: 1.13, species: 'open-crown' },
    { endFraction: 1, canopyRatio: 0.84, species: 'broadleaf' },
  ]),
  signs: Object.freeze([
    { text: 'APEX  /  FORMULA', s: 360, lateral: -19, width: 18, height: 2 },
    { text: 'AUREL MOTORSPORT', s: 870, lateral: 19, width: 20, height: 2 },
    { text: 'NORTHLINE', s: 1540, lateral: -19, width: 15, height: 1.8 },
    { text: 'PULSE / ENGINEERING', s: 2300, lateral: 19, width: 20, height: 2 },
  ]),
  brakingBoards: Object.freeze([570, 1170, 1410, 1640, 2070, 2670]),
  gantryLabel: 'AUREL / GRAND CIRCUIT',
  landmark: 'event-hall',
} as VenuePlan);

/** Vellamar: coast straight and paddock by the sea, stands at the heavy
 * braking zones and on the ridge, a lighthouse on the T1 headland, terraced
 * districts on the hillside and a marina club at the final corner. */
export const VELLAMAR_VENUE: VenuePlan = Object.freeze({
  grandstands: Object.freeze([
    { s: -72, side: -1, length: 64 },
    { s: 55, side: -1, length: 80 },
    { s: 880, side: -1, length: 56 },
    { s: 1320, side: 1, length: 48 },
    { s: 2930, side: -1, length: 48 },
    { s: 3330, side: 1, length: 48 },
    { s: 3560, side: -1, length: 48 },
  ]),
  serviceZones: Object.freeze([
    { s: 1150, side: 1, kind: 'recovery' },
    { s: 1720, side: -1, kind: 'maintenance' },
    { s: 2420, side: 1, kind: 'recovery' },
    { s: 3040, side: -1, kind: 'maintenance' },
    { s: 3420, side: 1, kind: 'recovery' },
    { s: 3700, side: 1, kind: 'maintenance' },
  ]),
  districts: Object.freeze([
    { id: 'faro-concourse', name: 'FARO / CONCOURSE', s: 700, kind: 'concourse', side: 1 },
    { id: 'oliveto-works', name: 'OLIVETO / WORKS', s: 1560, kind: 'works', side: 1 },
    { id: 'belvedere-terrace', name: 'BELVEDERE / TERRACE', s: 3080, kind: 'terrace', side: 1 },
    { id: 'marina-club', name: 'MARINA / YACHT CLUB', s: 3700, kind: 'club', side: -1 },
  ]),
  districtRelief: 3.5,
  plantingZones: Object.freeze([
    { endFraction: 0.2, canopyRatio: 1.13, species: 'umbrella-pine' },
    { endFraction: 0.45, canopyRatio: 0.64, species: 'cypress' },
    { endFraction: 0.7, canopyRatio: 1.0, species: 'olive' },
    { endFraction: 0.86, canopyRatio: 0.64, species: 'cypress' },
    { endFraction: 1, canopyRatio: 1.13, species: 'umbrella-pine' },
  ]),
  signs: Object.freeze([
    { text: 'VELLAMAR / COAST', s: 380, lateral: -19, width: 20, height: 2 },
    { text: 'APEX  /  FORMULA', s: 1450, lateral: 19, width: 18, height: 2 },
    { text: 'RIDGE ENERGY', s: 2200, lateral: -19, width: 16, height: 1.8 },
    { text: 'PORTO LUX', s: 3700, lateral: 19, width: 14, height: 1.8 },
  ]),
  brakingBoards: Object.freeze([980, 1480, 2995, 3190]),
  gantryLabel: 'VELLAMAR / COAST CIRCUIT',
  landmark: 'lighthouse',
} as VenuePlan);

export function venuePlan(track: Track): VenuePlan {
  if (track.circuit.catalogue) return catalogueVenuePlan(track);
  return track.circuit.id === 'vellamar' ? VELLAMAR_VENUE : AUREL_VENUE;
}

/** Kerb paint schemes (D15): red/white (default), the signature blue/white
 * complex and one yellow/green corner. */
export const KERB_STYLES = Object.freeze(['red-white', 'blue-white', 'yellow-green'] as const);
export type KerbStyle = (typeof KERB_STYLES)[number];
/** Run-off finishes beyond the kerb (D15): painted bands over grey asphalt in
 * one of four colours, or astroturf. */
export const RUNOFF_STYLES = Object.freeze([
  'green',
  'red',
  'blue',
  'yellow',
  'astroturf',
] as const);
export type RunoffStyle = (typeof RUNOFF_STYLES)[number];
/** Corner window around a named corner's lap distance, metres. */
export const CORNER_WINDOW = Object.freeze({ before: 110, after: 70 });

function cornerAt(track: Track, s: number) {
  const corners = track.circuit.corners,
    length = track.length;
  for (let i = 0; i < corners.length; i++) {
    const d = ((((s - corners[i].s) % length) + length * 1.5) % length) - length / 2;
    if (d >= -CORNER_WINDOW.before && d <= CORNER_WINDOW.after) return i;
  }
  return -1;
}
/** Kerb scheme index (into KERB_STYLES) at lap distance `s`: the second named
 * corner is the blue complex, the fourth the yellow/green corner. */
export function kerbStyleAt(track: Track, s: number) {
  const corner = cornerAt(track, s);
  return corner === 1 ? 1 : corner === 3 ? 2 : 0;
}
/** Run-off finish index (into RUNOFF_STYLES) at `s`: green bands on the
 * straights, corners cycling red, astroturf, blue, yellow. */
export function runoffStyleAt(track: Track, s: number) {
  const corner = cornerAt(track, s);
  if (corner < 0) return 0;
  return [1, 4, 2, 3][corner % 4];
}
