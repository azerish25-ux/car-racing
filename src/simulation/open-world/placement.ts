import { clamp } from '../../core/math.ts';
import type { TrackPoint } from '../track.ts';
import { hash01, hash2, subSeed } from './noise.ts';
import type { LandmarkSpec } from './region-data.ts';
import { BIOME } from './terrain-field.ts';
import { TILE_SIZE } from './terrain-tiles.ts';
import type { OpenWorld } from './world.ts';

/** A building or structure footprint: an oriented box on the ground. */
export interface Structure {
  kind: LandmarkSpec['kind'] | 'house' | 'shop' | 'block';
  x: number;
  z: number;
  /** Rotation of the local +x axis from world +x (rad). */
  heading: number;
  /** Half extents along local x (frontage) and z (depth). */
  hx: number;
  hz: number;
  height: number;
  /** Ground under the footprint (m): the base sits a little below it. */
  base: number;
  floors: number;
  /** Style seed (facade, roof, colour). */
  style: number;
}
const scratchPoint = (): TrackPoint => ({
  s: 0,
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  tz: 1,
  nx: 1,
  nz: 0,
  curvature: 0,
  width: 0,
  bank: 0,
  gradient: 0,
});
/** Clear distance (m) from (x, z) to the nearest road's usable edge. */
function roadClearance(world: OpenWorld, x: number, z: number, p: TrackPoint) {
  const net = world.network,
    lateral = net.nearest(x, z, p),
    e = net.edges[net.edgeOf[net.lastSegment]];
  return Math.abs(lateral) - (e.spec.halfWidth + e.spec.shoulder);
}
function footprintCorners(s: Pick<Structure, 'x' | 'z' | 'heading' | 'hx' | 'hz'>) {
  const c = Math.cos(s.heading),
    n = Math.sin(s.heading);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => [s.x + c * a * s.hx - n * b * s.hz, s.z + n * a * s.hx + c * b * s.hz] as const);
}
/** Point inside an oriented footprint (with padding)? */
export function insideFootprint(s: Structure, x: number, z: number, pad = 0) {
  const c = Math.cos(s.heading),
    n = Math.sin(s.heading),
    dx = x - s.x,
    dz = z - s.z,
    lx = dx * c + dz * n,
    lz = -dx * n + dz * c;
  return Math.abs(lx) <= s.hx + pad && Math.abs(lz) <= s.hz + pad;
}

