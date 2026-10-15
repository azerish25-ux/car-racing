import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREE_SPECIES } from '../../simulation/open-world/placement.ts';
import { foliageAtlas, installFoliageAtlas, treeGeometry } from '../landscape.ts';
import { materials } from '../materials/index.ts';
import type { TileMeshData } from '../../workers/open-world-protocol.ts';
import { TILE_TREE_STRIDE } from './tile-data.ts';

/** A conifer crown: three stacked, irregular cone tiers (unit height). */
function coniferGeometry(segments: number, tiers: number) {
  const parts: T.BufferGeometry[] = [];
  for (let k = 0; k < tiers; k++) {
    const t = k / tiers,
      radius = 0.27 * (1 - t * 0.72),
      height = 0.48 * (1 - t * 0.35),
      base = 0.18 + t * 0.58;
    const cone = new T.ConeGeometry(radius, height, segments, 2, true);
    cone.translate(0, base + height / 2, 0);
    // Ragged, drooping edge.
    const p = cone.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) - base;
      if (y < height * 0.2) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const wobble = 1 + 0.18 * Math.sin(a * 5 + k * 1.7) + 0.08 * Math.sin(a * 11 + k);
        p.setXYZ(i, p.getX(i) * wobble, p.getY(i) - 0.03 * wobble, p.getZ(i) * wobble);
      }
    }
    cone.computeVertexNormals();
    // Crown normals lean outward and up (soft, volumetric lighting).
    const n = cone.getAttribute('normal');
    const v = new T.Vector3();
    for (let i = 0; i < n.count; i++) {
      v.set(p.getX(i), 0.35, p.getZ(i)).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    parts.push(cone);
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}
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

interface TileTrees {
  group: T.Group;
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
    conifer: T.BufferGeometry;
    coniferTrunk: T.BufferGeometry;
    coniferFar: T.BufferGeometry;
    shrub: T.BufferGeometry;
  };
  stats = { tiles: 0, instances: 0 };
  constructor() {
    this.root.name = 'Festival vegetation';
    const { leafGeometry, trunkGeometry, distantLeafGeometry } = treeGeometry();
    this.geometry = {
      leaf: leafGeometry,
      trunk: trunkGeometry,
      distant: distantLeafGeometry,
      conifer: coniferGeometry(9, 4),
      coniferTrunk: new T.CylinderGeometry(0.014, 0.03, 0.3, 6).translate(0, 0.15, 0),
      coniferFar: coniferGeometry(5, 2),
      shrub: shrubGeometry(),
    };
    this.foliage = new T.MeshStandardMaterial({ map: foliageAtlas(), side: T.DoubleSide, alphaTest: 0.45, roughness: 1 });
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
    this.needles = materials.vegetation({ color: 0x24361f, translucency: 0.2 });
    this.needles.side = T.FrontSide;
    this.shrub = materials.vegetation({ color: 0x3a4a24, translucency: 0.3 });
  }
  /** Bring the instanced tiles in line with the terrain's near tiles. */
  sync(near: ReadonlyMap<number, { data: TileMeshData; level: number }>) {
    for (const [key, tile] of this.tiles)
      if (!near.has(key)) {
        this.root.remove(tile.group);
        tile.group.traverse((o) => {
          if (o instanceof T.InstancedMesh) o.dispose();
        });
        this.tiles.delete(key);
      }
    for (const [key, entry] of near) if (!this.tiles.has(key)) this.tiles.set(key, { group: this.build(entry.data, entry.level) });
    let instances = 0;
    for (const t of this.tiles.values()) instances += t.group.userData.instances as number;
    this.stats = { tiles: this.tiles.size, instances };
  }
  private build(data: TileMeshData, level: number) {
    const group = new T.Group(),
      trees = data.trees,
      near = level === 0,
      buckets: number[][] = [[], [], []];
    for (let i = 0; i < trees.length; i += TILE_TREE_STRIDE) buckets[trees[i + 3]]?.push(i);
    const transform = new T.Object3D(),
      color = new T.Color();
    const add = (indices: number[], geometry: T.BufferGeometry, material: T.Material, kind: number, shadows: boolean) => {
      if (!indices.length) return;
      const mesh = new T.InstancedMesh(geometry, material, indices.length);
      indices.forEach((i, k) => {
        const h = trees[i + 2],
          w = kind === TREE_SPECIES.CONIFER ? h * 0.5 : kind === TREE_SPECIES.SHRUB ? h * 1.3 : h * 0.62;
        transform.position.set(trees[i], trees[i + 6] - 0.15, trees[i + 1]);
        transform.rotation.set(0, trees[i + 4], 0);
        transform.scale.set(w, h, w);
        transform.updateMatrix();
        mesh.setMatrixAt(k, transform.matrix);
        const tint = trees[i + 5];
        if (kind === TREE_SPECIES.BROADLEAF) color.setRGB(0.78 + 0.25 * tint, 0.85 + 0.15 * tint, 0.68 + 0.12 * tint);
        else color.setRGB(0.85 + 0.2 * tint, 0.9 + 0.12 * tint, 0.85 + 0.1 * tint);
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
    const [broadleaf, conifer, shrubs] = buckets;
    if (near) {
      add(broadleaf, this.geometry.leaf, this.foliage, TREE_SPECIES.BROADLEAF, true);
      add(broadleaf, this.geometry.trunk, this.bark, TREE_SPECIES.BROADLEAF, true);
      add(conifer, this.geometry.conifer, this.needles, TREE_SPECIES.CONIFER, true);
      add(conifer, this.geometry.coniferTrunk, this.bark, TREE_SPECIES.CONIFER, true);
      add(shrubs, this.geometry.shrub, this.shrub, TREE_SPECIES.SHRUB, false);
    } else {
      add(broadleaf, this.geometry.distant, this.foliage, TREE_SPECIES.BROADLEAF, false);
      add(conifer, this.geometry.coniferFar, this.needles, TREE_SPECIES.CONIFER, false);
    }
    group.userData.instances = broadleaf.length + conifer.length + (near ? shrubs.length : 0);
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
