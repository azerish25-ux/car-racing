import type { CircuitDefinition, PitLaneDefinition } from '../circuits.ts';
import { defineCircuit, type CircuitSpec, type Segment } from '../circuit-catalogue/builder.ts';
import { A, S } from '../circuit-catalogue/dsl.ts';
import type { OffroadCircuitId } from '../circuit-catalogue/venue-data.ts';
import type { Track } from '../track.ts';
import { OffroadCourse, type OffroadCourseSpec } from './course.ts';
import { TrackTerrainSurface } from './course-terrain.ts';
import { ProfileBuilder, type JumpSurvey } from './profile.ts';
import type { OffroadVenueData } from './types.ts';
import { OFFROAD_CLASSES } from './formats.ts';

/** The four terrain venues (WP37-WP41, GAME_DESIGN §8 off-road row), built
 * through the circuit-catalogue builder (centreline, widths, barriers, pit
 * and menu data, validated by `validate:content`) plus an off-road course:
 * the jump profile, berms, soils, moisture, and the venue's format geometry
 * (motocross start gate, rallycross joker road, rally stage controls).
 * Original names and layouts; no real venue, series or organiser. */
export interface OffroadVenue extends OffroadVenueData {
  readonly course: OffroadCourse;
}
const DEG = Math.PI / 180;
/** A compact mechanics area (no pit service in these formats, but the
 * paddock template, grid and release geometry stay exact): the straight
 * must run from 45 m before the line to 75 m after it. */
export function mechanicsArea(
  side: 1 | -1,
  overrides: Partial<PitLaneDefinition> = {},
): PitLaneDefinition {
  return Object.freeze({
    side,
    offset: 14,
    divergeStart: 70,
    divergeEnd: 45,
    mergeStart: 75,
    mergeEnd: 100,
    sectionBefore: 65,
    sectionAfter: 95,
    limitBefore: 60,
    limitAfter: 70,
    entry: 55,
    firstBox: 4,
    boxSpacing: 5,
    boxLateral: 16,
    holdLine: 72,
    exitAfter: 100,
    exitBefore: 70,
    gridStart: 10,
    gridRow: 8,
    gridColumn: 2.2,
    ...overrides,
  });
}
/** Authored distance -> lap distance through the built circuit's named
 * corners (the builder keeps every arc and shares the closure error between
 * straights, so the map is piecewise linear between corner middles). */
function lapMap(spec: CircuitSpec, circuit: CircuitDefinition, length: number) {
  const anchors: [number, number][] = [[0, 0]];
  let d = 0;
  const starts: number[] = [];
  for (const seg of spec.path) {
    starts.push(d);
    const run = seg.r !== undefined ? seg.r * Math.abs((seg.turn ?? 0) * DEG) : (seg.s ?? 0);
    if (seg.name) {
      const corner = circuit.corners.find((c) => c.name === seg.name);
      if (!corner) throw new Error(`${spec.id}: corner ${seg.name} not built`);
      anchors.push([d + run / 2, corner.s]);
    }
    d += run;
  }
  anchors.push([d, length]);
  anchors.sort((a, b) => a[0] - b[0]);
  const toLap = (authored: number) => {
    let i = 0;
    while (i < anchors.length - 2 && anchors[i + 1][0] < authored) i++;
    const [a0, s0] = anchors[i],
      [a1, s1] = anchors[i + 1];
    return s0 + ((s1 - s0) * (authored - a0)) / (a1 - a0 || 1);
  };
  /** Lap distance of `local` metres into authored segment `index`. */
  return (index: number, local = 0) => toLap(starts[index] + local);
}
type Authoring = (
  at: (segment: number, local?: number) => number,
  profile: ProfileBuilder,
  length: number,
) => Omit<OffroadCourseSpec, 'kind'>;
function venue(spec: CircuitSpec, kind: OffroadCourseSpec['kind'], author: Authoring) {
  const circuit = defineCircuit(spec),
    length = circuit.catalogue.length,
    at = lapMap(spec, circuit, length),
    builder = new ProfileBuilder(),
    data = author(at, builder, length),
    built = builder.build();
  const course = new OffroadCourse(
    { kind, ...data },
    built.profile,
    built.jumps,
    built.rough,
    length,
  );
  const offroad: OffroadVenue = Object.freeze({
    kind,
    course,
    createSurface: (track: Track) => new TrackTerrainSurface(track, course),
  });
  const bikes = kind === 'motocross' || kind === 'supercross';
  return Object.freeze({
    ...circuit,
    offroad,
    jumps: Object.freeze(built.jumps.map((j: JumpSurvey) => Object.freeze({ ...j }))),
    // What races here (career/registry.ts reads these).
    surface: kind === 'rallycross' ? 'mixed' : kind === 'rally-stage' ? 'gravel' : 'dirt',
    classes: bikes ? OFFROAD_CLASSES.bikes : OFFROAD_CLASSES.cars,
    formats: Object.freeze([bikes ? 'moto' : kind === 'rallycross' ? 'rallycross' : 'stage']),
  });
}
const berm = (h: number, extra: Partial<Segment> = {}) => ({ ...extra, berm: h });
/** Berm heights authored on the arcs (index -> m), resolved after building. */
function berms(
  path: readonly (Segment & { berm?: number })[],
  at: (i: number, l?: number) => number,
) {
  const out: { from: number; to: number; height: number; side: 1 | -1 }[] = [];
  path.forEach((seg, i) => {
    if (!seg.berm || seg.r === undefined || seg.turn === undefined) return;
    const run = seg.r * Math.abs(seg.turn * DEG);
    // The builder's outside of an arc is its turn's hand (venue-data sides).
    out.push({
      from: at(i, -4),
      to: at(i, run + 4),
      height: seg.berm,
      side: seg.turn > 0 ? 1 : -1,
    });
  });
  return out;
}

