import type { Structure } from '../../simulation/open-world/placement.ts';

export type JoineryKind = 'casement' | 'shop' | 'shuttered';
export interface FacadeOpening {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  cell0: number;
  cell1: number;
  row0: number;
  row1: number;
  kind: JoineryKind;
  room: number;
  /** Ribbon or curtain-wall glazing: one long opening per floor divided
   * into this many lites by shader mullions (no authored joinery). */
  lites?: number;
}
export interface FacadeLayout {
  openings: FacadeOpening[];
  /** A complete, non-overlapping partition of the wall outside the holes. */
  wall: [number, number, number, number][];
}
const SUPPORTED = new Set<Structure['kind']>(['house', 'shop', 'block', 'farm', 'terminal']);
function noise(seed: number, row: number, bay: number, side: number) {
  let h = (seed ^ Math.imul(row + 17, 0x45d9f3b) ^ Math.imul(bay + side * 41, 0x27d4eb2d)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}
/** Opening proportions: the original European casements, Japanese urban
 * aluminium window bands (sill 0.8 m, head ~2.55 m of a 3.2 m storey, up to
 * 2.3 m wide) or traditional timber fronts (full-bay sliding lattice doors on
 * the ground floor, low upper-storey windows). Japanese variants never use
 * the hinged European shutters. */
export type FacadeVariant = 'european' | 'urban' | 'traditional' | 'ribbon' | 'curtain';
/** Ribbon windows (refs 030, 089, 097): a 1.65 m band from 0.85 m above
 * each upper floor, 0.45 m clear of the corners, in 1.2 m lites. Curtain
 * walls (refs 030, 039): glazing from 0.12 m above to 0.12 m below each
 * floor line in 1.5 m lites. Ground floors keep the urban shop bays. */
const BANDS = Object.freeze({
  ribbon: { inset: 0.45, sill: 0.85, head: 2.5, lite: 1.2 },
  curtain: { inset: 0.3, sill: 0.12, head: 3.08, lite: 1.5 },
});
/** Dimensions follow the actual footprint. Centred complete bays never cut a
 * window through a corner pilaster or a floor band. There is no random state.
 * Storeys from `blindFrom` to below `blindTo` are blank wall (city party
 * walls beside a neighbour). */
export function facadeLayout(
  s: Structure,
  length: number,
  side = 0,
  variant: FacadeVariant = 'european',
  blindFrom = Infinity,
  blindTo = Infinity,
): FacadeLayout | null {
  if (
    !SUPPORTED.has(s.kind) ||
    !Number.isFinite(length) ||
    length < 2.2 ||
    !Number.isFinite(s.height) ||
    s.height < 2.8 ||
    !Number.isFinite(s.floors)
  )
    return null;
  const floors = Math.min(16, Math.max(1, Math.floor(s.floors)));
  const floorH = (s.height - 0.6) / floors;
  if (floorH < 2.2) return null;
  const bays = Math.min(24, Math.max(1, Math.floor(length / (s.kind === 'house' ? 2.9 : 3.3))));
  const span = length / bays;
  const openings: FacadeOpening[] = [],
    wall: FacadeLayout['wall'] = [];
  const rect = (u0: number, v0: number, u1: number, v1: number) => {
    if (u1 - u0 > 1e-6 && v1 - v0 > 1e-6) wall.push([u0, v0, u1, v1]);
  };
  for (let row = 0; row < floors; row++) {
    const row0 = row * floorH,
      row1 = (row + 1) * floorH;
    // Blank party walls (refs 014, 030): one wall rectangle per storey.
    if (row >= blindFrom && row < blindTo) {
      rect(0, row0, length, row1);
      continue;
    }
    if ((variant === 'ribbon' || variant === 'curtain') && row > 0 && length >= 4.5) {
      const band = BANDS[variant];
      const u0 = band.inset,
        u1 = length - band.inset,
        v0 = row0 + band.sill,
        v1 = row0 + Math.min(band.head, floorH - 0.12);
      const lites = Math.max(2, Math.round((u1 - u0) / band.lite));
      const room = noise(s.style, row, 0, side);
      openings.push({
        u0,
        u1,
        v0,
        v1,
        cell0: 0,
        cell1: length,
        row0,
        row1,
        kind: 'casement',
        room,
        lites,
      });
      rect(0, row0, u0, row1);
      rect(u1, row0, length, row1);
      rect(u0, row0, u1, v0);
      rect(u0, v1, u1, row1);
      continue;
    }
    for (let bay = 0; bay < bays; bay++) {
      const cell0 = bay * span,
        cell1 = (bay + 1) * span;
      const room = noise(s.style, row, bay, side);
      const traditional = variant === 'traditional',
        urban = variant !== 'european' && !traditional;
      // Houses keep some blind bays; traditional side walls are mostly closed.
      const blind = traditional
        ? row > 0 || side % 2 === 1
          ? room > 0.62
          : room > 0.9
        : (s.kind === 'house' || s.kind === 'farm') && room > 0.85;
      if (blind) {
        rect(cell0, row0, cell1, row1);
        continue;
      }
      const shop = traditional
        ? row === 0 && side % 2 === 0
        : row === 0 && (s.kind === 'shop' || s.kind === 'block' || s.kind === 'terminal');
      const shuttered =
        variant === 'european' &&
        !shop &&
        span >= 2.7 &&
        (s.kind === 'house' || s.kind === 'farm' || s.kind === 'shop') &&
        room < 0.4;
      // The authored open shutters extend to +/-0.94 opening widths. Narrow
      // that opening to fit its complete assembly between the bay boundaries;
      // otherwise shutters collide with neighbouring casements and pilasters.
      const width = Math.min(
        span - 0.58,
        shop ? span * (traditional ? 0.86 : 0.83) : traditional ? 1.9 : urban ? 2.3 : 1.72,
        shuttered ? (span - 0.58) / 1.88 : (span - 0.34) / 1.14,
      );
      const u0 = (cell0 + cell1 - width) / 2,
        u1 = u0 + width;
      // Foundations are recessed by placement.ts. The shop threshold remains
      // above the stone plinth, not below the ground like the old shader grid.
      const v0 =
        row0 +
        (shop ? (traditional ? 0.56 : 0.66) : urban ? 0.8 : traditional ? 0.85 : floorH * 0.3);
      const v1 =
        row0 +
        (traditional
          ? Math.min(shop ? 2.45 : 2.2, floorH * (shop ? 0.8 : 0.76))
          : floorH * (shop ? 0.86 : urban ? 0.8 : 0.84));
      const kind = shop ? 'shop' : shuttered ? 'shuttered' : 'casement';
      openings.push({ u0, u1, v0, v1, cell0, cell1, row0, row1, kind, room });
      rect(cell0, row0, u0, row1);
      rect(u1, row0, cell1, row1);
      rect(u0, row0, u1, v0);
      rect(u0, v1, u1, row1);
    }
  }
  rect(0, floors * floorH, length, s.height);
  return { openings, wall };
}

/** Japanese wall finishes by palette identity: 45x95 mm mosaic tile
 * (nikoguchi), stained vertical cedar boards, 1.8x0.9 m formed concrete,
 * horizontal lap siding; city offices add 600x300 mm large-format tile
 * (beige stone, grey granite, white ceramic, charcoal; refs 014, 030),
 * precast concrete panels (089) and aluminium composite panels (030's
 * violet block, 014's slate front). */
export const WALL_FINISH = Object.freeze({
  tile: [0xc6b49a, 0x9a6a52, 0xb7b4ad, 0xc4643f, 0xd9d4c8, 0x7d5d4c],
  timber: [0x3b2f27, 0x4f3b2c, 0x2d2622],
  concrete: [0xa9a69e, 0x9c9a94, 0xbab7ae],
  siding: [0xb9c0c4, 0xd0ccc0, 0xa7b2b0],
  largeTile: [0xcdbfa6, 0xb5b0a6, 0xdedad0, 0x4d4a47],
  precast: [0xd5d1c6, 0xc1bcb0, 0xa29e95],
  panel: [0x7f7589, 0x8b9297, 0x56606a],
});
export type Finish = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** Palette identity, not a per-pixel hue guess: brick and dressed stone
 * retain metric courses while painted walls remain plaster. */
export function facadeFinish(color: number): Finish {
  if (color === 0x8c4f3a) return 1;
  if (color === 0xb3a891) return 2;
  if (WALL_FINISH.tile.includes(color)) return 3;
  if (WALL_FINISH.timber.includes(color)) return 4;
  if (WALL_FINISH.concrete.includes(color)) return 5;
  if (WALL_FINISH.siding.includes(color)) return 6;
  if (WALL_FINISH.largeTile.includes(color)) return 7;
  if (WALL_FINISH.precast.includes(color)) return 8;
  if (WALL_FINISH.panel.includes(color)) return 9;
  return 0;
}

export type Point3 = readonly [number, number, number];
export interface FacadePlacement {
  kind: JoineryKind;
  centre: Point3;
  tangent: Point3;
  normal: Point3;
  width: number;
  height: number;
  room: number;
}
export interface FacadeSink {
  quad(
    corners: readonly Point3[],
    normal: Point3,
    uv: readonly (readonly [number, number])[],
    color: number,
    facade: readonly [number, number, number, number],
  ): void;
}
export interface RecessOptions {
  /** Wall colour of a partition rectangle by its height band (m). */
  paint?: (v0: number, v1: number) => number;
  /** Facade kind code written on an opening's glazing. */
  pane?: (hole: FacadeOpening) => number;
  /** Glazing UVs in metres instead of 0..1 (lattice and shoji patterns). */
  metric?: boolean;
  /** Request authored joinery for the openings (default true). */
  joinery?: boolean;
  /** Overrides the glazing's w channel (city panes: mode + 4 * bucket). */
  paneTag?: (hole: FacadeOpening) => number;
  /** Wall height (m) packed into the partition's w channel above the
   * finish (w = finish + 16 * top) for parapet weathering. */
  wallTop?: number;
}
/** Cut actual holes and return real reveals/glazing. There is no wall triangle
 * behind the pane; ray tests can independently verify its 0.21 m setback. */
export function addRecessedFacade(
  sink: FacadeSink,
  layout: FacadeLayout,
  origin: Point3,
  tangent: Point3,
  normal: Point3,
  color: number,
  style: number,
  kind: number,
  placements: FacadePlacement[],
  options: RecessOptions = {},
) {
  const at = (u: number, v: number, depth = 0): Point3 => [
    origin[0] + tangent[0] * u + normal[0] * depth,
    origin[1] + v,
    origin[2] + tangent[2] * u + normal[2] * depth,
  ];
  const wallQuad = (u0: number, v0: number, u1: number, v1: number) => {
    const paint = options.paint?.(v0, v1) ?? color;
    sink.quad(
      [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)],
      normal,
      [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ],
      paint,
      [style, kind, -3, facadeFinish(paint) + 16 * Math.round(options.wallTop ?? 0)],
    );
  };
  for (const r of layout.wall) wallQuad(...r);
  for (const hole of layout.openings) {
    const { u0, u1, v0, v1, room } = hole,
      depth = -0.21;
    const reveal = (corners: Point3[], n: Point3, w: number, h: number) =>
      sink.quad(
        corners,
        n,
        [
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ],
        0x8b8578,
        [style, kind, -5, 0],
      );
    // Inward-facing reveals point toward the opening, not into the wall.
    reveal([at(u0, v0), at(u0, v0, depth), at(u0, v1, depth), at(u0, v1)], tangent, 0.21, v1 - v0);
    reveal(
      [at(u1, v0, depth), at(u1, v0), at(u1, v1), at(u1, v1, depth)],
      [-tangent[0], 0, -tangent[2]],
      0.21,
      v1 - v0,
    );
    reveal(
      [at(u0, v0, depth), at(u0, v0), at(u1, v0), at(u1, v0, depth)],
      [0, 1, 0],
      0.21,
      u1 - u0,
    );
    reveal(
      [at(u0, v1), at(u0, v1, depth), at(u1, v1, depth), at(u1, v1)],
      [0, -1, 0],
      0.21,
      u1 - u0,
    );
    const w = options.metric ? u1 - u0 : (hole.lites ?? 1),
      h = options.metric ? v1 - v0 : 1;
    sink.quad(
      [at(u0, v0, depth), at(u1, v0, depth), at(u1, v1, depth), at(u0, v1, depth)],
      normal,
      [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ],
      0xffffff,
      [
        // City panes hash their room id in the shader: store it at a 1/256
        // bucket centre so interpolation noise never changes the bucket.
        options.paneTag ? (Math.floor(room * 256) + 0.5) / 256 : room,
        options.pane?.(hole) ?? kind,
        -4,
        options.paneTag?.(hole) ?? (hole.kind === 'shop' ? 1 : 0),
      ],
    );
    if (options.joinery === false || hole.lites) continue;
    placements.push({
      kind: hole.kind,
      centre: at((u0 + u1) / 2, (v0 + v1) / 2),
      tangent,
      normal,
      width: u1 - u0,
      height: v1 - v0,
      room,
    });
  }
}
