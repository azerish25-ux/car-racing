import * as T from 'three';
import type { QualityPreset } from '../options.ts';
import type { VegetationLibrary, VegetationSpecies } from './library.ts';
import { VEGETATION, vegetationUniforms } from './materials.ts';
import type { SpeciesId } from './species.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';

/** One placed plant (plant space scaled uniformly, turned about +Y). */
export interface PhotoPlant {
  species: SpeciesId;
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  /** Linear albedo multiplier. */
  tint: readonly [number, number, number];
}

export interface PhotoLayerOptions {
  /** Name prefix of the meshes. */
  label: string;
  /** Near trees cast into the moving sun shadow map (impostors never do;
   * the static far map bakes them). */
  shadows: boolean;
  /** Chunk size (m) for culling and near-LOD switching. */
  chunk?: number;
  /** Ground height for the contact occlusion under each crown (its slope
   * tilts the disc); without it no disc is laid. */
  ground?: (x: number, z: number) => number;
}

/** A near-LOD mesh (cards or trunk) and its full instance data: only the
 * plants within the near distance are copied into the drawn instances. */
interface NearSet {
  mesh: T.InstancedMesh;
  matrices: Float32Array;
  colors: Float32Array | null;
  /** Plant positions (x, z) in instance order. */
  xz: Float32Array;
  /** Instances drawn after the last compaction (-1: none yet). */
  drawn: number;
}

interface Chunk {
  centre: T.Vector3;
  radius: number;
  near: NearSet[];
  far: T.InstancedMesh[];
  contact: T.InstancedMesh | null;
  plants: number;
  /** Eye of the last compaction (NaN: compact on the next frame). */
  compactedAt: T.Vector3;
}

/** Re-select the near plants after the eye moves this far (m); they are
 * selected this far beyond the near distance, so none pops in between. */
const COMPACT_STEP = 2;
const COMPACT_MARGIN = 2.5;

/** Contact occlusion: a soft dark disc on the ground under each crown (the
 * sky the crown hides from the ground beneath it), drawn within
 * `CONTACT_DISTANCE` metres. */
