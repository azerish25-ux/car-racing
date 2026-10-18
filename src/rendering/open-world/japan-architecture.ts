import { StructureGrid, type Structure } from '../../simulation/open-world/placement.ts';
import { carvedGroundHeight } from '../../simulation/open-world/ground-height.ts';
import type { TownSpec } from '../../simulation/open-world/region-data.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import { trackPoint } from '../../simulation/track.ts';

/** Presentation-only architectural reading of the existing structures. The
 * collision footprints, heights and positions are never changed: a village
 * shop stays the same box whether it is drawn as a timber machiya or not.
 *
 * - minka: one-storey timber/plaster house or farmhouse, tiled hip-and-gable
 *   (irimoya) roof with 0.9-1.1 m eaves (refs 012, 020, 034, 064).
 * - machiya: two/three-storey village townhouse, dark timber lattice ground
 *   floor, white plaster upper floor, tiled pent roof and main roof (ref 020).
 * - urban: tile/concrete-clad mid-rise, aluminium window bands, balconies,
 *   AC units, roof tanks and projecting signs (refs 014, 030, 038, 089).
 * - konbini: low flat-roofed convenience store with glazed front, fascia
 *   stripes, pole sign and side car park (refs 080-083; original chains).
 * - temple: the landmark chapel drawn as a temple (refs 011, 026, 027).
 * - legacy: hangars, warehouses, terminal, tower and lighthouse. */
export type Architecture = 'minka' | 'machiya' | 'urban' | 'konbini' | 'temple' | 'legacy';
export const ARCH_CODE: Record<Architecture, number> = {
  legacy: 0,
  minka: 1,
  machiya: 1,
  urban: 2,
  konbini: 3,
  temple: 1,
};

export interface ArchitecturePlan {
  style: Architecture[];
  /** Local z side (+1/-1) of each structure that faces its nearest road. */
  front: Int8Array;
  /** Urban structures with a convenience store on the ground floor. */
  konbiniFloor: Set<number>;
  /** Chain palette (0/1) of each convenience store, by structure index. */
  chain: Map<number, number>;
  /** Local x side (+1/-1) of each stand-alone store's car park. */
  lotSide: Map<number, number>;
  /** Visual-only landmarks on open hilltops (no collider, no road). */
  landmarks: VisualLandmark[];
  /** Apartment blocks whose rear exterior stair stands clear of every other
   * building and road. */
  rearStair: Set<number>;
  /** Highest carved ground under each temple footprint: its stone terrace
   * rises to this level so the halls stand on the surrounding grade. */
  terrace: Map<number, number>;
}
/** A castle keep (ref 033): stone base from `y` (lowest ground of its 20 m
 * square) and a three-tier keep, facing the town at `heading`. */
export interface VisualLandmark {
  kind: 'castle';
  x: number;
  z: number;
  y: number;
  heading: number;
}

/** The highest open hilltop within 2.2 km of a town that the town can see:
 * >= 25 m above it, >= 90 m from every road, >= 60 m from every building,
 * level to 2 m over a 30 m square, with a clear sight line from the town
 * centre. Deterministic lattice search over the natural terrain. */
function castleSite(
  world: OpenWorld,
  grid: StructureGrid,
  town: TownSpec,
  p: ReturnType<typeof trackPoint>,
): VisualLandmark | null {
  const field = world.field,
    cx = (town.x0 + town.x1) / 2,
    cz = (town.z0 + town.z1) / 2,
    townY = carvedGroundHeight(world.carver, cx, cz);
  let best: VisualLandmark | null = null,
    score = -Infinity;
  const step = 50;
  for (let x = town.x0 - 1200; x <= town.x1 + 1200; x += step)
    for (let z = town.z0 - 600; z <= town.z1 + 1500; z += step) {
      const h = field.height(x, z);
      if (h < townY + 25 || h < world.region.seaLevel + 10) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d > 2200) continue;
      let level = 0,
        peak = true;
      for (const [dx, dz] of [
        [15, 0],
        [-15, 0],
        [0, 15],
        [0, -15],
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ]) {
        const q = field.height(x + dx, z + dz);
        if (Math.abs(dx) < step && Math.abs(dz) < step) level = Math.max(level, Math.abs(q - h));
        else if (q > h) peak = false;
      }
      if (!peak || level > 2) continue;
      const value = h - d * 0.012 - level * 3;
      if (value <= score) continue;
      if (Math.abs(world.network.nearest(x, z, p)) < 90) continue;
      let blocked = false;
      for (let a = -60; a <= 60 && !blocked; a += 20)
        for (let b = -60; b <= 60 && !blocked; b += 20) blocked = grid.blocks(x + a, z + b, 0);
      if (blocked) continue;
      // The keep must be seen from the town: a clear sight line from 3 m
      // above the town centre to its middle tier.
      let hidden = false;
      for (let k = 1; k < 40 && !hidden; k++) {
        const t = k / 40;
        const ray = townY + 3 + (h + 12 - townY - 3) * t;
        hidden = carvedGroundHeight(world.carver, cx + (x - cx) * t, cz + (z - cz) * t) > ray;
      }
      if (hidden) continue;
      let low = Infinity;
      for (const a of [-10, 0, 10])
        for (const b of [-10, 0, 10])
          low = Math.min(low, carvedGroundHeight(world.carver, x + a, z + b));
      score = value;
      best = { kind: 'castle', x, z, y: low - 0.6, heading: Math.atan2(x - cx, cz - z) };
    }
  return best;
}

