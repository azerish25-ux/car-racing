import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from '../../../public/models/solvane/street-kit.manifest.json' with { type: 'json' };
import { downloadAuthoredAsset } from '../authored-download.ts';
import { assetUrl } from '../assets/third-party.ts';
import { installSpecularIBL } from '../studio/ibl-energy.ts';
import type { QualityPreset } from '../options.ts';
import type { Structure } from '../../simulation/open-world/placement.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import { trackPoint } from '../../simulation/track.ts';

export const STREET_KIT = manifest;
const KINDS = ['awning', 'service', 'pipe'] as const;
type Kind = (typeof KINDS)[number];
const NAMES = KINDS.flatMap((kind) => [`${kind}_near`, `${kind}_far`]);
const CELL = 96;
/** Counts are placements per kind, not total triangles or whole-frame budgets. */
export const STREET_BUDGETS = Object.freeze({
  low: { near: 0, far: 18, detailRange: 0, range: 105 },
  medium: { near: 18, far: 42, detailRange: 48, range: 170 },
  high: { near: 26, far: 64, detailRange: 65, range: 215 },
  ultra: { near: 32, far: 80, detailRange: 80, range: 260 },
});
const CAPACITY = 80;
interface Placement {
  kind: Kind;
  matrix: T.Matrix4;
  centre: T.Vector3;
  radius: number;
  tint: T.Color;
  near: boolean;
  distance: number;
}
interface Batch {
  mesh: T.InstancedMesh;
  local: T.Matrix4;
  canvas: boolean;
}
const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');

/** Authenticate the compressed payload before expanding it. The expanded
 * buffer is bounded as it streams, then authenticated independently. */
export async function decodeStreetTransport(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.length !== manifest.gzip.bytes || (await hash(bytes)) !== manifest.gzip.sha256)
    throw new Error('Street transport integrity mismatch');
  if (typeof DecompressionStream === 'undefined') throw new Error('Gzip decompression unavailable');
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const result = new Uint8Array(manifest.bytes);
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (size + chunk.value.length > result.length)
        throw new Error('Street expansion exceeds budget');
      result.set(chunk.value, size);
      size += chunk.value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (size !== result.length) throw new Error('Truncated street expansion');
  return result;
}

export async function parseStreetKit(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.length < 28 || bytes.length !== manifest.bytes || bytes.length > 240_000)
    throw new Error('Street GLB byte budget mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    jsonLength > bytes.length - 28 ||
    (jsonLength & 3) !== 0
  )
    throw new Error('Invalid street GLB');
  if ((await hash(bytes)) !== manifest.sha256) throw new Error('Street GLB integrity mismatch');
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    buffers?: { uri?: string }[];
    images?: unknown[];
    nodes?: { name?: string }[];
    materials?: unknown[];
    accessors?: unknown[];
  };
  if (
    doc.buffers?.length !== 1 ||
    doc.buffers[0].uri ||
    doc.images?.length ||
    (doc.nodes?.length ?? 0) > 64 ||
    (doc.materials?.length ?? 0) > 8 ||
    (doc.accessors?.length ?? 0) > 100 ||
    NAMES.some((name) => doc.nodes?.filter((node) => node.name === name).length !== 1)
  )
    throw new Error('Street GLB template/resource contract mismatch');
  return (await new GLTFLoader().parseAsync(bytes.slice().buffer, '')).scene;
}

/** Bounded, deterministic facade furniture on the existing collision-backed
 * region. Static meshes and materials are shared, instance buffers are owned.
 * This does not introduce invisible colliders or change road geometry. */
export class StreetDetails {
  readonly root = new T.Group();
  readonly stats = {
    loaded: true,
    planned: 0,
    nearInstances: 0,
    farInstances: 0,
    draws: 0,
    candidates: 0,
  };
  private readonly cells = new Map<string, Placement[]>();
  private readonly placements: Placement[] = [];
  private readonly batches = new Map<string, Batch[]>();
  private readonly candidates: Record<Kind, Placement[]> = { awning: [], service: [], pipe: [] };
  private readonly finishes = new Map<
    T.MeshStandardMaterial,
    { color: T.Color; rough: number; porous: boolean }
  >();
  private readonly frustum = new T.Frustum();
  private readonly projection = new T.Matrix4();
  private readonly sphere = new T.Sphere();
  private readonly matrix = new T.Matrix4();
  private disposed = false;

