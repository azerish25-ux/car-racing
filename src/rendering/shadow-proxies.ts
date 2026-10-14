import * as T from 'three';

/** Depth side three's shadow pass renders for a material side (the default
 * shadowSide mapping of WebGLShadowMap). */
const SHADOW_SIDE: Record<T.Side, T.Side> = {
  [T.FrontSide]: T.BackSide,
  [T.BackSide]: T.FrontSide,
  [T.DoubleSide]: T.DoubleSide,
};

/** userData flag for a mesh whose shadow hooks only narrow its draw range to
 * the shadow camera's frustum: they never change what reaches the map. */
export const RANGE_ONLY_SHADOW_HOOK = 'rangeOnlyShadowHook';

export const SHADOW_MERGE = Object.freeze({
  /** Merging copies a source's vertices to save one draw. Larger sources
   * keep casting alone (on the supplied player car 7 of 172 primitives hold
   * 41% of its vertices). */
  maxSourceVertices: 8192,
  /** Merged casters stay addressable with 16-bit indices. */
  maxCasterVertices: 65535,
});

function staticAttribute(attribute: T.BufferAttribute | T.InterleavedBufferAttribute | undefined) {
  return (
    attribute instanceof T.BufferAttribute &&
    !(attribute instanceof T.InterleavedBufferAttribute) &&
    attribute.usage === T.StaticDrawUsage
  );
}

/** True when three's shadow pass draws `mesh` with its plain depth material,
 * so merged vertices reproduce its shadow exactly: no instancing, morphing,
 * custom depth, alpha test, displacement, clipping, partial draw range,
 * shadow hook (other than draw-range narrowing) or CPU-animated vertices.
 * Skinned meshes qualify; they merge only with meshes on the same skeleton. */
export function plainShadowCaster(mesh: T.Object3D): mesh is T.Mesh {
  if (!(mesh instanceof T.Mesh) || !mesh.castShadow || !mesh.visible) return false;
  if (mesh instanceof T.InstancedMesh || mesh instanceof T.BatchedMesh) return false;
  const material = mesh.material;
  if (Array.isArray(material) || !material.visible || material.wireframe) return false;
  if (mesh.customDepthMaterial) return false;
  if (
    mesh.onBeforeShadow !== T.Object3D.prototype.onBeforeShadow &&
    mesh.userData[RANGE_ONLY_SHADOW_HOOK] !== true
  )
    return false;
  if (material.alphaTest > 0 || material.alphaToCoverage || material.clipShadows) return false;
  const standard = material as T.MeshStandardMaterial;
  if (standard.displacementMap && standard.displacementScale !== 0) return false;
  const geometry = mesh.geometry;
  if (!staticAttribute(geometry.getAttribute('position'))) return false;
  if (Object.keys(geometry.morphAttributes).length) return false;
  if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return false;
  if (mesh instanceof T.SkinnedMesh) {
    if (!mesh.skeleton) return false;
    if (!staticAttribute(geometry.getAttribute('skinIndex'))) return false;
    if (!staticAttribute(geometry.getAttribute('skinWeight'))) return false;
  }
  return true;
}

export function shadowSideOf(material: T.Material) {
  return material.shadowSide ?? SHADOW_SIDE[material.side];
}

type Typed = T.TypedArray;
type TypedConstructor = { new (length: number): Typed };

const local = new T.Matrix4(),
  identity = new T.Matrix4(),
  point = new T.Vector3();

function localMatrix(frame: T.Object3D, mesh: T.Mesh) {
  if (mesh === frame) return local.identity();
  if (mesh.matrixAutoUpdate) mesh.updateMatrix();
  return local.copy(mesh.matrix);
}

/** The sources' own array type when they all agree, so a merged attribute
 * holds the identical values (normalized bone weights stay normalized). */
function commonType(attributes: readonly T.BufferAttribute[], fallback: TypedConstructor) {
  const first = attributes[0];
  const same = attributes.every(
    (a) => a.array.constructor === first.array.constructor && a.normalized === first.normalized,
  );
  return same
    ? { type: first.array.constructor as TypedConstructor, normalized: first.normalized }
    : { type: fallback, normalized: false };
}

/** Vertex attributes of `meshes` in the frame of `frame`: positions, plus
 * bone indices and weights for skinned sources (whose local matrix is the
 * identity, see `groupKey`). */