// ---- Valley Ridge: outdoor motocross on a hillside (anticlockwise) --------
const valleyPath: (Segment & { berm?: number })[] = [
  S(110, { w: 6.5, stands: 'left' }),
  A(18, 180, berm(1.3, { name: 'FIRST BERM', y: 1, stands: 'out' })),
  S(90, { y: 2.5 }),
  A(14, -90, berm(1.0, { name: 'QUARRY', y: 3 })),
  S(80, { y: 5.5 }),
  A(14, -90, berm(1.0, { name: 'BARN', y: 6 })),
  S(70, { y: 6.5 }),
  A(18, 180, berm(1.4, { name: 'OAK BERM', y: 7, stands: 'out' })),
  S(150, { y: 6 }),
  A(20, 90, berm(1.2, { name: 'SKY BERM', y: 5 })),
  S(140, { y: 2 }),
  A(20, 90, berm(1.1, { name: 'LAST BERM', y: 0.5, w: 6.5 })),
  S(60, { w: 6.5, stands: 'left' }),
];
const VALLEY_RIDGE = venue(
  {
    id: 'valley-ridge-mx',
    name: 'VALLEY RIDGE / MOTOCROSS',
    short: 'VALLEY RIDGE',
    group: 'off-road',
    venue: 'valley-ridge-mx',
    venueName: 'Valley Ridge Motocross Park',
    layout: 'National',
    description:
      'Hillside loam with a long start straight, tabletops, a barn double, washboard whoops, a triple and tall berms.',
    theme: 'motocross',
    heading: 0,
    winding: 1,
    halfWidth: 5,
    elevationSmoothing: 25,
    crossFall: 0.01,
    barrier: { kind: 'tyre', offset: 3 },
    runoff: { straight: 'grass', outside: 'grass', inside: 'grass' },
    pit: mechanicsArea(1),
    path: valleyPath,
  },
  'motocross',
  (at, p, length) => {
    p.jump({
      name: 'RIDGE TABLE',
      kind: 'tabletop',
      at: at(2, 22),
      height: 2.0,
      face: 28,
      gap: 11,
      landing: 18,
    });
    p.jump({
      name: 'BARN DOUBLE',
      kind: 'double',
      at: at(4, 22),
      height: 2.1,
      face: 29,
      gap: 15,
      landingHeight: 2.8,
      landing: 18,
    });
    p.jump({ name: 'CREEK KICKER', kind: 'kicker', at: at(6, 16), height: 1.0, face: 24, gap: 8 });
    p.whoops({ at: at(8, 14), count: 9, spacing: 5, height: 0.45 });
    p.jump({
      name: 'SKY TRIPLE',
      kind: 'triple',
      at: at(8, 78),
      height: 1.8,
      face: 31,
      gap: 18,
      landingHeight: 2.5,
      landing: 19,
    });
    p.jump({
      name: 'SUMMIT TABLE',
      kind: 'tabletop',
      at: at(10, 18),
      height: 2.4,
      face: 29,
      gap: 13,
      landing: 18,
    });
    p.jump({
      name: 'VALLEY DOUBLE',
      kind: 'double',
      at: at(10, 68),
      height: 2.0,
      face: 28,
      gap: 14,
      landingHeight: 2.7,
      landing: 18,
    });
    p.rollers({ at: at(10, 104), count: 3, spacing: 7, height: 0.6 });
    return {
      soil: 'loam',
      offTrack: 'turf',
      moisture: 0.28,
      zones: [
        // Hard-packed start straight and gate pad.
        { from: length - 70, to: at(1, 0), soil: 'hardpack' },
        // Sandy washboard and a wet creek bottom.
        { from: at(8, 10), to: at(8, 64), soil: 'sand' },
        { from: at(6, 38), to: at(6, 60), soil: 'mud', moisture: 0.45 },
      ],
      berms: berms(valleyPath, at),
      chop: 0.025,
      rough: [{ from: at(2, 0), to: at(2, 18) }],
      gate: { s: length - 10, slots: 10, spacing: 1.15, holeshot: at(1, 8) },
    };
  },
);

