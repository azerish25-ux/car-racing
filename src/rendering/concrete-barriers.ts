import * as T from 'three';
import { downloadAuthoredAsset } from './authored-download.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import manifest from './concrete-barriers.manifest.json' with { type: 'json' };
import { Track, trackPoint } from '../simulation/track.ts';
import { clamp } from '../core/math.ts';
import { detailDistance } from './view-detail.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import {
  WEATHERING_ATTRIBUTE,
  installTracksideWeathering,
  rubberWear,
  weatheringStream,
} from './trackside-weathering.ts';
import type { Quality } from './options.ts';

export const CONCRETE_BARRIERS = manifest;
export const BARRIER_VARIANTS = ['clean', 'rubbed', 'chipped'] as const;
type Variant = (typeof BARRIER_VARIANTS)[number];
interface BarrierDocument {
  asset: { version: string };
  nodes: { name?: string; mesh?: number }[];
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
}
const aborted = () => new DOMException('A01 loading cancelled', 'AbortError');
export function concreteBarrierDocument(bytes: Uint8Array<ArrayBuffer>): BarrierDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28 || bytes.length > 2 * 1024 * 1024)
    throw new Error('A01 byte count mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    length = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    length > bytes.length - 28
  )
    throw new Error('Invalid A01 GLB header');
  const d = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + length)),
  ) as BarrierDocument;
  if (
    d.asset?.version !== '2.0' ||
    d.nodes?.length !== manifest.nodes ||
    d.meshes?.length !== manifest.meshes ||
    d.images?.length !== manifest.images ||
    d.materials?.length !== 1 ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri ||
    d.images.some((i) => i.uri || !Number.isInteger(i.bufferView))
  )
    throw new Error('Invalid self-contained A01 contract');
  for (const variant of BARRIER_VARIANTS)
    for (const level of [0, 1, 2]) {
      const name = `A01_${variant.toUpperCase()}_LOD${level}`;
      const nodes = d.nodes.filter((n) => n.name === name),
        primitive = d.meshes[nodes[0]?.mesh ?? -1]?.primitives;
      if (
        nodes.length !== 1 ||
        primitive?.length !== 1 ||
        d.accessors[primitive[0].indices]?.count !== manifest.triangles[variant][level] * 3 ||
        ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0'].some(
          (k) => primitive[0].attributes[k] === undefined,
        )
      )
        throw new Error('Invalid A01 LOD/UV/colour contract');
    }
  return d;
}
export function concreteBarrierLod(
  distance: number,
  previous: number,
  quality: Quality,
  fov = 58,
  aspect = 16 / 9,
) {
  const d = detailDistance(distance, fov, aspect),
    near = quality === 'high' ? 40 : quality === 'medium' ? 28 : 16,
    far = quality === 'high' ? 150 : quality === 'medium' ? 100 : 70;
  if (previous === 0 && d < near * 1.12) return 0;
  if (previous === 2 && d > far * 0.88) return 2;
  return d < near ? 0 : d < far ? 1 : 2;
}
export function barrierVariant(station: number, side: number): Variant {
  const key = (Math.floor(station / 3.8) * 7 + (side < 0 ? 3 : 0)) % 19;
  return key === 0 ? 'chipped' : key % 5 === 0 ? 'rubbed' : 'clean';
}
function release(roots: T.Object3D[]) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>(),
    ts = new Set<T.Texture>();
  for (const root of roots)
    root.traverse((o) => {
      if (o instanceof T.Mesh) {
        gs.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          ms.add(m);
          for (const v of Object.values(m)) if (v instanceof T.Texture) ts.add(v);
        }
      }
    });
  gs.forEach((g) => g.dispose());
  ms.forEach((m) => m.dispose());
  ts.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
}
/** Authored profiles replace only the old concrete display meshes. Track
 * boundary physics, catch fencing and pit routes remain authoritative. */
