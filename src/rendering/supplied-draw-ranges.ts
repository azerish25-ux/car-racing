import * as T from 'three';
import { CompactIndexBuffers } from './compact-index-buffer.ts';
import { RANGE_ONLY_SHADOW_HOOK } from './shadow-proxies.ts';
import { allFinite } from '../core/math.ts';

/** One camera's compacted selection of one geometry, and the key of its
 * owned index buffer. */
interface Selection {
  selected: Uint8Array;
  compacted?: Uint32Array;
  compactedCount?: number;
  revision: number;
}
interface RangeBounds {
  index: T.BufferAttribute;
  position: T.BufferAttribute | T.InterleavedBufferAttribute;
  indexVersion: number;
  positionVersion: number;
  boxes: T.Box3[];
  /** Per camera: the main view, shadow, mirror and reflection cameras each
   * keep their own selection, so alternating passes within a frame no longer
   * re-select and re-upload the whole compacted stream for every pass. */
  selections: WeakMap<T.Camera, Selection>;
}
const TRIANGLES_PER_BLOCK = 128;
const BLOCK = TRIANGLES_PER_BLOCK * 3;
const version = (a: T.BufferAttribute | T.InterleavedBufferAttribute) =>
  a instanceof T.InterleavedBufferAttribute ? a.data.version : a.version;

/** Trim only wholly off-frustum prefixes/suffixes of static triangle streams.
 * The remaining contiguous range preserves every index, winding and ordering.
 * The optional compact path also rejects invisible interior blocks using owned
 * index-only buffers. No vertices, materials or draw calls are added. In particular,
 * transparent triangles are never sorted, and shadow/mirror cameras own their
 * own range. Original ranges are restored immediately after each submission. */
