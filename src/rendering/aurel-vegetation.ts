import { SceneryPassDetail } from './scenery-pass-detail.ts';
import * as T from 'three';
import { downloadAuthoredAsset } from './authored-download.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import manifest from './aurel-vegetation.manifest.json' with { type: 'json' };
import { Track } from '../simulation/track.ts';
import {
  aurelVegetationPlan,
  treeSeed,
  type AuthoredTree,
  type TreeVariant,
  type PlantingLayer,
  type PlantingExclusion,
} from './aurel-vegetation-plan.ts';
import { serviceSitePlan, type ServiceSite } from './venue-service-plan.ts';
import { cameraDetailDistance } from './camera-detail.ts';
import { installCanopyNormals } from './canopy-normals.ts';
import {
  CANOPY_VOLUME,
  bakeCanopyVolume,
  canopyLeafAtlas,
  installCanopyVolume,
  withCanopyShell,
} from './canopy-volume.ts';
import { installFoliageShading, installFoliageWind } from './studio/foliage-shading.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import type { Quality } from './options.ts';

export const AUREL_VEGETATION = manifest;
export const TREE_VARIANTS = Object.keys(manifest.dimensions) as TreeVariant[];
export const VEGETATION_LOD = Object.freeze({ near: 55, middle: 190, hysteresis: 0.14 });
interface VegetationDocument {
  asset: { version: string };
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: { name: string; alphaMode?: string; alphaCutoff?: number; doubleSided?: boolean }[];
}
export function vegetationDocument(bytes: Uint8Array<ArrayBuffer>): VegetationDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28 || bytes.length > 2 * 1024 * 1024)
    throw new Error('A51-A54 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    length = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    length > bytes.length - 28
  )
    throw new Error('Invalid A51-A54 GLB header');
  const d = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + length)),
  ) as VegetationDocument;
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
    throw new Error('Invalid self-contained A51-A54 library');
  const leaves = d.materials.find((m) => m.name === 'A51_A54_LEAVES');
  if (leaves?.alphaMode !== 'MASK' || leaves.alphaCutoff !== 0.45 || !leaves.doubleSided)
    throw new Error('Invalid masked foliage contract');
  for (const variant of TREE_VARIANTS) {
    if (d.nodes.filter((n) => n.name === `ROOT_${variant}`).length !== 1)
      throw new Error('Missing A51-A54 ground socket');
    for (const level of [0, 1, 2]) {
      const nodes = d.nodes.filter((n) => n.name === `${variant}_LOD${level}`);
      if (nodes.length !== 1 || nodes[0].children?.length !== 2)
        throw new Error('Invalid A51-A54 tier hierarchy');
      let triangles = 0;
      for (const child of nodes[0].children) {
        const primitives = d.meshes[d.nodes[child]?.mesh ?? -1]?.primitives;
        if (
          primitives?.length !== 1 ||
          ['POSITION', 'NORMAL', 'TEXCOORD_0'].some(
            (k) => primitives[0].attributes[k] === undefined,
          )
        )
          throw new Error('Invalid A51-A54 indexed UV geometry');
        triangles += d.accessors[primitives[0].indices]?.count / 3;
      }
      if (triangles !== manifest.triangles[variant][level])
        throw new Error('A51-A54 triangle mismatch');
    }
  }
  return d;
}

/** Hysteresis belongs to a view, not a wall-clock timer or an allocation loop. */
export function vegetationLod(distance: number, previous = 2, quality: Quality = 'high'): number {
  if (!Number.isFinite(distance) || distance < 0)
    throw new Error('Invalid vegetation detail distance');
  const scale = quality === 'low' ? 0.68 : quality === 'medium' ? 0.86 : 1,
    near = VEGETATION_LOD.near * scale,
    middle = VEGETATION_LOD.middle * scale,
    h = VEGETATION_LOD.hysteresis;
  if (previous === 0 && distance < near * (1 + h)) return 0;
  if (previous === 1 && distance > near * (1 - h) && distance < middle * (1 + h)) return 1;
  if (previous === 2 && distance > middle * (1 - h)) return 2;
  return distance < near ? 0 : distance < middle ? 1 : 2;
}
export const TREE_FAMILIES: readonly (readonly [TreeVariant, TreeVariant])[] = [
  ['broadleaf-young', 'broadleaf-mature'],
  ['columnar-young', 'columnar-mature'],
  ['orchard-open', 'orchard-row-end'],
];
const familyOf = (variant: TreeVariant) => TREE_FAMILIES.find((pair) => pair.includes(variant))!;
/** Paired forms share a draw, not a silhouette. Both complete authored vertex
 * streams are retained; a binary per-instance selector chooses position, normal
 * and UV consistently in colour, sun-shadow and point-shadow programs. */
