import * as T from 'three';
import { TILE_SIZE } from '../../simulation/open-world/terrain-tiles.ts';
import type { FromTileWorker, TileMeshData, ToTileWorker } from '../../workers/open-world-protocol.ts';
import { terrainMaterial } from './terrain-material.ts';

/** Quadtree levels: level L tiles are TILE_SIZE·2^L wide. Level 6 tiles
 * (16.4 km) cover the drivable region and the horizon ranges around it. */
export const TERRAIN_LEVELS = 6;
export const TERRAIN_EXTENT = TILE_SIZE * 2 ** TERRAIN_LEVELS;
const ORIGIN = -TERRAIN_EXTENT / 2;

export interface TerrainBudget {
  /** Split distance as a multiple of the tile edge (detail falloff). */
  split: number;
  /** Resident GPU tiles (LRU beyond this). */
  maxTiles: number;
  /** Tile requests in flight to the worker. */
  inFlight: number;
  /** Tree planting density for the near levels (0..1). */
  trees: number;
}
export const TERRAIN_BUDGETS: Readonly<Record<'low' | 'medium' | 'high', TerrainBudget>> = Object.freeze({
  low: { split: 1.25, maxTiles: 110, inFlight: 3, trees: 0.45 },
  medium: { split: 1.6, maxTiles: 150, inFlight: 4, trees: 0.7 },
  high: { split: 2.1, maxTiles: 220, inFlight: 6, trees: 1 },
});

interface Tile {
  key: number;
  level: number;
  ix: number;
  iz: number;
  mesh: T.Mesh | null;
  data: TileMeshData | null;
  requested: boolean;
  id: number;
  used: number;
}
const res = (level: number) => (level <= 2 ? 64 : 32);
const key = (level: number, ix: number, iz: number) => (level * 4096 + ix) * 4096 + iz;

/**
 * Streamed terrain with level of detail: a quadtree of carved height tiles
 * built in the tile worker, drawn with the layered PBR terrain material.
 * Each frame the tree is refined around the camera (split while closer than
 * `split` tile edges); a node whose children are not all resident keeps
 * drawing itself, so there are never holes, only coarser ground for a few
 * frames. Skirts hide the cracks between neighbouring levels. Resident
 * tiles beyond the budget are evicted least-recently-used.
 */