/** Uniform 2-D grid over structures (collision and planting exclusion). */
export class StructureGrid {
  readonly cell = 48;
  private readonly cells = new Map<number, number[]>();
  constructor(readonly items: readonly Structure[]) {
    items.forEach((s, i) => {
      const r = Math.hypot(s.hx, s.hz);
      for (let cx = Math.floor((s.x - r) / this.cell); cx <= Math.floor((s.x + r) / this.cell); cx++)
        for (let cz = Math.floor((s.z - r) / this.cell); cz <= Math.floor((s.z + r) / this.cell); cz++) {
          const key = cx * 65536 + cz,
            list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
    });
  }
  /** Indices of structures whose cell contains (x, z). */
  near(x: number, z: number): readonly number[] {
    return this.cells.get(Math.floor(x / this.cell) * 65536 + Math.floor(z / this.cell)) ?? EMPTY;
  }
  blocks(x: number, z: number, pad = 0) {
    for (const i of this.near(x, z)) if (insideFootprint(this.items[i], x, z, pad)) return true;
    return false;
  }
}
const EMPTY: readonly number[] = Object.freeze([]);

/**
 * Every building and landmark of the region, deterministic from the region
 * data: authored landmarks (hangars, tower, terminal, lighthouse, farms,
 * chapel, warehouses) plus street frontage generated along each town's
 * streets, set back behind the pavement, never on a road, the quay or the
 * river. Physics turns them into colliders, rendering into PBR buildings.
 */
export function regionStructures(world: OpenWorld): Structure[] {
  const out: Structure[] = [],
    region = world.region,
    net = world.network,
    p = scratchPoint(),
    seed = subSeed(region.seed, 31);
  const ground = (s: Pick<Structure, 'x' | 'z' | 'heading' | 'hx' | 'hz'>) => {
    let low = Infinity;
    for (const [x, z] of footprintCorners(s)) low = Math.min(low, world.field.height(x, z));
    return Math.min(low, world.field.height(s.x, s.z));
  };
  const clear = (s: Pick<Structure, 'x' | 'z' | 'heading' | 'hx' | 'hz'>, margin: number) => {
    for (const [x, z] of [...footprintCorners(s), [s.x, s.z] as const])
      if (roadClearance(world, x, z, p) < margin) return false;
    return true;
  };
  const overlaps = (s: Structure) =>
    out.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < Math.hypot(o.hx, o.hz) + Math.hypot(s.hx, s.hz) && boxesOverlap(o, s));
  for (const l of region.landmarks) {
    const s: Structure = {
      kind: l.kind,
      x: l.x,
      z: l.z,
      heading: l.heading,
      hx: l.length / 2,
      hz: l.width / 2,
      height: l.height,
      base: 0,
      floors: Math.max(1, Math.round(l.height / 3.5)),
      style: hash2(Math.round(l.x), Math.round(l.z), seed),
    };
    s.base = ground(s) - 0.4;
    out.push(s);
  }
  // Street frontage: walk each town's roads, both sides.
  for (const town of region.towns) {
    const inside = (x: number, z: number) => x > town.x0 && x < town.x1 && z > town.z0 && z < town.z1;
    for (const e of net.edges) {
      if (e.roadClass !== 'town' && e.roadClass !== 'country' && e.roadClass !== 'highway') continue;
      const setback = e.spec.halfWidth + e.spec.shoulder + (e.roadClass === 'town' ? 1.2 : 6);
      for (const side of [-1, 1]) {
        let s = 6 + hash01(e.index, side, seed) * 8;
        while (s < e.length - 6) {
          const r = hash2(e.index * 31 + (side > 0 ? 7 : 3), Math.round(s * 10), seed);
          const frontage = 9 + (r % 1000) / 1000 * 14,
            depth = 9 + ((r >>> 10) % 1000) / 1000 * 10;
          net.at(e.offset + s + frontage / 2, p);
          const heading = Math.atan2(p.tz, p.tx),
            cx = p.x + p.nx * side * (setback + depth / 2),
            cz = p.z + p.nz * side * (setback + depth / 2);
          s += frontage + 1.5 + ((r >>> 20) % 100) / 100 * 3;
          if (!inside(cx, cz)) continue;
          if (((r >>> 3) % 1000) / 1000 > town.density) continue;
          const floors = town.floors[0] + ((r >>> 13) % (town.floors[1] - town.floors[0] + 1));
          const b: Structure = {
            kind: floors >= 4 ? 'block' : floors >= 2 ? 'shop' : 'house',
            x: cx,
            z: cz,
            heading,
            hx: frontage / 2,
            hz: depth / 2,
            height: floors * 3.2 + 0.6,
            base: 0,
            floors,
            style: r,
          };
          if (!clear(b, 1)) continue;
          b.base = ground(b) - 0.5;
          // Not in the water: the quay edge and the canal stay open.
          const field = world.field;
          const v = field.valleyAt(cx, cz);
          if (b.base < region.seaLevel + 0.6 || v.distance < region.valley.channel + 6) continue;
          if (overlaps(b)) continue;
          out.push(b);
        }
      }
    }
  }
  return out;
}
/** Separating-axis overlap of two oriented footprints. */
function boxesOverlap(a: Structure, b: Structure) {
  const axes = [a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2];
  const ca = footprintCorners(a),
    cb = footprintCorners(b);
  for (const angle of axes) {
    const ux = Math.cos(angle),
      uz = Math.sin(angle);
    let a0 = Infinity,
      a1 = -Infinity,
      b0 = Infinity,
      b1 = -Infinity;
    for (const [x, z] of ca) {
      const d = x * ux + z * uz;
      a0 = Math.min(a0, d);
      a1 = Math.max(a1, d);
    }
    for (const [x, z] of cb) {
      const d = x * ux + z * uz;
      b0 = Math.min(b0, d);
      b1 = Math.max(b1, d);
    }
    if (a1 < b0 - 0.5 || b1 < a0 - 0.5) return false;
  }
  return true;
}

/** Packed tree instances: x, z, height (m), species (0 broadleaf, 1 conifer,
 * 2 shrub), rotation (rad), tint (0..1). */
