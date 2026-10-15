import type { CircuitSpec, Segment } from './builder.ts';
import { A, S, gpPit } from './dsl.ts';

/** Original unconventional venues (catalogue wave 2). */

/** Container terminal at night: a figure-eight through the stacks — quay
 * straights under portal cranes, a lower diagonal underpass and a flyover
 * that climbs over it (layer-aware progress keeps each road's identity). */
const gantryPath: Segment[] = [
  S(500, { drs: true, y: 0, drop: 'left', gantry: true, stands: 'right' }),
  A(35, -90, {
    name: 'BERTH ONE',
    y: 0,
    stands: 'out',
    barrier: { side: 'out', offset: 8, kind: 'tyre' },
  }),
  S(500, { y: 0, gantry: true }),
  A(40, -90, { name: 'REEFER YARD', y: 0 }),
  S(700, { drs: true, y: 0, gantry: true }),
  A(60, -45, { name: 'STRADDLE', y: -0.5 }),
  S(700, { y: -1.5 }),
  A(50, 45, { name: 'CUSTOMS GATE', y: -1 }),
  S(600, { y: 0, gantry: true }),
  A(35, 90, { name: 'BOLLARD', y: 0, stands: 'out' }),
  S(455, { y: 0, drop: 'right' }),
  A(35, 90, { name: 'LASHING', y: 0, barrier: { side: 'out', offset: 8, kind: 'tyre' } }),
  S(456, { y: 0, gantry: true }),
  A(60, 45, { name: 'FLYOVER', y: 0.5 }),
  S(380, { y: 9.5, barrier: { offset: 2.5, kind: 'concrete' } }),
  S(380, { y: 1.5, barrier: { offset: 2.5, kind: 'concrete' } }),
  A(60, -45, { name: 'HAWSER', y: 0 }),
  S(300, { drs: true, y: 0, drop: 'left', gantry: true, stands: 'right' }),
];
const gantryCommon = {
  group: 'unconventional' as const,
  venue: 'gantry-point',
  venueName: 'Gantry Point Container Terminal',
  theme: 'dockyard' as const,
  signage: 'GANTRY POINT',
  night: true,
  heading: 0,
  winding: 0 as const,
  seaLevel: -3,
  halfWidth: 7.4,
  elevationSmoothing: 40,
  crossFall: 0.015,
  barrier: { kind: 'concrete' as const, offset: 4.5 },
  runoff: { straight: 'asphalt' as const, outside: 'asphalt' as const, inside: 'asphalt' as const },
  path: gantryPath,
};
const gantryPoint: CircuitSpec = {
  ...gantryCommon,
  id: 'gantry-point',
  name: 'GANTRY POINT / NIGHT TERMINAL',
  short: 'GANTRY POINT',
  layout: 'Grand Prix',
  description:
    'A floodlit container terminal: quay straights under portal cranes and a figure-eight whose flyover climbs over the underpass.',
  pit: gpPit(1),
};
const gantryPointReverse: CircuitSpec = {
  ...gantryCommon,
  id: 'gantry-point-reverse',
  name: 'GANTRY POINT / REVERSE',
  short: 'GANTRY REV',
  layout: 'Reverse',
  description:
    'The terminal the other way: drop off the flyover into the stacks and dive under it on the return.',
  reverse: true,
  variantOf: 'gantry-point',
  // The flyover exit corner comes 323 m after the line: a shorter merge.
  pit: gpPit(-1, {
    mergeStart: 195,
    mergeEnd: 275,
    sectionAfter: 255,
    limitAfter: 200,
    holdLine: 240,
    exitAfter: 275,
  }),
};

/** Salt-flat airbase: a two-kilometre runway, a heavy stop into a fast
 * sweeper across the salt, a chicane through the blast fence, the hangar
 * apron and a flat-out kink back onto the runway. */
const brightBasin: CircuitSpec = {
  id: 'salt-flat',
  name: 'BRIGHT BASIN / SALT FLAT AIRBASE',
  short: 'BRIGHT BASIN',
  group: 'unconventional',
  venue: 'salt-flat',
  venueName: 'Bright Basin Salt Flat Airbase',
  layout: 'High-Speed Course',
  description:
    'Flat-out on a salt-flat airbase: a two-kilometre runway, sweepers across the salt, a blast-fence chicane and the hangar apron.',
  theme: 'salt-flat',
  heading: 0,
  winding: -1,
  length: 6800,
  halfWidth: 9,
  elevationSmoothing: 120,
  crossFall: 0.01,
  barrier: { kind: 'armco', offset: 18 },
  runoff: { straight: 'asphalt', outside: 'asphalt', inside: 'asphalt' },
  pit: gpPit(1, { offset: 26, boxLateral: 28.1 }),
  path: [
    S(400, { drs: true, w: 10, stands: 'left', barrier: { kind: 'concrete', side: 'right' } }),
    A(60, -100, {
      name: 'THRESHOLD',
      barrier: { side: 'out', offset: 25, kind: 'tyre' },
      stands: 'out',
    }),
    S(300),
    A(250, -40, { name: 'WINDSOCK' }),
    S(900),
    A(400, -60, { name: 'SALT PAN', y: 0.3 }),
    S(1100, { drs: true, y: 0.3 }),
    A(30, 40, {
      name: 'BLAST FENCE',
      runoff: { out: 'asphalt', in: 'asphalt' },
      barrier: { side: 'out', offset: 20, kind: 'tyre' },
      stands: 'out',
    }),
    S(20),
    A(30, -40),
    S(400),
    A(80, -70, { name: 'HANGAR ROW', stands: 'out' }),
    S(338, { facades: 'left' }),
    A(60, -60, { name: 'TOWER', facades: 'out' }),
    S(300),
    A(300, -30, { name: 'MIRAGE' }),
    S(1844, { drs: true, w: 10, stands: 'left', barrier: { kind: 'concrete', side: 'right' } }),
  ],
};

export const INDUSTRIAL_SPECS: readonly CircuitSpec[] = [
  gantryPoint,
  gantryPointReverse,
  brightBasin,
];