// ---- Arena Nord: indoor supercross stadium (anticlockwise, night) ---------
const arenaPath: (Segment & { berm?: number })[] = [
  S(100, { w: 6, stands: 'right' }),
  A(7, 180, berm(1.2, { name: 'TURN ONE' })),
  S(110),
  A(7, -180, berm(1.1, { name: 'STAGE TURN' })),
  S(95),
  A(7, 180, berm(1.2, { name: 'SCOREBOARD' })),
  S(140),
  A(7, 90, berm(1.0, { name: 'TUNNEL' })),
  S(28),
  A(7, 90, berm(1.0, { name: 'FINISH TURN', w: 6 })),
  S(55, { w: 6, stands: 'right' }),
];
const ARENA_NORD = venue(
  {
    id: 'arena-nord-sx',
    name: 'ARENA NORD / SUPERCROSS',
    short: 'ARENA NORD',
    group: 'off-road',
    venue: 'arena-nord-sx',
    venueName: 'Arena Nord Stadium',
    layout: 'Supercross',
    description:
      'Floodlit stadium floor of hard clay: a triple rhythm lane, whoops, tabletops and tight bowl berms.',
    theme: 'stadium',
    night: true,
    heading: 0,
    winding: 1,
    halfWidth: 4.2,
    elevationSmoothing: 10,
    crossFall: 0.005,
    // Tuff-block walls behind the berm faces (a wall at the edge would cut them).
    barrier: { kind: 'concrete', offset: 1.8 },
    runoff: { straight: 'grass', outside: 'grass', inside: 'grass' },
    pit: mechanicsArea(1, { offset: 12, boxLateral: 14 }),
    path: arenaPath,
  },
  'supercross',
  (at, p, length) => {
    p.jump({
      name: 'TRIPLE',
      kind: 'triple',
      at: at(2, 14),
      height: 1.6,
      face: 31,
      gap: 17,
      landingHeight: 2.2,
      landing: 19,
    });
    p.jump({
      name: 'LANE DOUBLE',
      kind: 'double',
      at: at(2, 50),
      height: 1.5,
      face: 29,
      gap: 11,
      landingHeight: 2.0,
      landing: 18,
    });
    p.whoops({ at: at(4, 12), count: 11, spacing: 4.2, height: 0.4 });
    p.jump({
      name: 'TABLETOP',
      kind: 'tabletop',
      at: at(6, 14),
      height: 1.8,
      face: 29,
      gap: 9,
      landing: 18,
    });
    p.rollers({ at: at(6, 40), count: 4, spacing: 6, height: 0.6 });
    p.jump({
      name: 'FINISH TRIPLE',
      kind: 'triple',
      at: at(6, 78),
      height: 1.7,
      face: 31,
      gap: 17,
      landingHeight: 2.2,
      landing: 19,
    });
    return {
      soil: 'hardpack',
      offTrack: 'hardpack',
      moisture: 0.18,
      zones: [{ from: at(4, 8), to: at(4, 60), soil: 'loam' }],
      berms: berms(arenaPath, at),
      indoor: true,
      gate: { s: length - 8, slots: 10, spacing: 1.1, holeshot: at(1, 4) },
    };
  },
);