export class SuppliedDrawRanges {
  enabled = true;
  /** Independent prefix/suffix-only baseline for GPU comparison. */
  compact = false;
  private readonly buffers = new CompactIndexBuffers();
  private readonly bounds = new Map<T.BufferGeometry, RangeBounds>();
  private readonly restore: (() => void)[] = [];
  private disposed = false;
  private readonly frustum = new T.Frustum();
  private readonly matrix = new T.Matrix4();
  private readonly point = new T.Vector3();
  private submissions = 0;
  private omittedIndices = 0;
  constructor(
    bindings: readonly { mesh: T.Mesh; geometries: readonly T.BufferGeometry[] }[],
    compact = false,
  ) {
    this.compact = compact;
    for (const { mesh, geometries } of bindings) {
      // Skinned, instanced and morphing geometry needs deformation-aware bounds;
      // retain the existing full submission for those paths.
      if (mesh instanceof T.SkinnedMesh || mesh instanceof T.InstancedMesh) continue;
      for (const geometry of geometries) this.prepare(geometry);
      if (!geometries.some((g) => this.bounds.has(g))) continue;
      const before = mesh.onBeforeRender,
        after = mesh.onAfterRender;
      const beforeShadow = mesh.onBeforeShadow,
        afterShadow = mesh.onAfterShadow;
      let held: {
        geometry: T.BufferGeometry;
        index: T.BufferAttribute | null;
        start: number;
        count: number;
      } | null = null;
      const reset = () => {
        if (!held) return;
        held.geometry.setIndex(held.index);
        held.geometry.setDrawRange(held.start, held.count);
        held = null;
      };
      const select = (
        renderer: T.WebGLRenderer,
        camera: T.Camera,
        geometry: T.BufferGeometry,
        material: T.Material,
      ) => {
        reset();
        if (!this.enabled || this.disposed || camera instanceof T.ArrayCamera) return;
        // Unknown vertex programs or displacement may move an otherwise rejected
        // triangle into view. Fall back rather than guessing its envelope.
        if (
          !(
            material instanceof T.MeshStandardMaterial ||
            material instanceof T.MeshBasicMaterial ||
            material instanceof T.MeshDepthMaterial ||
            material instanceof T.MeshDistanceMaterial
          ) ||
          ('displacementMap' in material && material.displacementMap) ||
          ('wireframe' in material && material.wireframe)
        )
          return;
        const b = this.bounds.get(geometry);
        if (
          !b ||
          geometry.index !== b.index ||
          geometry.attributes.position !== b.position ||
          version(b.index) !== b.indexVersion ||
          version(b.position) !== b.positionVersion ||
          geometry.morphAttributes.position?.length ||
          geometry.groups.length
        )
          return;
        const { start, count } = geometry.drawRange;
        // A non-triangle-aligned caller range changes primitive assembly. Keep it
        // intact, including unusual finite counts, instead of rounding indices.
        if (start !== 0 || count !== Infinity) return;
        this.matrix
          .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
          .multiply(mesh.matrixWorld);
        if (!allFinite(this.matrix.elements) || this.matrix.determinant() === 0) return;
        this.frustum.setFromProjectionMatrix(this.matrix, camera.coordinateSystem);
        for (const p of this.frustum.planes)
          if (
            !Number.isFinite(p.normal.x) ||
            !Number.isFinite(p.normal.y) ||
            !Number.isFinite(p.normal.z) ||
            !Number.isFinite(p.constant)
          )
            return;
        let first = 0,
          last = b.boxes.length - 1;
        while (first <= last && !this.frustum.intersectsBox(b.boxes[first])) first++;
        while (last >= first && !this.frustum.intersectsBox(b.boxes[last])) last--;
        const lo = Math.min(first * BLOCK, b.index.count);
        const hi = last < first ? lo : Math.min((last + 1) * BLOCK, b.index.count);
        this.submissions++;
        // Remove wholly invisible interior blocks too, copying surviving source
        // indices in exactly the same order. No spatial reordering, simplification
        // or backface guess is made, including on transparent surface sheets.
        if (this.compact && last > first && typeof renderer.getContext === 'function') {
          let selection = b.selections.get(camera);
          if (!selection) {
            selection = { selected: new Uint8Array(b.boxes.length).fill(2), revision: 0 };
            b.selections.set(camera, selection);
          }
          const selected = selection.selected;
          let changed = false,
            visibleCount = 0;
          for (let i = 0; i < b.boxes.length; i++) {
            const visible =
              i >= first && i <= last && this.frustum.intersectsBox(b.boxes[i]) ? 1 : 0;
            if (selected[i] !== visible) changed = true;
            selected[i] = visible;
            if (visible) visibleCount += Math.min(BLOCK, b.index.count - i * BLOCK);
          }
          if (visibleCount < hi - lo) {
            if (!selection.compacted) selection.compacted = new Uint32Array(b.index.count);
            if (changed || selection.compactedCount !== visibleCount) {
              const compacted = selection.compacted,
                source = b.index.array;
              let cursor = 0;
              for (let i = first; i <= last; i++) {
                if (!selected[i]) continue;
                const end = Math.min((i + 1) * BLOCK, b.index.count);
                for (let j = i * BLOCK; j < end; j++) compacted[cursor++] = source[j];
              }
              selection.compactedCount = visibleCount;
              selection.revision++;
            }
            const compacted = this.buffers.get(
              renderer.getContext(),
              selection,
              selection.compacted,
              visibleCount,
              selection.revision,
            );
            if (compacted) {
              held = { geometry, index: geometry.index, start, count };
              geometry.setIndex(compacted);
              geometry.setDrawRange(0, visibleCount);
              this.omittedIndices += b.index.count - visibleCount;
              return;
            }
          }
        }
        this.omittedIndices += b.index.count - (hi - lo);
        if (hi - lo === b.index.count) return;
        held = { geometry, index: geometry.index, start, count };
        geometry.setDrawRange(lo, hi - lo);
      };
      mesh.onBeforeRender = (...args) => {
        before.apply(mesh, args);
        select(args[0], args[2], args[3], args[4]);
      };
      mesh.onAfterRender = (...args) => {
        reset();
        after.apply(mesh, args);
      };
      mesh.onBeforeShadow = (...args) => {
        beforeShadow.apply(mesh, args);
        select(args[0], args[3], args[4], args[5]);
      };
      // Narrowing to the shadow camera never changes what reaches the map.
      const rangeOnly = mesh.userData[RANGE_ONLY_SHADOW_HOOK];
      mesh.userData[RANGE_ONLY_SHADOW_HOOK] =
        beforeShadow === T.Object3D.prototype.onBeforeShadow || rangeOnly === true;
      mesh.onAfterShadow = (...args) => {
        reset();
        afterShadow.apply(mesh, args);
      };
      this.restore.push(() => {
        reset();
        mesh.onBeforeRender = before;
        mesh.onAfterRender = after;
        mesh.onBeforeShadow = beforeShadow;
        mesh.onAfterShadow = afterShadow;
        if (rangeOnly === undefined) delete mesh.userData[RANGE_ONLY_SHADOW_HOOK];
        else mesh.userData[RANGE_ONLY_SHADOW_HOOK] = rangeOnly;
      });
    }
  }
  private prepare(geometry: T.BufferGeometry) {
    if (this.bounds.has(geometry)) return;
    const index = geometry.index,
      position = geometry.getAttribute('position');
    if (
      !index ||
      index.itemSize !== 1 ||
      index.normalized ||
      !(index.array instanceof Uint16Array || index.array instanceof Uint32Array) ||
      index.count < BLOCK * 2 ||
      index.count % 3 ||
      !position ||
      position.itemSize !== 3 ||
      geometry.groups.length ||
      geometry.morphAttributes.position?.length
    )
      return;
    const boxes: T.Box3[] = [];
    for (let start = 0; start < index.count; start += BLOCK) {
      const box = new T.Box3(),
        end = Math.min(start + BLOCK, index.count);
      for (let i = start; i < end; i++) {
        const vertex = index.getX(i);
        if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count) return;
        this.point.fromBufferAttribute(position, vertex);
        if (![this.point.x, this.point.y, this.point.z].every(Number.isFinite)) return;
        box.expandByPoint(this.point);
      }
      // Extra local-space margin protects near-plane silhouettes from float32
      // matrix/attribute rounding; it can only retain more source triangles.
      box.expandByScalar(1e-3);
      boxes.push(box);
    }
    this.bounds.set(geometry, {
      index,
      position,
      indexVersion: version(index),
      positionVersion: version(position),
      boxes,
      selections: new WeakMap(),
    });
  }
  diagnostics() {
    return {
      meshes: this.restore.length,
      geometries: this.bounds.size,
      submissions: this.submissions,
      omittedTriangles: this.omittedIndices / 3,
      compacted: this.buffers.diagnostics(),
    };
  }
  dispose() {
    if (this.disposed) return;
    for (const restore of this.restore) restore();
    this.restore.length = 0;
    this.bounds.clear();
    this.buffers.dispose();
    this.disposed = true;
  }
}