function mergeVertices(frame: T.Object3D, meshes: readonly T.Mesh[], skinned: boolean) {
  let vertices = 0;
  for (const mesh of meshes) vertices += mesh.geometry.getAttribute('position').count;
  const positions = new Float32Array(vertices * 3);
  let v = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    const matrix = localMatrix(frame, mesh);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(matrix);
      positions[(v + i) * 3] = point.x;
      positions[(v + i) * 3 + 1] = point.y;
      positions[(v + i) * 3 + 2] = point.z;
    }
    v += position.count;
  }
  const attributes: Record<string, T.BufferAttribute> = {
    position: new T.BufferAttribute(positions, 3),
  };
  if (skinned)
    for (const [name, fallback] of [
      ['skinIndex', Uint16Array],
      ['skinWeight', Float32Array],
    ] as const) {
      const sources = meshes.map((m) => m.geometry.getAttribute(name) as T.BufferAttribute);
      const { type, normalized } = commonType(sources, fallback);
      const array = new type(vertices * 4);
      let offset = 0;
      for (const source of sources) {
        if (source.array.constructor === type && source.normalized === normalized)
          array.set(source.array.subarray(0, source.count * 4), offset);
        else
          for (let i = 0; i < source.count; i++)
            for (let c = 0; c < 4; c++) array[offset + i * 4 + c] = source.getComponent(i, c);
        offset += source.count * 4;
      }
      attributes[name] = new T.BufferAttribute(array, 4, normalized);
    }
  return attributes;
}

/** Triangles of `meshes`, offset into the merged vertex attributes. */
function mergeIndex(meshes: readonly T.Mesh[]) {
  let count = 0,
    vertices = 0;
  for (const mesh of meshes) {
    const n = mesh.geometry.getAttribute('position').count;
    count += mesh.geometry.index?.count ?? n;
    vertices += n;
  }
  const index = vertices > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  let v = 0,
    k = 0;
  for (const mesh of meshes) {
    const source = mesh.geometry.index,
      n = mesh.geometry.getAttribute('position').count;
    if (source) for (let i = 0; i < source.count; i++) index[k++] = v + source.getX(i);
    else for (let i = 0; i < n; i++) index[k++] = v + i;
    v += n;
  }
  return index;
}