export function installTreeVariants(material: T.Material) {
  const previous = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
#ifdef USE_INSTANCING
attribute float treeVariant;
attribute vec3 treePosition;
attribute vec3 treeNormal;
attribute vec2 treeUv;
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
transformed = mix(position, treePosition, treeVariant);
#endif`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
#ifdef USE_INSTANCING
objectNormal = mix(normal, treeNormal, treeVariant);
#endif`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_INSTANCING
#ifdef USE_MAP
vMapUv = (mapTransform * vec3(mix(uv, treeUv, treeVariant), 1.)).xy;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv = (normalMapTransform * vec3(mix(uv, treeUv, treeVariant), 1.)).xy;
#endif
#endif`,
      );
  };
  material.customProgramCacheKey = () => `${key}-aurel-paired-tree-streams-v1`;
}
interface Range {
  start: number;
  count: number;
}
interface Template {
  geometry: T.BufferGeometry;
  material: T.MeshStandardMaterial;
  ranges: Range[];
  foliage: boolean;
}
export interface VegetationChunk {
  layer: PlantingLayer;
  variant: TreeVariant;
  sphere: T.Sphere;
  level: number;
  trees: number;
  meshes: T.InstancedMesh[];
  templates: Template[];
}
function releaseSource(source: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  source.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  const images = new Set<unknown>();
  textures.forEach((t) => {
    images.add(t.image);
    t.dispose();
  });
  for (const image of images)
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
}

export class AurelVegetationKit {
  readonly root = new T.Group();
  readonly chunks: VegetationChunk[] = [];
  readonly templates = new Map<TreeVariant, Template[]>();
  readonly depth: T.MeshDepthMaterial;
  readonly distance: T.MeshDistanceMaterial;
  sites: readonly AuthoredTree[] = [];
  private disposed = false;
  private built = false;
  private quality: Quality = 'high';
  private primaryCamera: T.Camera | null = null;
  private readonly eye = new T.Vector3();
  private readonly centre = new T.Vector3();
  private readonly passDetail = new SceneryPassDetail();

