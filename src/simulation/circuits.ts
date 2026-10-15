import { clamp, mod, TAU } from '../core/math.ts';
import { CATALOGUE_CIRCUITS } from './circuit-catalogue/index.ts';
import {
  CATALOGUE_CIRCUIT_IDS,
  type CatalogueCircuitId,
  type CatalogueMeta,
  type RunoffCode,
} from './circuit-catalogue/venue-data.ts';

/** Identifies a circuit layout. Aurel remains the default everywhere; the
 * catalogue layouts (WP29-WP30, circuit-catalogue/) follow the two originals. */
export type CircuitId = 'aurel' | 'vellamar' | CatalogueCircuitId;
export const CIRCUIT_IDS: readonly CircuitId[] = Object.freeze([
  'aurel',
  'vellamar',
  ...CATALOGUE_CIRCUIT_IDS,
]);

/** One consistent source for a circuit's centreline and cross-section. The
 * physical contact ribbon, rendering ribbons, collision boundary, AI racing
 * line, sectors, lap validity, water grid, grid slots, pit lane and minimap are
 * all derived from the Track built from this definition.
 *
 * Paddock template (shared by every circuit so the validated pit, grid and
 * release logic stays exact): the lap starts on the main straight; the straight
 * spans at least [length - 250 m, 350 m] with radius above ~200 m; the pit
 * lane runs on the right-hand (+lateral) side, 22 m from the centreline. */
export interface CircuitDefinition {
  id: CircuitId;
  /** HUD / minimap caption. */
  name: string;
  short: string;
  /** Closed Catmull-Rom control polygon in metres (x east, z north). */
  design: readonly (readonly [number, number])[];
  /** Road height above the venue datum at lap fraction u in [0, 1). */
  elevation(u: number, flat: boolean): number;
  /** Optional exact d(height)/ds; otherwise a central difference is used. */
  gradient?(u: number, length: number, flat: boolean): number;
  /** Half-width of the racing surface in metres. */
  halfWidth(u: number): number;
  /** Banking gain applied to signed curvature (rad per 1/m); positive raises
   * the outside of every corner. Zero means the authored cross-fall only. */
  bankGain(u: number): number;
  /** Authored cross-fall (rad) added to curvature banking. */
  crossFall(u: number, flat: boolean): number;
  /** Maximum banking magnitude in radians. */
  maxBank: number;
  /** Named corners, by lap distance (m), for boards, minimap labels and guides. */
  corners: readonly { s: number; name: string }[];
  /** DRS zones by lap distance (m): the 1.0 s gap is judged at `detect`, the
   * flap may open from `start` to `end` (zones may wrap through the line). */
  drsZones: readonly DrsZone[];
  /** Pit lane and grid; STANDARD_PIT when absent. */
  pit?: PitLaneDefinition;
  /** Authored run-off beyond the paint band (RUNOFF code) at lap distance `s`
   * on `side` (+1 right of travel). Absent: gravel outside tighter corners,
   * grass elsewhere (Aurel and Vellamar). */
  runoff?(s: number, side: number): RunoffCode;
  /** Barrier face distance beyond the asphalt edge (m); 11 when absent. */
  barrier?(s: number, side: number): number;
  /** Roofed road (tunnels): rain does not reach the surface there. */
  covered?(s: number): boolean;
  /** Catalogue layouts: venue, menu and dressing data (circuit-catalogue/). */
  catalogue?: CatalogueMeta;
}
/** Venue-owned pit lane, grid and service geometry (WP10 / F06). Distances
 * are lap metres measured from the start line (the lane straddles it), the
 * lateral offset is unsigned and `side` selects the road edge: +1 is the
 * +lateral (right-hand) side used by Aurel and Vellamar, -1 the left. Every
 * pit, AI, collision and contact formula reads these values instead of
 * literal constants, so a new venue needs data, not new global formulas. */