function hashArrays(arrays: readonly Typed[]) {
  let a = 0x811c9dc5,
    b = 0x9e3779b9;
  for (const array of arrays) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const words =
      array.byteOffset % 4 === 0
        ? new Uint32Array(array.buffer, array.byteOffset, bytes.length >> 2)
        : new Uint32Array(0);
    for (let i = 0; i < words.length; i++) {
      a = Math.imul(a ^ words[i], 0x01000193);
      b = Math.imul(b ^ words[i], 0x5bd1e995) ^ (b >>> 15);
    }
    for (let i = words.length << 2; i < bytes.length; i++) a = Math.imul(a ^ bytes[i], 0x01000193);
  }
  const shape = arrays.map((x) => `${x.constructor.name}:${x.length}`).join(',');
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}|${shape}`;
}
function sameArrays(a: readonly Typed[], b: readonly Typed[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i],
      y = b[i];
    if (x.constructor !== y.constructor || x.length !== y.length) return false;
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
  }
  return true;
}

interface Pooled<V> {
  value: V;
  arrays: Typed[];
  refs: number;
}
/** Content-addressed sharing: identical merged data (the same part on every
 * rival, or LOD tiers sharing vertices) is held, and uploaded, once. */
class Pool<V> {
  private readonly entries = new Map<string, Pooled<V>[]>();
  acquire(arrays: Typed[], create: () => V, prefix = '') {
    const key = prefix + hashArrays(arrays);
    let bucket = this.entries.get(key);
    if (!bucket) this.entries.set(key, (bucket = []));
    let entry = bucket.find((e) => sameArrays(e.arrays, arrays));
    if (!entry) bucket.push((entry = { value: create(), arrays, refs: 0 }));
    entry.refs++;
    return entry.value;
  }
  /** Returns true when `value` is no longer used. */
  release(value: V) {
    for (const [key, bucket] of this.entries) {
      const i = bucket.findIndex((e) => e.value === value);
      if (i < 0) continue;
      if (--bucket[i].refs > 0) return false;
      bucket.splice(i, 1);
      if (!bucket.length) this.entries.delete(key);
      return true;
    }
    return false;
  }
  get bytes() {
    let bytes = 0;
    for (const bucket of this.entries.values())
      for (const entry of bucket) for (const array of entry.arrays) bytes += array.byteLength;
    return bytes;
  }
}

interface VertexSet {
  id: number;
  attributes: Record<string, T.BufferAttribute>;
}
interface Caster {
  mesh: T.Mesh;
  frame: T.Object3D;
  sources: T.Mesh[];
  skinned: boolean;
  /** Source geometries the caster's current geometry was merged from. */
  built: T.BufferGeometry[];
  /** Source position attributes the merged vertices came from. */
  vertexSources: T.BufferAttribute[];
  vertices: VertexSet | null;
  /** Merged geometry per source index set (LOD tiers swap indices only). */
  byIndex: Map<string, T.BufferGeometry>;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (value: object) => {
  let id = ids.get(value);
  if (id === undefined) ids.set(value, (id = nextId++));
  return id;
};

/** Sources merge only if three would draw them identically apart from their
 * triangles: same shadow side and, for skinning, the same skeleton, bind
 * matrix and bind mode with an identity placement in the frame. */
function groupKey(frame: T.Object3D, mesh: T.Mesh) {
  const side = shadowSideOf(mesh.material as T.Material);
  if (!(mesh instanceof T.SkinnedMesh)) return `${side}`;
  if (mesh !== frame && !localMatrix(frame, mesh).equals(identity)) return null;
  return `${side}|${idOf(mesh.skeleton)}|${mesh.bindMode}|${mesh.bindMatrix.elements.join(',')}`;
}

/** Depth-only casters per rigid frame, shadow side and chunk, replacing the
 * frame's per-material shadow draws. A frame's own mesh (if any) and its
 * direct mesh children merge; their transforms relative to the frame must
 * not change afterwards (batched bodywork, wheel carriers, rims, wings, or
 * the primitives of one glTF mesh node). Sources stop casting and keep
 * receiving, so self-shadowing is unchanged; the casters are the same
 * triangles (in the same LOD tier), so the shadow map is too.
 *
 * Casters stay hidden except inside the shadow pass (see `install`), so they
 * never cost a draw in any camera view. */
export interface ShadowSubstitute {
  fine: T.Object3D;
  coarse: T.Object3D;
  /** Prepare/restore the coarse tier for drawing every instance of `fine`. */
  begin?: () => void;
  end?: () => void;
}
function visibleChain(object: T.Object3D) {
  for (let o: T.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
export class ShadowProxies {
  private readonly casters: Caster[] = [];
  private readonly vertexPool = new Pool<VertexSet>();
  private readonly geometryPool = new Pool<T.BufferGeometry>();
  private renderer: T.WebGLRenderer | null = null;
  private original: T.WebGLShadowMap['render'] | null = null;
  get count() {
    return this.casters.length;
  }
  /** Bytes of merged vertex and index data the casters hold (GPU copies),
   * counting shared data once. */
  get bytes() {
    return this.vertexPool.bytes + this.geometryPool.bytes;
  }
  /** Merge the plain casters of each frame; returns the casters created. */
  add(...frames: T.Object3D[]) {
    const created: T.Mesh[] = [];
    for (const frame of frames) {
      const groups = new Map<string, T.Mesh[]>();
      for (const object of [frame, ...frame.children]) {
        if (!plainShadowCaster(object)) continue;
        if (object.geometry.getAttribute('position').count > SHADOW_MERGE.maxSourceVertices)
          continue;
        const key = groupKey(frame, object);
        if (key === null) continue;
        const list = groups.get(key);
        if (list) list.push(object);
        else groups.set(key, [object]);
      }
      for (const group of groups.values()) {
        const chunks: T.Mesh[][] = [];
        let size = Infinity;
        for (const mesh of group) {
          const n = mesh.geometry.getAttribute('position').count;
          if (size + n > SHADOW_MERGE.maxCasterVertices) {
            chunks.push([]);
            size = 0;
          }
          chunks[chunks.length - 1].push(mesh);
          size += n;
        }
        // A single draw gains nothing.
        for (const meshes of chunks) if (meshes.length > 1) created.push(this.cast(frame, meshes));
      }
    }
    return created;
  }
  private cast(frame: T.Object3D, meshes: T.Mesh[]) {
    const first = meshes[0];
    const material = new T.MeshBasicMaterial({ colorWrite: false });
    material.shadowSide = shadowSideOf(first.material as T.Material);
    const mesh =
      first instanceof T.SkinnedMesh
        ? new T.SkinnedMesh(undefined, material)
        : new T.Mesh(undefined, material);
    if (mesh instanceof T.SkinnedMesh && first instanceof T.SkinnedMesh) {
      mesh.bindMode = first.bindMode;
      mesh.bind(first.skeleton, first.bindMatrix);
    }
    mesh.name = 'Shadow caster (depth only)';
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.visible = false;
    mesh.frustumCulled = meshes.every((m) => m.frustumCulled);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    const caster: Caster = {
      mesh,
      frame,
      sources: meshes,
      skinned: first instanceof T.SkinnedMesh,
      built: [],
      vertexSources: [],
      vertices: null,
      byIndex: new Map(),
    };
    this.sync(caster);
    frame.add(mesh);
    for (const source of meshes) source.castShadow = false;
    this.casters.push(caster);
    return mesh;
  }
  private releaseGeometries(caster: Caster) {
    for (const geometry of caster.byIndex.values())
      if (this.geometryPool.release(geometry)) geometry.dispose();
    caster.byIndex.clear();
  }
  /** Follow geometry swaps of the sources (LOD tiers): vertices are merged
   * once per set of source vertex buffers, triangles once per index set. */
  private sync(caster: Caster) {
    const { sources } = caster;
    if (sources.every((s, i) => s.geometry === caster.built[i])) return;
    const positions = sources.map((s) => s.geometry.getAttribute('position') as T.BufferAttribute);
    if (!caster.vertices || positions.some((p, i) => p !== caster.vertexSources[i])) {
      this.releaseGeometries(caster);
      if (caster.vertices) this.vertexPool.release(caster.vertices);
      const attributes = mergeVertices(caster.frame, sources, caster.skinned);
      caster.vertices = this.vertexPool.acquire(
        Object.values(attributes).map((a) => a.array),
        () => ({ id: nextId++, attributes }),
      );
      caster.vertexSources = positions;
    }
    const key = sources.map((s) => (s.geometry.index ? idOf(s.geometry.index) : 0)).join(',');
    let geometry = caster.byIndex.get(key);
    if (!geometry) {
      const vertices = caster.vertices;
      const index = mergeIndex(sources);
      geometry = this.geometryPool.acquire(
        [index],
        () => {
          const merged = new T.BufferGeometry();
          for (const [name, attribute] of Object.entries(vertices.attributes))
            merged.setAttribute(name, attribute);
          merged.setIndex(new T.BufferAttribute(index, 1));
          merged.computeBoundingSphere();
          return merged;
        },
        `${vertices.id}#`,
      );
      caster.byIndex.set(key, geometry);
    }
    caster.mesh.geometry = geometry;
    caster.built = sources.map((s) => s.geometry);
  }
  /** Run `render` with every caster shown (shadow passes and the shadow census). */
  /** Shadow-pass LOD substitution (F03 / WP06): pairs of [fine, coarse]
   * representations sharing instance transforms. While `fine` is the visible
   * tier, the shadow pass draws `coarse` instead; camera views are untouched
   * because their draw lists are built before shadows render. Used for crowd
   * and seat tiers whose sub-centimetre detail is far below shadow texels. */
  shadowSubstitutes: () => readonly ShadowSubstitute[] = () => [];
  /** Pairs substituted in the most recent shadow pass (diagnostics). */
  substitutedPairs = 0;
  withCasters<R>(render: () => R): R {
    for (const caster of this.casters) {
      this.sync(caster);
      caster.mesh.visible = true;
    }
    const muted: T.Object3D[] = [],
      shown: ShadowSubstitute[] = [];
    for (const pair of this.shadowSubstitutes()) {
      const { fine, coarse } = pair;
      if (!fine.visible || coarse.visible || !visibleChain(fine)) continue;
      fine.traverse((o) => {
        if (o.castShadow) {
          o.castShadow = false;
          muted.push(o);
        }
      });
      coarse.visible = true;
      pair.begin?.();
      shown.push(pair);
    }
    this.substitutedPairs = shown.length;
    try {
      return render();
    } finally {
      for (const caster of this.casters) caster.mesh.visible = false;
      for (const o of muted) o.castShadow = true;
      for (const pair of shown) {
        pair.coarse.visible = false;
        pair.end?.();
      }
    }
  }
  /** Show the casters only while `renderer` renders shadow maps. WebGLRenderer
   * builds its view's draw list before it renders shadows, so the casters are
   * never in a view's draw list. */
  install(renderer: T.WebGLRenderer) {
    if (this.renderer) throw new Error('Shadow casters already installed');
    const shadowMap = renderer.shadowMap,
      original = shadowMap.render;
    this.renderer = renderer;
    this.original = original;
    shadowMap.render = (lights, scene, camera) =>
      this.withCasters(() => original.call(shadowMap, lights, scene, camera));
  }
  /** Remove the casters made for frames under `root`, restoring their sources. */
  remove(root: T.Object3D) {
    for (let i = this.casters.length - 1; i >= 0; i--) {
      const caster = this.casters[i];
      let under = false;
      for (let o: T.Object3D | null = caster.mesh; o; o = o.parent) if (o === root) under = true;
      if (!under) continue;
      for (const source of caster.sources) source.castShadow = true;
      caster.mesh.removeFromParent();
      this.releaseGeometries(caster);
      if (caster.vertices) this.vertexPool.release(caster.vertices);
      (caster.mesh.material as T.Material).dispose();
      this.casters.splice(i, 1);
    }
  }
  dispose() {
    if (this.renderer && this.original) this.renderer.shadowMap.render = this.original;
    this.renderer = null;
    this.original = null;
    for (const caster of [...this.casters]) this.remove(caster.mesh);
  }
}
