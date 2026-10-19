import { clamp } from '../../core/math.ts';
import { architecturePlan } from '../../rendering/open-world/japan-architecture.ts';
import { bendZones, junctionClearance } from '../../rendering/open-world/road-layout.ts';
import { trackPoint } from '../track.ts';
import { carvedGroundHeight } from './ground-height.ts';
import { hash01 } from './noise.ts';
import { insideFootprint, TREE_SPECIES, TREE_STRIDE, type Structure } from './placement.ts';
import { roadCandidates, type RoadEdge } from './road-network.ts';
import { TILE_SIZE } from './terrain-tiles.ts';
import type { OpenWorld } from './world.ts';

/**
 * Street trees (refs 015, 033, 050, 086, 096, 097, 027, 089): sidewalk trees
 * in tree pits along Port Ilse's streets, cherry avenues on country roads
 * around Ashvale and the castle approach, a maple row along the temple
 * front. Planted in the shared placement (treesForTile), so every trunk is
 * a physics collider and the drawn tree; deterministic from the region.
 *
 * Measured / standard: tree pits 1.0 m square at the back of the 2.4 m
 * town footway (the flush footway is drivable: trunks stay 0.45 m outside
 * the road footprint), 10 m apart (8-12 m street-tree spacing), crowns
 * leaning 1.1 m out over the footway and kerb;
 * avenue trunks 1.6 m past the country shoulder, 9 m apart; pruned crowns
 * with a clear stem to >= 2.5 m so cars and shopfronts read underneath.
 * Never in a carriageway, junction mouth (crosswalk, signal, fences), on a
 * bridge, in sharp bends (chevrons), beside lamp standards or utility poles,
 * in front of store lots, coin parks, driveways or a frontage's entrance.
 */
export const STREET_TREE = Object.freeze({
  townSpacing: 10,
  avenueSpacing: 9,
  /** Trunk centre behind the kerb (town) / past the shoulder (avenue). */
  /** Beyond the road footprint (carriageway + shoulder). */
  townSetback: 0.45,
  avenueSetback: 1.6,
  /** Clear stem under the drawn crown (m). */
  clearStem: 2.5,
  /** Crown offset from the trunk toward the road (m). */
  lean: 1.1,
  /** Ashvale avenues reach and the castle approach reach (m). */
  ashvaleReach: 1100,
  castleReach: 650,
  /** Temple maple row: half length along the road (m). */
  templeReach: 70,
});

/** Street species codes (TREE_SPECIES): cherry, zelkova/ginkgo, maple. */
export function isStreetSpecies(species: number) {
  return species >= TREE_SPECIES.STREET_CHERRY && species <= TREE_SPECIES.STREET_MAPLE;
}

/** Pruned street-tree crown (unit-crown instance scale): crown height and
 * width, lift of the crown instance above the ground, so the lowest drawn
 * leaves (foliage crown shaping, landscape.ts foliageReach) clear the stem
 * height whatever the per-tree reach. Width / height also picks the atlas
 * silhouette: cherry the widest lobes (>= 1.065), maple round (1.0),
 * zelkova/ginkgo the upright broadleaf (0.73-0.93). */
export function streetTreeForm(species: number, height: number) {
  if (species === TREE_SPECIES.STREET_CHERRY) {
    const crownH = height * 0.66,
      crownW = crownH * 1.16;
    // Lowest crown base: 1.02 - 0.83 * 0.82 (atlas tile 3) of the crown.
    return { crownH, crownW, lift: Math.max(0.3, STREET_TREE.clearStem - 0.339 * crownH) };
  }
  const crownH = height * (species === TREE_SPECIES.STREET_MAPLE ? 0.65 : 0.72),
    crownW = crownH * (species === TREE_SPECIES.STREET_MAPLE ? 1.0 : 0.8);
  // Lowest crown base: 1.02 - 0.83 * 1.12 (atlas tiles 0 and 2).
  return { crownH, crownW, lift: STREET_TREE.clearStem + 0.1 - 0.0904 * crownH };
}

interface StreetPlan {
  trees: Float32Array;
  /** Tree indices per 256 m tile (key as tileKey). */
  byTile: Map<number, number[]>;
}
const cache = new WeakMap<readonly Structure[], StreetPlan>();
const tileKey = (ix: number, iz: number) => (ix + 512) * 1024 + (iz + 512);

/** Street trees of one 256 m tile (TREE_STRIDE packing). */
export function streetTreesForTile(
  world: OpenWorld,
  structures: readonly Structure[],
  ix: number,
  iz: number,
): Float32Array {
  const plan = streetTreePlan(world, structures),
    list = plan.byTile.get(tileKey(ix, iz));
  if (!list) return EMPTY;
  const out = new Float32Array(list.length * TREE_STRIDE);
  list.forEach((t, k) =>
    out.set(plan.trees.subarray(t * TREE_STRIDE, (t + 1) * TREE_STRIDE), k * TREE_STRIDE),
  );
  return out;
}
const EMPTY = new Float32Array(0);