// ---- Kestrel: rallycross on asphalt and gravel with a joker hairpin -------
const kestrelPath: (Segment & { berm?: number })[] = [
  S(100, { stands: 'left' }),
  A(30, 180, { name: 'FIRST BEND', stands: 'out', y: 0.5 }),
  S(60, { y: 1, barrier: { side: 'left', offset: 13 } }),
  A(18, -180, {
    name: 'JOKER HAIRPIN',
    y: 1.5,
    barrier: { side: 'out', offset: 13 },
    stands: 'in',
  }),
  S(70, { y: 2, barrier: { side: 'left', offset: 13 } }),
  A(20, 90, { name: 'BIRCH', y: 3 }),
  S(50, { y: 4 }),
  A(25, 90, { name: 'TOWER', y: 4.5, stands: 'out' }),
  S(170, { y: 3 }),
  A(25, 90, { name: 'QUARRY BEND', y: 1.5 }),
  S(126, { y: 0.5 }),
  A(40, 90, { name: 'LAST BEND' }),
  S(50, { stands: 'left' }),
];
const KESTREL = venue(
  {
    id: 'kestrel-rx',
    name: 'KESTREL / RALLYCROSS',
    short: 'KESTREL RX',
    group: 'off-road',
    venue: 'kestrel-rx',
    venueName: 'Kestrel Rallycross Circuit',
    layout: 'Joker',
    description:
      'Asphalt start and finish, rolled gravel through the back, a crest jump and a joker loop round the hairpin.',
    theme: 'rallycross',
    heading: 0,
    winding: 1,
    halfWidth: 7,
    elevationSmoothing: 30,
    crossFall: 0.012,
    barrier: { kind: 'tyre', offset: 4 },
    runoff: { straight: 'grass', outside: 'grass', inside: 'grass' },
    pit: mechanicsArea(1, { offset: 18, boxLateral: 20, gridRow: 8, gridColumn: 2.4 }),
    path: kestrelPath,
  },
  'rallycross',
  (at, p, length) => {
    p.jump({
      name: 'KESTREL CREST',
      kind: 'crest',
      at: at(8, 60),
      height: 0.9,
      face: 9,
      gap: 6,
      landing: 8,
    });
    // The hairpin turns right (builder hand -1), so its outside is the left.
    return {
      soil: 'gravel',
      offTrack: 'turf',
      moisture: 0.18,
      zones: [
        // Asphalt: the start/finish straight, the first bend and the last bend.
        { from: at(11, 0), to: length, soil: 'asphalt' },
        { from: 0, to: at(2, 10), soil: 'asphalt' },
      ],
      berms: [],
      // The joker road runs wide of the hairpin with a turf island between
      // the two roads (2.2 m from the lap's taped edge to the joker's), and
      // inside the outer tyre wall (20 m out).
      joker: {
        from: at(2, 18),
        to: at(4, 42),
        side: -1,
        offset: 13.5,
        halfWidth: 3.5,
        ramp: 22,
        soil: 'gravel',
      },
    };
  },
);

