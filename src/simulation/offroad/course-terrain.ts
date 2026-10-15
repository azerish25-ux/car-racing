import { clamp, mod, Vec3 } from '../../core/math.ts';
import { surfaceMaterial } from '../surface-material.ts';
import { TERRAIN, TerrainTile, type TerrainContact } from '../terrain.ts';
import type { SurfaceSample, Track, TrackPoint } from '../track.ts';
import {
  COURSE_CELL,
  SOIL_KINDS,
  SOILS,
  relief,
  type OffroadCourse,
  type SoilKind,
} from './course.ts';
import type { OffroadSurface } from './types.ts';

/** A scratch station (track.ts `trackPoint`, duplicated so this module needs
 * no runtime import of the Track: circuits.ts loads it through venues.ts). */
const trackPoint = (): TrackPoint => ({
  s: 0,
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  tz: 1,
  nx: 1,
  nz: 0,
  curvature: 0,
  width: 8,
  bank: 0,
  gradient: 0,
});

/** A terrain render export: (block, depth, compaction) triples, the session
 * wetness, and whether it replaces the whole field (session start, rewind). */
export interface TerrainRenderDelta {
  blocks: Float32Array;
  wetness: number;
  reset: boolean;
}
/** Session-scale deformable terrain (WP37/WP38): a TerrainTile laid out in
 * the Track's own frame — columns across (lateral, 0.25 m), rows along the
 * lap (0.5 m) — over the course's terrain band. It keeps the prototype's
 * authoritative state and lifecycle (bounded depression and compaction per
 * cell, sparse checkpoint/restore, reset) and adds what a course needs: a
 * soil kind and a base moisture per cell, a session wetness from the
 * weather, and the static relief (jumps, berms) as the tile's base height.
 * Physics contact, the AI line cost (`lineCost(tile, lateral, s)`), the
 * snapshot rut channels and the rendered terrain all read these cells.
 *
 * Determinism: every write is a pure function of (cell, load, slip, dt) in a
 * fixed entrant/wheel order, so a re-simulation from the input journal
 * reproduces the field bit for bit; `hash()` fingerprints it for tests and
 * records. Ruts persist through a session (a course is re-prepared between
 * motos, i.e. by `reset()` / a new session), so no relaxation runs here. */
