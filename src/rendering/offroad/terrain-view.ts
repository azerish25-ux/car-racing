import * as T from 'three';
import { clamp, mod } from '../../core/math.ts';
import {
  TrackTerrainSurface,
  type CourseTerrain,
  type TerrainRenderDelta,
} from '../../simulation/offroad/course-terrain.ts';
import { COURSE_CELL, SOIL_KINDS, type SoilKind } from '../../simulation/offroad/course.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { materials } from '../materials/index.ts';
import { installScannedSoil, soilSlotOf, soilSlots, writeSoilSlot } from '../ground/soil-splat.ts';
import type { ScanLayer } from '../ground/scan-store.ts';
import { installMxSoilDetail, MX_SOIL_COLOURS } from './mx-soil-detail.ts';
import { mxSoilSample, sampleMxSoilTransition } from './mx-soil-transition.ts';
import { installMxTerrainShadow } from './mx-terrain-shadow.ts';

/** Soil albedo per kind (sRGB; the soil detail map multiplies it). */
export const SOIL_COLOURS: Readonly<Record<SoilKind, number>> = Object.freeze({
  hardpack: 0x8a6d50,
  loam: 0x6c5440,
  sand: 0xb39b74,
  mud: 0x4c3b2c,
  gravel: 0x8d857a,
  asphalt: 0x4b4c4d,
  turf: 0x56683b,
});
/** Render rows per mesh chunk (1 m each): culled and re-uploaded per chunk. */
const CHUNK_ROWS = 96;
interface Chunk {
  mesh: T.Mesh;
  first: number;
  rows: number;
  base: Float32Array;
  dirty: boolean;
}
/** One recorded export, for replays (the soil as it was at that time). */
interface Keyframe {
  time: number;
  delta: TerrainRenderDelta;
}
/**
 * Deformable course terrain mesh (WP41): the course band as a render grid of
 * 2 x 2 physics cells (0.5 m across, 1 m along the lap) laid in the Track
 * frame, posed from the authoritative terrain state the physics worker
 * exports with each surface keyframe (rut depth and compaction per block,
 * session wetness). The base ground (Track cross-section plus the jumps,
 * berms and joker island) is computed locally from the same course data;
 * vertices over another section of the course (hairpin legs, parallel
 * straights) are dropped. Soil kind is the vertex colour; moisture darkens
 * through the shared soil material. Keyframes are kept for the session so a
 * replay shows the ruts as they were at its time.
 */
