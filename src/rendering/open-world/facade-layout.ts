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
/** Dimensions follow the actual footprint. Centred complete bays never cut a
 * window through a corner pilaster or a floor band. There is no random state. */
export function facadeLayout(s: Structure, length: number, side = 0): FacadeLayout | null {
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
    for (let bay = 0; bay < bays; bay++) {
      const cell0 = bay * span,
        cell1 = (bay + 1) * span;
      const room = noise(s.style, row, bay, side);
      if ((s.kind === 'house' || s.kind === 'farm') && room > 0.85) {
        rect(cell0, row0, cell1, row1);
        continue;
      }
      const shop = row === 0 && (s.kind === 'shop' || s.kind === 'block' || s.kind === 'terminal');
      const shuttered =
        !shop &&
        span >= 2.7 &&
        (s.kind === 'house' || s.kind === 'farm' || s.kind === 'shop') &&
        room < 0.4;
      // The authored open shutters extend to +/-0.94 opening widths. Narrow
      // that opening to fit its complete assembly between the bay boundaries;
      // otherwise shutters collide with neighbouring casements and pilasters.
      const width = Math.min(
        span - 0.58,
        shop ? span * 0.83 : 1.72,
        shuttered ? (span - 0.58) / 1.88 : (span - 0.34) / 1.14,
      );
      const u0 = (cell0 + cell1 - width) / 2,
        u1 = u0 + width;
      // Foundations are recessed by placement.ts. The shop threshold remains
      // above the stone plinth, not below the ground like the old shader grid.
      const v0 = row0 + (shop ? 0.66 : floorH * 0.3);
      const v1 = row0 + floorH * (shop ? 0.86 : 0.84);
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

/** Palette identity, not a per-pixel hue guess: brick and dressed stone
 * retain metric courses while painted walls remain plaster. */
export function facadeFinish(color: number): 0 | 1 | 2 {
  return color === 0x8c4f3a ? 1 : color === 0xb3a891 ? 2 : 0;
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
) {
  const at = (u: number, v: number, depth = 0): Point3 => [
    origin[0] + tangent[0] * u + normal[0] * depth,
    origin[1] + v,
    origin[2] + tangent[2] * u + normal[2] * depth,
  ];
  const bare = [style, kind, -3, facadeFinish(color)] as const;
  const wallQuad = (u0: number, v0: number, u1: number, v1: number) =>
    sink.quad(
      [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)],
      normal,
      [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ],
      color,
      bare,
    );
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
    sink.quad(
      [at(u0, v0, depth), at(u1, v0, depth), at(u1, v1, depth), at(u0, v1, depth)],
      normal,
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      0xffffff,
      [room, kind, -4, hole.kind === 'shop' ? 1 : 0],
    );
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
