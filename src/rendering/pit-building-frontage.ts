import * as T from 'three';
import { downloadAuthoredAsset } from './authored-download.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './pit-building-frontage.manifest.json' with { type: 'json' };
import { pitBuildingLayout, PIT_BUILDING_LIMITS } from './pit-building-layout.ts';

/** Rigid-chunk placement tolerance for the shared paddock template (m, rad). */
export const A21_BAY_TOLERANCE = Object.freeze({ position: 0.12, yaw: 0.02 });
import { detailDistance } from './view-detail.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import { installFacadeWeathering, type FacadeKind } from './facade-weathering.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import type { BroadcastSightlines } from './broadcast-sightlines.ts';
import type { Quality } from './options.ts';

export const PIT_BUILDING = manifest;
type ChunkId = 'A' | 'B' | 'C' | 'D';
interface BuildingDocument {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; children?: number[]; mesh?: number }[];
  meshes?: { primitives?: { indices?: number; material?: number }[] }[];
  accessors?: { count?: number }[];
  buffers?: { byteLength?: number; uri?: string }[];
  images?: { uri?: string; bufferView?: number }[];
  materials?: { name?: string }[];
}
const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
const aborted = () => new DOMException('A21 frontage loading cancelled', 'AbortError');

/** Validate the committed self-contained payload before it acquires GPU resources. */
export function pitBuildingDocument(bytes: Uint8Array<ArrayBuffer>): BuildingDocument {
  if (
    bytes.length !== manifest.bytes ||
    bytes.length > PIT_BUILDING_LIMITS.bytes ||
    bytes.length < 28
  )
    throw new Error('A21 byte count mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    length > bytes.length - 28
  )
    throw new Error('Invalid A21 GLB header');
  const d: BuildingDocument = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  if (
    d.asset?.version !== '2.0' ||
    d.scene !== 0 ||
    d.scenes?.length !== 1 ||
    d.nodes?.length !== manifest.nodes ||
    d.meshes?.length !== manifest.meshes ||
    d.materials?.length !== manifest.materials ||
    d.images?.length !== manifest.images ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri !== undefined ||
    d.images.some((i) => i.uri !== undefined || !Number.isInteger(i.bufferView))
  )
    throw new Error('Invalid self-contained A21 contract');
  const names = ['AUREL_PIT_BUILDING_A21', ...Object.keys(manifest.sockets)];
  for (const id of ['A', 'B', 'C', 'D'] as const) {
    names.push(`A21_CHUNK_${id}`);
    for (const level of [0, 1, 2]) {
      names.push(`A21_${id}_LOD${level}`);
      let triangles = 0;
      for (const node of d.nodes.filter((n) => n.name?.startsWith(`A21_${id}_L${level}_`))) {
        const primitives = d.meshes[node.mesh ?? -1]?.primitives;
        if (!primitives?.length) throw new Error('Missing A21 surface');
        for (const p of primitives) {
          const count = d.accessors?.[p.indices ?? -1]?.count;
          if (!count || count % 3) throw new Error('Invalid A21 triangle data');
          triangles += count / 3;
        }
      }
      if (triangles !== manifest.chunkTriangles[id][level])
        throw new Error('A21 LOD count mismatch');
    }
  }
  for (const name of names)
    if (d.nodes.filter((n) => n.name === name).length !== 1)
      throw new Error(`Missing or duplicate A21 node ${name}`);
  return d;
}

export function pitBuildingLod(
  distance: number,
  previous: number,
  quality: Quality,
  fov = 58,
  aspect = 16 / 9,
) {
  const d = detailDistance(distance, fov, aspect);
  const near = quality === 'high' ? 42 : quality === 'medium' ? 28 : 18;
  const far = quality === 'high' ? 160 : quality === 'medium' ? 120 : 85;
  if (previous === 0 && d < near * 1.12) return 0;
  if (previous === 2 && d > far * 0.88) return 2;
  return d < near ? 0 : d < far ? 1 : 2;
}

function free(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
}