/** Every street tree of the region (cached per structure list). */
export function streetTreePlan(world: OpenWorld, structures: readonly Structure[]): StreetPlan {
  const cached = cache.get(structures);
  if (cached) return cached;
  const net = world.network,
    region = world.region,
    field = world.field,
    plan = architecturePlan(world, structures),
    p = trackPoint(),
    q = trackPoint(),
    cands = roadCandidates(),
    seed = 0x57ee7,
    out: number[] = [],
    cells = new Map<number, number[]>();
  const city = region.towns.find((t) => t.floors[1] > 3),
    village = region.towns.find((t) => t.floors[1] <= 3);
  const inTown = (t: typeof city, x: number, z: number, pad = 0) =>
    !!t && x > t.x0 - pad && x < t.x1 + pad && z > t.z0 - pad && z < t.z1 + pad;
  const castle = plan.landmarks.find((l) => l.kind === 'castle');
  const temple = structures.find((s) => s.kind === 'chapel');
  // Buildings near a point (frontage, entrance tests).
  const grid = new Map<number, number[]>();
  structures.forEach((s, i) => {
    const key = Math.floor(s.x / 48) * 65536 + Math.floor(s.z / 48);
    grid.set(key, [...(grid.get(key) ?? []), i]);
  });
  const buildingAt = (x: number, z: number, pad: number) => {
    const cx = Math.floor(x / 48),
      cz = Math.floor(z / 48);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const i of grid.get((cx + a) * 65536 + cz + b) ?? [])
          if (insideFootprint(structures[i], x, z, pad)) return i;
    return -1;
  };
  // Species per street: whole streets share one species (097, 089). The
  // streets running inland from the harbour are cherry avenues, the ones
  // along the shore zelkova (golden in autumn).
  const inland = (e: RoadEdge) => {
    const a = e.road.points[0],
      b = e.road.points[e.road.points.length - 1];
    return Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]);
  };
  const usable: RoadEdge[] = net.edges.filter(
    (e) => e.spec.surface === 'asphalt' && (e.roadClass === 'town' || e.roadClass === 'country'),
  );
  for (const e of usable) {
    const town = e.roadClass === 'town',
      spec = e.spec,
      clear = junctionClearance(net, e),
      bends = bendZones(net, e),
      poleSide = hash01(e.index, 3, 0x9e1) < 0.5 ? -1 : 1,
      poles: number[] = [];
    // Utility pole stations (road-furniture.ts utilityPoles).
    for (let s = clear[0] + 4, k = 0; s < e.length - clear[1] - 4; k++) {
      let at = s;
      const lamp = Math.round((at - 12) / 32) * 32 + 12,
        lampSide = Math.floor(lamp / 32) % 2 === 0 ? 1 : -1;
      if (town && lampSide === poleSide && Math.abs(at - lamp) < 4) at = lamp + 4.5;
      poles.push(at);
      s += 30 + 15 * hash01(e.index * 7919, k, 5);
    }
    const nearPole = (s: number, side: number) =>
      side === poleSide && poles.some((at) => Math.abs(at - s) < 4.5);
    // Town lamp standards (roads.ts townLamps): s = 12 + 32 n, alternating.
    const nearLamp = (s: number, side: number) => {
      if (!town) return false;
      const lamp = Math.round((s - 12) / 32) * 32 + 12;
      return (Math.floor(lamp / 32) % 2 === 0 ? 1 : -1) === side && Math.abs(s - lamp) < 5;
    };
    const margin = 16,
      spacing = town ? STREET_TREE.townSpacing : STREET_TREE.avenueSpacing;
    for (const side of [-1, 1]) {
      for (
        let s = clear[0] + margin + hash01(e.index, side, seed) * 4;
        s < e.length - clear[1] - margin;
        s += spacing
      ) {
        const at = s + (hash01(e.index * 3 + side, Math.round(s), seed) - 0.5) * 1.6;
        if (nearLamp(at, side) || nearPole(at, side)) continue;
        if (bends.some((b) => at > b.s0 - 6 && at < b.s1 + 6)) continue;
        net.at(e.offset + at, p);
        const setback =
            spec.shoulder + (town ? STREET_TREE.townSetback : STREET_TREE.avenueSetback),
          lateral =
            side *
            (spec.halfWidth +
              setback +
              (hash01(e.index, Math.round(at * 7), seed + side) - 0.5) * 0.2),
          x = p.x + p.nx * lateral,
          z = p.z + p.nz * lateral;
        // Species of this stretch.
        let species = -1;
        const templeRow =
          temple && Math.hypot(x - temple.x, z - temple.z) < STREET_TREE.templeReach && !town;
        if (templeRow) {
          // Not across the gate: the approach opens onto the road.
          const c = Math.cos(temple.heading),
            n = Math.sin(temple.heading),
            lx = (x - temple.x) * c + (z - temple.z) * n;
          if (Math.abs(lx) < 6) continue;
          species = TREE_SPECIES.STREET_MAPLE;
        } else if (town) {
          if (!inTown(city, x, z)) continue;
          species = inland(e) ? TREE_SPECIES.STREET_CHERRY : TREE_SPECIES.STREET_ZELKOVA;
        } else {
          // Cherry avenues in runs of ~150 m on the roads around Ashvale and
          // on the castle approach (015, 033, 050): about half the runs.
          const ash =
            village &&
            Math.hypot(x - (village.x0 + village.x1) / 2, z - (village.z0 + village.z1) / 2) <
              STREET_TREE.ashvaleReach;
          const toCastle =
            castle && Math.hypot(x - castle.x, z - castle.z) < STREET_TREE.castleReach;
          if (!ash && !toCastle) continue;
          if (inTown(village, x, z, 10) || inTown(city, x, z, 40)) continue;
          if (hash01(e.index, Math.floor(at / 150), seed + 9) > (toCastle ? 0.85 : 0.5)) continue;
          species = TREE_SPECIES.STREET_CHERRY;
        }
        if (tooClose(cells, out, x, z, 6) || buildingAt(x, z, 0.5) >= 0) continue;
        if (town) {
          // A frontage behind the tree (no lot, coin park or driveway gap)
          // that is not a store front, and not before its entrance.
          const b = buildingAt(x + p.nx * side * 3.6, z + p.nz * side * 3.6, 0);
          if (b < 0 || plan.style[b] === 'konbini' || plan.konbiniFloor.has(b)) continue;
          const f = structures[b],
            lx = (x - f.x) * Math.cos(f.heading) + (z - f.z) * Math.sin(f.heading);
          if (Math.abs(lx) < 2.2 || Math.abs(lx) > f.hx + 0.5) continue;
        }
        // Nearest centreline must be this edge (not a junction corner).
        net.nearest(x, z, q);
        if (net.edges[net.edgeOf[net.lastSegment]] !== e) continue;
        // Every road nearby: trunk clear of every carriageway, not on
        // another road's footprint, not on a bridge.
        const count = net.covering(x, z, p.y, 4, cands);
        let ok = true;
        for (let k = 0; k < count && ok; k++) {
          const other = net.edges[net.edgeOf[cands.segment[k]]];
          if (cands.bridge[k]) ok = false;
          else if (cands.distance[k] - other.spec.halfWidth - other.spec.shoulder < 0.42)
            ok = false;
          else if (other !== e && cands.outside[k] < 1.2) ok = false;
        }
        if (!ok) continue;
        if (
          p.y < region.seaLevel + 0.8 ||
          field.valleyAt(x, z).distance < region.valley.channel + 5
        )
          continue;
        if (!town) {
          // Level verge only (no tree on an embankment or in a cutting).
          const g = (dx: number, dz: number) => carvedGroundHeight(world.carver, x + dx, z + dz),
            road = net.surfaceHeight(p, side * spec.halfWidth, spec.halfWidth, spec.crown);
          if (Math.abs(g(0, 0) - road) > 0.7) continue;
          if (Math.hypot(g(1.5, 0) - g(-1.5, 0), g(0, 1.5) - g(0, -1.5)) > 0.75) continue;
        }
        const cell = Math.floor(x / 8) * 65536 + Math.floor(z / 8);
        cells.set(cell, [...(cells.get(cell) ?? []), out.length]);
        const r = hash01(Math.round(x * 10), Math.round(z * 10), seed + 3);
        const height =
          species === TREE_SPECIES.STREET_ZELKOVA
            ? 8 + r * 2
            : species === TREE_SPECIES.STREET_MAPLE
              ? 5.8 + r * 1.4
              : town
                ? 6.4 + r * 1.2
                : 7.6 + r * 1.6;
        out.push(
          x,
          z,
          height,
          species,
          // Yaw: local +z toward the road (the crown leans that way).
          Math.atan2(-side * p.nx, -side * p.nz),
          clamp(hash01(Math.round(z * 10), Math.round(x * 10), seed), 0, 0.99),
        );
      }
    }
  }
  const trees = Float32Array.from(out),
    byTile = new Map<number, number[]>();
  for (let t = 0; t < trees.length / TREE_STRIDE; t++) {
    const key = tileKey(
      Math.floor(trees[t * TREE_STRIDE] / TILE_SIZE),
      Math.floor(trees[t * TREE_STRIDE + 1] / TILE_SIZE),
    );
    const list = byTile.get(key);
    if (list) list.push(t);
    else byTile.set(key, [t]);
  }
  const result = { trees, byTile };
  cache.set(structures, result);
  return result;
}
function tooClose(
  cells: ReadonlyMap<number, readonly number[]>,
  out: readonly number[],
  x: number,
  z: number,
  d: number,
) {
  const cx = Math.floor(x / 8),
    cz = Math.floor(z / 8);
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const i of cells.get((cx + a) * 65536 + cz + b) ?? [])
        if (Math.hypot(out[i] - x, out[i + 1] - z) < d) return true;
  return false;
}