export class ConcreteBarrierKit {
  readonly root = new T.Group();
  readonly templates = new Map<string, T.BufferGeometry>();
  readonly chunks: { levels: T.Mesh[]; sphere: T.Sphere; level: number; modules: number }[] = [];
  readonly material: T.MeshStandardMaterial;
  private disposed = false;
  constructor(private readonly source: T.Group) {
    this.root.name = 'A01 authored concrete barrier chunks';
    let material: T.MeshStandardMaterial | undefined;
    for (const variant of BARRIER_VARIANTS)
      for (const level of [0, 1, 2]) {
        const mesh = source.getObjectByName(`A01_${variant.toUpperCase()}_LOD${level}`);
        if (!(mesh instanceof T.Mesh) || !(mesh.material instanceof T.MeshStandardMaterial))
          throw new Error('Missing A01 template');
        if (material && material !== mesh.material) throw new Error('Unbatched A01 materials');
        material = mesh.material;
        mesh.updateWorldMatrix(true, false);
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        const position = geometry.getAttribute('position'),
          normal = geometry.getAttribute('normal');
        if (!position || !normal || !geometry.getAttribute('uv') || !geometry.index)
          throw new Error('Missing A01 mesh data');
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i),
            y = position.getY(i),
            z = position.getZ(i);
          if (
            ![x, y, z, normal.getX(i), normal.getY(i), normal.getZ(i)].every(Number.isFinite) ||
            Math.abs(x) > 0.27501 ||
            y < -0.05501 ||
            y > 0.94001 ||
            z < -0.00001 ||
            z > 3.80001
          )
            throw new Error('A01 exceeds original collision envelope');
        }
        this.templates.set(`${variant}:${level}`, geometry);
      }
    this.material = material!;
    tagWeatherSurface(this.material, 'concrete');
    installTracksideWeathering(this.material, 'concrete');
  }
  conform(track: Track, start: number, end: number, side: number, variant: Variant, level: number) {
    if (
      this.disposed ||
      ![start, end, side].every(Number.isFinite) ||
      end <= start ||
      ![-1, 1].includes(side)
    )
      throw new Error('Invalid A01 span');
    const template = this.templates.get(`${variant}:${level}`);
    if (!template) throw new Error('Invalid A01 variant or LOD');
    const g = template.clone(),
      position = g.getAttribute('position');
    // Barrier-space coordinates for weathering (template +x faces `side`).
    g.setAttribute(
      WEATHERING_ATTRIBUTE,
      new T.BufferAttribute(
        weatheringStream(
          position,
          g.getAttribute('normal'),
          start,
          end,
          manifest.span,
          side,
          false,
          rubberWear(track, (start + end) / 2),
        ),
        4,
      ),
    );
    const a = track.at(start, trackPoint()),
      b = track.at(end, trackPoint()),
      la = side * track.boundary(start, side),
      lb = side * track.boundary(end, side);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i),
        y = position.getY(i),
        t = clamp(position.getZ(i) / manifest.span, 0, 1),
        l0 = la + x,
        l1 = lb + x;
      position.setXYZ(
        i,
        (a.x + a.nx * l0) * (1 - t) + (b.x + b.nx * l1) * t,
        (a.y + a.bank * clamp(l0, -12, 12)) * (1 - t) + (b.y + b.bank * clamp(l1, -12, 12)) * t + y,
        (a.z + a.nz * l0) * (1 - t) + (b.z + b.nz * l1) * t,
      );
    }
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  buildChunk(
    track: Track,
    parent: T.Group,
    start: number,
    end: number,
    exclude?: (station: number, side: number) => boolean,
  ) {
    if (this.disposed) throw new Error('A01 disposed');
    const count = Math.ceil((end - start) / 3.8);
    const segments: { a: number; b: number; side: number; variant: Variant }[] = [];
    for (const side of [-1, 1])
      for (let i = 0; i < count; i++) {
        const a = start + ((end - start) * i) / count,
          b = start + ((end - start) * (i + 1)) / count;
        if (exclude?.((a + b) / 2, side)) continue;
        segments.push({ a: a + 0.008, b: b - 0.008, side, variant: barrierVariant(a, side) });
      }
    if (!segments.length) return;
    if (!this.root.parent) parent.add(this.root);
    if (this.root.parent !== parent) throw new Error('A01 already attached elsewhere');
    const levels: T.Mesh[] = [];
    for (const level of [0, 1, 2]) {
      const parts = segments.map((s) => this.conform(track, s.a, s.b, s.side, s.variant, level));
      const geometry = mergeGeometries(parts, false)!;
      parts.forEach((g) => g.dispose());
      geometry.computeBoundingSphere();
      const mesh = new T.Mesh(geometry, this.material);
      mesh.name = `A01 concrete ${Math.round(start)}-${Math.round(end)}m LOD${level}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = level === 2;
      this.root.add(mesh);
      levels.push(mesh);
    }
    this.chunks.push({
      levels,
      sphere: levels[0].geometry.boundingSphere!.clone(),
      level: 2,
      modules: segments.length,
    });
  }
  update(camera: T.PerspectiveCamera, quality: Quality) {
    if (this.disposed) return;
    for (const chunk of this.chunks) {
      const distance = Math.max(
        0,
        camera.position.distanceTo(chunk.sphere.center) - chunk.sphere.radius,
      );
      const level = concreteBarrierLod(distance, chunk.level, quality, camera.fov, camera.aspect);
      if (level !== chunk.level) {
        chunk.levels[chunk.level].visible = false;
        chunk.levels[level].visible = true;
        chunk.level = level;
      }
    }
  }
  diagnostics() {
    return {
      assetId: 'A01',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      chunks: this.chunks.length,
      modules: this.chunks.reduce((n, c) => n + c.modules, 0),
      selectedLods: [0, 1, 2].map((l) => this.chunks.filter((c) => c.level === l).length),
      selectedTriangles: this.chunks.reduce(
        (n, c) => n + c.levels[c.level].geometry.index!.count / 3,
        0,
      ),
      physicsChanged: false,
      finalArtApproved: false,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    release([this.source, this.root]);
    this.templates.forEach((g) => g.dispose());
    this.templates.clear();
    this.root.clear();
  }
}
export async function decodeConcreteBarriers(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
) {
  concreteBarrierDocument(bytes);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (sha !== manifest.sha256) throw new Error('A01 integrity mismatch');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new ConcreteBarrierKit(gltf.scene);
  } catch (error) {
    release([gltf.scene]);
    throw error;
  }
}
export async function loadConcreteBarriers(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  let asset: ConcreteBarrierKit | undefined;
  try {
    const bytes = await downloadAuthoredAsset({
      label: 'A01',
      title: 'A01 barriers',
      bytes: manifest.bytes,
      url:
        url ??
        new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      cancelled,
      fetcher,
      aborted,
    });
    asset = await decodeConcreteBarriers(bytes);
    if (cancelled()) throw aborted();
    return asset;
  } catch (error) {
    asset?.dispose();
    throw error;
  }
}
