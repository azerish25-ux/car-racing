import type { CircuitSpec, Segment } from './builder.ts';
import { A, S, bends, compactPit, gpPit } from './dsl.ts';

/** Night and street circuits (catalogue wave 2): approximations of famous
 * floodlit and street venues from public geometry, under neutral original
 * names (no official circuit, corner or event names; see
 * ASSET_PROVENANCE.md). Not licensed reproductions. */

const ramla = {
  group: 'real-world' as const,
  venue: 'ramla',
  venueName: 'Ramla Desert Circuit',
  theme: 'night-desert' as const,
  night: true,
  heading: -90,
  winding: -1 as const,
  y0: 6,
  halfWidth: 7.6,
  elevationSmoothing: 60,
  barrier: { kind: 'armco' as const, offset: 12 },
  runoff: { straight: 'asphalt' as const, outside: 'asphalt' as const, inside: 'asphalt' as const },
  pit: gpPit(1),
};
/** Opening shared by both desert layouts: the long main straight into a
 * slow right, a left-right and a fast run to the fourth corner. */
const ramlaOpening = (run: number): Segment[] => [
  S(600, { drs: true, w: 8, y: 6, stands: 'left', barrier: { kind: 'concrete', side: 'right' } }),
  A(30, -120, {
    name: 'BAB',
    y: 5,
    barrier: { side: 'out', offset: 22, kind: 'tyre' },
    stands: 'out',
  }),
  S(300, { y: 5 }),
  A(60, 40, { name: 'NAKHLA', y: 6 }),
  S(30, { y: 6 }),
  A(100, -40, { y: 7 }),
  S(run, { drs: true, y: 9 }),
  A(35, -60, { name: 'WAHA', y: 10, stands: 'out' }),
];
/** Desert night circuit: floodlit, clockwise — a long straight, a slow
 * first right, flowing esses, a right hairpin, a downhill double left, a long
 * left, three rights, a long diagonal straight and a last right onto the
 * straight. Asphalt run-off. */
const ramlaNight: CircuitSpec = {
  ...ramla,
  id: 'ramla-night',
  name: 'RAMLA / GRAND PRIX',
  short: 'RAMLA',
  layout: 'Grand Prix',
  description:
    'Floodlit desert night race: long straights, a slow first right, flowing esses, a downhill double left and wide asphalt run-off.',
  length: 5412,
  referenceLength: 5412,
  path: [
    ...ramlaOpening(1000),
    S(134, { y: 10 }),
    A(80, 40, { name: 'KATHIB', y: 11 }),
    A(70, -40, { y: 12 }),
    A(80, 40, { y: 13 }),
    S(60, { y: 14 }),
    A(25, -120, { name: 'FANAR', y: 14, stands: 'out' }),
    S(572, { y: 13 }),
    // The downhill double left.
    A(80, 30, { name: 'QAMAR', y: 11 }),
    S(60, { y: 9 }),
    A(35, 40, { name: 'HILAL', y: 7, stands: 'out' }),
    S(150, { y: 5 }),
    A(100, 90, { name: 'SAHRA', y: 4 }),
    A(100, -60, { y: 3 }),
    S(80, { y: 3 }),
    A(40, -90, { name: 'DAHAB', y: 4, stands: 'out' }),
    S(150, { y: 4 }),
    A(60, -60, { name: 'NAJMA', y: 4 }),
    S(850, { drs: true, y: 5 }),
    A(80, -50, { name: 'BURJ', y: 5, stands: 'out' }),
    S(500, { drs: true, w: 8, y: 6, barrier: { kind: 'concrete', side: 'right' } }),
  ],
};
/** Outer circuit: the same opening, then a flat-out link across the desert
 * to the last three corners — a short, fast night sprint. */