export const CONTACT = Object.freeze({ distance: 240, opacity: 0.42, radius: 0.85 });
let contactParts: {
  geometry: T.BufferGeometry;
  material: T.MeshBasicMaterial;
  /** Shadow passes (the far map bakes every non-casting vegetation mesh):
   * the disc never casts. */
  depth: T.MeshDepthMaterial;
} | null = null;
function contactShared() {
  if (contactParts) return contactParts;
  const size = 64,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1,
        v = ((y + 0.5) / size) * 2 - 1,
        r = Math.min(1, Math.hypot(u, v));
      const a = Math.pow(1 - r * r, 1.6);
      data.set([0, 0, 0, Math.round(a * 255)], (y * size + x) * 4);
    }
  const map = new T.DataTexture(data, size, size);
  map.magFilter = T.LinearFilter;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  const material = new T.MeshBasicMaterial({
    name: 'Crown contact occlusion',
    color: 0x000000,
    map,
    transparent: true,
    opacity: CONTACT.opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const geometry = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const depth = new T.MeshDepthMaterial();
  chainShaderHook(depth, 'crown-contact-no-shadow-v1', (shader) =>
    injectAfter(shader, 'clipping_planes_fragment', 'discard;', 'fragment'),
  );
  contactParts = { geometry, material, depth };
  return contactParts;
}

/**
 * Instanced photographic plants in spatial chunks. Every chunk draws each
 * species' impostors (one instanced quad per plant) and, while the camera is
 * within the near-LOD distance of the chunk, its leaf cards and trunks; the
 * per-plant crossfade between the two runs in the vertex/fragment shaders
 * (materials.ts), so the CPU only toggles whole chunks.
 */
export class PhotoForest {
  readonly root = new T.Group();
  private readonly chunks: Chunk[] = [];
  private readonly eye = new T.Vector3();
  private nearEnd: number = VEGETATION.near.high;
  plants = 0;

  constructor(private readonly library: VegetationLibrary) {
    this.root.name = 'Photographic planting';
  }

  add(plants: readonly PhotoPlant[], options: PhotoLayerOptions) {
    const size = options.chunk ?? 140;
    const groups = new Map<string, PhotoPlant[]>();
    for (const plant of plants) {
      if (!this.library.get(plant.species)) continue;
      const key = `${Math.floor(plant.x / size)}:${Math.floor(plant.z / size)}`;
      const list = groups.get(key);
      if (list) list.push(plant);
      else groups.set(key, [plant]);
    }
    const transform = new T.Object3D(),
      color = new T.Color();
    for (const [key, list] of groups) {
      const chunk: Chunk = {
        centre: new T.Vector3(),
        radius: 0,
        near: [],
        far: [],
        contact: null,
        plants: list.length,
        compactedAt: new T.Vector3(NaN, NaN, NaN),
      };
      const box = new T.Box3();
      const bySpecies = new Map<SpeciesId, PhotoPlant[]>();
      for (const plant of list) {
        const l = bySpecies.get(plant.species);
        if (l) l.push(plant);
        else bySpecies.set(plant.species, [plant]);
      }
      for (const [id, members] of bySpecies) {
        const species = this.library.get(id)!;
        const build = (
          geometry: T.BufferGeometry | null,
          material: T.Material | null,
          depth: T.Material | null,
          distance: T.Material | null,
          part: string,
          shadows: boolean,
        ) => {
          if (!geometry || !material) return null;
          const mesh = new T.InstancedMesh(geometry, material, members.length);
          mesh.name = `${options.label} ${species.id} ${part} ${key}`;
          members.forEach((plant, i) => {
            transform.position.set(plant.x, plant.y, plant.z);
            transform.rotation.set(0, plant.yaw, 0);
            transform.scale.setScalar(plant.scale);
            transform.updateMatrix();
            mesh.setMatrixAt(i, transform.matrix);
            mesh.setColorAt(i, color.setRGB(plant.tint[0], plant.tint[1], plant.tint[2]));
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingBox();
          mesh.computeBoundingSphere();
          mesh.userData.fullCount = members.length;
          mesh.userData.photoVegetation = part;
          mesh.castShadow = shadows;
          mesh.receiveShadow = true;
          if (depth) mesh.customDepthMaterial = depth;
          if (distance) mesh.customDistanceMaterial = distance;
          box.union(mesh.boundingBox!);
          this.root.add(mesh);
          return mesh;
        };
        const s: VegetationSpecies = species;
        const cards = build(
          s.cards,
          s.cardMaterial,
          s.cardDepth,
          s.cardDistance,
          'cards',
          options.shadows,
        );
        const trunk = build(
          s.trunk,
          s.barkMaterial,
          s.barkDepth,
          s.barkDistance,
          'trunk',
          options.shadows,
        );
        const impostor = build(
          s.impostor,
          s.impostorMaterial,
          s.impostorDepth,
          null,
          'impostor',
          false,
        );
        for (const m of [cards, trunk])
          if (m)
            chunk.near.push({
              mesh: m,
              matrices: (m.instanceMatrix.array as Float32Array).slice(),
              colors: m.instanceColor ? (m.instanceColor.array as Float32Array).slice() : null,
              xz: Float32Array.from(members.flatMap((p) => [p.x, p.z])),
              drawn: -1,
            });
        if (impostor) chunk.far.push(impostor);
      }
      if (options.ground) chunk.contact = this.contact(list, options.ground, key);
      box.getCenter(chunk.centre);
      chunk.radius = box.getSize(new T.Vector3()).length() / 2;
      this.chunks.push(chunk);
      this.plants += list.length;
    }
  }

  private contact(
    list: readonly PhotoPlant[],
    ground: (x: number, z: number) => number,
    key: string,
  ) {
    const { geometry, material, depth } = contactShared();
    const mesh = new T.InstancedMesh(geometry, material, list.length);
    mesh.customDepthMaterial = depth;
    mesh.name = `Crown contact occlusion ${key}`;
    const m = new T.Matrix4(),
      q = new T.Quaternion(),
      up = new T.Vector3(0, 1, 0),
      n = new T.Vector3(),
      p = new T.Vector3(),
      scale = new T.Vector3();
    list.forEach((plant, i) => {
      const info = this.library.get(plant.species)!.info;
      const r = Math.max(0.6, info.radius * plant.scale * CONTACT.radius);
      // Ground slope across the disc tilts it onto the terrain.
      const d = Math.min(2, r);
      const hx = ground(plant.x + d, plant.z) - ground(plant.x - d, plant.z),
        hz = ground(plant.x, plant.z + d) - ground(plant.x, plant.z - d);
      n.set(-hx / (2 * d), 1, -hz / (2 * d)).normalize();
      q.setFromUnitVectors(up, n);
      m.compose(p.set(plant.x, plant.y + 0.12, plant.z), q, scale.set(r * 2, 1, r * 2));
      mesh.setMatrixAt(i, m);
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = -1;
    mesh.userData.fullCount = list.length;
    mesh.userData.photoVegetation = 'contact';
    this.root.add(mesh);
    return mesh;
  }

  /** Per frame: shared eye and LOD distances; near chunks draw only the
   * plants within the near distance (cards and trunks of every other plant
   * would be collapsed by the shader anyway, at full vertex cost).
   * `density` (0..1) keeps the same leading share of each species as the
   * impostors' density count. */
  update(camera: T.Camera, preset: QualityPreset, density = 1) {
    camera.getWorldPosition(this.eye);
    PhotoForest.setEye(this.eye, preset);
    this.nearEnd = VEGETATION.near[preset];
    const share = Math.min(1, Math.max(0, density));
    for (const chunk of this.chunks) {
      const gap = this.eye.distanceTo(chunk.centre) - chunk.radius;
      if (chunk.contact) chunk.contact.visible = gap < CONTACT.distance;
      if (gap >= this.nearEnd + COMPACT_MARGIN) {
        for (const set of chunk.near) set.mesh.visible = false;
        chunk.compactedAt.set(NaN, NaN, NaN);
        continue;
      }
      const stale =
        !(chunk.compactedAt.distanceToSquared(this.eye) < COMPACT_STEP * COMPACT_STEP) ||
        chunk.near.some((set) => set.mesh.count !== set.drawn) ||
        share !== this.share;
      if (stale) {
        for (const set of chunk.near) this.compact(set, share);
        chunk.compactedAt.copy(this.eye);
      }
    }
    this.share = share;
  }
  private share = 1;

  private compact(set: NearSet, share: number) {
    const { mesh, matrices, colors, xz } = set;
    const total = Math.floor((xz.length / 2) * share),
      reach = this.nearEnd + COMPACT_MARGIN,
      reach2 = reach * reach,
      out = mesh.instanceMatrix.array as Float32Array,
      outColor = mesh.instanceColor?.array as Float32Array | undefined;
    let n = 0;
    for (let i = 0; i < total; i++) {
      const dx = xz[i * 2] - this.eye.x,
        dz = xz[i * 2 + 1] - this.eye.z;
      if (dx * dx + dz * dz > reach2) continue;
      out.set(matrices.subarray(i * 16, i * 16 + 16), n * 16);
      if (colors && outColor) outColor.set(colors.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    mesh.count = n;
    set.drawn = n;
    mesh.visible = n > 0;
    if (n > 0) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, n * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** Shared uniforms for every photographic plant and grass clump. */
  static setEye(eye: T.Vector3, preset: QualityPreset) {
    vegetationUniforms.vegEye.value.copy(eye);
    const near = VEGETATION.near[preset],
      grass = VEGETATION.grass[preset];
    vegetationUniforms.vegLod.value.set(near - VEGETATION.band, near, grass * 0.7, grass);
  }

  diagnostics() {
    return {
      plants: this.plants,
      chunks: this.chunks.length,
      nearChunks: this.chunks.filter((c) => c.near.some((n) => n.mesh.visible)).length,
      nearPlants: this.chunks.reduce(
        (sum, c) =>
          sum + c.near.reduce((m, n) => Math.max(m, n.mesh.visible ? n.mesh.count : 0), 0),
        0,
      ),
      species: [...this.library.species.keys()],
      failed: [...this.library.failed],
    };
  }

  dispose() {
    this.root.removeFromParent();
    for (const chunk of this.chunks)
      for (const m of [
        ...chunk.near.map((n) => n.mesh),
        ...chunk.far,
        ...(chunk.contact ? [chunk.contact] : []),
      ])
        m.dispose();
    this.chunks.length = 0;
    this.root.clear();
  }
}