  constructor(private readonly source: T.Group) {
    this.root.name = 'A51-A54 authored Aurel planting';
    source.updateMatrixWorld(true);
    const foliageMesh = source.getObjectByName('broadleaf-young_LOD0_LEAVES');
    if (
      !(foliageMesh instanceof T.Mesh) ||
      !(foliageMesh.material instanceof T.MeshStandardMaterial)
    )
      throw new Error('Missing A51-A54 foliage material');
    const foliage = foliageMesh.material;
    foliage.alphaTest = manifest.alphaCutoff;
    foliage.transparent = false;
    foliage.depthWrite = true;
    foliage.side = T.DoubleSide;
    if (foliage.map) foliage.map.userData.foliageAlphaCutoff = manifest.alphaCutoff;
    installTreeVariants(foliage);
    installCanopyNormals(foliage);
    // D11: canopy grade, leaf translucency and wind (also on the shadow materials).
    installFoliageShading(foliage);
    installFoliageWind(foliage);
    // Crown occlusion, clumps and rim back-scatter over the baked crown normals.
    installCanopyVolume(foliage);
    tagWeatherSurface(foliage, 'foliage');
    // Original leaf-cluster atlas and per-leaf normals replace the flat sprays
    // (same tile layout and UVs). Without a DOM (unit tests) the export stays.
    const atlas = foliage.map ? canopyLeafAtlas(foliage.map.image?.width || 1024) : null;
    if (atlas && foliage.map) {
      const exported = foliage.map.image as unknown;
      foliage.map.image = atlas.color;
      foliage.map.needsUpdate = true;
      if (typeof ImageBitmap !== 'undefined' && exported instanceof ImageBitmap) exported.close();
      const normalMap = new T.CanvasTexture(atlas.normal);
      normalMap.flipY = false;
      normalMap.colorSpace = T.NoColorSpace;
      normalMap.anisotropy = 8;
      foliage.normalMap = normalMap;
      foliage.normalScale.set(1, 1);
      foliage.roughness = CANOPY_VOLUME.roughness;
    }
    // Multisampled targets resolve leaf edges by coverage instead of a hard
    // alpha-test stair; without MSAA this is the same 0.45 cut.
    foliage.alphaToCoverage = true;
    this.depth = new T.MeshDepthMaterial({
      depthPacking: T.RGBADepthPacking,
      map: foliage.map,
      alphaTest: foliage.alphaTest,
      side: T.DoubleSide,
    });
    this.distance = new T.MeshDistanceMaterial({
      map: foliage.map,
      alphaTest: foliage.alphaTest,
      side: T.DoubleSide,
    });
    installTreeVariants(this.depth);
    installTreeVariants(this.distance);
    installFoliageWind(this.depth);
    installFoliageWind(this.distance);
    const configured = new Set<T.Material>([foliage]);
    try {
      for (const family of TREE_FAMILIES) {
        const parts: Template[] = [];
        for (const variant of family) this.templates.set(variant, parts);
        for (const part of ['BARK', 'LEAVES']) {
          const packed: T.BufferGeometry[] = [],
            ranges: Range[] = [];
          let material: T.MeshStandardMaterial | undefined;
          try {
            for (const variant of family) {
              const levels: T.BufferGeometry[] = [];
              let start = 0;
              try {
                for (let level = 0; level < 3; level++) {
                  const node = source.getObjectByName(`${variant}_LOD${level}_${part}`);
                  if (
                    !(node instanceof T.Mesh) ||
                    !(node.material instanceof T.MeshStandardMaterial)
                  )
                    throw new Error('Missing A51-A54 mesh/material');
                  const g = node.geometry.clone().applyMatrix4(node.matrixWorld);
                  levels.push(g);
                  if (!g.index || ['position', 'normal', 'uv'].some((k) => !g.getAttribute(k)))
                    throw new Error('Invalid A51-A54 attributes');
                  for (const name of ['position', 'normal', 'uv'])
                    if (!Array.from(g.getAttribute(name).array).every(Number.isFinite))
                      throw new Error('Non-finite A51-A54 geometry');
                  g.computeBoundingBox();
                  const b = manifest.bounds[variant],
                    d = manifest.dimensions[variant],
                    allowed = new T.Box3(
                      new T.Vector3().fromArray(b.min).addScalar(-1e-4),
                      new T.Vector3().fromArray(b.max).addScalar(1e-4),
                    );
                  if (!allowed.containsBox(g.boundingBox!))
                    throw new Error('A51-A54 geometry outside declared crown');
                  // Triangle-order packing supports distinct vertex indexing in the
                  // two exports. The selector is binary, never interpolated.
                  const shell = part === 'LEAVES' && level < CANOPY_VOLUME.shellLevels,
                    count = g.index.count * (shell ? 2 : 1);
                  if (variant === family[0]) ranges.push({ start, count });
                  else if (count !== ranges[level].count)
                    throw new Error('A51-A54 paired topology budget mismatch');
                  start += count;
                  g.scale(1 / d.width, 1 / d.height, 1 / d.width);
                  const expanded = g.toNonIndexed();
                  g.dispose();
                  // Near tier: an inner shell of the same cards fills the crown.
                  levels[level] = shell ? withCanopyShell(expanded) : expanded;
                  if (shell) expanded.dispose();
                  material = node.material;
                }
                const geometry = mergeGeometries(levels, false);
                if (!geometry) throw new Error('Unable to pack A51-A54 tiers');
                packed.push(geometry);
              } finally {
                levels.forEach((g) => g.dispose());
              }
            }
            if (!material) throw new Error('Missing paired tree material');
            const geometry = packed[0],
              alternate = packed[1];
            if (part === 'LEAVES') {
              // Crown normals, occlusion, rim and clumps, per variant stream.
              const seed = TREE_FAMILIES.indexOf(family) * 2;
              const own = bakeCanopyVolume(
                geometry.getAttribute('position'),
                geometry.getAttribute('normal'),
                ranges,
                seed,
              );
              const other = bakeCanopyVolume(
                alternate.getAttribute('position'),
                alternate.getAttribute('normal'),
                ranges,
                seed + 1,
              );
              geometry.setAttribute('canopy', new T.BufferAttribute(own, 3));
              geometry.setAttribute('treeCanopy', new T.BufferAttribute(other, 3));
            }
            geometry.setAttribute('treePosition', alternate.getAttribute('position'));
            geometry.setAttribute('treeNormal', alternate.getAttribute('normal'));
            geometry.setAttribute('treeUv', alternate.getAttribute('uv'));
            geometry.setIndex(
              Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i),
            );
            geometry.computeBoundingBox();
            alternate.computeBoundingBox();
            geometry.boundingBox!.union(alternate.boundingBox!);
            geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new T.Sphere());
            parts.push({ geometry, material, ranges, foliage: part === 'LEAVES' });
            if (!configured.has(material)) {
              installTreeVariants(material);
              configured.add(material);
            }
            if (part === 'BARK') tagWeatherSurface(material, 'timber');
            for (const value of Object.values(material))
              if (value instanceof T.Texture) value.userData.immutableAssetTexture = true;
            // The alternate attributes now belong to the retained combined owner.
            alternate.dispose();
            packed.length = 0;
          } finally {
            packed.forEach((g) => g.dispose());
          }
        }
      }
    } catch (error) {
      this.releaseTemplates();
      this.depth.dispose();
      this.distance.dispose();
      throw error;
    }
  }
  private releaseTemplates() {
    const geometries = new Set<T.BufferGeometry>();
    for (const parts of this.templates.values())
      for (const part of parts) geometries.add(part.geometry);
    geometries.forEach((g) => g.dispose());
    this.templates.clear();
  }

  build(
    track: Track,
    parent: T.Group,
    services: readonly ServiceSite[] = serviceSitePlan(track),
    extraExclusion?: PlantingExclusion,
  ) {
    if (this.disposed || this.built) throw new Error('A51-A54 is disposed or already installed');
    this.built = true;
    this.sites = aurelVegetationPlan(track, services, extraExclusion);
    const buckets = new Map<string, AuthoredTree[]>();
    for (const tree of this.sites) {
      const size = tree.layer === 'treeline' ? 700 : tree.layer === 'grove' ? 240 : 160,
        key = `${tree.layer}:${familyOf(tree.variant)[0]}:${Math.floor(tree.x / size)}:${Math.floor(tree.z / size)}`,
        list = buckets.get(key);
      if (list) list.push(tree);
      else buckets.set(key, [tree]);
    }
    const transform = new T.Object3D(),
      color = new T.Color();
    for (const [key, unsorted] of buckets) {
      // Prefix density keeps a spatial sample, not the first several orchard rows.
      const list = unsorted.slice().sort((a, b) => treeSeed(a.x, a.z) - treeSeed(b.x, b.z)),
        first = list[0],
        parts = this.templates.get(first.variant)!,
        chunk: VegetationChunk = {
          layer: first.layer,
          variant: first.variant,
          sphere: new T.Sphere(),
          level: 2,
          trees: list.length,
          meshes: [],
          templates: parts,
        },
        bounds = new T.Box3(),
        selectors = new T.InstancedBufferAttribute(
          new Float32Array(list.map((t) => (t.variant === familyOf(t.variant)[0] ? 0 : 1))),
          1,
        );
      for (const part of parts) {
        const geometry = new T.BufferGeometry();
        for (const [name, attribute] of Object.entries(part.geometry.attributes))
          geometry.setAttribute(name, attribute);
        geometry.setAttribute('treeVariant', selectors);
        geometry.setIndex(part.geometry.index);
        geometry.boundingBox = part.geometry.boundingBox!.clone();
        geometry.boundingSphere = part.geometry.boundingSphere!.clone();
        geometry.setDrawRange(part.ranges[2].start, part.ranges[2].count);
        const mesh = new T.InstancedMesh(geometry, part.material, list.length);
        mesh.name = `A51-A54 ${part.foliage ? 'Canopy' : 'Branches'} ${key}`;
        mesh.userData.fullCount = list.length;
        mesh.userData.vegetationLayer = first.layer;
        mesh.castShadow = first.layer === 'near' || first.layer === 'orchard';
        mesh.receiveShadow = true;
        if (part.foliage) {
          mesh.customDepthMaterial = this.depth;
          mesh.customDistanceMaterial = this.distance;
        }
        list.forEach((tree, i) => {
          const seed = treeSeed(tree.x, tree.z);
          transform.position.set(tree.x, tree.y, tree.z);
          transform.rotation.set(0, tree.yaw, 0);
          transform.scale.set(tree.width, tree.height, tree.width);
          transform.updateMatrix();
          mesh.setMatrixAt(i, transform.matrix);
          const variation = 0.87 + (seed % 17) / 100;
          mesh.setColorAt(
            i,
            part.foliage
              ? color.setRGB(
                  variation,
                  variation * (0.96 + (seed % 5) * 0.01),
                  variation * (0.82 + (seed % 7) * 0.025),
                )
              : color.setRGB(variation, variation, variation),
          );
        });
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        bounds.union(mesh.boundingBox!);
        mesh.onBeforeRender = (renderer, _scene, camera) => this.select(chunk, camera, renderer);
        // Three passes the viewing camera third and the actual light camera fourth.
        mesh.onBeforeShadow = (renderer, _object, _viewCamera, shadowCamera) =>
          this.select(chunk, shadowCamera, renderer);
        this.root.add(mesh);
        chunk.meshes.push(mesh);
      }
      bounds.getBoundingSphere(chunk.sphere);
      this.chunks.push(chunk);
    }
    parent.add(this.root);
    parent.userData.treeCount = this.sites.filter(
      (t) => t.layer === 'near' || t.layer === 'orchard',
    ).length;
    parent.userData.orchardTrees = this.sites.filter((t) => t.layer === 'orchard').length;
    parent.userData.groveTrees = this.sites.filter((t) => t.layer === 'grove').length;
    parent.userData.treelineTrees = this.sites.filter((t) => t.layer === 'treeline').length;
  }
  private select(chunk: VegetationChunk, camera: T.Camera, renderer?: T.WebGLRenderer | null) {
    if (this.disposed) return;
    let level = 2;
    if (
      camera instanceof T.PerspectiveCamera ||
      (camera instanceof T.OrthographicCamera && renderer)
    ) {
      camera.getWorldPosition(this.eye);
      this.centre.copy(chunk.sphere.center).applyMatrix4(this.root.matrixWorld);
      const distance = Math.max(
          0,
          this.eye.distanceTo(this.centre) -
            chunk.sphere.radius * this.root.matrixWorld.getMaxScaleOnAxis(),
        ),
        primary = camera === this.primaryCamera;
      level = vegetationLod(
        renderer && !primary
          ? this.passDetail.distance(distance, camera, renderer)
          : cameraDetailDistance(distance, camera as T.PerspectiveCamera),
        primary ? chunk.level : -1,
        this.quality,
      );
      // Deep groves and the skyline remain economical in all view modes.
      if (chunk.layer === 'grove') level = Math.max(1, level);
      if (chunk.layer === 'treeline') level = 2;
      if (primary) chunk.level = level;
    }
    for (let i = 0; i < chunk.meshes.length; i++) {
      const range = chunk.templates[i].ranges[level];
      chunk.meshes[i].geometry.setDrawRange(range.start, range.count);
    }
  }
  update(camera: T.Camera, quality: Quality) {
    if (this.disposed) return;
    this.primaryCamera = camera;
    this.quality = quality;
    this.root.updateWorldMatrix(true, false);
    for (const chunk of this.chunks) this.select(chunk, camera);
  }
  diagnostics() {
    return {
      revision: manifest.revision,
      trees: this.sites.length,
      chunks: this.chunks.length,
      instances: this.chunks.reduce((n, c) => n + c.meshes.length, 0),
      orchard: this.sites.filter((t) => t.layer === 'orchard').length,
      tiers: [0, 1, 2].map((level) => this.chunks.filter((c) => c.level === level).length),
      finalArtApproved: false,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const chunk of this.chunks)
      for (const mesh of chunk.meshes) {
        mesh.dispose();
        mesh.geometry.dispose();
      }
    this.root.clear();
    this.chunks.length = 0;
    this.releaseTemplates();
    this.depth.dispose();
    this.distance.dispose();
    releaseSource(this.source);
  }
}

export async function decodeAurelVegetation(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
) {
  vegetationDocument(bytes);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (hash !== manifest.sha256) throw new Error('A51-A54 integrity mismatch');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new AurelVegetationKit(gltf.scene);
  } catch (error) {
    releaseSource(gltf.scene);
    throw error;
  }
}
const aborted = () => new DOMException('A51-A54 loading cancelled', 'AbortError');
export async function loadAurelVegetation(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  let asset: AurelVegetationKit | undefined;
  try {
    const bytes = await downloadAuthoredAsset({
      label: 'A51-A54',
      title: 'A51-A54 vegetation',
      bytes: manifest.bytes,
      url:
        url ??
        new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      cancelled,
      fetcher,
      aborted,
    });
    asset = await decodeAurelVegetation(bytes);
    if (cancelled()) throw aborted();
    return asset;
  } catch (error) {
    asset?.dispose();
    throw error;
  }
}