export class CourseTerrain extends TerrainTile {
  readonly soil: Uint8Array;
  readonly baseMoisture: Uint8Array;
  /** Session wetness added to every cell's moisture (rain soaks, sun dries). */
  wetness = 0;
  /** Render-grid blocks (2 x 2 cells) changed since the last export. */
  readonly changed = new Set<number>();
  readonly renderColumns: number;
  readonly renderRows: number;
  private readonly point = trackPoint();
  constructor(
    readonly track: Track,
    readonly course: OffroadCourse,
    readonly lateralMin: number,
    lateralMax: number,
  ) {
    const columns = Math.round((lateralMax - lateralMin) / COURSE_CELL.lateral),
      rows = Math.ceil(track.length / COURSE_CELL.along),
      at = trackPoint(),
      r = relief();
    // The tile's base height is the course ground in the Track frame (x =
    // lateral, z = lap distance): Track cross-section plus static relief.
    const base = (lateral: number, s: number) => {
      track.at(s, at);
      course.relief(s, lateral, at, r);
      return at.y + at.bank * clamp(lateral, -12, 12) + r.h;
    };
    super(lateralMin, 0, columns, rows, base, 'loam', course.spec.moisture);
    this.soil = new Uint8Array(columns * rows);
    this.baseMoisture = new Uint8Array(columns * rows);
    this.renderColumns = Math.ceil(columns / 2);
    this.renderRows = Math.ceil(rows / 2);
    const p = this.point;
    for (let row = 0; row < rows; row++) {
      const s = (row + 0.5) * COURSE_CELL.along;
      track.at(s, p);
      for (let col = 0; col < columns; col++) {
        const lateral = lateralMin + (col + 0.5) * COURSE_CELL.lateral,
          cell = this.soilAtCell(s, lateral, p);
        this.soil[row * columns + col] = SOIL_KINDS.indexOf(cell.soil);
        this.baseMoisture[row * columns + col] = Math.round(
          clamp(course.spec.moisture + cell.moisture, 0, 1) * 255,
        );
      }
    }
  }
  private soilAtCell(s: number, lateral: number, p: TrackPoint) {
    return this.course.soilAt(s, lateral, p.width);
  }
  /** Ground without ruts at (s, lateral). */
  baseHeight(s: number, lateral: number) {
    return this.base(lateral, s);
  }
  protected override index(lateral: number, s: number) {
    const c = Math.floor((lateral - this.originX) / COURSE_CELL.lateral),
      r = Math.floor(mod(s, this.track.length) / COURSE_CELL.along);
    return c < 0 || c >= this.columns || r >= this.rows ? -1 : r * this.columns + c;
  }
  cellIndex(lateral: number, s: number) {
    return this.index(lateral, s);
  }
  soilKind(cell: number): SoilKind {
    return SOIL_KINDS[this.soil[cell]] ?? 'loam';
  }
  moistureAt(cell: number) {
    return cell < 0
      ? clamp(this.wetness, 0, 1)
      : clamp(this.baseMoisture[cell] / 255 + this.wetness, 0, 1);
  }
  depthAt(lateral: number, s: number) {
    const i = this.index(lateral, s);
    return i < 0 ? 0 : this.depth[i];
  }
  /** Per-cell contact: soil friction, compaction line and moisture, rut
   * bulldozing. Normal is in the Track frame (x = lateral, z = along). */
  override contact(lateral: number, s: number, out?: TerrainContact): TerrainContact {
    const i = this.index(lateral, s),
      result = out ?? ({} as TerrainContact),
      kind = i < 0 ? this.course.spec.offTrack : this.soilKind(i),
      soil = SOILS[kind],
      wet = this.moistureAt(i),
      depth = i < 0 ? 0 : this.depth[i],
      compaction = i < 0 ? 0 : this.compaction[i];
    const hl = COURSE_CELL.lateral,
      hs = COURSE_CELL.along;
    const dx = (this.heightAt(lateral + hl, s) - this.heightAt(lateral - hl, s)) / (2 * hl),
      dz = (this.heightAt(lateral, s + hs) - this.heightAt(lateral, s - hs)) / (2 * hs),
      len = Math.hypot(dx, 1, dz);
    result.height = this.heightAt(lateral, s);
    result.nx = -dx / len;
    result.ny = 1 / len;
    result.nz = -dz / len;
    result.material =
      kind === 'mud' ? 'mud' : kind === 'sand' ? 'sand' : kind === 'hardpack' ? 'hardpack' : 'loam';
    result.moisture = wet;
    result.compaction = compaction;
    result.depth = depth;
    const m = surfaceMaterial(soil.material);
    // Compacted ruts are grippier (a line forms); moisture costs grip on
    // deformable soil (a wet berm is slicker than a dry one, D046).
    const deformable = soil.softness > 0.3 ? 1 : 0.3;
    result.grip =
      m.grip *
      soil.grip *
      (1 + 0.08 * compaction) *
      (1 - 0.3 * deformable * wet * (1 - compaction));
    result.resistance =
      m.rolling + TERRAIN.bulldoze * (depth / TERRAIN.maxDepth) * (1 - compaction * 0.5);
    return result;
  }
  /** Wheel interaction: depress and compact the contacted cell, and half as
   * much to each side (a rut is wider than its centre cell). Rigid ground
   * (asphalt) is never deformed. */
  override deform(lateral: number, s: number, load: number, slip: number, dt: number) {
    const i = this.index(lateral, s);
    if (i < 0 || !(load > 0) || !(dt > 0)) return;
    const col = i % this.columns;
    this.press(i, load, slip, dt);
    if (col > 0) this.press(i - 1, load * 0.45, slip, dt);
    if (col < this.columns - 1) this.press(i + 1, load * 0.45, slip, dt);
  }
  private press(i: number, load: number, slip: number, dt: number) {
    const soil = SOILS[this.soilKind(i)];
    if (soil.softness <= 0) return;
    const wet = this.moistureAt(i),
      soft = soil.softness * (0.6 + 0.8 * wet),
      resist = 1 - this.compaction[i] / TERRAIN.maxCompaction,
      sink = TERRAIN.sinkRate * load * dt * soft * (0.5 + clamp(slip, 0, 2)) * resist;
    this.depth[i] = Math.min(TERRAIN.maxDepth, this.depth[i] + sink);
    this.compaction[i] = Math.min(
      TERRAIN.maxCompaction,
      this.compaction[i] + TERRAIN.compactionRate * load * dt * 1e-2,
    );
    this.dirty.add(i);
    const row = Math.floor(i / this.columns),
      col = i % this.columns;
    this.changed.add((row >> 1) * this.renderColumns + (col >> 1));
    this.sequence++;
  }
  /** Ruts persist for the session (no relaxation; see class note). */
  override relax(dt: number) {
    void dt;
  }
  override reset() {
    super.reset();
    this.wetness = 0;
    this.changed.clear();
  }
  /** Rain soaks the soil and dry, sunny air slowly dries it (per s). */
  weather(rainMmPerHour: number, cloud: number, dt: number) {
    if (this.course.spec.indoor) return;
    const soak = (Math.max(0, rainMmPerHour) / 20) * 0.02,
      dry = (1 - clamp(cloud, 0, 1)) * 0.00015 + 0.00005;
    this.wetness = clamp(this.wetness + (soak - dry) * dt, 0, 0.6);
  }
  /** Render value of one 2 x 2 block: deepest depression and mean compaction. */
  renderBlock(block: number, out: { depth: number; compaction: number }) {
    const rc = block % this.renderColumns,
      rr = Math.floor(block / this.renderColumns);
    let depth = 0,
      compaction = 0,
      n = 0;
    for (let dr = 0; dr < 2; dr++)
      for (let dc = 0; dc < 2; dc++) {
        const row = rr * 2 + dr,
          col = rc * 2 + dc;
        if (row >= this.rows || col >= this.columns) continue;
        const i = row * this.columns + col;
        depth = Math.max(depth, this.depth[i]);
        compaction += this.compaction[i];
        n++;
      }
    out.depth = depth;
    out.compaction = n ? compaction / n : 0;
    return out;
  }
  /** Render-grid export for the presentation (worker -> renderer): the
   * blocks changed since the last export (or, `full`, every deformed block)
   * as (block, depth m, compaction 0..1) triples in ascending block order.
   * Read-only for the simulation: the change set is presentation state. */
  renderDelta(full = false): TerrainRenderDelta {
    let blocks: number[];
    if (full) {
      const all = new Set<number>();
      for (const i of this.dirty) {
        const row = Math.floor(i / this.columns),
          col = i % this.columns;
        all.add((row >> 1) * this.renderColumns + (col >> 1));
      }
      blocks = [...all];
    } else blocks = [...this.changed];
    blocks.sort((a, b) => a - b);
    this.changed.clear();
    const data = new Float32Array(blocks.length * 3),
      v = { depth: 0, compaction: 0 };
    blocks.forEach((block, k) => {
      this.renderBlock(block, v);
      data[k * 3] = block;
      data[k * 3 + 1] = v.depth;
      data[k * 3 + 2] = v.compaction / TERRAIN.maxCompaction;
    });
    return { blocks: data, wetness: this.wetness, reset: full };
  }
  /** FNV-1a fingerprint of the authoritative state (depth, compaction bits). */
  hash() {
    let h = 0x811c9dc5;
    const words = [new Uint32Array(this.depth.buffer), new Uint32Array(this.compaction.buffer)];
    for (const w of words)
      for (let i = 0; i < w.length; i++) if (w[i]) h = Math.imul(h ^ (w[i] ^ i), 0x01000193);
    h = Math.imul(h ^ Math.round(this.wetness * 1e6), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  /** Cells currently deformed and the deepest rut (diagnostics, tests). */
  stats() {
    let deepest = 0;
    for (const i of this.dirty) deepest = Math.max(deepest, this.depth[i]);
    return { cells: this.dirty.size, deepest, sequence: this.sequence, wetness: this.wetness };
  }
}
/** A Track's terrain venue surface: the deformable grid inside the band, the
 * Track's standard rules outside it. */
export class TrackTerrainSurface implements OffroadSurface {
  readonly kind;
  readonly terrain: CourseTerrain;
  private readonly contact = {} as TerrainContact;
  private readonly normal = new Vec3();
  private readonly probe = new Vec3();
  constructor(
    readonly track: Track,
    readonly course: OffroadCourse,
  ) {
    this.kind = course.kind;
    let widest = 0;
    const p = trackPoint();
    for (let s = 0; s < track.length; s += 4) widest = Math.max(widest, track.at(s, p).width);
    const [lo, hi] = course.band(widest);
    this.terrain = new CourseTerrain(track, course, lo, hi);
  }
  sample(p: TrackPoint, lateral: number, cell: number, out: SurfaceSample) {
    const t = this.terrain;
    if (lateral < t.lateralMin || lateral >= t.originX + t.columns * COURSE_CELL.lateral)
      return false;
    const c = t.contact(lateral, p.s, this.contact),
      index = t.cellIndex(lateral, p.s),
      soil = SOILS[index < 0 ? this.course.spec.offTrack : t.soilKind(index)];
    out.s = p.s;
    out.lateral = lateral;
    out.width = this.course.legalWidth(p.width, p.s, lateral);
    out.height = c.height;
    // Track frame (lateral along n, along-lap along t) to world.
    this.normal.set(c.nx * p.nx + c.nz * p.tx, c.ny, c.nx * p.nz + c.nz * p.tz);
    out.normal.copy(this.normal.normalize());
    out.surface = soil.material;
    out.grip = c.grip;
    out.resistance = c.resistance;
    out.cell = cell;
    out.pit = false;
    out.terrain = true;
    return true;
  }
  /** Heightfield ray cast by vertical projection (rays point nearly down):
   * a few fixed-point steps on f(t) = y(t) - ground(x(t), z(t)). */
  cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    const track = this.track,
      q = this.probe;
    const dy = Math.min(-0.2, down.y);
    let t = 0;
    for (let k = 0; k < 4; k++) {
      q.copy(origin).addScaled(down, t);
      track.sample(q.x, q.z, out, q.y);
      const f = q.y - out.height;
      t = Math.max(0, t + f / -dy);
      if (Math.abs(f) < 1e-4) break;
    }
    if (t > maximum) return Infinity;
    q.copy(origin).addScaled(down, t);
    track.sample(q.x, q.z, out, q.y);
    return t;
  }
}