  static async load(world: OpenWorld, structures: readonly Structure[], cancelled: () => boolean) {
    const aborted = () => new DOMException('Street detail load cancelled', 'AbortError');
    // Old browsers retain the same verified geometry via an ordinary GLB.
    const compressed = typeof DecompressionStream !== 'undefined';
    const bytes = await downloadAuthoredAsset({
      label: 'Solvane street',
      title: 'Solvane street details',
      bytes: compressed ? manifest.gzip.bytes : manifest.bytes,
      url: assetUrl(`models/solvane/street-kit.${compressed ? 'bin' : 'glb'}`),
      cancelled,
      fetcher: fetch,
      aborted,
    });
    if (cancelled()) throw aborted();
    const source = await parseStreetKit(compressed ? await decodeStreetTransport(bytes) : bytes);
    const result = new StreetDetails(source, world, structures);
    if (cancelled()) {
      result.dispose();
      throw aborted();
    }
    return result;
  }

  constructor(
    private readonly source: T.Group,
    world: OpenWorld,
    structures: readonly Structure[],
  ) {
    this.root.name = 'Solvane Blender street construction';
    source.updateMatrixWorld(true);
    for (const name of NAMES) {
      const template = source.getObjectByName(name);
      if (!template) throw new Error(`Missing street template ${name}`);
      const batch: Batch[] = [];
      template.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        const mesh = new T.InstancedMesh(node.geometry, node.material, CAPACITY);
        mesh.name = `Street ${name} / ${node.name}`;
        mesh.count = 0;
        mesh.frustumCulled = false; // Placements use their transformed bounding spheres below.
        mesh.castShadow = name.endsWith('_near');
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        const canvas = materials.some((material) => material.name === 'canvas');
        if (canvas) {
          mesh.setColorAt(0, new T.Color(1, 1, 1));
          mesh.instanceColor!.setUsage(T.DynamicDrawUsage);
        }
        for (const material of materials) {
          if (material instanceof T.MeshStandardMaterial && !this.finishes.has(material))
            this.finishes.set(material, {
              color: material.color.clone(),
              rough: material.roughness,
              porous: material.name === 'canvas',
            });
        }
        batch.push({ mesh, local: node.matrixWorld.clone(), canvas });
        this.root.add(mesh);
      });
      this.batches.set(name, batch);
    }
    installSpecularIBL(source);
    this.plan(world, structures);
  }

  private plan(world: OpenWorld, structures: readonly Structure[]) {
    const p = trackPoint(),
      pose = new T.Object3D();
    const palettes = [
      [0.12, 0.28, 0.275],
      [0.29, 0.075, 0.048],
      [0.34, 0.29, 0.18],
      [0.1, 0.14, 0.2],
      [0.26, 0.24, 0.2],
    ];
    const add = (
      s: Structure,
      side: number,
      kind: Kind,
      x: number,
      y: number,
      sx = 1,
      variant = 0,
    ) => {
      const z = side * (s.hz + 0.025),
        c = Math.cos(s.heading),
        n = Math.sin(s.heading);
      pose.position.set(s.x + x * c - z * n, s.base + y, s.z + x * n + z * c);
      pose.rotation.set(0, -s.heading + (side < 0 ? Math.PI : 0), 0);
      // Maximum canopy projection is 0.855 m, within the >=1 m setback.
      pose.scale.set(sx, 1, kind === 'awning' ? 0.66 : 1);
      pose.updateMatrix();
      const b = manifest.templates[`${kind}_near`].bounds;
      const box = new T.Box3(new T.Vector3(...b.min), new T.Vector3(...b.max));
      box.applyMatrix4(pose.matrix).getBoundingSphere(this.sphere);
      const color = palettes[variant % palettes.length];
      const placement: Placement = {
        kind,
        matrix: pose.matrix.clone(),
        centre: this.sphere.center.clone(),
        radius: this.sphere.radius,
        tint: new T.Color().setRGB(color[0] / 0.115, color[1] / 0.28, color[2] / 0.275),
        near: false,
        distance: 0,
      };
      this.placements.push(placement);
      const key = `${Math.floor(placement.centre.x / CELL)},${Math.floor(placement.centre.z / CELL)}`;
      const list = this.cells.get(key);
      if (list) list.push(placement);
      else this.cells.set(key, [placement]);
    };
    for (const s of structures) {
      if (!['shop', 'block', 'house'].includes(s.kind) || s.hx < 3 || s.height < 3.5) continue;
      world.network.nearest(s.x, s.z, p);
      const c = Math.cos(s.heading),
        n = Math.sin(s.heading);
      const side = (p.x - s.x) * -n + (p.z - s.z) * c >= 0 ? 1 : -1;
      if (s.kind !== 'house' && s.style % 5 !== 0) {
        const width = Math.min(s.hx * 1.48, 10.5);
        const bays = Math.max(1, Math.floor(width / 3.8));
        for (let i = 0; i < bays; i++)
          add(
            s,
            side,
            'awning',
            (i - (bays - 1) / 2) * (width / bays),
            3.57,
            Math.min(1.05, width / bays / 3.7),
            (s.style + i) % palettes.length,
          );
      }
      // Services occupy side bays, above the awning and below the next cornice.
      if (s.height > 5.5) add(s, side, 'service', (s.style & 1 ? -1 : 1) * (s.hx - 1.0), 4.0);
      // A 3.12 m drainage segment terminates at the first-floor collection band.
      add(s, side, 'pipe', -s.hx + 0.47, 0.15);
      if (s.hx > 8) add(s, side, 'pipe', s.hx - 0.47, 0.15);
    }
    this.stats.planned = this.placements.length;
  }

  update(camera: T.Camera, quality: QualityPreset, wetness = 0) {
    if (this.disposed) return;
    const budget = STREET_BUDGETS[quality];
    const wet = Number.isFinite(wetness) ? Math.max(0, Math.min(1, wetness)) : 0;
    for (const [material, base] of this.finishes) {
      material.color.copy(base.color).multiplyScalar(1 - wet * (base.porous ? 0.16 : 0.035));
      material.roughness =
        base.rough + (Math.max(0.28, base.rough * (base.porous ? 0.87 : 0.75)) - base.rough) * wet;
    }
    camera.updateMatrixWorld();
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    for (const kind of KINDS) this.candidates[kind].length = 0;
    this.stats.candidates = 0;
    const range = budget.range + 4;
    for (
      let x = Math.floor((camera.position.x - range) / CELL);
      x <= Math.floor((camera.position.x + range) / CELL);
      x++
    )
      for (
        let z = Math.floor((camera.position.z - range) / CELL);
        z <= Math.floor((camera.position.z + range) / CELL);
        z++
      )
        for (const placement of this.cells.get(`${x},${z}`) ?? []) {
          this.stats.candidates++;
          const distance = placement.centre.distanceTo(camera.position);
          if (distance > budget.range + placement.radius) continue;
          this.sphere.set(placement.centre, placement.radius);
          if (!this.frustum.intersectsSphere(this.sphere)) continue;
          placement.distance = distance;
          this.candidates[placement.kind].push(placement);
        }
    this.stats.nearInstances = this.stats.farInstances = this.stats.draws = 0;
    for (const kind of KINDS) {
      const near = this.batches.get(`${kind}_near`)!,
        far = this.batches.get(`${kind}_far`)!;
      let n = 0,
        f = 0;
      this.candidates[kind].sort((a, b) => a.distance - b.distance);
      for (const placement of this.candidates[kind]) {
        placement.near =
          budget.near > 0 && placement.distance < budget.detailRange + (placement.near ? 7 : 0);
        const detailed = placement.near && n < budget.near;
        if (!detailed && f >= budget.far) continue;
        const at = detailed ? n++ : f++;
        for (const batch of detailed ? near : far) {
          this.matrix.multiplyMatrices(placement.matrix, batch.local);
          batch.mesh.setMatrixAt(at, this.matrix);
          if (batch.canvas) batch.mesh.setColorAt(at, placement.tint);
        }
      }
      for (const [list, count] of [
        [near, n],
        [far, f],
      ] as const)
        for (const batch of list) {
          batch.mesh.count = count;
          batch.mesh.visible = count > 0;
          batch.mesh.instanceMatrix.needsUpdate = true;
          if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
          if (count) this.stats.draws++;
        }
      this.stats.nearInstances += n;
      this.stats.farInstances += f;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    this.source.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        materials.add(material);
    });
    for (const list of this.batches.values()) for (const batch of list) batch.mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.root.removeFromParent();
    this.root.clear();
    this.source.clear();
    this.cells.clear();
    this.placements.length = 0;
    this.batches.clear();
    this.finishes.clear();
    for (const kind of KINDS) this.candidates[kind].length = 0;
    this.stats.loaded = false;
    this.stats.nearInstances = this.stats.farInstances = this.stats.draws = 0;
  }
}
