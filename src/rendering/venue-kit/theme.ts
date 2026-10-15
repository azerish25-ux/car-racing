import type { PlantingZoneSpec } from '../venue-plan.ts';
import type { VenueTheme } from '../../simulation/circuit-catalogue/venue-data.ts';

/** Per-theme dressing rules for the procedural venue kit. Colours are linear
 * PBR albedos chosen by hand for the original venues (no captured assets). */
export interface VenueThemeStyle {
  /** Verge and apron ground: grass, sand, pavement or dusty hardpan. */
  ground: 'grass' | 'sand' | 'pavement' | 'concrete';
  groundTint: number;
  /** Natural landform beyond the venue. */
  landform: 'flat' | 'rolling' | 'hills' | 'mountains' | 'mesas' | 'coast';
  /** Landform amplitude scale (m). */
  relief: number;
  /** Near-track planting uses the shared vegetation builder with these zones;
   * null plants nothing (city, dock, desert, oval infields). */
  planting: readonly PlantingZoneSpec[] | null;
  forestBelts: boolean;
  /** Instanced dry scrub and boulders (deserts, cliffs, mountains). */
  scrub: number;
  rockTint: number;
  /** Fictional signage for boards and the gantry. */
  sponsor: string;
  /** Grandstands by default at the start straight and the slowest corners. */
  stands: number;
  /** Floodlight towers along the lap (always lit at night venues). */
  lightTowers: boolean;
}

const BROADLEAF: readonly PlantingZoneSpec[] = Object.freeze([
  { endFraction: 0.3, canopyRatio: 0.84, species: 'broadleaf' },
  { endFraction: 0.6, canopyRatio: 1.0, species: 'spreading' },
  { endFraction: 1, canopyRatio: 0.64, species: 'upright' },
]);
const CONIFER: readonly PlantingZoneSpec[] = Object.freeze([
  { endFraction: 0.5, canopyRatio: 0.64, species: 'upright' },
  { endFraction: 1, canopyRatio: 0.64, species: 'cypress' },
]);
const MEDITERRANEAN: readonly PlantingZoneSpec[] = Object.freeze([
  { endFraction: 0.4, canopyRatio: 1.13, species: 'umbrella-pine' },
  { endFraction: 0.7, canopyRatio: 1.0, species: 'olive' },
  { endFraction: 1, canopyRatio: 0.64, species: 'cypress' },
]);