const ramlaOuter: CircuitSpec = {
  ...ramla,
  id: 'ramla-outer',
  name: 'RAMLA / OUTER CIRCUIT',
  short: 'RAMLA OUTER',
  layout: 'Outer Circuit',
  description:
    'The short outer loop under floodlights: the opening corners, a flat-out desert link and the last three corners.',
  variantOf: 'ramla-night',
  length: 3543,
  referenceLength: 3543,
  path: [
    ...ramlaOpening(451),
    S(635, { y: 9 }),
    A(200, -60, { name: 'DUNE LINK', y: 8 }),
    S(250, { drs: true, y: 7 }),
    A(150, -30, { name: 'MIRAGE', y: 6 }),
    S(150, { y: 5 }),
    A(100, -40, { name: 'NAJMA', y: 4 }),
    S(300, { y: 4 }),
    A(40, -50, { name: 'BURJ', y: 5, stands: 'out' }),
    S(500, { drs: true, w: 8, y: 6, barrier: { kind: 'concrete', side: 'right' } }),
  ],
};

/** Caspian boulevard street circuit: anticlockwise — a 2 km flat-out run
 * along the seafront, a grid of right-angle city corners and a narrow, steep
 * climb through the old fortress walls. */
const mirvari: CircuitSpec = {
  id: 'mirvari',
  name: 'MIRVARI / BOULEVARD STREETS',
  short: 'MIRVARI',
  group: 'real-world',
  venue: 'mirvari',
  venueName: 'Mirvari Boulevard Street Circuit',
  layout: 'Grand Prix',
  description:
    'Seafront streets: right-angle city corners, a narrow climb through the old fortress walls and a 2 km flat-out boulevard.',
  theme: 'caspian-city',
  heading: 0,
  winding: 1,
  length: 6003,
  referenceLength: 6003,
  seaLevel: 0,
  y0: 2,
  halfWidth: 6.2,
  elevationSmoothing: 40,
  crossFall: 0.02,
  barrier: { kind: 'concrete', offset: 2.4 },
  runoff: { straight: 'asphalt', outside: 'asphalt', inside: 'asphalt' },
  pit: gpPit(-1, { offset: 18, boxLateral: 20.1 }),
  path: [
    S(330, { drs: true, w: 6.6, y: 2, facades: 'left', drop: 'right' }),
    A(25, 90, {
      name: 'BULVAR',
      y: 2,
      barrier: { side: 'out', offset: 9, kind: 'tyre' },
      stands: 'out',
    }),
    S(397, { y: 4, facades: 'both' }),
    A(25, 90, { name: 'MEYDAN', y: 5, facades: 'both' }),
    S(750, { y: 7, facades: 'both' }),
    A(25, -90, {
      name: 'BAZAR',
      y: 8,
      facades: 'both',
      barrier: { side: 'out', offset: 7, kind: 'tyre' },
    }),
    S(200, { y: 9, facades: 'both' }),
    A(25, 90, { y: 10, facades: 'both' }),
    S(400, { y: 11, facades: 'both' }),
    A(25, -90, { name: 'KARVANSARA', y: 12, facades: 'both' }),
    S(150, { y: 13, facades: 'both' }),
    A(25, 90, { y: 14, facades: 'both' }),
    S(150, { y: 16, facades: 'both' }),
    // The old town: 8.6 m between the fortress walls, climbing.
    A(20, 30, { name: 'QALA QAPISI', y: 18, w: 4.3, rock: 'both' }),
    S(60, { y: 20, w: 4.3, rock: 'both' }),
    A(18, -60, { y: 22, w: 4.3, rock: 'both' }),
    S(50, { y: 24, w: 4.3, rock: 'both' }),
    A(20, 50, { name: 'DAR KÜÇƏ', y: 25, w: 4.3, rock: 'both' }),
    S(60, { y: 26, w: 4.3, rock: 'both' }),
    A(25, -40, { y: 26, w: 4.6, rock: 'right' }),
    S(80, { y: 25, facades: 'both' }),
    A(30, 40, { y: 24, facades: 'both' }),
    A(40, 30, { name: 'SARAY', y: 22, facades: 'both' }),
    S(200, { y: 18, facades: 'both' }),
    A(80, -30, { y: 15, facades: 'both' }),
    S(200, { y: 12, facades: 'both' }),
    A(60, 40, { name: 'MİNARƏ', y: 9, facades: 'out' }),
    S(200, { y: 6 }),
    A(100, 30, { y: 4 }),
    S(250, { y: 3, facades: 'left' }),
    A(30, 90, { name: 'DƏNİZ', y: 2, stands: 'out' }),
    S(691, { drs: true, w: 6.6, y: 2, facades: 'left', drop: 'right' }),
    A(800, -10, { w: 6.6, y: 2, facades: 'left', drop: 'right' }),
    S(500, { drs: true, w: 6.6, y: 2, facades: 'left', drop: 'right' }),
    A(800, 10, { w: 6.6, y: 2, facades: 'left', drop: 'right' }),
    S(400, { drs: true, w: 6.6, y: 2, facades: 'left', drop: 'right' }),
  ],
};

