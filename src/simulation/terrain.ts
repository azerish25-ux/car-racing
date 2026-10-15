import { clamp } from '../core/math.ts';

/** Bounded deformable dirt prototype (WP37/WP38, masterplan §9.2-§9.3).
 * A tile-based height/displacement field for loose-surface regions; bridges
 * and structures stay on mesh collision. Authoritative state is the base
 * height plus a bounded per-cell depression and compaction, so physical
 * contact, the rendered displacement and the AI line cost all read the same
 * numbers (no decorative groove with a flat contact).
 *
 * Lifecycle: every authoritative modification is a pure function of
 * (cell, load, slip, dt), so replay/resimulation reproduces it; `checkpoint`
 * captures only changed cells (sparse) and `restore` returns the field
 * exactly, which serves pause, seek, flashback, restart and late-join. Depth
 * is capped and compaction saturates, so fifty laps cannot deepen a rut
 * without bound; relaxation slowly re-fills untouched cells. */
export const TERRAIN = Object.freeze({
  /** Cell size (m): the physical resolution decision, recorded explicitly. */
  cell: 0.25,
  /** Maximum rut depth (m) and per-cell compaction ceiling (0..1). */
  maxDepth: 0.12,
  maxCompaction: 1,
  /** Depression per (N load · s · slip-weight), m. */
  sinkRate: 6e-5,
  /** Compacted soil resists further sinking. */
  compactionRate: 0.1,
  /** Fraction of depression relaxed per second in untouched cells. */
  relax: 0.0005,
  /** Rolling resistance coefficient added by full depth (bulldozing). */
  bulldoze: 0.12,
});
export type Material = 'hardpack' | 'loam' | 'sand' | 'mud';
const MATERIAL = Object.freeze({
  hardpack: { softness: 0.4, grip: 1.0 },
  loam: { softness: 1.0, grip: 0.92 },
  sand: { softness: 1.6, grip: 0.78 },
  mud: { softness: 2.2, grip: 0.6 },
});
export interface TerrainContact {
  height: number;
  nx: number;
  ny: number;
  nz: number;
  material: Material;
  moisture: number;
  compaction: number;
  depth: number;
  grip: number;
  resistance: number;
}
export interface TerrainCheckpoint {
  cells: Uint32Array;
  depth: Float32Array;
  compaction: Float32Array;
  sequence: number;
}
export class TerrainTile {
  readonly depth: Float32Array;
  readonly compaction: Float32Array;
  /** Cells changed since construction (sparse checkpoint set). */
  protected readonly dirty = new Set<number>();
  /** Monotonic count of authoritative modifications (replay ordering). */
  sequence = 0;
  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly columns: number,
    readonly rows: number,
    readonly base: (x: number, z: number) => number,
    readonly material: Material = 'loam',
    readonly moisture = 0.2,
  ) {
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 2 || rows < 2)
      throw new Error('Invalid terrain tile');
    if (columns * rows > 1 << 20) throw new Error('Terrain tile exceeds its cell budget');
    this.depth = new Float32Array(columns * rows);
    this.compaction = new Float32Array(columns * rows);
  }
  protected index(x: number, z: number) {
    const c = Math.floor((x - this.originX) / TERRAIN.cell),
      r = Math.floor((z - this.originZ) / TERRAIN.cell);
    return c < 0 || r < 0 || c >= this.columns || r >= this.rows ? -1 : r * this.columns + c;
  }
  heightAt(x: number, z: number) {
    const i = this.index(x, z);
    return this.base(x, z) - (i < 0 ? 0 : this.depth[i]);
  }
  /** The one contact query physics, rendering and AI share. */
  contact(x: number, z: number, out?: TerrainContact): TerrainContact {
    const i = this.index(x, z),
      h = TERRAIN.cell;
    const dx = (this.heightAt(x + h, z) - this.heightAt(x - h, z)) / (2 * h),
      dz = (this.heightAt(x, z + h) - this.heightAt(x, z - h)) / (2 * h),
      len = Math.hypot(dx, 1, dz);
    const depth = i < 0 ? 0 : this.depth[i],
      compaction = i < 0 ? 0 : this.compaction[i],
      m = MATERIAL[this.material],
      wet = clamp(this.moisture, 0, 1);
    const result = out ?? ({} as TerrainContact);
    result.height = this.heightAt(x, z);
    result.nx = -dx / len;
    result.ny = 1 / len;
    result.nz = -dz / len;
    result.material = this.material;
    result.moisture = wet;
    result.compaction = compaction;
    result.depth = depth;
    // Compacted ruts are grippier (a line forms); moisture costs grip.
    result.grip = m.grip * (1 + 0.08 * compaction) * (1 - 0.3 * wet * (1 - compaction));
    result.resistance =
      0.02 + TERRAIN.bulldoze * (depth / TERRAIN.maxDepth) * (1 - compaction * 0.5);
    return result;
  }
  /** Authoritative wheel interaction: depress and compact the contacted cell. */
  deform(x: number, z: number, load: number, slip: number, dt: number) {
    const i = this.index(x, z);
    if (i < 0 || !(load > 0) || !(dt > 0)) return;
    const m = MATERIAL[this.material],
      soft = m.softness * (0.6 + 0.8 * clamp(this.moisture, 0, 1));
    const resist = 1 - this.compaction[i] / TERRAIN.maxCompaction;
    const sink = TERRAIN.sinkRate * load * dt * soft * (0.5 + clamp(slip, 0, 2)) * resist;
    this.depth[i] = Math.min(TERRAIN.maxDepth, this.depth[i] + sink);
    this.compaction[i] = Math.min(
      TERRAIN.maxCompaction,
      this.compaction[i] + TERRAIN.compactionRate * load * dt * 1e-2,
    );
    this.dirty.add(i);
    this.sequence++;
  }
  /** Untouched cells slowly re-fill (track crew/raking abstraction). */
  relax(dt: number) {
    const k = Math.exp(-TERRAIN.relax * dt);
    for (const i of this.dirty) this.depth[i] *= k;
  }
  checkpoint(): TerrainCheckpoint {
    const cells = Uint32Array.from(this.dirty);
    return {
      cells,
      depth: Float32Array.from(cells, (i) => this.depth[i]),
      compaction: Float32Array.from(cells, (i) => this.compaction[i]),
      sequence: this.sequence,
    };
  }
  /** Restore exactly; cells changed after the checkpoint return to pristine. */
  restore(cp: TerrainCheckpoint) {
    for (const i of this.dirty) {
      this.depth[i] = 0;
      this.compaction[i] = 0;
    }
    this.dirty.clear();
    cp.cells.forEach((cell, k) => {
      this.depth[cell] = cp.depth[k];
      this.compaction[cell] = cp.compaction[k];
      this.dirty.add(cell);
    });
    this.sequence = cp.sequence;
  }
  /** Track reset: physical and visual grooves reset together (D050). */
  reset() {
    this.restore({
      cells: new Uint32Array(0),
      depth: new Float32Array(0),
      compaction: new Float32Array(0),
      sequence: 0,
    });
  }
  /** Bytes of state a late joiner needs (sparse). */
  get checkpointBytes() {
    return this.dirty.size * 12;
  }
}
/** AI line cost across a lateral band: prefers compacted, shallow lines and
 * avoids rut edges (D045). Lower is better. */
export function lineCost(tile: TerrainTile, x: number, z: number) {
  const c = tile.contact(x, z);
  const edge =
    Math.abs(tile.heightAt(x + TERRAIN.cell, z) - tile.heightAt(x - TERRAIN.cell, z)) /
    TERRAIN.cell;
  return c.resistance * 10 - c.grip + edge * 4;
}