export const VENUE_THEMES: Readonly<Record<VenueTheme, VenueThemeStyle>> = Object.freeze({
  parkland: {
    ground: 'grass',
    groundTint: 0x5f7a3c,
    landform: 'rolling',
    relief: 6,
    planting: BROADLEAF,
    forestBelts: true,
    scrub: 0,
    rockTint: 0x8a8578,
    sponsor: 'PARCO / AUTODROMO',
    stands: 5,
    lightTowers: false,
  },
  forest: {
    ground: 'grass',
    groundTint: 0x4f6e33,
    landform: 'hills',
    relief: 40,
    planting: CONIFER,
    forestBelts: true,
    scrub: 0,
    rockTint: 0x6f6a60,
    sponsor: 'ARDENNES / FOREST',
    stands: 5,
    lightTowers: false,
  },
  airfield: {
    ground: 'grass',
    groundTint: 0x6c8442,
    landform: 'flat',
    relief: 2,
    planting: BROADLEAF,
    forestBelts: false,
    scrub: 0,
    rockTint: 0x8a8578,
    sponsor: 'NORTHFIELD / AIRFIELD',
    stands: 7,
    lightTowers: false,
  },
  hills: {
    ground: 'grass',
    groundTint: 0x557636,
    landform: 'hills',
    relief: 22,
    planting: BROADLEAF,
    forestBelts: true,
    scrub: 0,
    rockTint: 0x7a7468,
    sponsor: 'KANSAI / CIRCUIT',
    stands: 6,
    lightTowers: false,
  },
  'harbour-street': {
    ground: 'pavement',
    groundTint: 0x9a968c,
    landform: 'coast',
    relief: 30,
    planting: MEDITERRANEAN,
    forestBelts: false,
    scrub: 0,
    rockTint: 0xa39a86,
    sponsor: 'RIVIERA / HARBOUR',
    stands: 5,
    lightTowers: false,
  },
  prairie: {
    ground: 'grass',
    groundTint: 0x8a8a4c,
    landform: 'rolling',
    relief: 10,
    planting: BROADLEAF,
    forestBelts: false,
    scrub: 220,
    rockTint: 0xb09a78,
    sponsor: 'HILL COUNTRY',
    stands: 7,
    lightTowers: false,
  },
  'neon-city': {
    ground: 'pavement',
    groundTint: 0x6e6d6a,
    landform: 'flat',
    relief: 0,
    planting: null,
    forestBelts: false,
    scrub: 0,
    rockTint: 0x6e6d6a,
    sponsor: 'NEON / CITY',
    stands: 5,
    lightTowers: true,
  },
  alpine: {
    ground: 'grass',
    groundTint: 0x58703a,
    landform: 'mountains',
    relief: 420,
    planting: CONIFER,
    forestBelts: true,
    scrub: 260,
    rockTint: 0x7d7a74,
    sponsor: 'COL D’ARGENT',
    stands: 4,
    lightTowers: false,
  },
  oval: {
    ground: 'grass',
    groundTint: 0x6a8040,
    landform: 'flat',
    relief: 1,
    planting: null,
    forestBelts: false,
    scrub: 0,
    rockTint: 0x9c9182,
    sponsor: 'MESA / SPEEDBOWL',
    stands: 5,
    lightTowers: true,
  },
  desert: {
    ground: 'sand',
    groundTint: 0xc28a5a,
    landform: 'mesas',
    relief: 70,
    planting: null,
    forestBelts: false,
    scrub: 420,
    rockTint: 0xa65a35,
    sponsor: 'RED MESA',
    stands: 5,
    lightTowers: false,
  },
  'coastal-cliff': {
    ground: 'grass',
    groundTint: 0x6f7c45,
    landform: 'coast',
    relief: 60,
    planting: MEDITERRANEAN,
    forestBelts: false,
    scrub: 260,
    rockTint: 0xa8a090,
    sponsor: 'CAP LUMIÈRE',
    stands: 5,
    lightTowers: false,
  },
  // Off-road venues (offroad/venues.ts): the course itself is the deformable
  // terrain mesh; the kit dresses verges beyond it, barriers and the paddock.
  motocross: {
    ground: 'grass',
    groundTint: 0x5d7436,
    landform: 'hills',
    relief: 18,
    planting: BROADLEAF,
    forestBelts: true,
    scrub: 0,
    rockTint: 0x7b6f60,
    sponsor: 'VALLEY RIDGE / MX',
    stands: 3,
    lightTowers: false,
  },
  stadium: {
    ground: 'concrete',
    groundTint: 0x6f6b64,
    landform: 'flat',
    relief: 0,
    planting: null,
    forestBelts: false,
    scrub: 0,
    rockTint: 0x6f6b64,
    sponsor: 'ARENA NORD',
    stands: 6,
    lightTowers: true,
  },
  rallycross: {
    ground: 'grass',
    groundTint: 0x637a3e,
    landform: 'rolling',
    relief: 8,
    planting: BROADLEAF,
    forestBelts: true,
    scrub: 0,
    rockTint: 0x857c6e,
    sponsor: 'KESTREL / RX',
    stands: 4,
    lightTowers: false,
  },
  'forest-stage': {
    ground: 'grass',
    groundTint: 0x4b6630,
    landform: 'hills',
    relief: 45,
    planting: CONIFER,
    forestBelts: true,
    scrub: 0,
    rockTint: 0x6c665c,
    sponsor: 'PINEWOOD / STAGE',
    stands: 2,
    lightTowers: false,
  },
  dockyard: {
    ground: 'concrete',
    groundTint: 0x8c8a84,
    landform: 'coast',
    relief: 0,
    planting: null,
    forestBelts: false,
    scrub: 0,
    rockTint: 0x7b776f,
    sponsor: 'IRON QUAY',
    stands: 4,
    lightTowers: true,
  },
});