export interface PitLaneDefinition {
  side: 1 | -1;
  /** Lane centre distance from the circuit centreline (m). */
  offset: number;
  /** The lane leaves the circuit between length-divergeStart and length-divergeEnd. */
  divergeStart: number;
  divergeEnd: number;
  /** ... and rejoins between mergeStart and mergeEnd after the line. */
  mergeStart: number;
  mergeEnd: number;
  /** Pit surface section: from length-sectionBefore to sectionAfter. */
  sectionBefore: number;
  sectionAfter: number;
  /** Speed-limited zone: from length-limitBefore to limitAfter. */
  limitBefore: number;
  limitAfter: number;
  /** Commitment line, length-entry (m). */
  entry: number;
  /** Garage box i is at firstBox + i * boxSpacing, boxLateral from centre. */
  firstBox: number;
  boxSpacing: number;
  boxLateral: number;
  /** Release hold line and end of the swept merge corridor. */
  holdLine: number;
  /** Released cars leave pit state between exitAfter and length-exitBefore. */
  exitAfter: number;
  exitBefore: number;
  /** Grid: first slot length-gridStart, rows gridRow apart, columns ±gridColumn. */
  gridStart: number;
  gridRow: number;
  gridColumn: number;
}
/** Aurel's validated paddock template; every value is the former literal. */
export const STANDARD_PIT: PitLaneDefinition = Object.freeze({
  side: 1,
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
});
export interface DrsZone {
  detect: number;
  start: number;
  end: number;
}

const AUREL_DESIGN = Object.freeze([
  [-360, -180],
  [-360, 40],
  [-355, 260],
  [-270, 420],
  [-65, 465],
  [145, 410],
  [295, 300],
  [260, 180],
  [100, 140],
  [65, 15],
  [175, -85],
  [320, -190],
  [295, -345],
  [100, -430],
  [-100, -420],
  [-275, -335],
] as const);

/** Aurel: the original compact circuit. These formulas are byte-for-byte the
 * former hard-coded profile, so every existing test and recording holds. */
export const AUREL: CircuitDefinition = Object.freeze({
  id: 'aurel',
  name: 'AUREL / GRAND CIRCUIT',
  short: 'AUREL',
  design: AUREL_DESIGN,
  elevation: (u: number, flat: boolean) => {
    const theta = u * TAU;
    return flat ? 0 : 1.5 * Math.sin(theta) + 0.65 * Math.sin(3 * theta);
  },
  gradient: (u: number, length: number, flat: boolean) => {
    const theta = u * TAU;
    return flat ? 0 : ((1.5 * Math.cos(theta) + 1.95 * Math.cos(3 * theta)) * TAU) / length;
  },
  halfWidth: (u: number) => 8 + 0.6 * Math.sin(u * TAU) ** 2,
  bankGain: () => 0,
  crossFall: (u: number, flat: boolean) => (flat ? 0 : 0.018 * Math.sin(2 * u * TAU)),
  maxBank: 0.02,
  corners: Object.freeze([
    { s: 627, name: 'NORTH HOOK' },
    { s: 1248, name: 'QUARRY' },
    { s: 1545, name: 'ORCHARD' },
    { s: 2012, name: 'WORKS' },
    { s: 2180, name: 'CONCOURSE' },
  ]),
  drsZones: Object.freeze([{ detect: 2180, start: 2300, end: 470 }]),
});

/** Periodic monotone-free cubic interpolation through (u, value) knots. */
function periodicProfile(knots: readonly (readonly [number, number])[]) {
  const n = knots.length;
  return (u: number) => {
    u = mod(u, 1);
    let i = 0;
    while (i < n - 1 && knots[i + 1][0] <= u) i++;
    const a = knots[mod(i - 1, n)],
      b = knots[i],
      c = knots[(i + 1) % n],
      d = knots[(i + 2) % n];
    const ub = b[0],
      uc = c[0] > ub ? c[0] : c[0] + 1;
    const t = clamp((u - ub) / (uc - ub), 0, 1);
    // Catmull-Rom on values with uniform parameter: smooth, passes knots.
    const p0 = a[1],
      p1 = b[1],
      p2 = c[1],
      p3 = d[1];
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
    );
  };
}

