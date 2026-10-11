import * as T from 'three';
import { downloadAuthoredAsset } from './authored-download.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import manifest from './catch-fence.manifest.json' with { type: 'json' };
import { Track } from '../simulation/track.ts';
import { conformTracksideGeometry } from './trackside-module-conformance.ts';
import { concreteBarrierLod } from './concrete-barriers.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import { installTracksideWeathering } from './trackside-weathering.ts';
import type { Quality } from './options.ts';
export const CATCH_FENCE = manifest;
export const FENCE_VARIANTS = ['run', 'braced', 'gate'] as const;
type Variant = (typeof FENCE_VARIANTS)[number];
export interface FenceGateSite {
  s: number;
  side: number;
}
export function fenceVariant(
  start: number,
  end: number,
  side: number,
  gates: readonly FenceGateSite[],
): { variant: Variant; reverse: boolean } {
  if (gates.some((g) => g.side === side && g.s >= start && g.s < end))
    return { variant: 'gate', reverse: false };
  return {
    variant: (Math.floor((start + end) / 7.6) + (side < 0 ? 5 : 0)) % 12 === 0 ? 'braced' : 'run',
    reverse: false,
  };
}
interface FenceDocument {
  asset: { version: string };
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
}
export function catchFenceDocument(bytes: Uint8Array<ArrayBuffer>): FenceDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28 || bytes.length > 3 * 1024 * 1024)
    throw new Error('A03 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    len = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    len > bytes.length - 28
  )
    throw new Error('Invalid A03 GLB header');
  const d = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as FenceDocument;
  if (
    d.asset?.version !== '2.0' ||
    d.nodes?.length !== manifest.nodes ||
    d.meshes?.length !== manifest.meshes ||
    d.materials?.length !== 1 ||
    d.images?.length !== 3 ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri ||
    d.images.some((i) => i.uri || !Number.isInteger(i.bufferView))
  )
    throw new Error('Invalid self-contained A03 contract');
  for (const variant of FENCE_VARIANTS)
    for (const level of [0, 1, 2]) {
      const name = `A03_${variant.toUpperCase()}_LOD${level}`,
        nodes = d.nodes.filter((n) => n.name === name);
      if (nodes.length !== 1 || nodes[0].children?.length !== manifest.draws[variant][level])
        throw new Error('Invalid A03 LOD hierarchy');
      let tris = 0;
      for (const id of nodes[0].children!) {
        const ps = d.meshes[d.nodes[id]?.mesh ?? -1]?.primitives;
        if (
          ps?.length !== 1 ||
          ['POSITION', 'NORMAL', 'TEXCOORD_0'].some((k) => ps[0].attributes[k] === undefined)
        )
          throw new Error('Invalid A03 UV/topology contract');
        tris += d.accessors[ps[0].indices]?.count / 3;
      }
      if (tris !== manifest.triangles[variant][level])
        throw new Error('Invalid A03 triangle count');
    }
  for (const name of Object.keys(manifest.sockets))
    if (d.nodes.filter((n) => n.name === name).length !== 1) throw new Error('Missing A03 socket');
  return d;
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
export function conformCatchFenceGeometry(
  template: T.BufferGeometry,
  track: Track,
  start: number,
  end: number,
  side: number,
  reverse = false,
) {
  return conformTracksideGeometry(template, track, start, end, side, manifest.span, reverse);
}
interface Template {
  geometry: T.BufferGeometry;
  material: T.MeshStandardMaterial;
}
export class CatchFenceKit {
  readonly root = new T.Group();
  readonly templates = new Map<string, Template[]>();
  readonly chunks: {
    levels: T.Group[];
    sphere: T.Sphere;
    level: number;
    modules: number;
    gates: number;
  }[] = [];
  private disposed = false;
  private gateSites: readonly FenceGateSite[] = [];
  setGateSites(sites: readonly FenceGateSite[]) {
    if (this.disposed || this.chunks.length)
      throw new Error('A03 placement is already constructed');
    if (sites.some((s) => !Number.isFinite(s.s) || s.s < 0 || ![-1, 1].includes(s.side)))
      throw new Error('Invalid A03 gate site');
    this.gateSites = Object.freeze(sites.map((s) => Object.freeze({ s: s.s, side: s.side })));
  }
  constructor(private readonly source: T.Group) {
    this.root.name = 'A03 authored catch-fence supports';
    source.updateMatrixWorld(true);
    const allowed = new T.Box3(
      new T.Vector3().fromArray(manifest.bounds.min).addScalar(-1e-5),
      new T.Vector3().fromArray(manifest.bounds.max).addScalar(1e-5),
    );
    for (const variant of FENCE_VARIANTS)
      for (const level of [0, 1, 2]) {
        const group = source.getObjectByName(`A03_${variant.toUpperCase()}_LOD${level}`);
        if (!group) throw new Error('Missing A03 level');
        const parts: Template[] = [];
        group.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          if (!(o.material instanceof T.MeshStandardMaterial))
            throw new Error('Invalid A03 material');
          const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
          geometry.computeBoundingBox();
          if (
            !geometry.index ||
            !geometry.getAttribute('normal') ||
            !geometry.getAttribute('uv') ||
            !allowed.containsBox(geometry.boundingBox!)
          )
            throw new Error('A03 outside its declared envelope');
          for (const name of ['position', 'normal', 'uv'])
            if (!Array.from(geometry.getAttribute(name).array).every(Number.isFinite))
              throw new Error('Non-finite A03 geometry');
          parts.push({ geometry, material: o.material });
          tagWeatherSurface(o.material, 'metal');
          installTracksideWeathering(o.material, 'galvanised');
        });
        if (parts.length !== manifest.draws[variant][level])
          throw new Error('A03 draw budget mismatch');
        this.templates.set(`${variant}:${level}`, parts);
      }
    for (const [name, point] of Object.entries(manifest.sockets)) {
      const node = source.getObjectByName(name);
      if (
        !node ||
        node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(point)) > 1e-5
      )
        throw new Error('Invalid A03 socket position');
    }
  }
  buildChunk(
    track: Track,
    parent: T.Group,
    start: number,
    end: number,
    exclude?: (station: number, side: number) => boolean,
  ) {
    if (this.disposed) throw new Error('A03 disposed');
    const count = Math.ceil((end - start) / 3.8);
    const segments: { a: number; b: number; side: number; variant: Variant; reverse: boolean }[] =
      [];
    for (const side of [-1, 1])
      for (let i = 0; i < count; i++) {
        const a = start + ((end - start) * i) / count,
          b = start + ((end - start) * (i + 1)) / count;
        if (exclude?.((a + b) / 2, side)) continue;
        segments.push({
          a: a + 0.008,
          b: b - 0.008,
          side,
          ...fenceVariant(a, b, side, this.gateSites),
        });
      }
    if (!segments.length) return;
    if (!this.root.parent) parent.add(this.root);
    if (this.root.parent !== parent) throw new Error('A03 already attached elsewhere');
    const build = (chosen: typeof segments): void => {
      const levels: T.Group[] = [],
        batch = this.chunks.length;
      let sphere = new T.Sphere(new T.Vector3(), -1);
      for (const level of [0, 1, 2]) {
        const group = new T.Group();
        group.name = `A03 batch ${batch} ${Math.round(start)}-${Math.round(end)}m LOD${level}`;
        const batches = new Map<T.MeshStandardMaterial, T.BufferGeometry[]>();
        for (const segment of chosen)
          for (const part of this.templates.get(`${segment.variant}:${level}`)!) {
            const parts = batches.get(part.material) ?? [];
            parts.push(
              conformCatchFenceGeometry(
                part.geometry,
                track,
                segment.a,
                segment.b,
                segment.side,
                segment.reverse,
              ),
            );
            batches.set(part.material, parts);
          }
        for (const [material, parts] of batches) {
          const geometry = mergeGeometries(parts, false)!;
          parts.forEach((p) => p.dispose());
          geometry.computeBoundingSphere();
          const mesh = new T.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.name = group.name + ' ' + material.name;
          group.add(mesh);
        }
        if (level === 0) {
          sphere = new T.Sphere(new T.Vector3(), -1);
          for (const mesh of group.children as T.Mesh[])
            sphere.union(mesh.geometry.boundingSphere!);
          // Outer hairpin rails and paired sides can exceed the intended bound
          // even inside an 80m station span. Subdivide the original segment list,
          // never recompute its grid or move gates/wire to make a bound pass.
          if (sphere.radius >= 50) {
            for (const mesh of group.children as T.Mesh[]) mesh.geometry.dispose();
            group.clear();
            if (chosen.length < 2) throw new Error('A03 module exceeds culling bounds');
            const middle = Math.ceil(chosen.length / 2);
            build(chosen.slice(0, middle));
            build(chosen.slice(middle));
            return;
          }
        }
        group.visible = level === 2;
        this.root.add(group);
        levels.push(group);
      }
      this.chunks.push({
        levels,
        sphere,
        level: 2,
        modules: chosen.length,
        gates: chosen.filter((s) => s.variant === 'gate').length,
      });
    };
    build(segments);
  }
  update(camera: T.PerspectiveCamera, quality: Quality) {
    if (this.disposed) return;
    for (const c of this.chunks) {
      const d = Math.max(0, camera.position.distanceTo(c.sphere.center) - c.sphere.radius),
        level = concreteBarrierLod(d, c.level, quality, camera.fov, camera.aspect);
      if (level !== c.level) {
        c.levels[c.level].visible = false;
        c.levels[level].visible = true;
        c.level = level;
      }
    }
  }
  diagnostics() {
    return {
      assetId: 'A03',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      chunks: this.chunks.length,
      modules: this.chunks.reduce((n, c) => n + c.modules, 0),
      gates: this.chunks.reduce((n, c) => n + c.gates, 0),
      selectedLods: [0, 1, 2].map((i) => this.chunks.filter((c) => c.level === i).length),
      retainedAnalyticWire: true,
      gateOperation: false,
      physicsChanged: false,
      finalArtApproved: false,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    release([this.source, this.root]);
    this.templates.forEach((parts) => parts.forEach((p) => p.geometry.dispose()));
    this.templates.clear();
    this.root.clear();
  }
}
export async function decodeCatchFence(bytes: Uint8Array<ArrayBuffer>, loader = new GLTFLoader()) {
  catchFenceDocument(bytes);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (sha !== manifest.sha256) throw new Error('A03 integrity mismatch');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new CatchFenceKit(gltf.scene);
  } catch (error) {
    release([gltf.scene]);
    throw error;
  }
}
const aborted = () => new DOMException('A03 loading cancelled', 'AbortError');
export async function loadCatchFence(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  let asset: CatchFenceKit | undefined;
  try {
    const bytes = await downloadAuthoredAsset({
      label: 'A03',
      title: 'A03 catch fence',
      bytes: manifest.bytes,
      url:
        url ??
        new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      cancelled,
      fetcher,
      aborted,
    });
    asset = await decodeCatchFence(bytes);
    if (cancelled()) throw aborted();
    return asset;
  } catch (error) {
    asset?.dispose();
    throw error;
  }
}
