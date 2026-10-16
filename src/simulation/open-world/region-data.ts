/** Authored data of the festival region (GAME_DESIGN §2 Festival row, §8
 * Festival region). Everything here is original content: invented place
 * names, an invented coastline and road layout, no real-world map data.
 * Terrain is procedural (seeded noise) shaped by these authored control
 * features; roads are authored control polylines that the network builder
 * turns into sampled, graded, cambered roads with junctions and bridges.
 * Units: metres, x east, z north, y up. */

export type RoadClass = 'highway' | 'country' | 'mountain' | 'town' | 'dirt' | 'runway';
/** Speed classification of a road class (signage and advisory speeds). */
export type SpeedClass = 'motorway' | 'fast' | 'medium' | 'slow' | 'technical';
export interface RoadClassSpec {
  /** Half-width of the running surface (m). */
  halfWidth: number;
  /** Shoulder beyond the running surface, same level (m). */
  shoulder: number;
  /** Design speed used for superelevation and advisory speeds (m/s). */
  designSpeed: number;
  speedClass: SpeedClass;
  /** Maximum longitudinal grade (rise/run). */
  maxGrade: number;
  /** Terrain smoothing window of the vertical profile (m). */
  smoothing: number;
  /** Crown cross-fall each side of the centreline (rise/run). */
  crown: number;
  /** Maximum superelevation (rise/run). */
  maxBank: number;
  surface: 'asphalt' | 'dirt';
  /** Physics grip and rolling resistance of the running surface. */
  grip: number;
  resistance: number;
  markings: 'motorway' | 'centre' | 'runway' | 'none';
  /** Guardrails where the ground falls away beside the road. */
  guardrails: boolean;
  /** Spline sampling step (m). */
  step: number;
  /** Network priority: higher classes keep their profile at junctions. */
  priority: number;
}
export const ROAD_CLASSES: Readonly<Record<RoadClass, Readonly<RoadClassSpec>>> = Object.freeze({
  highway: Object.freeze({
    halfWidth: 7.6,
    shoulder: 1.6,
    designSpeed: 36,
    speedClass: 'motorway',
    maxGrade: 0.06,
    smoothing: 150,
    crown: 0.022,
    maxBank: 0.06,
    surface: 'asphalt',
    grip: 0.95,
    resistance: 0.015,
    markings: 'motorway',
    guardrails: true,
    step: 4,
    priority: 5,
  }),
  country: Object.freeze({
    halfWidth: 3.7,
    shoulder: 0.8,
    designSpeed: 25,
    speedClass: 'fast',
    maxGrade: 0.09,
    smoothing: 70,
    crown: 0.025,
    maxBank: 0.07,
    surface: 'asphalt',
    grip: 0.92,
    resistance: 0.016,
    markings: 'centre',
    guardrails: false,
    step: 4,
    priority: 3,
  }),
  mountain: Object.freeze({
    halfWidth: 3.5,
    shoulder: 0.6,
    designSpeed: 17,
    speedClass: 'technical',
    maxGrade: 0.105,
    smoothing: 44,
    crown: 0.025,
    maxBank: 0.08,
    surface: 'asphalt',
    grip: 0.92,
    resistance: 0.016,
    markings: 'centre',
    guardrails: true,
    step: 3,
    priority: 3,
  }),
  town: Object.freeze({
    halfWidth: 4.6,
    shoulder: 2.4,
    designSpeed: 14,
    speedClass: 'slow',
    maxGrade: 0.08,
    smoothing: 40,
    crown: 0.02,
    maxBank: 0.0,
    surface: 'asphalt',
    grip: 0.9,
    resistance: 0.016,
    markings: 'centre',
    guardrails: false,
    step: 4,
    priority: 2,
  }),
  dirt: Object.freeze({
    halfWidth: 2.9,
    shoulder: 0.5,
    designSpeed: 15,
    speedClass: 'medium',
    maxGrade: 0.15,
    smoothing: 26,
    crown: 0.03,
    maxBank: 0.03,
    surface: 'dirt',
    grip: 0.66,
    resistance: 0.045,
    markings: 'none',
    guardrails: false,
    step: 4,
    priority: 1,
  }),
  runway: Object.freeze({
    halfWidth: 15,
    shoulder: 4,
    designSpeed: 70,
    speedClass: 'motorway',
    maxGrade: 0.012,
    smoothing: 300,
    crown: 0.012,
    maxBank: 0,
    surface: 'asphalt',
    grip: 0.95,
    resistance: 0.015,
    markings: 'runway',
    guardrails: false,
    step: 6,
    priority: 4,
  }),
});
export const SPEED_CLASS_KMH: Readonly<Record<SpeedClass, number>> = Object.freeze({
  motorway: 130,
  fast: 90,
  medium: 70,
  slow: 50,
  technical: 60,
});