/** Car park beside a store: 16 m along the frontage from 0.8 m off the side
 * wall, from the facade line back to the rear wall. Returns a flatness score
 * (> 0) when it touches no building, road or water and is level to 0.6 m. */
export const LOT = Object.freeze({ offset: 0.8, length: 16 });
function lotClear(
  world: OpenWorld,
  grid: StructureGrid,
  s: Structure,
  side: number,
  p: ReturnType<typeof trackPoint>,
) {
  const c = Math.cos(s.heading),
    n = Math.sin(s.heading);
  const sample = (step: number) => {
    const points: [number, number][] = [];
    for (let a = 0; a <= LOT.length; a += step)
      for (let b = -s.hz; b <= s.hz + 1e-6; b += Math.min(step, s.hz)) {
        const lx = side * (s.hx + LOT.offset + a);
        points.push([s.x + c * lx - n * b, s.z + n * lx + c * b]);
      }
    return points;
  };
  // Cheap building test first (2 m); roads (>= 9 m wide) and ground on a
  // 4 m lattice only for the open gaps.
  if (sample(2).some(([x, z]) => grid.blocks(x, z, 0.6))) return 0;
  let low = Infinity,
    high = -Infinity;
  for (const [x, z] of sample(4)) {
    const lateral = world.network.nearest(x, z, p),
      edge = world.network.edges[world.network.edgeOf[world.network.lastSegment]];
    if (Math.abs(lateral) < edge.spec.halfWidth + edge.spec.shoulder + 0.5) return 0;
    const y = carvedGroundHeight(world.carver, x, z);
    if (y < world.region.seaLevel + 0.8) return 0;
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  return high - low < 0.6 ? 1 - (high - low) : 0;
}

/** City blocks whose street face is balconies or open corridors (ref 089):
 * no canvas awnings or projecting signs cross those parapets. */
export function isApartment(s: Structure) {
  return s.kind === 'block' && (s.style >>> 4) % 3 === 0;
}

/** Local x end (+1/-1) of an apartment block's rear stair. */
export function stairSide(s: Structure) {
  return (s.style & 1024) === 0 ? 1 : -1;
}

/** Villages are the towns whose buildings never exceed three storeys. */
function village(town: TownSpec) {
  return town.floors[1] <= 3;
}
function inside(town: TownSpec, x: number, z: number, pad: number) {
  return x > town.x0 - pad && x < town.x1 + pad && z > town.z0 - pad && z < town.z1 + pad;
}
function mix(h: number) {
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

const cache = new WeakMap<readonly Structure[], ArchitecturePlan>();

/** Deterministic plan shared by buildings, signage and the authored kits so
 * each module agrees which facade faces the road and which lot is a store. */
export function architecturePlan(
  world: OpenWorld,
  structures: readonly Structure[],
): ArchitecturePlan {
  const cached = cache.get(structures);
  if (cached) return cached;
  const p = trackPoint(),
    net = world.network;
  const terrace = new Map<number, number>();
  const style: Architecture[] = [],
    front = new Int8Array(structures.length),
    roadClass: string[] = [];
  structures.forEach((s, i) => {
    net.nearest(s.x, s.z, p);
    const c = Math.cos(s.heading),
      n = Math.sin(s.heading);
    front[i] = (p.x - s.x) * -n + (p.z - s.z) * c >= 0 ? 1 : -1;
    roadClass[i] = net.edges[net.edgeOf[net.lastSegment]].roadClass;
    const town = world.region.towns.find((t) => inside(t, s.x, s.z, 40));
    if (s.kind === 'chapel') {
      style[i] = 'temple';
      const c = Math.cos(s.heading),
        n = Math.sin(s.heading);
      let high = -Infinity;
      for (let a = -s.hx; a <= s.hx + 1e-6; a += s.hx / 4)
        for (let b = -s.hz; b <= s.hz + 1e-6; b += s.hz / 2)
          high = Math.max(
            high,
            carvedGroundHeight(world.carver, s.x + c * a - n * b, s.z + n * a + c * b),
          );
      terrace.set(i, high);
    } else if (s.kind === 'farm') style[i] = 'minka';
    else if (s.kind === 'house') style[i] = 'minka';
    else if (s.kind === 'shop' && town && village(town)) style[i] = 'machiya';
    else if (s.kind === 'shop' || s.kind === 'block') style[i] = 'urban';
    else style[i] = 'legacy';
  });
  const konbiniFloor = new Set<number>(),
    chain = new Map<number, number>(),
    lotSide = new Map<number, number>();
  // Stand-alone stores with a side car park (the festival car meet) where a
  // town frontage leaves a flat, unbuilt gap of >= 16 m beside a two- or
  // three-storey shop: 2.5 x 5.0 m nose-in bays from the street, a second
  // row behind. Up to two per town, spread >= 400 m apart.
  const grid = new StructureGrid(structures);
  for (const town of world.region.towns) {
    if (village(town)) continue;
    const candidates: { i: number; side: number; score: number }[] = [];
    structures.forEach((s, i) => {
      if (style[i] !== 'urban' || s.kind !== 'shop' || roadClass[i] !== 'town') return;
      if (!inside(town, s.x, s.z, 0) || s.hx < 6.5 || s.hz < 5) return;
      for (const side of [-1, 1]) {
        const lot = lotClear(world, grid, s, side, p);
        if (lot) candidates.push({ i, side, score: lot + s.hx });
      }
    });
    candidates.sort((a, b) => b.score - a.score || a.i - b.i);
    const chosen: number[] = [];
    for (const c of candidates) {
      const s = structures[c.i];
      if (chosen.some((j) => Math.hypot(structures[j].x - s.x, structures[j].z - s.z) < 400))
        continue;
      chosen.push(c.i);
      style[c.i] = 'konbini';
      lotSide.set(c.i, c.side);
      chain.set(c.i, chosen.length % 2);
      if (chosen.length >= 2) break;
    }
  }
  // City stores on the ground floor of wide street-front buildings, about
  // one per 15 eligible frontages, alternating between two original chains.
  structures.forEach((s, i) => {
    if (style[i] !== 'urban' || s.hx < 8 || roadClass[i] !== 'town') return;
    if (mix(s.style ^ 0x5bd1e995) % 15 !== 4) return;
    konbiniFloor.add(i);
    chain.set(i, konbiniFloor.size % 2);
  });
  const landmarks: VisualLandmark[] = [];
  for (const town of world.region.towns) {
    if (village(town)) continue;
    const site = castleSite(world, grid, town, p);
    if (site) landmarks.push(site);
  }
  const rearStair = new Set<number>();
  structures.forEach((s, i) => {
    if (style[i] !== 'urban' || !isApartment(s) || s.floors < 3) return;
    const rear = -front[i],
      sx = stairSide(s),
      c = Math.cos(s.heading),
      n = Math.sin(s.heading);
    for (const lx of [sx * (s.hx - 4.8), sx * (s.hx - 2.5), sx * (s.hx + 0.3)])
      for (const lz of [rear * (s.hz + 0.25), rear * (s.hz + 1.2), rear * (s.hz + 2.1)]) {
        const x = s.x + c * lx - n * lz,
          z = s.z + n * lx + c * lz;
        if (grid.blocks(x, z, 0.1)) return;
        const lateral = Math.abs(net.nearest(x, z, p)),
          edge = net.edges[net.edgeOf[net.lastSegment]];
        if (lateral < edge.spec.halfWidth + edge.spec.shoulder + 0.3) return;
      }
    rearStair.add(i);
  });
  const plan = {
    style,
    front,
    konbiniFloor,
    chain,
    lotSide,
    landmarks,
    terrace,
    rearStair,
  };
  cache.set(structures, plan);
  return plan;
}
