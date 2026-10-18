import { clamp } from '../../core/math.ts';
import { smoothstep } from './noise.ts';
import { ROAD_CELL, ROAD_FLAG, type RoadNetwork } from './road-network.ts';
import type { TerrainField } from './terrain-field.ts';

/** Edge of the finest (physics) terrain tile (m) and its cells per side:
 * 4 m spacing. Coarser render LODs double the tile edge per level with the
 * same cell count. */
export const TILE_SIZE = 256;
export const TILE_RES = 64;
export const TILE_STEP = TILE_SIZE / TILE_RES;
/** Terrain under the asphalt sits this far below the road surface so the
 * road ribbon never z-fights it; physics on the road reads the road itself. */
export const ROAD_BED = 0.18;

export const tileKey = (ix: number, iz: number, lod = 0) => `${lod}:${ix}:${iz}`;

/** Road influence of one tile vertex (rendering uses it for verge shading). */
export interface CarveResult {
  heights: Float32Array;
  /** 0..1: how much a road reshaped this vertex (1 on the road bed). */
  road: Float32Array;
  /** Distance to the nearest road centreline (m), capped at 255. */
  distance: Float32Array;
  /** Clear distance beyond the nearest usable road edge (carriageway plus
   * shoulder, m; negative on it), capped at 255. Rendering keeps ground
   * cover off the drivable surface with it. */
  edge: Float32Array;
  /** Ground removed by the carving (m): positive in cuttings, negative on
   * embankment fills. */
  cut: Float32Array;
}

/**
 * Builds carved terrain heights for a square tile: the natural TerrainField
 * with every road's bed, shoulders and embankments (cuts and fills) pressed
 * in. Carving is rasterised per road segment over its influence band, so
 * the cost follows the road area in the tile, not tile area times roads.
 * The physics worker and the render tile worker call the same code with the
 * same inputs, so the drivable ground and the drawn ground are one surface.
 */