/** Bay night street circuit: anticlockwise round the marina under
 * floodlights — a hairpin after the first corners, a long boulevard, a grid
 * of right-angle corners, a narrow river bridge and a bayfront road. */
const lanternBay: CircuitSpec = {
  id: 'lantern-bay',
  name: 'LANTERN BAY / NIGHT STREETS',
  short: 'LANTERN BAY',
  group: 'real-world',
  venue: 'lantern-bay',
  venueName: 'Lantern Bay Street Circuit',
  layout: 'Grand Prix',
  description:
    'A night street race round the marina: a hairpin, a long boulevard, right-angle corners, a narrow river bridge and the bayfront.',
  theme: 'bay-city',
  night: true,
  heading: 0,
  winding: 1,
  length: 4940,
  referenceLength: 4940,
  seaLevel: -2,
  y0: 1,
  halfWidth: 6.4,
  elevationSmoothing: 40,
  crossFall: 0.02,
  barrier: { kind: 'concrete', offset: 2.6 },
  runoff: { straight: 'asphalt', outside: 'asphalt', inside: 'asphalt' },
  pit: gpPit(-1, { offset: 18, boxLateral: 20.1 }),
  path: [
    S(320, { drs: true, w: 6.8, facades: 'right', stands: 'right' }),
    A(25, 80, {
      name: 'HARBOUR GATE',
      barrier: { side: 'out', offset: 9, kind: 'tyre' },
      stands: 'out',
    }),
    S(40),
    A(25, -50, { facades: 'out' }),
    S(80),
    A(20, 150, { name: 'TIGER', barrier: { side: 'out', offset: 8, kind: 'tyre' }, stands: 'out' }),
    S(500, { drs: true, facades: 'both' }),
    A(500, -12, { facades: 'both' }),
    S(400, { drs: true, facades: 'both' }),
    A(500, 12, { facades: 'both' }),
    S(200, { facades: 'both' }),
    A(25, 90, { name: 'CLOCKTOWER', facades: 'both', stands: 'out' }),
    S(250, { facades: 'both' }),
    A(25, -90, { name: 'TEMPLE', facades: 'both' }),
    S(300, { facades: 'both' }),
    A(25, 90, { name: 'MARKET', facades: 'both' }),
    S(120, { facades: 'both' }),
    // River bridge: narrow, water both sides.
    S(120, { w: 5.6, drop: 'both', y: 2 }),
    S(80, { facades: 'both', y: 1 }),
    A(20, 90, { name: 'FERRY', facades: 'out', barrier: { side: 'out', offset: 7, kind: 'tyre' } }),
    S(400, { drop: 'right', facades: 'left', stands: 'left' }),
    A(25, -90, { name: 'QUAYSIDE', facades: 'in' }),
    S(150, { drop: 'both' }),
    A(25, 90, { name: 'BAYFRONT', stands: 'out' }),
    S(481, { drop: 'right', facades: 'left', stands: 'left' }),
    A(25, 90, { name: 'HAWKER', facades: 'out' }),
    S(555, { facades: 'both' }),
    A(25, -90, { name: 'ORCHID', stands: 'out' }),
    S(250, { drs: true, w: 6.8, facades: 'right', stands: 'right' }),
  ],
};