export const TREE_STRIDE = 6;
export const TREE_SPECIES = Object.freeze({ BROADLEAF: 0, CONIFER: 1, SHRUB: 2 });
/** Trunk collider radius by species (m per m of tree height, clamped). */
export function trunkRadius(species: number, height: number) {
  return species === TREE_SPECIES.SHRUB ? 0 : clamp(height * 0.022, 0.18, 0.55);
}

/**
 * Trees of one 256 m tile, deterministic from the region seed: authored woods
 * and scattered copses (forest density), conifers on the high ground, shrubs
 * on open meadow; never on roads and their verges, in towns, on the airfield,
 * on beaches, in water, above the tree line or on rock faces. Depends only on
 * the natural terrain and the road network, so the physics worker (trunk
 * colliders) and the render tile worker (instances) agree without sharing
 * tiles. `density` thins the planting for lower presets (rendering only;
 * physics always uses 1, so thinning never removes a collider that is drawn).
 */
export function treesForTile(
  world: OpenWorld,
  ix: number,
  iz: number,
  structures: StructureGrid | null,
  density = 1,
  /** Thin only trees without a trunk collider (shrubs): every tree the
   * physics collides with stays, whatever the render density. */
  keepColliders = false,
): Float32Array {
  const field = world.field,
    region = world.region,
    cell = 8,
    cells = TILE_SIZE / cell,
    seed = subSeed(region.seed, 41),
    p = scratchPoint(),
    out: number[] = [];
  const x0 = ix * TILE_SIZE,
    z0 = iz * TILE_SIZE;
  if (Math.max(Math.abs(x0 + TILE_SIZE / 2), Math.abs(z0 + TILE_SIZE / 2)) > region.half + 1400) return new Float32Array(0);
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const h = hash2(ix * cells + i, iz * cells + j, seed),
        r0 = (h & 0xffff) / 65536,
        r1 = (h >>> 16) / 65536;
      const x = x0 + (i + 0.15 + 0.7 * r0) * cell,
        z = z0 + (j + 0.15 + 0.7 * r1) * cell;
      const pick = hash01(Math.floor(x * 7), Math.floor(z * 7), seed + 1);
      // Forest stands: about one tree per 8 m cell at full density; open
      // ground: rare field trees and shrubs.
      if (pick > 0.62) continue;
      const forest = field.forestDensity(x, z),
        chance = forest > 0.25 ? forest * 0.62 : 0.022;
      if (pick > chance) continue;
      const thinned = pick > chance * density;
      if (thinned && !keepColliders) continue;
      if (Math.abs(x) > region.half + 1200 || Math.abs(z) > region.half + 1200) continue;
      const height = field.height(x, z),
        slope = Math.hypot(field.height(x + 2, z) - height, field.height(x, z + 2) - height) / 2;
      const biome = field.biome(x, z, height, slope, forest);
      if (
        biome === BIOME.SEA ||
        biome === BIOME.BEACH ||
        biome === BIOME.TOWN ||
        biome === BIOME.AIRFIELD ||
        biome === BIOME.RIVER ||
        biome === BIOME.SNOW ||
        biome === BIOME.ROCK
      )
        continue;
      if (height > field.snowLine(x, z) - 70) continue;
      if (roadClearance(world, x, z, p) < 4.5) continue;
      if (structures?.blocks(x, z, 3)) continue;
      const r2 = hash2(Math.floor(x * 3), Math.floor(z * 3), seed + 2);
      const conifer = height > 260 || (forest > 0.25 && (r2 & 7) < 2 && height > 120);
      const shrub = forest <= 0.25 && (r2 & 3) !== 0;
      const species = shrub ? TREE_SPECIES.SHRUB : conifer ? TREE_SPECIES.CONIFER : TREE_SPECIES.BROADLEAF;
      const size =
        species === TREE_SPECIES.SHRUB
          ? 1.2 + ((r2 >>> 4) % 100) / 60
          : (conifer ? 11 : 9) + ((r2 >>> 4) % 1000) / 1000 * (conifer ? 13 : 9);
      if (thinned && trunkRadius(species, size) <= 0) continue;
      out.push(x, z, size, species, ((r2 >>> 14) % 628) / 100, ((r2 >>> 22) % 100) / 100);
    }
  return Float32Array.from(out);
}