export type XZ = readonly [number, number];
export interface RoadSpec {
  id: string;
  name: string;
  roadClass: RoadClass;
  /** Catmull-Rom control points (m). */
  points: readonly XZ[];
  /** A closed loop (runway/taxiway circuits). */
  closed?: boolean;
}
export interface PeakSpec {
  name: string;
  x: number;
  z: number;
  height: number;
  radius: number;
  /** Ridge relief as a fraction of height. */
  ridge: number;
}
export interface FlatSpec {
  kind: 'town' | 'airfield' | 'village';
  name: string;
  /** Axis-aligned area (m). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Blend distance outside the area (m). */
  blend: number;
  /** Plane height at (x0, z0) and its north slope; NaN height = natural mean. */
  height: number;
  slopeZ: number;
}
export interface ForestSpec {
  name: string;
  x: number;
  z: number;
  radius: number;
  density: number;
}
export interface ValleySpec {
  name: string;
  /** Polyline from source to mouth with the valley floor height (x, z, floor). */
  points: readonly (readonly [number, number, number])[];
  /** Gaussian half-width of the valley (m). */
  width: number;
  /** River channel half-width (m) and depth below the floor (m). */
  channel: number;
  channelDepth: number;
}
export interface TownSpec {
  id: string;
  name: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Storeys range of buildings. */
  floors: readonly [number, number];
  /** Fraction of street frontage built up. */
  density: number;
}
export interface LandmarkSpec {
  kind: 'hangar' | 'tower' | 'terminal' | 'lighthouse' | 'farm' | 'chapel' | 'warehouse';
  x: number;
  z: number;
  /** Heading of the long axis (rad). */
  heading: number;
  width: number;
  length: number;
  height: number;
}
export type FestivalEventKind =
  | 'road-race'
  | 'circuit'
  | 'sprint'
  | 'speed-trap'
  | 'speed-zone'
  | 'drift-zone'
  | 'showcase';
export interface FestivalEventSpec {
  id: string;
  name: string;
  kind: FestivalEventKind;
  /** Ordered waypoints the route visits through the road network (the first
   * is the start/marker). A circuit returns to its first waypoint. */
  waypoints: readonly XZ[];
  /** Circuit laps (circuits only). */
  laps?: number;
  /** AI rivals (races only). */
  rivals?: number;
  /** Skill-challenge target values for one, two and three stars: km/h for
   * traps and zones, points for drift zones; seconds for showcases. */
  stars?: readonly [number, number, number];
  blurb: string;
}
export interface RegionDefinition {
  id: string;
  name: string;
  version: number;
  seed: number;
  /** Half extent of the drivable region (m): x, z in [-half, half]. */
  half: number;
  seaLevel: number;
  /** Coastline, west to east (strictly increasing x); land lies north (+z). */
  coast: readonly XZ[];
  peaks: readonly PeakSpec[];
  valley: ValleySpec;
  flats: readonly FlatSpec[];
  forests: readonly ForestSpec[];
  towns: readonly TownSpec[];
  landmarks: readonly LandmarkSpec[];
  roads: readonly RoadSpec[];
  /** Grade-separated crossings: `over` bridges `under` without a junction. */
  overpasses: readonly { over: string; under: string }[];
  events: readonly FestivalEventSpec[];
}

/** Centre of the Varda massif (the pass is laid out around it). */
const VARDA: XZ = [-2900, 2450];
/** Points on a polar path around a centre: [radius m, angle deg] pairs. */
function arc(centre: XZ, polar: readonly (readonly [number, number])[]): XZ[] {
  return polar.map(([r, deg]) => {
    const a = (deg * Math.PI) / 180;
    return [
      Math.round(centre[0] + r * Math.cos(a)),
      Math.round(centre[1] + r * Math.sin(a)),
    ] as const;
  });
}
/** A hairpin stack: spiral legs between the given polar corners, each leg
 * subdivided so the road follows the contour while it climbs. */