export class TerrainCarver {
  private stamp = new Int32Array(0);
  private stampId = 1;
  private bestW = new Float32Array(0);
  private bestD = new Float32Array(0);
  private bestE = new Float32Array(0);
  private target = new Float32Array(0);
  constructor(
    readonly field: TerrainField,
    readonly network: RoadNetwork,
  ) {}
  /** Heights of an (res + 1)² vertex grid with origin (x0, z0) and spacing
   * `step`; `border` extra vertices on every side (for normals). `edgeSpan`
   * (m beyond the usable edge) widens the band where `edge` is measured past
   * the carving reach (rendering only; heights are unaffected). */
  build(x0: number, z0: number, step: number, res: number, border = 0, edgeSpan = 0): CarveResult {
    const side = res + 1 + 2 * border,
      count = side * side,
      ox = x0 - border * step,
      oz = z0 - border * step,
      minWavelength = step <= TILE_STEP ? 0 : step * 1.5;
    const heights = new Float32Array(count),
      road = new Float32Array(count),
      distance = new Float32Array(count).fill(255),
      edge = new Float32Array(count).fill(255),
      cut = new Float32Array(count);
    for (let j = 0; j < side; j++)
      for (let i = 0; i < side; i++) heights[j * side + i] = this.field.height(ox + i * step, oz + j * step, minWavelength);
    if (this.bestW.length < count) {
      this.bestW = new Float32Array(count);
      this.bestD = new Float32Array(count);
      this.bestE = new Float32Array(count);
      this.target = new Float32Array(count);
    }
    this.bestW.fill(0, 0, count);
    this.bestD.fill(Infinity, 0, count);
    this.bestE.fill(Infinity, 0, count);
    const net = this.network,
      g = net.grid,
      reach = 96,
      extent = (side - 1) * step;
    // Candidate segments from the road grid around the tile.
    const cx0 = Math.max(0, Math.floor((ox - reach - g.x0) / ROAD_CELL)),
      cx1 = Math.min(g.cols - 1, Math.floor((ox + extent + reach - g.x0) / ROAD_CELL)),
      cz0 = Math.max(0, Math.floor((oz - reach - g.z0) / ROAD_CELL)),
      cz1 = Math.min(g.rows - 1, Math.floor((oz + extent + reach - g.z0) / ROAD_CELL));
    if (this.stamp.length < net.x.length) this.stamp = new Int32Array(net.x.length);
    const id = ++this.stampId;
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = cz * g.cols + cx;
        for (let k = g.start[cell]; k < g.start[cell + 1]; k++) {
          const s = g.items[k];
          if (this.stamp[s] === id) continue;
          this.stamp[s] = id;
          this.carveSegment(s, ox, oz, step, side, heights, edgeSpan);
        }
      }
    for (let v = 0; v < count; v++) {
      const w = this.bestW[v];
      if (w > 0) {
        const before = heights[v];
        heights[v] += (this.target[v] - heights[v]) * w;
        cut[v] = before - heights[v];
      }
      road[v] = w;
      if (this.bestD[v] < 255) distance[v] = this.bestD[v];
      if (this.bestE[v] < 255) edge[v] = this.bestE[v];
    }
    return { heights, road, distance, edge, cut };
  }
  private carveSegment(
    i: number,
    ox: number,
    oz: number,
    step: number,
    side: number,
    raw: Float32Array,
    edgeSpan: number,
  ) {
    const net = this.network,
      j = i + 1,
      e = net.edges[net.edgeOf[i]],
      spec = e.spec,
      hw = spec.halfWidth,
      shoulder = hw + spec.shoulder,
      bridge = (net.flags[i] & ROAD_FLAG.BRIDGE) !== 0 && (net.flags[j] & ROAD_FLAG.BRIDGE) !== 0,
      reach = Math.max(net.influence[i], net.influence[j]),
      span = Math.max(reach, shoulder + edgeSpan);
    const ax = net.x[i],
      az = net.z[i],
      dx = net.x[j] - ax,
      dz = net.z[j] - az,
      len2 = dx * dx + dz * dz || 1,
      len = Math.sqrt(len2);
    const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - span - ox) / step)),
      i1 = Math.min(side - 1, Math.ceil((Math.max(ax, ax + dx) + span - ox) / step)),
      j0 = Math.max(0, Math.floor((Math.min(az, az + dz) - span - oz) / step)),
      j1 = Math.min(side - 1, Math.ceil((Math.max(az, az + dz) + span - oz) / step));
    if (i0 > i1 || j0 > j1) return;
    const crown = spec.crown;
    for (let vj = j0; vj <= j1; vj++)
      for (let vi = i0; vi <= i1; vi++) {
        const x = ox + vi * step,
          z = oz + vj * step,
          t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1),
          px = ax + dx * t,
          pz = az + dz * t,
          d = Math.hypot(x - px, z - pz);
        if (d > span) continue;
        const v = vj * side + vi;
        if (d - shoulder < this.bestE[v]) this.bestE[v] = d - shoulder;
        if (d > reach) continue;
        // Nearest road wins the distance; the strongest carve wins the height.
        if (d < this.bestD[v]) this.bestD[v] = d;
        if (bridge) continue;
        // Ends of a segment only carve across it, not beyond its endpoints
        // (the neighbouring segment owns that ground).
        const along = ((x - ax) * dx + (z - az) * dz) / len;
        if (along < -step || along > len + step) continue;
        const lateral = ((x - ax) * dz - (z - az) * dx) / len,
          y = net.y[i] + (net.y[j] - net.y[i]) * t,
          bank = net.bank[i] + (net.bank[j] - net.bank[i]) * t,
          l = clamp(lateral, -hw, hw),
          surface = y + bank * l - Math.max(0, crown - Math.abs(bank)) * Math.abs(l);
        let target: number, w: number;
        if (d <= hw) {
          target = surface - ROAD_BED;
          w = 1;
        } else if (d <= shoulder) {
          target = surface - 0.06 - (d - hw) * 0.03;
          w = 1;
        } else {
          target = surface - 0.06 - (shoulder - hw) * 0.03;
          w = 1 - smoothstep(shoulder, reach, d);
          // The band falls back to the natural ground faster on the side of
          // the road where it already meets it.
          const delta = Math.abs(target - raw[v]);
          if (delta < 0.5) w *= delta / 0.5;
        }
        if (w > this.bestW[v] || (w === this.bestW[v] && d < this.bestD[v] + 1e-6)) {
          this.bestW[v] = w;
          this.target[v] = target;
        }
      }
  }
}

/** Point height on a heights grid with the render mesh's triangulation
 * (quads split along the (i, j)-(i+1, j+1) diagonal). Writes the triangle's
 * normal into `normal` when given. */
export function gridHeight(
  heights: Float32Array,
  side: number,
  fx: number,
  fz: number,
  step: number,
  normal?: { x: number; y: number; z: number },
) {
  const i = clamp(Math.floor(fx), 0, side - 2),
    j = clamp(Math.floor(fz), 0, side - 2),
    u = fx - i,
    v = fz - j,
    a = heights[j * side + i],
    b = heights[j * side + i + 1],
    c = heights[(j + 1) * side + i],
    d = heights[(j + 1) * side + i + 1];
  let gx: number, gz: number, h: number;
  if (u >= v) {
    gx = b - a;
    gz = d - b;
    h = a + gx * u + gz * v;
  } else {
    gx = d - c;
    gz = c - a;
    h = a + gx * u + gz * v;
  }
  if (normal) {
    const nx = -gx / step,
      nz = -gz / step,
      len = Math.hypot(nx, 1, nz);
    normal.x = nx / len;
    normal.y = 1 / len;
    normal.z = nz / len;
  }
  return h;
}

export interface TileCacheStats {
  resident: number;
  peakResident: number;
  budget: number;
  generated: number;
  evicted: number;
  /** Tiles generated synchronously because a query arrived first. */
  stalls: number;
  prefetched: number;
  generationMs: number;
  worstGenerationMs: number;
}