export class TerrainStreamer {
  readonly root = new T.Group();
  readonly material = terrainMaterial();
  private readonly tiles = new Map<number, Tile>();
  private readonly byId = new Map<number, Tile>();
  private nextId = 1;
  private frame = 0;
  private inFlight = 0;
  private readonly indices = new Map<number, T.BufferAttribute>();
  /** Diagnostics. */
  stats = { resident: 0, drawn: 0, requested: 0, built: 0, evicted: 0, workerMs: 0 };
  /** Tree data of drawn near tiles changed (vegetation rebuilds instances). */
  readonly treeTiles = new Map<number, { data: TileMeshData; level: number; ix: number; iz: number }>();
  treesChanged = false;
  private readonly camera = new T.Vector3();
  constructor(
    private readonly worker: Worker,
    public budget: TerrainBudget = TERRAIN_BUDGETS.medium,
  ) {
    this.root.name = 'Festival terrain';
    worker.addEventListener('message', this.receive);
  }
  private receive = (event: MessageEvent<FromTileWorker>) => {
    const msg = event.data;
    const tile = this.byId.get(msg.id);
    this.byId.delete(msg.id);
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (!tile || msg.type === 'error') return;
    tile.data = msg;
    tile.mesh = this.build(tile, msg);
    this.stats.built++;
    this.stats.workerMs = this.stats.workerMs * 0.9 + msg.ms * 0.1;
  };
  private indexFor(r: number) {
    let index = this.indices.get(r);
    if (index) return index;
    const side = r + 1,
      list: number[] = [];
    for (let j = 0; j < r; j++)
      for (let i = 0; i < r; i++) {
        const a = j * side + i,
          b = a + 1,
          c = a + side,
          d = c + 1;
        // Diagonal a-d: the physics triangulation (terrain-tiles gridHeight).
        list.push(a, d, b, a, c, d);
      }
    // Skirts: edge vertex k of side e has its dropped twin at side² + e·side + k.
    const base = side * side;
    const edges = [
      (k: number) => k, // z = 0 row
      (k: number) => r * side + k, // z = max row
      (k: number) => k * side, // x = 0 column
      (k: number) => k * side + r, // x = max column
    ];
    edges.forEach((edge, e) => {
      for (let k = 0; k < r; k++) {
        const a = edge(k),
          b = edge(k + 1),
          a2 = base + e * side + k,
          b2 = a2 + 1;
        // Both windings: skirts are seen from either side.
        list.push(a, b, a2, b, b2, a2, a, a2, b, b, a2, b2);
      }
    });
    index = new T.BufferAttribute(new Uint32Array(list), 1);
    this.indices.set(r, index);
    return index;
  }
  private build(tile: Tile, data: TileMeshData) {
    const r = res(tile.level),
      side = r + 1,
      size = TILE_SIZE * 2 ** tile.level,
      step = size / r,
      count = side * side + 4 * side,
      skirt = 2 + step * 0.6;
    const position = new Float32Array(count * 3),
      normal = new Float32Array(count * 3),
      splat = new Float32Array(count * 4),
      shade = new Float32Array(count * 4);
    for (let j = 0; j < side; j++)
      for (let i = 0; i < side; i++) {
        const v = j * side + i;
        position[v * 3] = i * step;
        position[v * 3 + 1] = data.heights[v];
        position[v * 3 + 2] = j * step;
      }
    normal.set(data.normals);
    splat.set(data.splat);
    shade.set(data.shade);
    const edges = [
      (k: number) => k,
      (k: number) => r * side + k,
      (k: number) => k * side,
      (k: number) => k * side + r,
    ];
    edges.forEach((edge, e) => {
      for (let k = 0; k < side; k++) {
        const from = edge(k),
          to = side * side + e * side + k;
        position[to * 3] = position[from * 3];
        position[to * 3 + 1] = position[from * 3 + 1] - skirt;
        position[to * 3 + 2] = position[from * 3 + 2];
        for (let c = 0; c < 3; c++) normal[to * 3 + c] = normal[from * 3 + c];
        for (let c = 0; c < 4; c++) {
          splat[to * 4 + c] = splat[from * 4 + c];
          shade[to * 4 + c] = shade[from * 4 + c];
        }
      }
    });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new T.BufferAttribute(normal, 3));
    geometry.setAttribute('splat', new T.BufferAttribute(splat, 4));
    geometry.setAttribute('shade', new T.BufferAttribute(shade, 4));
    geometry.setIndex(this.indexFor(r));
    geometry.boundingBox = new T.Box3(new T.Vector3(0, data.minY - skirt, 0), new T.Vector3(size, data.maxY, size));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new T.Sphere());
    const mesh = new T.Mesh(geometry, this.material);
    mesh.name = `Terrain L${tile.level} ${tile.ix},${tile.iz}`;
    mesh.position.set(ORIGIN + tile.ix * size, 0, ORIGIN + tile.iz * size);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    this.root.add(mesh);
    return mesh;
  }
  private tile(level: number, ix: number, iz: number) {
    const k = key(level, ix, iz);
    let t = this.tiles.get(k);
    if (!t) {
      t = { key: k, level, ix, iz, mesh: null, data: null, requested: false, id: 0, used: 0 };
      this.tiles.set(k, t);
    }
    return t;
  }
  private request(t: Tile, priority: number) {
    if (t.requested || t.mesh) return false;
    if (this.inFlight >= this.budget.inFlight && priority > 0) return false;
    const size = TILE_SIZE * 2 ** t.level;
    t.requested = true;
    t.id = this.nextId++;
    this.byId.set(t.id, t);
    this.inFlight++;
    this.stats.requested++;
    const message: ToTileWorker = {
      type: 'tile',
      id: t.id,
      x0: ORIGIN + t.ix * size,
      z0: ORIGIN + t.iz * size,
      size,
      res: res(t.level),
      trees: t.level <= 1 ? this.budget.trees : 0,
    };
    this.worker.postMessage(message);
    return true;
  }
  private wantsSplit(level: number, ix: number, iz: number) {
    if (level === 0) return false;
    const size = TILE_SIZE * 2 ** level,
      x0 = ORIGIN + ix * size,
      z0 = ORIGIN + iz * size,
      c = this.camera;
    const dx = Math.max(x0 - c.x, 0, c.x - (x0 + size)),
      dz = Math.max(z0 - c.z, 0, c.z - (z0 + size));
    const t = this.tiles.get(key(level, ix, iz));
    const dy = t?.data ? Math.max(0, c.y - t.data.maxY) : 0;
    return Math.hypot(dx, dz, dy * 0.6) < size * this.budget.split;
  }
  /** Refine around the camera; show the covering set; request what is
   * missing (nearest first); evict beyond the budget. */
  update(camera: T.Camera) {
    camera.getWorldPosition(this.camera);
    this.frame++;
    for (const t of this.tiles.values()) if (t.mesh) t.mesh.visible = false;
    let drawn = 0;
    const wanted: { t: Tile; d: number }[] = [];
    const visit = (level: number, ix: number, iz: number) => {
      const t = this.tile(level, ix, iz);
      t.used = this.frame;
      if (this.wantsSplit(level, ix, iz)) {
        const kids: Tile[] = [];
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) kids.push(this.tile(level - 1, ix * 2 + i, iz * 2 + j));
        if (kids.every((k) => k.mesh)) {
          for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) visit(level - 1, ix * 2 + i, iz * 2 + j);
          return;
        }
        for (const k of kids) {
          k.used = this.frame;
          if (!k.mesh) wanted.push({ t: k, d: this.distance(k) });
        }
      }
      if (t.mesh) {
        t.mesh.visible = true;
        drawn++;
      } else wanted.push({ t, d: this.distance(t) - 1e6 * (level === TERRAIN_LEVELS ? 1 : 0) });
    };
    visit(TERRAIN_LEVELS, 0, 0);
    wanted.sort((a, b) => a.d - b.d);
    for (const w of wanted) if (!this.request(w.t, w.t.level === TERRAIN_LEVELS ? 0 : 1)) break;
    this.stats.drawn = drawn;
    // Trees of the drawn near tiles.
    let changed = false;
    for (const t of this.tiles.values()) {
      const near = t.mesh?.visible && t.level <= 1 && t.data && t.data.trees.length > 0;
      if (near && !this.treeTiles.has(t.key)) {
        this.treeTiles.set(t.key, { data: t.data!, level: t.level, ix: t.ix, iz: t.iz });
        changed = true;
      } else if (!near && this.treeTiles.has(t.key)) {
        this.treeTiles.delete(t.key);
        changed = true;
      }
    }
    if (changed) this.treesChanged = true;
    this.evict();
  }
  private distance(t: Tile) {
    const size = TILE_SIZE * 2 ** t.level;
    return Math.hypot(ORIGIN + (t.ix + 0.5) * size - this.camera.x, ORIGIN + (t.iz + 0.5) * size - this.camera.z);
  }
  private evict() {
    const resident = [...this.tiles.values()].filter((t) => t.mesh);
    this.stats.resident = resident.length;
    if (resident.length <= this.budget.maxTiles) {
      // Forget never-built entries that fell out of use.
      for (const t of this.tiles.values()) if (!t.mesh && !t.requested && t.used < this.frame - 2) this.tiles.delete(t.key);
      return;
    }
    resident
      .filter((t) => t.used < this.frame && t.level < TERRAIN_LEVELS)
      .sort((a, b) => a.used - b.used)
      .slice(0, resident.length - this.budget.maxTiles)
      .forEach((t) => {
        this.root.remove(t.mesh!);
        t.mesh!.geometry.dispose();
        t.mesh = null;
        t.data = null;
        t.requested = false;
        this.tiles.delete(t.key);
        this.treeTiles.delete(t.key);
        this.stats.evicted++;
      });
    this.stats.resident = Math.min(resident.length, this.budget.maxTiles);
  }
  /** True once the coarse cover and the tiles under `at` are resident. */
  readyAround(x: number, z: number) {
    const top = this.tiles.get(key(TERRAIN_LEVELS, 0, 0));
    if (!top?.mesh) return false;
    const ix = Math.floor((x - ORIGIN) / TILE_SIZE),
      iz = Math.floor((z - ORIGIN) / TILE_SIZE);
    return !!this.tiles.get(key(0, ix, iz))?.mesh;
  }
  dispose() {
    this.worker.removeEventListener('message', this.receive);
    for (const t of this.tiles.values()) t.mesh?.geometry.dispose();
    this.tiles.clear();
    this.material.dispose();
  }
}