function switchbacks(centre: XZ, corners: readonly (readonly [number, number])[]): XZ[] {
  const out: XZ[] = [];
  for (let k = 0; k < corners.length - 1; k++) {
    const [r0, a0] = corners[k],
      [r1, a1] = corners[k + 1],
      span = Math.abs(a1 - a0);
    // Hairpin: a short radial step at the same angle, rounded by one point
    // beyond the leg ends.
    if (span < 1) {
      const out0 = Math.sign(a0 - corners[Math.max(0, k - 1)][1]) || 1;
      out.push(...arc(centre, [[(r0 + r1) / 2, a0 + out0 * 2.2]]));
      continue;
    }
    const steps = Math.max(1, Math.round(span / 12));
    for (let i = k === 0 ? 1 : 0; i <= steps; i++)
      out.push(...arc(centre, [[r0 + ((r1 - r0) * i) / steps, a0 + ((a1 - a0) * i) / steps]]));
  }
  return out;
}

/** The Solvane festival region: an original coastal province with the harbour
 * town of Port Ilse, the Ashvale river valley, the Varda massif with its pass,
 * the Kestrel airfield plateau and the Thornwood forest. */
export const SOLVANE: RegionDefinition = Object.freeze({
  id: 'solvane',
  name: 'Solvane Coast',
  version: 1,
  seed: 0x50a1e,
  half: 4096,
  seaLevel: 0,
  coast: [
    [-6400, -2250],
    [-4100, -2330],
    [-3300, -2620],
    [-2300, -2480],
    [-1200, -2880],
    [-100, -3020],
    [700, -2800],
    [1500, -2760],
    [2400, -2980],
    [3300, -2560],
    [3900, -2700],
    [4300, -2200],
    [6400, -2050],
  ],
  peaks: [
    { name: 'Mount Varda', x: VARDA[0], z: VARDA[1], height: 520, radius: 1700, ridge: 0.22 },
    { name: 'Varda North Spur', x: -1250, z: 3600, height: 340, radius: 1050, ridge: 0.25 },
    { name: 'Coldwater Fell', x: -3900, z: 4150, height: 330, radius: 1300, ridge: 0.2 },
  ],
  valley: {
    name: 'Ashvale',
    points: [
      [-1750, 1950, 128],
      [-1350, 1450, 104],
      [-900, 980, 82],
      [-480, 520, 62],
      [-60, -60, 44],
      [380, -760, 26],
      [800, -1500, 11],
      [1080, -2120, 2.2],
      [1150, -2700, -1.5],
    ],
    width: 230,
    channel: 11,
    channelDepth: 2.6,
  },
  flats: [
    {
      kind: 'town',
      name: 'Port Ilse',
      x0: 300,
      z0: -2700,
      x1: 2250,
      z1: -1780,
      blend: 260,
      height: 2.6,
      slopeZ: 0.02,
    },
    {
      kind: 'airfield',
      name: 'Kestrel Airfield',
      x0: 1540,
      z0: 1540,
      x1: 3900,
      z1: 1960,
      blend: 220,
      height: NaN,
      slopeZ: 0,
    },
    {
      kind: 'village',
      name: 'Ashvale',
      x0: -1020,
      z0: 560,
      x1: -520,
      z1: 900,
      blend: 120,
      height: NaN,
      slopeZ: 0,
    },
  ],
  forests: [
    { name: 'Thornwood', x: 1500, z: 3100, radius: 1500, density: 1 },
    { name: 'Varda lower woods', x: -2300, z: 1500, radius: 1300, density: 0.85 },
    { name: 'Coldwater pines', x: -3500, z: 2700, radius: 900, density: 0.8 },
    { name: 'Eastern copse', x: 3400, z: -300, radius: 700, density: 0.6 },
    { name: 'Valley alders', x: -200, z: 200, radius: 650, density: 0.45 },
  ],
  towns: [
    {
      id: 'port-ilse',
      name: 'Port Ilse',
      x0: 360,
      z0: -2660,
      x1: 2200,
      z1: -2060,
      floors: [2, 6],
      density: 0.82,
    },
    {
      id: 'ashvale',
      name: 'Ashvale',
      x0: -1000,
      z0: 580,
      x1: -540,
      z1: 880,
      floors: [1, 3],
      density: 0.55,
    },
  ],
  landmarks: [
    { kind: 'hangar', x: 2050, z: 1490, heading: 0, width: 46, length: 60, height: 15 },
    { kind: 'hangar', x: 2150, z: 1490, heading: 0, width: 46, length: 60, height: 15 },
    { kind: 'terminal', x: 2400, z: 1470, heading: 0, width: 24, length: 90, height: 9 },
    { kind: 'tower', x: 2560, z: 1480, heading: 0, width: 8, length: 8, height: 26 },
    { kind: 'hangar', x: 3300, z: 1480, heading: 0, width: 40, length: 52, height: 13 },
    { kind: 'lighthouse', x: 3930, z: -2460, heading: 0, width: 7, length: 7, height: 28 },
    { kind: 'farm', x: -2650, z: -1180, heading: 0.4, width: 14, length: 26, height: 8 },
    { kind: 'farm', x: -1680, z: -330, heading: -0.3, width: 12, length: 22, height: 7 },
    { kind: 'farm', x: 1520, z: 120, heading: 1.1, width: 14, length: 24, height: 8 },
    { kind: 'farm', x: 2950, z: -860, heading: 0.2, width: 12, length: 30, height: 8 },
    { kind: 'chapel', x: -780, z: 830, heading: 0.2, width: 10, length: 22, height: 14 },
    { kind: 'warehouse', x: 2350, z: -2600, heading: 0, width: 30, length: 70, height: 12 },
    { kind: 'warehouse', x: 2350, z: -2480, heading: 0, width: 30, length: 70, height: 12 },
  ],
  roads: [
    {
      id: 'h1',
      name: 'Coast Highway',
      roadClass: 'highway',
      points: [
        [-4000, -1880],
        [-3500, -1960],
        [-2900, -2060],
        [-2200, -1980],
        [-1500, -2160],
        [-800, -2250],
        [-150, -2180],
        [380, -1960],
        [1000, -1860],
        [1700, -1900],
        [2400, -1930],
        [3000, -1830],
        [3550, -1680],
        [4000, -1560],
      ],
    },
    {
      id: 'h2',
      name: 'Ridge Highway',
      roadClass: 'highway',
      points: [
        [3000, -1830],
        [3330, -1300],
        [3480, -500],
        [3420, 350],
        [3050, 1020],
        [2350, 1270],
        [1400, 1330],
        [500, 1260],
        [-300, 1080],
        [-1050, 820],
        [-1850, 560],
        [-2700, 240],
        [-3350, -350],
        [-3620, -1100],
        [-3500, -1960],
      ],
    },
    {
      id: 'valley',
      name: 'Ashvale Valley Road',
      roadClass: 'country',
      points: [
        [1000, -1860],
        [870, -1450],
        [560, -930],
        [210, -430],
        [-150, 50],
        [-500, 470],
        [-760, 740],
        [-1100, 1120],
        [-1450, 1560],
        [-1700, 1850],
      ],
    },
    {
      id: 'pass',
      name: 'Varda Pass',
      roadClass: 'mountain',
      points: [
        [-1700, 1850],
        ...switchbacks(VARDA, [
          [1342, -27],
          [1180, 28],
          [1125, 28],
          [990, -24],
          [935, -24],
          [800, 30],
          [745, 30],
          [620, -20],
          [565, -20],
          [480, 40],
        ]),
        ...arc(VARDA, [
          [500, 62],
          [560, 90],
          [620, 108],
          [660, 118],
        ]),
        ...switchbacks(VARDA, [
          [660, 118],
          [800, 196],
          [855, 196],
          [1010, 124],
          [1065, 124],
          [1250, 210],
        ]),
        [-3860, 1700],
        [-3780, 1200],
        [-3500, 760],
        [-3080, 430],
        [-2700, 240],
      ],
    },
    {
      id: 'airfield',
      name: 'Kestrel Runway and Taxiway',
      roadClass: 'runway',
      closed: true,
      points: [
        [1760, 1820],
        [2700, 1820],
        [3640, 1820],
        [3780, 1760],
        [3700, 1660],
        [2700, 1640],
        [1820, 1640],
        [1660, 1700],
      ],
    },
    {
      id: 'apron',
      name: 'Kestrel Access Road',
      roadClass: 'country',
      points: [
        [2700, 1640],
        [2640, 1460],
        [2470, 1330],
        [2350, 1270],
      ],
    },
    {
      id: 'farm',
      name: 'Saltmarsh Farm Road',
      roadClass: 'country',
      points: [
        [-2200, -1980],
        [-2350, -1500],
        [-2280, -900],
        [-1900, -450],
        [-1200, -330],
        [-500, -400],
        [210, -430],
      ],
    },
    {
      id: 'orchard',
      name: 'Orchard Lane',
      roadClass: 'country',
      points: [
        [-800, -2250],
        [-760, -1700],
        [-520, -1250],
        [-150, -840],
        [210, -430],
      ],
    },
    {
      id: 'plateau',
      name: 'Plateau Road',
      roadClass: 'country',
      points: [
        [-760, 740],
        [-200, 640],
        [400, 420],
        [1000, 200],
        [1700, -150],
        [2400, -550],
        [2900, -820],
        [3480, -500],
      ],
    },
    {
      id: 'lighthouse',
      name: 'Lighthouse Road',
      roadClass: 'country',
      points: [
        [3550, -1680],
        [3720, -2000],
        [3860, -2300],
        [3900, -2400],
      ],
    },
    {
      id: 'thornwood',
      name: 'Thornwood Trail',
      roadClass: 'dirt',
      points: [
        [1400, 1330],
        [1520, 1900],
        [1350, 2500],
        [1150, 3100],
        [1600, 3550],
        [2300, 3650],
        [2950, 3300],
        [3350, 2700],
        [3600, 2200],
        [3780, 1760],
      ],
    },
    {
      id: 'quarry',
      name: 'Quarry Track',
      roadClass: 'dirt',
      points: [
        [-1450, 1560],
        [-1950, 1350],
        [-2450, 1150],
        [-2950, 1250],
        [-3350, 1500],
        [-3860, 1700],
      ],
    },
    {
      id: 'dunes',
      name: 'Dune Track',
      roadClass: 'dirt',
      points: [
        [-2900, -2060],
        [-2600, -2300],
        [-2000, -2350],
        [-1500, -2160],
      ],
    },
    {
      id: 'harbour',
      name: 'Harbour Front',
      roadClass: 'town',
      points: [
        [420, -2600],
        [900, -2600],
        [1400, -2600],
        [1900, -2600],
        [2150, -2600],
      ],
    },
    {
      id: 'market',
      name: 'Market Street',
      roadClass: 'town',
      points: [
        [420, -2400],
        [900, -2400],
        [1400, -2400],
        [1900, -2400],
        [2150, -2400],
      ],
    },
    {
      id: 'upper',
      name: 'Upper Street',
      roadClass: 'town',
      points: [
        [420, -2200],
        [900, -2200],
        [1400, -2200],
        [1900, -2200],
        [2150, -2200],
      ],
    },
    {
      id: 'west-quay',
      name: 'West Quay',
      roadClass: 'town',
      points: [
        [420, -2600],
        [420, -2400],
        [420, -2200],
        [400, -1985],
      ],
    },
    {
      id: 'chandlers',
      name: 'Chandlers Row',
      roadClass: 'town',
      points: [
        [800, -2600],
        [800, -2400],
        [800, -2200],
        [800, -1900],
      ],
    },
    {
      id: 'bell',
      name: 'Bell Street',
      roadClass: 'town',
      points: [
        [1250, -2600],
        [1250, -2400],
        [1250, -2200],
        [1250, -1870],
      ],
    },
    {
      id: 'ropewalk',
      name: 'Ropewalk',
      roadClass: 'town',
      points: [
        [1700, -2600],
        [1700, -2400],
        [1700, -2200],
        [1700, -1900],
      ],
    },
    {
      id: 'east-quay',
      name: 'East Quay',
      roadClass: 'town',
      points: [
        [2150, -2600],
        [2150, -2400],
        [2150, -2200],
        [2200, -1925],
      ],
    },
  ],
  overpasses: [{ over: 'h2', under: 'valley' }],
  events: [
    {
      id: 'coast-to-summit',
      name: 'Coast to Summit',
      kind: 'road-race',
      waypoints: [
        [1000, -2200],
        [-760, 740],
        [-2657, 2885],
      ],
      rivals: 5,
      blurb: 'Harbour streets, the Ashvale valley and every hairpin of the Varda Pass.',
    },
    {
      id: 'grand-loop',
      name: 'Solvane Grand Loop',
      kind: 'circuit',
      waypoints: [
        [2400, -1930],
        [3420, 350],
        [-1050, 820],
        [-3350, -350],
        [-1500, -2160],
      ],
      laps: 1,
      rivals: 5,
      blurb: 'The full highway ring: coast, ridge and back, flat out.',
    },
    {
      id: 'port-ilse-loop',
      name: 'Port Ilse Street Loop',
      kind: 'circuit',
      waypoints: [
        [1000, -2600],
        [1700, -2500],
        [1500, -2200],
        [800, -2300],
      ],
      laps: 3,
      rivals: 5,
      blurb: 'Tight harbour-front streets, three laps, no room for mistakes.',
    },
    {
      id: 'kestrel-circuit',
      name: 'Kestrel Airfield Circuit',
      kind: 'circuit',
      waypoints: [
        [2200, 1820],
        [3700, 1660],
        [1820, 1640],
      ],
      laps: 2,
      rivals: 5,
      blurb: 'Runway and taxiway at full speed, two laps.',
    },
    {
      id: 'valley-sprint',
      name: 'Ashvale Sprint',
      kind: 'sprint',
      waypoints: [
        [870, -1450],
        [-500, 470],
      ],
      rivals: 3,
      blurb: 'A short, fast blast up the valley road.',
    },
    {
      id: 'thornwood-rally',
      name: 'Thornwood Dirt Sprint',
      kind: 'sprint',
      waypoints: [
        [1520, 1900],
        [2950, 3300],
        [3780, 1760],
      ],
      rivals: 3,
      blurb: 'Loose forest track from the airfield edge to the far gate.',
    },
    {
      id: 'ridge-trap',
      name: 'Ridge Highway Speed Trap',
      kind: 'speed-trap',
      waypoints: [
        [3420, 50],
        [3420, 350],
      ],
      stars: [180, 230, 270],
      blurb: 'Carry speed through the camera on the long ridge straight.',
    },
    {
      id: 'coast-trap',
      name: 'Coast Highway Speed Trap',
      kind: 'speed-trap',
      waypoints: [
        [-2600, -2020],
        [-2200, -1980],
      ],
      stars: [170, 220, 260],
      blurb: 'Seaside camera at the end of the coastal sweepers.',
    },
    {
      id: 'pass-zone',
      name: 'Varda Pass Speed Zone',
      kind: 'speed-zone',
      waypoints: [
        [-2657, 2885],
        [-3656, 2529],
      ],
      stars: [80, 105, 125],
      blurb: 'Average speed across the high pass. Keep it tidy.',
    },
    {
      id: 'plateau-zone',
      name: 'Plateau Speed Zone',
      kind: 'speed-zone',
      waypoints: [
        [400, 420],
        [1700, -150],
      ],
      stars: [110, 140, 165],
      blurb: 'Rolling country straights across the plateau.',
    },
    {
      id: 'hairpin-drift',
      name: 'Varda Hairpins Drift Zone',
      kind: 'drift-zone',
      waypoints: [
        [-1678, 2638],
        [-2443, 2658],
      ],
      stars: [3000, 7000, 12000],
      blurb: 'Link the switchbacks sideways. Points for angle, duration and combos.',
    },
    {
      id: 'quarry-drift',
      name: 'Quarry Track Drift Zone',
      kind: 'drift-zone',
      waypoints: [
        [-1950, 1350],
        [-3350, 1500],
      ],
      stars: [2500, 6000, 10000],
      blurb: 'Loose surface, long slides.',
    },
    {
      id: 'runway-showcase',
      name: 'Runway Showcase',
      kind: 'showcase',
      waypoints: [
        [1820, 1820],
        [3640, 1820],
        [3050, 1020],
        [3480, -500],
      ],
      rivals: 1,
      stars: [150, 140, 132],
      blurb: 'Exhibition run: the full runway, onto the ridge highway, against a pace car.',
    },
    {
      id: 'harbour-welcome',
      name: 'Harbour Opening Run',
      kind: 'sprint',
      waypoints: [
        [650, -2600],
        [1250, -2480],
        [1640, -2400],
        [1700, -2180],
        [2040, -2200],
      ],
      rivals: 2,
      blurb:
        'Your first festival run: the waterfront, market and upper streets. Brake before each turn and chase two rivals.',
    },
    {
      id: 'kestrel-drift',
      name: 'Kestrel Drift Playground',
      kind: 'drift-zone',
      waypoints: [
        [3550, 1820],
        [3700, 1660],
        [3320, 1640],
      ],
      stars: [100, 300, 600],
      blurb:
        'A wide taxiway turn for learning to link a slide. Carry speed through the gate, countersteer and exit cleanly.',
    },
    {
      id: 'runway-launch',
      name: 'Kestrel Launch Run',
      kind: 'speed-trap',
      waypoints: [
        [2150, 1820],
        [3450, 1820],
      ],
      stars: [110, 160, 210],
      blurb:
        'Build speed along the broad runway and cross the speed gate. Three reachable targets from road cars to supercars.',
    },
  ],
} as RegionDefinition);