// ---- Pinewood: point-to-point gravel stage through a forest ---------------
const pinewoodPath: (Segment & { berm?: number })[] = [
  S(120, { stands: 'left' }),
  A(60, 45, { name: 'FOREST GATE', y: 2 }),
  S(150, { y: 9 }),
  A(40, -70, { name: 'FIRST RIGHT', y: 12 }),
  S(200, { y: 20 }),
  A(80, 60, { name: 'LONG LEFT', y: 24 }),
  S(120, { y: 26 }),
  A(30, 110, { name: 'HAIRPIN', y: 25 }),
  S(180, { y: 18 }),
  A(50, -50, { name: 'MILL RIGHT', y: 14 }),
  S(160, { y: 15 }),
  A(45, 70, { name: 'MILL LEFT', y: 17 }),
  S(220, { y: 10 }),
  A(70, 40, { name: 'POND', y: 6 }),
  S(200, { y: 3 }),
  A(40, -60, { name: 'WATERSPLASH', y: 2 }),
  S(150, { y: 6 }),
  A(35, 90, { name: 'CHAPEL', y: 9 }),
  S(300, { y: 12 }),
  A(60, 80, { name: 'RIDGE', y: 10 }),
  S(315, { y: 4 }),
  A(50, 45, { name: 'SERVICE BEND', y: 1 }),
  S(103, { stands: 'left' }),
];
const PINEWOOD = venue(
  {
    id: 'pinewood-stage',
    name: 'PINEWOOD / GRAVEL STAGE',
    short: 'PINEWOOD',
    group: 'off-road',
    venue: 'pinewood-stage',
    venueName: 'Pinewood Forest Stage',
    layout: 'Special Stage',
    description:
      'Point-to-point forest gravel: crests over the ridge, a hairpin, a watersplash and two timed splits.',
    theme: 'forest-stage',
    heading: 0,
    winding: 1,
    halfWidth: 4,
    elevationSmoothing: 60,
    crossFall: 0.02,
    barrier: { kind: 'armco', offset: 4 },
    runoff: { straight: 'grass', outside: 'grass', inside: 'grass' },
    pit: mechanicsArea(1, { offset: 16, boxLateral: 18 }),
    path: pinewoodPath,
  },
  'rally-stage',
  (at, p, length) => {
    p.jump({
      name: 'HIGH CREST',
      kind: 'crest',
      at: at(4, 90),
      height: 1.1,
      face: 7,
      gap: 8,
      landing: 7,
    });
    p.jump({
      name: 'MILL CREST',
      kind: 'crest',
      at: at(10, 70),
      height: 1.0,
      face: 7,
      gap: 6,
      landing: 7,
    });
    p.jump({
      name: 'RIDGE CREST',
      kind: 'crest',
      at: at(18, 140),
      height: 1.2,
      face: 8,
      gap: 8,
      landing: 8,
    });
    const start = 40,
      finish = at(20, 250),
      stop = at(21, 10);
    return {
      soil: 'gravel',
      offTrack: 'turf',
      moisture: 0.22,
      zones: [
        { from: length - 60, to: 30, soil: 'hardpack' },
        { from: at(15, 0), to: at(16, 40), soil: 'mud', moisture: 0.5 },
      ],
      berms: [],
      stage: {
        start,
        splits: [start + (finish - start) / 3, start + (2 * (finish - start)) / 3],
        finish,
        stop,
        interval: 20,
      },
    };
  },
);
/** Terrain venues by id (registered after the catalogue in circuits.ts). */
export const OFFROAD_CIRCUITS: Readonly<Record<OffroadCircuitId, CircuitDefinition>> =
  Object.freeze({
    'valley-ridge-mx': VALLEY_RIDGE,
    'arena-nord-sx': ARENA_NORD,
    'kestrel-rx': KESTREL,
    'pinewood-stage': PINEWOOD,
  });
/** The course of a terrain venue, or null for a paved circuit. */
export function offroadCourse(def: Pick<CircuitDefinition, 'offroad'>): OffroadCourse | null {
  const data = def.offroad as OffroadVenue | undefined;
  return data?.course ?? null;
}
/** Classes a terrain venue admits: motorcycles at the motocross and
 * supercross venues, cars at rallycross and stages. Paved circuits admit all. */
export function venueAdmits(def: Pick<CircuitDefinition, 'offroad'>, classId: string) {
  const course = offroadCourse(def);
  if (!course) return true;
  const list: readonly string[] =
    course.kind === 'motocross' || course.kind === 'supercross'
      ? OFFROAD_CLASSES.bikes
      : OFFROAD_CLASSES.cars;
  return list.includes(classId);
}
