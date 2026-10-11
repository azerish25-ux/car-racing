import * as T from 'three';
import { downloadAuthoredAsset } from './authored-download.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import manifest from './steel-guardrails.manifest.json' with { type: 'json' };
import { Track } from '../simulation/track.ts';
import { conformTracksideGeometry } from './trackside-module-conformance.ts';
import { concreteBarrierLod } from './concrete-barriers.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import { installTracksideWeathering } from './trackside-weathering.ts';
import type { Quality } from './options.ts';
export const STEEL_GUARDRAILS = manifest;
export const GUARDRAIL_RANGES = Object.freeze([
  { start: 360, end: 610, side: -1 },
  { start: 1020, end: 1170, side: 1 },
  { start: 1840, end: 2090, side: -1 },
  { start: 2420, end: 2530, side: 1 },
]);
export const GUARDRAIL_VARIANTS = ['run', 'transition', 'terminal'] as const;
type Variant = (typeof GUARDRAIL_VARIANTS)[number];
export function guardrailRole(
  station: number,
  side: number,
): { variant: Variant; reverse: boolean } | null {
  const range = GUARDRAIL_RANGES.find(
    (r) => r.side === side && station >= r.start && station <= r.end,
  );
  if (!range) return null;
  return {
    variant: station - range.start < 3.8 || range.end - station < 3.8 ? 'transition' : 'run',
    reverse: range.end - station < 3.8,
  };
}
interface GuardrailDocument {
  asset: { version: string };
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
}
export function steelGuardrailDocument(bytes: Uint8Array<ArrayBuffer>): GuardrailDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28 || bytes.length > 3 * 1024 * 1024)
    throw new Error('A02 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    len = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    len > bytes.length - 28
  )
    throw new Error('Invalid A02 GLB header');
  const d = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as GuardrailDocument;
  if (
    d.asset?.version !== '2.0' ||
    d.nodes?.length !== manifest.nodes ||
    d.meshes?.length !== manifest.meshes ||
    d.materials?.length !== 2 ||
    d.images?.length !== 3 ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri ||
    d.images.some((i) => i.uri || !Number.isInteger(i.bufferView))
  )
    throw new Error('Invalid self-contained A02 contract');
  for (const variant of GUARDRAIL_VARIANTS)
    for (const level of [0, 1, 2]) {
      const name = `A02_${variant.toUpperCase()}_LOD${level}`,
        nodes = d.nodes.filter((n) => n.name === name);
      if (nodes.length !== 1 || nodes[0].children?.length !== manifest.draws[variant][level])
        throw new Error('Invalid A02 LOD hierarchy');
      let tris = 0;
      for (const id of nodes[0].children!) {
        const ps = d.meshes[d.nodes[id]?.mesh ?? -1]?.primitives;
        if (
          ps?.length !== 1 ||
          ['POSITION', 'NORMAL', 'TEXCOORD_0'].some((k) => ps[0].attributes[k] === undefined)
        )
          throw new Error('Invalid A02 UV/topology contract');
        tris += d.accessors[ps[0].indices]?.count / 3;
      }
      if (tris !== manifest.triangles[variant][level])
        throw new Error('Invalid A02 triangle count');
    }
  for (const name of Object.keys(manifest.sockets))
    if (d.nodes.filter((n) => n.name === name).length !== 1) throw new Error('Missing A02 socket');
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
export function conformGuardrailGeometry(
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
export class SteelGuardrailKit {
  readonly root = new T.Group();
  readonly templates = new Map<string, Template[]>();
  readonly chunks: {
    levels: T.Group[];
    sphere: T.Sphere;
    level: number;
    modules: number;
    transitions: number;
  }[] = [];
  private disposed = false;
  constructor(private readonly source: T.Group) {
    this.root.name = 'A02 authored steel guardrail runs';
    source.updateMatrixWorld(true);
    const allowed = new T.Box3(
      new T.Vector3().fromArray(manifest.bounds.min).addScalar(-1e-5),
      new T.Vector3().fromArray(manifest.bounds.max).addScalar(1e-5),
    );
    for (const variant of GUARDRAIL_VARIANTS)
      for (const level of [0, 1, 2]) {
        const group = source.getObjectByName(`A02_${variant.toUpperCase()}_LOD${level}`);
        if (!group) throw new Error('Missing A02 level');
        const parts: Template[] = [];
        group.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          if (!(o.material instanceof T.MeshStandardMaterial))
            throw new Error('Invalid A02 material');
          const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
          geometry.computeBoundingBox();
          if (
            !geometry.index ||
            !geometry.getAttribute('normal') ||
            !geometry.getAttribute('uv') ||
            !allowed.containsBox(geometry.boundingBox!)
          )
            throw new Error('A02 outside its declared envelope');
          for (const name of ['position', 'normal', 'uv'])
            if (!Array.from(geometry.getAttribute(name).array).every(Number.isFinite))
              throw new Error('Non-finite A02 geometry');
          parts.push({ geometry, material: o.material });
          tagWeatherSurface(o.material, o.material.name.includes('reflector') ? 'paint' : 'metal');
          if (!o.material.name.includes('reflector'))
            installTracksideWeathering(o.material, 'galvanised');
        });
        if (parts.length !== manifest.draws[variant][level])
          throw new Error('A02 draw budget mismatch');
        this.templates.set(`${variant}:${level}`, parts);
      }
    for (const [name, point] of Object.entries(manifest.sockets)) {
      const node = source.getObjectByName(name);
      if (
        !node ||
        node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(point)) > 1e-5
      )
        throw new Error('Invalid A02 socket position');
    }
  }
  buildChunk(
    track: Track,
    parent: T.Group,
    start: number,
    end: number,
    exclude?: (station: number, side: number) => boolean,
  ) {
    if (this.disposed) throw new Error('A02 disposed');
    const count = Math.ceil((end - start) / 3.8),
      segments = [];
    for (const side of [-1, 1])
      for (let i = 0; i < count; i++) {
        const a = start + ((end - start) * i) / count,
          b = start + ((end - start) * (i + 1)) / count,
          role = guardrailRole((a + b) / 2, side);
        if (role && !exclude?.((a + b) / 2, side))
          segments.push({ a: a + 0.008, b: b - 0.008, side, ...role });
      }
    if (!segments.length) return;
    if (!this.root.parent) parent.add(this.root);
    if (this.root.parent !== parent) throw new Error('A02 already attached elsewhere');
    const levels: T.Group[] = [];
    for (const level of [0, 1, 2]) {
      const group = new T.Group();
      group.name = `A02 ${Math.round(start)}-${Math.round(end)}m LOD${level}`;
      const batches = new Map<T.MeshStandardMaterial, T.BufferGeometry[]>();
      for (const segment of segments)
        for (const part of this.templates.get(`${segment.variant}:${level}`)!) {
          const parts = batches.get(part.material) ?? [];
          parts.push(
            conformGuardrailGeometry(
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
      group.visible = level === 2;
      this.root.add(group);
      levels.push(group);
    }
    const sphere = new T.Box3().setFromObject(levels[0]).getBoundingSphere(new T.Sphere());
    this.chunks.push({
      levels,
      sphere,
      level: 2,
      modules: segments.length,
      transitions: segments.filter((s) => s.variant === 'transition').length,
    });
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
      assetId: 'A02',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      chunks: this.chunks.length,
      modules: this.chunks.reduce((n, c) => n + c.modules, 0),
      transitions: this.chunks.reduce((n, c) => n + c.transitions, 0),
      selectedLods: [0, 1, 2].map((i) => this.chunks.filter((c) => c.level === i).length),
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
export async function decodeSteelGuardrails(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
) {
  steelGuardrailDocument(bytes);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (sha !== manifest.sha256) throw new Error('A02 integrity mismatch');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new SteelGuardrailKit(gltf.scene);
  } catch (error) {
    release([gltf.scene]);
    throw error;
  }
}
const aborted = () => new DOMException('A02 loading cancelled', 'AbortError');
export async function loadSteelGuardrails(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  let asset: SteelGuardrailKit | undefined;
  try {
    const bytes = await downloadAuthoredAsset({
      label: 'A02',
      title: 'A02 guardrails',
      bytes: manifest.bytes,
      url:
        url ??
        new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      cancelled,
      fetcher,
      aborted,
    });
    asset = await decodeSteelGuardrails(bytes);
    if (cancelled()) throw aborted();
    return asset;
  } catch (error) {
    asset?.dispose();
    throw error;
  }
}