/** Facade weathering per A21 material (glazing, interior and lamps stay clean). */
const A21_FACADES: Readonly<Record<string, FacadeKind>> = Object.freeze({
  A21_ArchitecturalConcrete: 'concrete',
  A21_CeramicCladding: 'cladding',
  A21_AnodizedSteel: 'metal',
  A21_BrushedAlloy: 'metal',
  A21_TeamEnamel: 'paint',
  A21_RoofMembrane: 'paint',
});
export class PitBuildingFrontage {
  readonly chunks: {
    id: ChunkId;
    root: T.Object3D;
    levels: T.Object3D[];
    localBounds: T.Box3;
    worldBounds: T.Box3;
    level: number;
  }[];
  private readonly lamps = new Set<T.MeshStandardMaterial>();
  private placed = false;
  private disposed = false;
  private minimumPitClearance = 0;
  private solidCount = 0;
  constructor(readonly root: T.Group) {
    root.updateMatrixWorld(true);
    this.chunks = (['A', 'B', 'C', 'D'] as const).map((id) => {
      const cr = root.getObjectByName(`A21_CHUNK_${id}`);
      if (!cr) throw new Error(`Missing A21 chunk ${id}`);
      // Exported chunks are origin-local; only place() sets world placement.
      if (cr.position.length() > 1e-6 || cr.scale.distanceTo(new T.Vector3(1, 1, 1)) > 1e-6)
        throw new Error('A21 export contains preview transforms');
      const levels = [0, 1, 2].map((level) => {
        const o = cr.getObjectByName(`A21_${id}_LOD${level}`);
        if (!o) throw new Error('Missing A21 level');
        return o;
      });
      const localBounds = new T.Box3().setFromObject(cr);
      const allowed = manifest.bounds[id];
      const envelope = new T.Box3(
        new T.Vector3(...(allowed.min as [number, number, number])),
        new T.Vector3(...(allowed.max as [number, number, number])),
      );
      if (!envelope.containsBox(localBounds))
        throw new Error('A21 geometry outside retained bounds');
      levels.forEach((o, i) => {
        o.visible = i === 0;
      });
      return { id, root: cr, levels, localBounds, worldBounds: new T.Box3(), level: 0 };
    });
    root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.geometry.computeBoundingBox();
      o.geometry.computeBoundingSphere();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!(m instanceof T.MeshStandardMaterial)) continue;
        if (m.name === 'A21_LightDiffuser') this.lamps.add(m);
        else if (m.name === 'A21_ArchitecturalConcrete') tagWeatherSurface(m, 'concrete');
        else if (m.name === 'A21_CeramicCladding') tagWeatherSurface(m, 'stone');
        else if (m.name === 'A21_AnodizedSteel' || m.name === 'A21_BrushedAlloy')
          tagWeatherSurface(m, 'metal');
        else if (m.name === 'A21_TeamEnamel') tagWeatherSurface(m, 'paint');
        // Seasons of rain run-off, grime and pit-lane splash. Chunk-local
        // coordinates: the pit-lane floor is y = 0 in every chunk.
        const facade = A21_FACADES[m.name];
        if (facade) installFacadeWeathering(m, facade, 'object', 0);
      }
    });
    root.name = 'Aurel Race Operations frontage / A21';
    root.userData.pitBuilding = { assetId: 'A21', revision: manifest.revision };
  }
  /** Largest bay offset between the authored layout and this track. */
  bayDeviation = { position: 0, yaw: 0 };
  /** Called once before scene transforms are sealed. No physics is modified. */
  place(track: Track, sightlines: BroadcastSightlines) {
    if (this.placed) throw new Error('A21 already placed');
    const sites = pitBuildingLayout(track);
    // Bay-relative geometry is authored against Aurel's pit straight. Each
    // chunk is placed rigidly (never stretched). Another circuit on the shared
    // paddock template may differ only by a few centimetres of pit-straight
    // curvature; anything beyond A21_BAY_TOLERANCE requires regeneration.
    this.bayDeviation = { position: 0, yaw: 0 };
    for (let i = 0; i < sites.length; i++) {
      const expected = manifest.layout[i],
        actual = sites[i];
      for (let b = 0; b < 3; b++) {
        const e = expected.bays[b],
          a = actual.bays[b];
        this.bayDeviation.position = Math.max(
          this.bayDeviation.position,
          Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z),
        );
        this.bayDeviation.yaw = Math.max(this.bayDeviation.yaw, Math.abs(e.yaw - a.yaw));
      }
    }
    if (
      this.bayDeviation.position > A21_BAY_TOLERANCE.position ||
      this.bayDeviation.yaw > A21_BAY_TOLERANCE.yaw
    )
      throw new Error('A21 bay layout changed; regenerate frontage for this track');
    this.minimumPitClearance = Infinity;
    for (const chunk of this.chunks) {
      const site = sites.find((p) => p.id === chunk.id)!;
      chunk.root.position.set(site.x, site.y, site.z);
      chunk.root.rotation.y = site.yaw;
      chunk.root.updateWorldMatrix(true, true);
      chunk.worldBounds.copy(chunk.localBounds).applyMatrix4(chunk.root.matrixWorld);
      // Check every near-tier vertex, not just a single centre-point clearance.
      const point = new T.Vector3(),
        nearest = trackPoint();
      chunk.levels[0].traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const positions = o.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld);
          const lateral = track.nearest(point.x, point.z, nearest);
          this.minimumPitClearance = Math.min(
            this.minimumPitClearance,
            lateral - track.pitOffset(nearest.s) - 3.6,
          );
        }
      });
    }
    if (this.minimumPitClearance < 0.25) throw new Error('A21 obstructs the pit driving ribbon');
    // These boxes describe actual thick slabs/walls, never empty garage volumes.
    for (const chunk of this.chunks)
      for (const solid of manifest.occluders[chunk.id]) {
        const proxy = new T.Mesh(new T.BoxGeometry(...(solid.size as [number, number, number])));
        proxy.position.set(...(solid.position as [number, number, number]));
        proxy.rotation.y = solid.yaw;
        proxy.updateMatrix();
        proxy.applyMatrix4(chunk.root.matrixWorld);
        sightlines.add(proxy);
        proxy.geometry.dispose();
        (proxy.material as T.Material).dispose();
        this.solidCount++;
      }
    this.placed = true;
  }
  /** Main view owns representation; mirrors and shadows reuse it without toggling
   * chunks off globally, which would remove offscreen shadow casters. */
  update(camera: T.PerspectiveCamera, quality: Quality, lighting: 'day' | 'sunset' | 'night') {
    for (const chunk of this.chunks) {
      chunk.root.updateWorldMatrix(true, false);
      chunk.worldBounds.copy(chunk.localBounds).applyMatrix4(chunk.root.matrixWorld);
      chunk.level = pitBuildingLod(
        chunk.worldBounds.distanceToPoint(camera.position),
        chunk.level,
        quality,
        camera.fov,
        camera.aspect,
      );
      chunk.levels.forEach((o, i) => {
        o.visible = i === chunk.level;
      });
    }
    for (const m of this.lamps)
      m.emissiveIntensity = lighting === 'night' ? 1.7 : lighting === 'sunset' ? 0.8 : 0.3;
  }
  socket(name: keyof typeof manifest.sockets, out: T.Vector3) {
    const node = this.root.getObjectByName(name);
    if (!node) throw new Error(`Missing A21 socket ${name}`);
    return node.getWorldPosition(out);
  }
  diagnostics() {
    return {
      assetId: 'A21',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      placed: this.placed,
      bayCount: 12,
      chunks: this.chunks.map((c) => ({
        id: c.id,
        lod: c.level,
        triangles: manifest.chunkTriangles[c.id][c.level],
      })),
      triangles: this.chunks.reduce((n, c) => n + manifest.chunkTriangles[c.id][c.level], 0),
      sockets: Object.keys(manifest.sockets).length,
      minimumPitClearance: this.minimumPitClearance,
      solidOccluders: this.solidCount,
      finalArtApproved: false,
    };
  }
  /** Attached meshes are owned by renderer disposal; call only while detached. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    free(this.root);
  }
}

export async function decodePitBuilding(bytes: Uint8Array<ArrayBuffer>, loader = new GLTFLoader()) {
  pitBuildingDocument(bytes);
  if ((await digest(bytes)) !== manifest.sha256) throw new Error('A21 integrity check failed');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new PitBuildingFrontage(gltf.scene);
  } catch (error) {
    free(gltf.scene);
    throw error;
  }
}

export async function loadPitBuildingFrontage(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  let asset: PitBuildingFrontage | undefined;
  try {
    const bytes = await downloadAuthoredAsset({
      label: 'A21',
      title: 'A21 frontage',
      bytes: manifest.bytes,
      url:
        url ??
        new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      cancelled,
      fetcher,
      aborted,
    });
    asset = await decodePitBuilding(bytes);
    if (cancelled()) throw aborted();
    return asset;
  } catch (error) {
    asset?.dispose();
    throw error;
  }
}
