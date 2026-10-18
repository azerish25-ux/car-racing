import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREE_SPECIES } from '../../simulation/open-world/placement.ts';
import { foliageAtlas, installFoliageAtlas, treeGeometry } from '../landscape.ts';
import { materials } from '../materials/index.ts';
import type { TileMeshData } from '../../workers/open-world-protocol.ts';
import { TILE_TREE_STRIDE } from './tile-data.ts';
import { FESTIVAL_PALETTE } from '../assets/sky-catalogue.ts';
import type { QualityPreset } from '../options.ts';
import { PhotoForest, type PhotoPlant } from '../vegetation/forest.ts';
import type { VegetationLibrary } from '../vegetation/library.ts';
import {
  MAX_SCALE,
  plantHash,
  plantScale,
  plantTint,
  SPECIES,
  type SpeciesId,
} from '../vegetation/species.ts';
import { encodeRole, FLORA_ROLE, floraRole } from './flora-roles.ts';
import { installSeasonBark, installSeasonFoliage } from './season-flora.ts';
import { TERRAIN_EXTENT } from './terrain.ts';
import { TILE_SIZE } from '../../simulation/open-world/terrain-tiles.ts';

function shrubGeometry() {
  const g = new T.IcosahedronGeometry(0.5, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      k = 1 + 0.22 * Math.sin(x * 9.1 + z * 5.3) + 0.12 * Math.sin(y * 13.7);
    p.setXYZ(i, x * k, Math.max(-0.1, y * 0.7 * k) + 0.32, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Japanese black pine (026, 027): flat cloud-pruned pads of needles on a
 * leaning trunk with a few bare limbs. Unit height; drawn at 0.9 x height. */
const PINE_PADS: readonly (readonly [number, number, number, number])[] = [
  [0.1, 0.9, 0.04, 0.25],
  [-0.2, 0.78, -0.06, 0.19],
  [0.3, 0.71, 0.14, 0.17],
  [0.02, 0.99, -0.12, 0.15],
  [-0.08, 0.64, 0.22, 0.13],
  [0.22, 0.84, -0.2, 0.14],
];
function pineGeometry(detail: number, pads = PINE_PADS.length) {
  const parts: T.BufferGeometry[] = [];
  for (const [x, y, z, r] of PINE_PADS.slice(0, pads)) {
    const pad = new T.IcosahedronGeometry(1, detail);
    const p = pad.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i),
        py = p.getY(i),
        pz = p.getZ(i),
        k = 1 + 0.16 * Math.sin(px * 7.1 + pz * 4.3 + y * 20) + 0.08 * Math.sin(pz * 11.3);
      // Flat underside, domed top.
      p.setXYZ(i, px * r * k, (py > 0 ? py * 0.09 : py * 0.035) * k, pz * r * k);
    }
    pad.translate(x, y, z);
    pad.computeVertexNormals();
    const n = pad.getAttribute('normal');
    const v = new T.Vector3();
    for (let i = 0; i < n.count; i++) {
      v.set(p.getX(i) - x, Math.max(0.25, (p.getY(i) - y) * 14 + 0.5), p.getZ(i) - z).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    parts.push(pad);
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}
function limb(a: T.Vector3, b: T.Vector3, r0: number, r1: number) {
  const g = new T.CylinderGeometry(r1, r0, a.distanceTo(b), 6);
  g.applyQuaternion(
    new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize()),
  );
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
/** Leaning, kinked pine trunk with limbs out to the pads. */
function pineTrunkGeometry() {
  const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  const parts = [
    limb(V(0, 0, 0), V(0.09, 0.42, 0.03), 0.034, 0.026),
    limb(V(0.09, 0.42, 0.03), V(0.04, 0.7, -0.02), 0.026, 0.019),
    limb(V(0.04, 0.7, -0.02), V(0.06, 0.95, -0.08), 0.019, 0.01),
    limb(V(0.06, 0.6, 0.0), V(-0.18, 0.77, -0.05), 0.012, 0.006),
    limb(V(0.08, 0.55, 0.03), V(0.28, 0.7, 0.13), 0.012, 0.006),
    limb(V(0.05, 0.62, 0.0), V(-0.07, 0.64, 0.2), 0.01, 0.005),
    limb(V(0.05, 0.75, -0.04), V(0.2, 0.83, -0.18), 0.01, 0.005),
  ];
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

/** Crown proportions per role: [height factor, width / height]. The width
 * ratio also picks the foliage atlas silhouette (landscape.ts foliageTile):
 * cherries the widest lobes, maples the round ones. */
const ROLE_FORM: Readonly<Record<number, readonly [number, number]>> = {
  [FLORA_ROLE.BROADLEAF]: [1, 0.86],
  [FLORA_ROLE.CHERRY]: [0.62, 1.22],
  [FLORA_ROLE.MAPLE]: [0.72, 1.0],
  [FLORA_ROLE.CEDAR]: [1.15, 0.5],
  [FLORA_ROLE.PINE]: [0.72, 0.9],
  [FLORA_ROLE.SHRUB]: [1, 1.3],
  [FLORA_ROLE.AZALEA]: [0.85, 1.45],
};
/** Photographic species per role (the shipped CC BY plants recoloured by the
 * season shader): fine pinnate rowan leaves read as blossom, palmate
 * chestnut leaves as maple, firs as cedar and pine stands. */
const ROLE_SPECIES: Readonly<Record<number, readonly SpeciesId[]>> = {
  [FLORA_ROLE.BROADLEAF]: [SPECIES.linden, SPECIES.linden, SPECIES.chestnut, SPECIES.birch],
  [FLORA_ROLE.CHERRY]: [SPECIES.rowan, SPECIES.linden],
  [FLORA_ROLE.MAPLE]: [SPECIES.chestnut, SPECIES.rowan],
  [FLORA_ROLE.CEDAR]: [SPECIES.fir, SPECIES.firB],
  [FLORA_ROLE.PINE]: [SPECIES.firB, SPECIES.fir],
};

/** Tile placement data plus where its tile lies (shade sampling). */
export interface VegetationTile {
  data: TileMeshData;
  level: number;
  ix?: number;
  iz?: number;
}
/** Role of every tree of a tile (TILE_TREE_STRIDE order). */
export function tileRoles(tile: VegetationTile) {
  const { data, level } = tile,
    trees = data.trees,
    out = new Uint8Array(trees.length / TILE_TREE_STRIDE);
  const size = TILE_SIZE * 2 ** level,
    res = Math.round(Math.sqrt(data.heights.length)) - 1,
    step = size / Math.max(1, res),
    known = tile.ix !== undefined && tile.iz !== undefined,
    x0 = -TERRAIN_EXTENT / 2 + (tile.ix ?? 0) * size,
    z0 = -TERRAIN_EXTENT / 2 + (tile.iz ?? 0) * size;
  for (let i = 0, k = 0; i < trees.length; i += TILE_TREE_STRIDE, k++) {
    const x = trees[i],
      z = trees[i + 1];
    let road = 0,
      town = 0;
    if (known) {
      const gi = Math.min(res, Math.max(0, Math.round((x - x0) / step))),
        gj = Math.min(res, Math.max(0, Math.round((z - z0) / step))),
        reach = Math.max(1, Math.round(9 / step));
      town = data.shade[(gj * (res + 1) + gi) * 4 + 3];
      // Road carving within ~9 m: the trees beside the road (placement keeps
      // them 4.5 m clear of the usable edge, where the carve has faded).
      for (let dj = -reach; dj <= reach; dj++)
        for (let di = -reach; di <= reach; di++) {
          const i2 = gi + di,
            j2 = gj + dj;
          if (i2 >= 0 && j2 >= 0 && i2 <= res && j2 <= res)
            road = Math.max(road, data.shade[(j2 * (res + 1) + i2) * 4]);
        }
    }
    out[k] = floraRole({
      x,
      z,
      y: trees[i + 6],
      species: trees[i + 3],
      height: trees[i + 2],
      road,
      town,
    });
  }
  return out;
}

interface TileTrees {
  group: T.Group;
  forest: PhotoForest | null;
}
/**
 * Instanced vegetation on the near terrain tiles: broadleaf trees from the
 * shared foliage-card crowns and atlas (the same crowns as the circuit
 * planting), conifers as ragged stacked tiers, shrubs; full trees with
 * shadows on the finest tiles, cheap three-card impostor crowns on the next
 * level, nothing beyond (the terrain's forest tint carries the far woods).
 * Instances come from the deterministic placement the physics colliders use.
 */
export class Vegetation {
  readonly root = new T.Group();
  private readonly tiles = new Map<number, TileTrees>();
  private readonly foliage: T.MeshStandardMaterial;
  private readonly depth: T.MeshDepthMaterial;
  private readonly bark: T.MeshStandardMaterial;
  private readonly needles: T.MeshStandardMaterial;
  private readonly shrub: T.MeshStandardMaterial;
  private readonly geometry: {
    leaf: T.BufferGeometry;
    trunk: T.BufferGeometry;
    distant: T.BufferGeometry;
    pine: T.BufferGeometry;
    pineTrunk: T.BufferGeometry;
    pineFar: T.BufferGeometry;
    shrub: T.BufferGeometry;
  };
  stats = { tiles: 0, instances: 0 };
  /** Photographic trees and shrubs (null: the procedural crowns). */
  private photo: VegetationLibrary | null = null;
  constructor() {
    this.root.name = 'Festival vegetation';
    const { leafGeometry, trunkGeometry, distantLeafGeometry } = treeGeometry();
    this.geometry = {
      leaf: leafGeometry,
      trunk: trunkGeometry,
      distant: distantLeafGeometry,
      pine: pineGeometry(1),
      pineTrunk: pineTrunkGeometry(),
      pineFar: pineGeometry(0, 3),
      shrub: shrubGeometry(),
    };
    this.foliage = new T.MeshStandardMaterial({
      map: foliageAtlas(),
      side: T.DoubleSide,
      alphaTest: 0.45,
      roughness: 1,
    });
    this.foliage.name = 'Festival broadleaf foliage';
    installFoliageAtlas(this.foliage);
    this.depth = new T.MeshDepthMaterial({
      depthPacking: T.RGBADepthPacking,
      map: this.foliage.map,
      alphaTest: 0.45,
      side: T.DoubleSide,
    });
    installFoliageAtlas(this.depth);
    this.bark = new T.MeshStandardMaterial({ color: 0x5b5242, roughness: 1 });
    // Black pine pads: dark olive needles (026 #393f27, p80 #616a4c). Sugi
    // use the painted conifer crown cards of the foliage atlas.
    this.needles = materials.vegetation({ color: 0x2a3820, translucency: 0.2 });
    this.needles.side = T.FrontSide;
    this.shrub = materials.vegetation({ color: 0x3a4a24, translucency: 0.3 });
    // Season and planting role (flora-roles.ts) on the festival's own
    // material instances.
    installSeasonFoliage(this.foliage, {
      role: FLORA_ROLE.BROADLEAF,
      lumRef: 0.09,
      speckle: 'vec3(vMapUv * 170.0, 0.0)',
      shadows: [this.depth],
    });
    // Pad normals lean up (soft lighting): snow only on the flattest tops,
    // patchy (003: dusted, still dark green).
    installSeasonFoliage(this.needles, {
      role: FLORA_ROLE.PINE,
      lumRef: 0.034,
      speckle: 'position * 70.0',
      snowBand: [0.9, 1.15],
    });
    installSeasonFoliage(this.shrub, {
      role: FLORA_ROLE.SHRUB,
      lumRef: 0.058,
      speckle: 'position * 24.0',
    });
    installSeasonBark(this.bark);
  }
  /** Use the photographic plants for every tile built from now on (set
   * before streaming starts; null returns to the procedural crowns). */
  setPhotoLibrary(library: VegetationLibrary | null, ground?: (x: number, z: number) => number) {
    this.photo = library;
    this.ground = ground;
  }
  private ground: ((x: number, z: number) => number) | undefined;
  get photographic() {
    return !!this.photo;
  }
  /** Per frame: near-LOD switching of photographic tiles. */
  update(camera: T.Camera, preset: QualityPreset) {
    for (const tile of this.tiles.values()) tile.forest?.update(camera, preset);
  }
  /** Bring the instanced tiles in line with the terrain's near tiles. */
  sync(near: ReadonlyMap<number, VegetationTile>) {
    for (const [key, tile] of this.tiles)
      if (!near.has(key)) {
        this.root.remove(tile.group);
        tile.forest?.dispose();
        tile.group.traverse((o) => {
          if (o instanceof T.InstancedMesh) o.dispose();
        });
        this.tiles.delete(key);
      }
    for (const [key, entry] of near)
      if (!this.tiles.has(key)) {
        if (this.photo) {
          const forest = this.buildPhoto(entry);
          this.tiles.set(key, { group: forest.root, forest });
        } else this.tiles.set(key, { group: this.build(entry), forest: null });
      }
    let instances = 0;
    for (const t of this.tiles.values()) instances += t.group.userData.instances as number;
    this.stats = { tiles: this.tiles.size, instances };
  }
  /** One tile's trees and shrubs as photographic plants (all levels: the
   * shader crossfades leaf cards and impostors per plant). Species follow
   * the planting role; the role rides in the tint for the season shader. */
  private buildPhoto(tile: VegetationTile) {
    const library = this.photo!,
      trees = tile.data.trees,
      roles = tileRoles(tile),
      forest = new PhotoForest(library);
    const plants: PhotoPlant[] = [];
    const shrubs: PhotoPlant[] = [];
    const shrub = library.get(SPECIES.shrub);
    for (let i = 0, k = 0; i < trees.length; i += TILE_TREE_STRIDE, k++) {
      const kind = trees[i + 3],
        h = trees[i + 2],
        role = roles[k];
      const x = trees[i],
        z = trees[i + 1],
        y = trees[i + 6];
      if (kind === TREE_SPECIES.SHRUB) {
        if (shrub) {
          const tint = plantTint(plantHash(x, z, 41), FESTIVAL_PALETTE);
          shrubs.push({
            species: SPECIES.shrub,
            x,
            y: y - 0.1,
            z,
            scale: Math.min(2.4, Math.max(0.8, h / Math.max(0.3, shrub.info.height))),
            yaw: trees[i + 4],
            tint: [tint[0], encodeRole(tint[1], role), tint[2]],
          });
        }
        continue;
      }
      const choices = (ROLE_SPECIES[role] ?? ROLE_SPECIES[FLORA_ROLE.BROADLEAF]).filter((id) =>
        library.get(id),
      );
      if (!choices.length) continue;
      const id = choices[Math.floor(plantHash(x, z, 17) * choices.length)],
        species = library.get(id)!;
      const height = h * (ROLE_FORM[role]?.[0] ?? 1);
      const tint = plantTint(plantHash(x, z, 29), FESTIVAL_PALETTE);
      plants.push({
        species: id,
        x,
        // The trunk sinks a little into uneven ground.
        y: y - 0.12,
        z,
        scale:
          plantScale(species.info.height, height, MAX_SCALE[id]) *
          (0.94 + 0.12 * plantHash(x, z, 3)),
        yaw: trees[i + 4],
        tint: [tint[0], encodeRole(tint[1], role), tint[2]],
      });
    }
    forest.add(plants, { label: 'Festival', shadows: true, chunk: 128, ground: this.ground });
    forest.add(shrubs, { label: 'Festival shrubs', shadows: false, chunk: 128 });
    forest.root.userData.instances = forest.plants;
    forest.root.name = 'Photographic vegetation tile';
    this.root.add(forest.root);
    return forest;
  }
  private build(tile: VegetationTile) {
    const group = new T.Group(),
      { data, level } = tile,
      trees = data.trees,
      roles = tileRoles(tile),
      near = level === 0,
      // Card crowns (broadleaf, cherry, maple, cedar), pine, shrubs.
      buckets: number[][] = [[], [], []],
      roleOf = new Map<number, number>();
    for (let i = 0, k = 0; i < trees.length; i += TILE_TREE_STRIDE, k++) {
      const role = roles[k];
      roleOf.set(i, role);
      const bucket =
        role === FLORA_ROLE.PINE
          ? 1
          : role === FLORA_ROLE.SHRUB || role === FLORA_ROLE.AZALEA
            ? 2
            : 0;
      buckets[bucket].push(i);
    }
    const transform = new T.Object3D(),
      color = new T.Color();
    const add = (
      indices: number[],
      geometry: T.BufferGeometry,
      material: T.Material,
      shadows: boolean,
    ) => {
      if (!indices.length) return;
      const mesh = new T.InstancedMesh(geometry, material, indices.length);
      indices.forEach((i, k) => {
        const role = roleOf.get(i)!,
          [hf, wf] = ROLE_FORM[role] ?? [1, 0.62];
        const h = trees[i + 2] * hf,
          w = h * wf;
        transform.position.set(trees[i], trees[i + 6] - 0.15, trees[i + 1]);
        transform.rotation.set(0, trees[i + 4], 0);
        transform.scale.set(w, h, w);
        transform.updateMatrix();
        mesh.setMatrixAt(k, transform.matrix);
        const tint = trees[i + 5];
        if (role <= FLORA_ROLE.MAPLE)
          color.setRGB(0.78 + 0.25 * tint, 0.85 + 0.15 * tint, 0.68 + 0.12 * tint);
        else color.setRGB(0.85 + 0.2 * tint, 0.9 + 0.12 * tint, 0.85 + 0.1 * tint);
        color.g = encodeRole(color.g, role);
        mesh.setColorAt(k, color);
      });
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      if (material === this.foliage) mesh.customDepthMaterial = this.depth;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    };
    const [cards, pine, shrubs] = buckets;
    if (near) {
      add(cards, this.geometry.leaf, this.foliage, true);
      add(cards, this.geometry.trunk, this.bark, true);
      add(pine, this.geometry.pine, this.needles, true);
      add(pine, this.geometry.pineTrunk, this.bark, true);
      add(shrubs, this.geometry.shrub, this.shrub, false);
    } else {
      add(cards, this.geometry.distant, this.foliage, false);
      add(pine, this.geometry.pineFar, this.needles, false);
    }
    group.userData.instances = cards.length + pine.length + (near ? shrubs.length : 0);
    group.name = `Vegetation L${level}`;
    this.root.add(group);
    return group;
  }
  dispose() {
    this.sync(new Map());
    for (const g of Object.values(this.geometry)) g.dispose();
    for (const m of [this.foliage, this.depth, this.bark, this.needles, this.shrub]) m.dispose();
  }
}