/** Harbour hill street circuit: clockwise — a fast seafront run with a
 * flat-out right kink, a slow harbour hairpin, a climb up the hillside, a
 * narrow twisting hilltop, two switchback hairpins down and a right onto the
 * seafront. Walls at the kerb throughout. */
const lotusHillPath: Segment[] = [
  S(700, { drs: true, w: 6.4, y: 2, drop: 'left', facades: 'right' }),
  A(400, -25, { name: 'GRANDE CURVA', w: 6.4, y: 2, drop: 'out', facades: 'in' }),
  S(900, { drs: true, w: 6.4, y: 2, drop: 'left', facades: 'right' }),
  A(25, -95, {
    name: 'BAÍA',
    y: 3,
    barrier: { side: 'out', offset: 9, kind: 'tyre' },
    stands: 'out',
  }),
  S(400, { y: 14, facades: 'both' }),
  A(40, 40, { name: 'SÃO JORGE', y: 16, facades: 'both' }),
  S(150, { y: 22, facades: 'both' }),
  A(40, -50, { name: 'COLINA', y: 25, facades: 'out' }),
  S(300, { y: 30, rock: 'left' }),
  A(50, -50, { name: 'MIRANTE', y: 32, drop: 'out' }),
  // Hilltop: narrow and twisting between walls.
  A(30, 40, { name: 'CALÇADA', y: 33, w: 4.8, rock: 'in' }),
  S(60, { y: 33, w: 4.8 }),
  A(30, -60, { y: 33, w: 4.8, rock: 'out' }),
  S(60, { y: 32, w: 4.8 }),
  A(30, 40, { y: 31, w: 4.8 }),
  S(100, { y: 30, w: 4.8, rock: 'left' }),
  A(40, -40, { name: 'FAROL', y: 29, w: 4.8 }),
  S(250, { y: 26, w: 4.8, drop: 'left' }),
  A(14, -170, { name: 'GANCHO', y: 24, w: 5.6, stands: 'out' }),
  S(150, { y: 20, w: 4.8, rock: 'right' }),
  A(14, 170, { name: 'MARÉ', y: 17, w: 5.6 }),
  ...bends(1300, 120, 25, 17, 10, ['SOLAR', undefined, 'JARDIM'], { facades: 'both' }),
  A(30, -70, { name: 'CURVA DO PORTO', y: 6, facades: 'out' }),
  S(719, { y: 4, facades: 'both' }),
  A(30, -90, {
    name: 'CAIS',
    y: 2,
    barrier: { side: 'out', offset: 9, kind: 'tyre' },
    stands: 'out',
  }),
  S(255, { drs: true, w: 6.4, y: 2, drop: 'left', facades: 'right' }),
];
const lotusHill: CircuitSpec = {
  id: 'lotus-hill',
  name: 'LOTUS HILL / HARBOUR STREETS',
  short: 'LOTUS HILL',
  group: 'real-world',
  venue: 'lotus-hill',
  venueName: 'Lotus Hill Harbour Circuit',
  layout: 'Grand Prix',
  description:
    'Harbour streets: a flat-out seafront kink, a slow hairpin, a narrow hilltop between walls and two switchbacks down the hill.',
  theme: 'harbour-street',
  signage: 'LOTUS HILL',
  heading: 0,
  winding: -1,
  length: 6120,
  referenceLength: 6120,
  seaLevel: 0,
  y0: 2,
  halfWidth: 5.8,
  elevationSmoothing: 40,
  crossFall: 0.02,
  barrier: { kind: 'concrete', offset: 2.2 },
  runoff: { straight: 'asphalt', outside: 'asphalt', inside: 'asphalt' },
  pit: compactPit(1),
  path: lotusHillPath,
};

export const NIGHT_AND_STREET_SPECS: readonly CircuitSpec[] = [
  ramlaNight,
  ramlaOuter,
  mirvari,
  lanternBay,
  lotusHill,
];