// Vellamar lap fractions are lap distances / 3997 m (see design notes below).
const L = 3997;
const vellamarElevation = periodicProfile([
  [0, 2],
  [700 / L, 2],
  [900 / L, 2.5],
  [1080 / L, 4],
  [1260 / L, 12],
  [1370 / L, 18],
  [1500 / L, 26],
  [1750 / L, 36],
  [2100 / L, 41],
  [2500 / L, 45],
  [2900 / L, 44],
  [3000 / L, 43.5],
  [3200 / L, 32],
  [3400 / L, 20],
  [3620 / L, 8],
  [3747 / L, 2.6],
  [3860 / L, 2],
]);
/** Banking only where it is authored: the ridge sweep and the long descending
 * Lantern right-hander carry real camber; the rest of the lap drains by cross-fall. */
const vellamarBankZone = periodicProfile([
  [0, 0],
  [1600 / L, 0],
  [1700 / L, 14],
  [1810 / L, 14],
  [1900 / L, 0],
  [3300 / L, 0],
  [3400 / L, 22],
  [3590 / L, 22],
  [3680 / L, 0],
]);

/** Vellamar: an original coastal-mountain circuit (4.00 km). The coast
 * straight and paddock sit just above the sea; the lap climbs through the
 * Ascent esses and Oliveto to a 45 m ridge, brakes into the Belvedere hairpin,
 * then falls through the Cascata esses and the banked Lantern sweeper back to
 * the coast. The six control points around the start line are a rigid copy of
 * Aurel's, so the paddock template (pit lane, garages, authored A21 frontage)
 * sits on geometrically identical pit-straight curvature. */
export const VELLAMAR: CircuitDefinition = Object.freeze({
  id: 'vellamar',
  name: 'VELLAMAR / COAST CIRCUIT',
  short: 'VELLAMAR',
  design: Object.freeze([
    [250, -420],
    [30, -420],
    [-190, -415],
    [-350, -420],
    [-620, -420],
    [-730, -385],
    [-745, -300],
    [-680, -250],
    [-600, -190],
    [-600, -90],
    [-680, 0],
    [-700, 110],
    [-620, 230],
    [-470, 300],
    [-300, 380],
    [-120, 470],
    [80, 510],
    [300, 500],
    [470, 470],
    [540, 410],
    [500, 340],
    [430, 250],
    [480, 140],
    [500, 40],
    [490, -160],
    [405, -335],
  ] as const),
  elevation: (u: number, flat: boolean) => (flat ? 0 : vellamarElevation(u)),
  halfWidth: (u: number) => 7.6 + 0.5 * Math.sin(u * TAU * 2 + 0.7) ** 2,
  bankGain: (u: number) => Math.max(0, vellamarBankZone(u)),
  crossFall: (u: number, flat: boolean) => (flat ? 0 : 0.012 * Math.sin(3 * u * TAU)),
  maxBank: 0.1,
  corners: Object.freeze([
    { s: 1030, name: 'T1 FARO' },
    { s: 1262, name: 'ASCENT' },
    { s: 1560, name: 'OLIVETO' },
    { s: 1751, name: 'RIDGE SWEEP' },
    { s: 2999, name: 'BELVEDERE' },
    { s: 3195, name: 'CASCATA' },
    { s: 3490, name: 'LANTERN' },
    { s: 3813, name: 'MARINA' },
  ]),
  drsZones: Object.freeze([
    { detect: 3330, start: 3420, end: 640 },
    { detect: 1800, start: 1900, end: 2720 },
  ]),
});

export const CIRCUITS: Readonly<Record<CircuitId, CircuitDefinition>> = Object.freeze({
  aurel: AUREL,
  vellamar: VELLAMAR,
  ...CATALOGUE_CIRCUITS,
});
export function circuitDefinition(id: unknown): CircuitDefinition {
  return typeof id === 'string' && Object.hasOwn(CIRCUITS, id) ? CIRCUITS[id as CircuitId] : AUREL;
}