export class TerrainView {
  readonly group = new T.Group();
  readonly material: T.MeshPhysicalMaterial;
  private readonly terrain: CourseTerrain;
  private readonly depth: Float32Array;
  private readonly compaction: Float32Array;
  private readonly chunks: Chunk[] = [];
  private readonly history: Keyframe[] = [];
  private shown = -1;
  private wetness = 0;
  private readonly motocross: boolean;
  /** Photographed soil sets of this course (ground/soil-splat.ts). */
  readonly soilSlots: readonly ScanLayer[];
  /** Broad variation uses a resident soil scan, never the MX/SX turf slot. */
  readonly soilMacro: ScanLayer;
  constructor(readonly track: Track) {
    const surface = Track.offroadOf(track);
    if (!(surface instanceof TrackTerrainSurface)) throw new Error('Not a terrain venue');
    this.terrain = surface.terrain;
    this.motocross = surface.kind === 'motocross' || surface.kind === 'supercross';
    const t = this.terrain,
      blocks = t.renderColumns * t.renderRows;
    this.depth = new Float32Array(blocks);
    this.compaction = new Float32Array(blocks);
    this.group.name = 'Off-road course terrain (deformable)';
    this.material = materials.soil({ tile: 0.28 });
    // Kinds on this course (cells off the course read as the venue's turf).
    const kinds = new Set<SoilKind>(['turf']);
    for (let i = 0; i < t.soil.length; i++) kinds.add(SOIL_KINDS[t.soil[i]] ?? 'loam');
    this.soilSlots = soilSlots(kinds);
    this.soilMacro =
      surface.kind === 'motocross'
        ? 'forest'
        : surface.kind === 'supercross'
          ? 'dryEarth'
          : this.soilSlots[0];
    installScannedSoil(this.material, this.soilSlots, this.soilMacro);
    if (this.motocross) {
      installMxSoilDetail(this.material);
      installMxTerrainShadow(this.material);
    }
    for (let first = 0; first < t.renderRows; first += CHUNK_ROWS)
      this.chunks.push(this.buildChunk(first, Math.min(CHUNK_ROWS, t.renderRows - first)));
  }
  private buildChunk(first: number, rows: number): Chunk {
    const t = this.terrain,
      track = this.track,
      L = track.length,
      cols = t.renderColumns,
      p = trackPoint(),
      q = trackPoint(),
      colour = new T.Color();
    const sample = this.motocross ? mxSoilSample() : null;
    const palette = this.motocross
      ? SOIL_KINDS.map((kind) => new T.Color(MX_SOIL_COLOURS[kind]))
      : [];
    const slots = this.motocross ? SOIL_KINDS.map((kind) => soilSlotOf(kind, this.soilSlots)) : [];
    const vx = cols + 1,
      vz = rows + 1,
      count = vx * vz;
    const position = new Float32Array(count * 3),
      colours = new Float32Array(count * 3),
      state = new Float32Array(count * 3),
      layers = new Float32Array(count * 4),
      mxCourse = this.motocross ? new Float32Array(count * 4) : null,
      uv = new Float32Array(count * 2),
      base = new Float32Array(count),
      keep = new Uint8Array(count);
    const stepLateral = COURSE_CELL.lateral * 2,
      stepAlong = COURSE_CELL.along * 2;
    for (let r = 0; r < vz; r++) {
      const s = Math.min(L, (first + r) * stepAlong);
      track.at(s, p);
      // Inside a tight turn the band would fold over the centre of curvature.
      const inside = Math.abs(p.curvature) > 1e-4 ? 0.85 / Math.abs(p.curvature) : Infinity;
      for (let c = 0; c < vx; c++) {
        const k = r * vx + c;
        let lateral = t.lateralMin + c * stepLateral;
        if (p.curvature * lateral > 0 && Math.abs(lateral) > inside)
          lateral = Math.sign(lateral) * inside;
        const x = p.x + p.nx * lateral,
          z = p.z + p.nz * lateral,
          h = t.baseHeight(s, lateral);
        base[k] = h;
        position[k * 3] = x;
        position[k * 3 + 1] = h;
        position[k * 3 + 2] = z;
        // Track-frame UV (lateral, lap metres / 5): the soil detail runs
        // along the lap and the night light pools read the same frame.
        uv[k * 2] = lateral / 5;
        uv[k * 2 + 1] = s / 5;
        // A vertex nearer another part of the course belongs to that part.
        const nearest = Math.abs(track.nearest(x, z, q));
        const gap = Math.abs(mod(q.s - s + L / 2, L) - L / 2);
        keep[k] = gap < 6 || nearest >= Math.abs(lateral) - 0.5 ? 1 : 0;
        const cell = t.cellIndex(
          clamp(lateral, t.lateralMin, t.lateralMin + t.columns * COURSE_CELL.lateral - 0.01),
          s,
        );
        const kind = cell < 0 ? 'turf' : t.soilKind(cell);
        if (sample) {
          sampleMxSoilTransition(t, lateral, s, sample);
          colour.setRGB(0, 0, 0);
          for (let soil = 0; soil < SOIL_KINDS.length; soil++) {
            const weight = sample.weights[soil];
            colour.r += palette[soil].r * weight;
            colour.g += palette[soil].g * weight;
            colour.b += palette[soil].b * weight;
            if (slots[soil] < this.soilSlots.length - 1) layers[k * 4 + slots[soil]] += weight;
          }
          state[k * 3] = sample.moisture;
        } else {
          // Preserve the pre-existing RX/stage rendering byte for byte.
          colour.setHex(SOIL_COLOURS[kind]).convertSRGBToLinear();
          state[k * 3] = cell < 0 ? 0 : t.baseMoisture[cell] / 255;
          writeSoilSlot(layers, k, soilSlotOf(kind, this.soilSlots), this.soilSlots.length);
        }
        colours[k * 3] = colour.r;
        colours[k * 3 + 1] = colour.g;
        colours[k * 3 + 2] = colour.b;
        if (mxCourse) {
          mxCourse[k * 4] = lateral;
          mxCourse[k * 4 + 1] = s;
          mxCourse[k * 4 + 2] = sample
            ? 1 -
              sample.weights[SOIL_KINDS.indexOf('turf')] -
              sample.weights[SOIL_KINDS.indexOf('asphalt')]
            : kind === 'turf' || kind === 'asphalt'
              ? 0
              : 1;
          mxCourse[k * 4 + 3] = clamp(p.curvature * 20, -1, 1);
        }
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const a = r * vx + c,
          b = a + 1,
          d = a + vx,
          e = d + 1;
        if (!(keep[a] && keep[b] && keep[d] && keep[e])) continue;
        index.push(a, d, b, b, d, e);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.BufferAttribute(position, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute('color', new T.BufferAttribute(colours, 3));
    geometry.setAttribute(
      'apexSoilState',
      new T.BufferAttribute(state, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute('apexSoilLayers', new T.BufferAttribute(layers, 4));
    if (mxCourse) geometry.setAttribute('mxCourse', new T.BufferAttribute(mxCourse, 4));
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geometry.setAttribute('uv1', new T.BufferAttribute(uv.slice(), 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, this.material);
    mesh.name = `Course terrain ${first}-${first + rows} m`;
    mesh.receiveShadow = true;
    mesh.castShadow = this.motocross;
    this.group.add(mesh);
    return { mesh, first, rows, base, dirty: false };
  }
  /** A worker keyframe: record it (replays) and, live, show it. */
  record(delta: TerrainRenderDelta | undefined, time: number, live: boolean) {
    if (!delta) return;
    // A full export (session start, flashback) replaces the field: keyframes
    // at or after its time belong to the abandoned timeline.
    if (delta.reset) {
      while (this.history.length && this.history.at(-1)!.time >= time) this.history.pop();
      this.shown = -1;
    }
    this.history.push({ time, delta });
    if (live) this.showLive();
  }
  /** Show the newest recorded state. */
  showLive() {
    this.showIndex(this.history.length - 1);
  }
  /** Show the field as it was at race time `time` (replay). */
  showAt(time: number) {
    let lo = -1;
    for (let i = 0; i < this.history.length; i++) if (this.history[i].time <= time) lo = i;
    this.showIndex(lo);
  }
  private showIndex(target: number) {
    if (target === this.shown) return;
    // Forward from the shown state when possible; else rebuild from the
    // last full export at or before the target.
    let from = this.shown + 1;
    if (target < this.shown || this.shown < 0) {
      this.depth.fill(0);
      this.compaction.fill(0);
      this.markAll();
      from = 0;
      for (let i = target; i >= 0; i--)
        if (this.history[i].delta.reset) {
          from = i;
          break;
        }
    }
    for (let i = from; i <= target; i++) this.apply(this.history[i].delta);
    this.shown = target;
    this.upload();
  }
  private markAll() {
    for (const c of this.chunks) c.dirty = true;
  }
  private apply(delta: TerrainRenderDelta) {
    if (delta.reset) {
      this.depth.fill(0);
      this.compaction.fill(0);
      this.markAll();
    }
    const b = delta.blocks,
      cols = this.terrain.renderColumns;
    for (let k = 0; k + 2 < b.length; k += 3) {
      const block = b[k];
      if (!(block >= 0 && block < this.depth.length)) continue;
      this.depth[block] = b[k + 1];
      this.compaction[block] = b[k + 2];
      const chunk = this.chunks[Math.floor(Math.floor(block / cols) / CHUNK_ROWS)];
      if (chunk) chunk.dirty = true;
      // The vertex row after a chunk's last block belongs to the next one too.
      const next = this.chunks[Math.floor((Math.floor(block / cols) + 1) / CHUNK_ROWS)];
      if (next) next.dirty = true;
    }
    this.wetness = delta.wetness;
    (this.material.userData.soil as { apexSoilWetness: T.IUniform<number> }).apexSoilWetness.value =
      this.wetness;
  }
  private upload() {
    const t = this.terrain,
      cols = t.renderColumns,
      rowsTotal = t.renderRows;
    for (const chunk of this.chunks) {
      if (!chunk.dirty) continue;
      chunk.dirty = false;
      const g = chunk.mesh.geometry,
        position = g.getAttribute('position') as T.BufferAttribute,
        state = g.getAttribute('apexSoilState') as T.BufferAttribute,
        vx = cols + 1;
      for (let r = 0; r <= chunk.rows; r++) {
        const row = (chunk.first + r) % rowsTotal;
        for (let c = 0; c < vx; c++) {
          const k = r * vx + c,
            block = row * cols + Math.min(c, cols - 1),
            d = this.depth[block];
          position.setY(k, chunk.base[k] - d);
          state.setY(k, this.compaction[block]);
          state.setZ(k, d);
        }
      }
      position.needsUpdate = true;
      state.needsUpdate = true;
      g.computeVertexNormals();
    }
  }
  /** Deformed blocks shown (diagnostics, tests). */
  get deformedBlocks() {
    let n = 0;
    for (let i = 0; i < this.depth.length; i++) if (this.depth[i] > 0) n++;
    return n;
  }
  dispose() {
    for (const c of this.chunks) c.mesh.geometry.dispose();
    this.material.dispose();
  }
}