/** LRU cache of LOD0 (physics) height tiles with a hard residency budget.
 * `prefetch` generates missing tiles near the cars ahead of use within a
 * time budget; a query on a missing tile builds it synchronously (counted
 * as a stall). Eviction never drops a tile requested this tick. */
export class TerrainTileCache {
  private readonly tiles = new Map<number, Float32Array>();
  private readonly pending: number[] = [];
  private readonly queued = new Set<number>();
  readonly stats: TileCacheStats;
  private lastKey = NaN;
  private lastTile: Float32Array | null = null;
  constructor(
    readonly carver: TerrainCarver,
    readonly budget = 64,
  ) {
    this.stats = {
      resident: 0,
      peakResident: 0,
      budget,
      generated: 0,
      evicted: 0,
      stalls: 0,
      prefetched: 0,
      generationMs: 0,
      worstGenerationMs: 0,
    };
  }
  private static key(ix: number, iz: number) {
    return (ix + 512) * 1024 + (iz + 512);
  }
  private generate(key: number) {
    const ix = Math.floor(key / 1024) - 512,
      iz = (key % 1024) - 512;
    const start = performance.now();
    const { heights } = this.carver.build(ix * TILE_SIZE, iz * TILE_SIZE, TILE_STEP, TILE_RES);
    const ms = performance.now() - start;
    this.stats.generated++;
    this.stats.generationMs += ms;
    this.stats.worstGenerationMs = Math.max(this.stats.worstGenerationMs, ms);
    this.tiles.set(key, heights);
    while (this.tiles.size > this.budget) {
      // Map iteration order is insertion order: the first key is the LRU.
      const oldest = this.tiles.keys().next().value as number;
      this.tiles.delete(oldest);
      this.stats.evicted++;
      if (oldest === this.lastKey) {
        this.lastKey = NaN;
        this.lastTile = null;
      }
    }
    this.stats.resident = this.tiles.size;
    this.stats.peakResident = Math.max(this.stats.peakResident, this.tiles.size);
    return heights;
  }
  private tile(ix: number, iz: number) {
    const key = TerrainTileCache.key(ix, iz);
    if (key === this.lastKey && this.lastTile) return this.lastTile;
    let tile = this.tiles.get(key);
    if (tile) {
      // Refresh LRU position.
      this.tiles.delete(key);
      this.tiles.set(key, tile);
    } else {
      this.stats.stalls++;
      tile = this.generate(key);
    }
    this.lastKey = key;
    this.lastTile = tile;
    return tile;
  }
  /** Carved ground height at (x, z), optionally the triangle normal. */
  height(x: number, z: number, normal?: { x: number; y: number; z: number }) {
    const ix = Math.floor(x / TILE_SIZE),
      iz = Math.floor(z / TILE_SIZE),
      tile = this.tile(ix, iz);
    return gridHeight(
      tile,
      TILE_RES + 1,
      (x - ix * TILE_SIZE) / TILE_STEP,
      (z - iz * TILE_SIZE) / TILE_STEP,
      TILE_STEP,
      normal,
    );
  }
  has(x: number, z: number) {
    return this.tiles.has(TerrainTileCache.key(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)));
  }
  /** Queue tiles around (x, z) and along the velocity (lookahead seconds). */
  want(x: number, z: number, vx: number, vz: number, lookahead = 3) {
    const points: [number, number][] = [[x, z]];
    for (const t of [1, 2, 3]) points.push([x + (vx * lookahead * t) / 3, z + (vz * lookahead * t) / 3]);
    for (const [px, pz] of points) {
      const ix = Math.floor(px / TILE_SIZE),
        iz = Math.floor(pz / TILE_SIZE);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          // Only the neighbours the point is close to.
          const cx = (ix + dx + 0.5) * TILE_SIZE,
            cz = (iz + dz + 0.5) * TILE_SIZE;
          if (Math.max(Math.abs(cx - px), Math.abs(cz - pz)) > TILE_SIZE * 0.5 + 64) continue;
          const key = TerrainTileCache.key(ix + dx, iz + dz);
          if (this.tiles.has(key) || this.queued.has(key)) continue;
          this.queued.add(key);
          this.pending.push(key);
        }
    }
  }
  /** Generate queued tiles for at most `budgetMs` (at least one). */
  prefetch(budgetMs: number) {
    const start = performance.now();
    while (this.pending.length && performance.now() - start < budgetMs) {
      const key = this.pending.shift()!;
      this.queued.delete(key);
      if (this.tiles.has(key)) continue;
      this.generate(key);
      this.stats.prefetched++;
    }
  }
  get queuedCount() {
    return this.pending.length;
  }
  clear() {
    this.tiles.clear();
    this.pending.length = 0;
    this.queued.clear();
    this.lastKey = NaN;
    this.lastTile = null;
    this.stats.resident = 0;
  }
}
