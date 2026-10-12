import * as T from 'three';
import { Track, trackPoint } from '../../simulation/track.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  foliageAtlas,
  installFoliageAtlas,
  treeGeometry,
  type TreePlacement,
} from '../landscape.ts';
import { plantingClearance, treeSeed, type PlantingExclusion } from '../aurel-vegetation-plan.ts';
import { serviceSitePlan, type ServiceSite } from '../venue-service-plan.ts';
import { terrainFor } from '../terrain.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';
import { installFoliageShading, installFoliageWind } from './foliage-shading.ts';
import { beltTreeStream, installBeltTrees } from './belt-trees.ts';

/**
 * Forest belts (D11 forest-vegetation).
 *
 * The circuit's planting stops at isolated trees and groves 43-198 m out, so
 * every view past the barriers shows mown lawn up to bare hills. F1 25 venues
 * sit in continuous woodland. Belts fill a band `FOREST_BELTS.near`-`far`
 * metres behind the boundary on both sides of the lap with clustered,
 * jittered-grid (Poisson-like) trees: 40 % conifers 14-28 m tall, broadleaf
 * crowns 15-25 m, denser further out and gathered in clumps with glades.
 *
 * Every candidate passes the same `plantingClearance` as the authored trees
 * (stands, service areas, districts, landmark, pit straight, sea, quarry and
 * gate exclusions); belts additionally keep `near` metres from the nearest
 * boundary, so a hairpin's inside never gets trees on the run-off.
 *
 * Broadleaf crowns are the treeline's crossed crown cards over the procedural
 * atlas (coverage-preserving mips, alpha-to-coverage); conifers are solid
 * tiered whorls (belt-trees.ts) with analytic rim coverage. One InstancedMesh
 * per bucket and kind (240 m broadleaf, 480 m conifer), each with a near and
 * a far tier, `castShadow = false` (the far shadow map bakes them),
 * `userData.fullCount` for vegetation density. Canopy grade, translucency and
 * wind (D11 foliage-shading) on colour, depth and distance materials.
 */
export const FOREST_BELTS = Object.freeze({
  near: 30,
  far: 120,
  /** Grid spacing of candidates, metres (along the boundary and outward). */
  spacing: 6.5,
  bucket: 240,
  /** Conifer buckets are coarser: they are the minority and draw separately. */
  coniferBucket: 480,
  /** Buckets nearer than this (metres from the camera to the bucket's bounds)
   * draw the near tier (more whorls and branch tips, a finer crown). */
  detail: 90,
  coniferShare: 0.4,
  conifer: Object.freeze({ min: 14, max: 28, aspect: [0.36, 0.5] as const }),
  broadleaf: Object.freeze({ min: 15, max: 25, aspect: [0.95, 1.05] as const }),
});

export interface BeltTree extends TreePlacement {
  conifer: boolean;
}

function hash(a: number, b: number, c: number) {
  let h =
    Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
/** Smooth 2D value noise on a `scale`-metre lattice, 0..1. */
function valueNoise(x: number, z: number, scale: number, seed: number) {
  const u = x / scale,
    v = z / scale,
    i = Math.floor(u),
    j = Math.floor(v),
    fu = u - i,
    fv = v - j,
    su = fu * fu * (3 - 2 * fu),
    sv = fv * fv * (3 - 2 * fv);
  const a = hash(i, j, seed),
    b = hash(i + 1, j, seed),
    c = hash(i, j + 1, seed),
    d = hash(i + 1, j + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Clump density 0..1 at a point `depth` metres behind the boundary. */
export function beltDensity(x: number, z: number, depth: number, seed = 0x6a09) {
  const clumps = 0.65 * valueNoise(x, z, 70, seed) + 0.35 * valueNoise(x, z, 23, seed + 1);
  // Glades open where the clump field is low; the far edge of the band is
  // denser (a forest wall), the near edge thins into scattered trees.
  const outward = smooth(FOREST_BELTS.near, FOREST_BELTS.near + 35, depth);
  return smooth(0.3, 0.62, clumps) * (0.55 + 0.45 * outward);
}

/** Deterministic belt placements for a circuit (both sides of the lap). */
export function forestBeltPlan(
  track: Track,
  services: readonly ServiceSite[] = serviceSitePlan(track),
  extraExclusion?: PlantingExclusion,
  seed = 0x6a09,
): BeltTree[] {
  const clear = plantingClearance(track, services, extraExclusion),
    ground = terrainFor(track),
    anchor = trackPoint(),
    nearest = trackPoint(),
    trees: BeltTree[] = [];
  const step = FOREST_BELTS.spacing,
    rows = Math.floor((FOREST_BELTS.far - FOREST_BELTS.near) / step) + 1;
  for (let k = 0, s = 0; s < track.length; k++, s = k * step) {
    track.at(s, anchor);
    for (const side of [-1, 1])
      for (let row = 0; row < rows; row++) {
        const cell = k * 2 + (side > 0 ? 1 : 0);
        const jitterAlong = (hash(cell, row, seed) - 0.5) * step * 0.85,
          jitterOut = (hash(cell, row, seed + 7) - 0.5) * step * 0.85;
        const depth = FOREST_BELTS.near + row * step + jitterOut;
        const boundary = track.boundary(s, side);
        const lateral = side * (boundary + depth);
        const x = anchor.x + anchor.tx * jitterAlong + anchor.nx * lateral,
          z = anchor.z + anchor.tz * jitterAlong + anchor.nz * lateral;
        if (hash(cell, row, seed + 13) > beltDensity(x, z, depth, seed)) continue;
        // The nearest point of the whole lap decides (hairpins, return straights).
        const l = track.nearest(x, z, nearest);
        const behind = Math.abs(l) - track.boundary(nearest.s, l < 0 ? -1 : 1);
        if (behind < FOREST_BELTS.near - step * 0.5) continue;
        const h = treeSeed(x, z),
          conifer = (h % 1000) / 1000 < FOREST_BELTS.coniferShare,
          spec = conifer ? FOREST_BELTS.conifer : FOREST_BELTS.broadleaf,
          height = spec.min + (spec.max - spec.min) * (((h >>> 10) % 1000) / 1000),
          aspect =
            spec.aspect[0] + (spec.aspect[1] - spec.aspect[0]) * (((h >>> 20) % 1000) / 1000),
          width = height * aspect;
        const candidate = {
          x,
          y: ground.height(x, z),
          z,
          height,
          width,
          yaw: ((h >>> 5) % 628) / 100,
          variant: 'broadleaf-mature' as const,
          layer: 'near' as const,
          station: nearest.s,
        };
        if (!clear(candidate)) continue;
        trees.push({ x, y: candidate.y, z, height, width, yaw: candidate.yaw, conifer });
      }
  }
  return trees;
}

/** Instance tint: deep summer greens with per-tree brightness; conifers darker and bluer. */
export function beltTint(tree: BeltTree, out = new T.Color()) {
  const h = treeSeed(tree.x + 0.5, tree.z - 0.5);
  const b = 0.82 + ((h >>> 8) % 24) / 100;
  return tree.conifer
    ? out.setRGB(0.62 * b, 0.7 * b, 0.66 * b)
    : out.setRGB(0.74 * b, 0.8 * b, 0.62 * b);
}

interface BeltKit {
  name: string;
  geometry: T.BufferGeometry;
  far: { start: number; count: number };
  near: { start: number; count: number };
  material: T.Material;
  depth: T.Material;
  distance: T.Material;
}
/** Broadleaf crowns: the treeline's crossed crown cards (far) and the full
 * clumped crown (near) over the procedural atlas, with coverage-preserving
 * mips so minified leaves never fizz away into speckle. */
function broadleafKit(): BeltKit {
  const { distantLeafGeometry, leafGeometry, trunkGeometry } = treeGeometry();
  trunkGeometry.dispose();
  const geometry = mergeGeometries([distantLeafGeometry, leafGeometry], false);
  if (!geometry) throw new Error('Unable to pack forest belt crowns');
  const far = { start: 0, count: distantLeafGeometry.index!.count },
    near = { start: far.count, count: leafGeometry.index!.count };
  geometry.boundingBox = distantLeafGeometry.boundingBox!.clone().union(leafGeometry.boundingBox!);
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new T.Sphere());
  distantLeafGeometry.dispose();
  leafGeometry.dispose();
  // Let WebGL generate the shared colour/depth mip chain. A custom Canvas
  // mip upload was introduced immediately before depth-pass INVALID_OPERATION
  // errors began, so use the previously proven texture allocation path.
  const map = foliageAtlas();
  const material = new T.MeshStandardMaterial({
    map,
    side: T.DoubleSide,
    alphaTest: BELT_ALPHA_CUTOFF,
    roughness: 1,
  });
  material.name = 'Forest belt foliage';
  installFoliageAtlas(material);
  // Multisampled targets resolve card edges by coverage, not a hard stair.
  material.alphaToCoverage = true;
  installFoliageShading(material);
  installFoliageWind(material);
  tagWeatherSurface(material, 'foliage');
  const depth = new T.MeshDepthMaterial({
    depthPacking: T.RGBADepthPacking,
    map,
    alphaTest: BELT_ALPHA_CUTOFF,
    side: T.DoubleSide,
  });
  const distance = new T.MeshDistanceMaterial({
    map,
    alphaTest: BELT_ALPHA_CUTOFF,
    side: T.DoubleSide,
  });
  for (const m of [depth, distance]) {
    installFoliageAtlas(m);
    installFoliageWind(m);
  }
  return { name: 'canopy', geometry, far, near, material, depth, distance };
}
/** Conifers: solid tiered whorls (belt-trees.ts), far and near tiers. */
function coniferKit(): BeltKit {
  const { geometry, far, near } = beltTreeStream();
  // Whorl rims carry analytic coverage: alpha-to-coverage under MSAA, the
  // same 0.5 cut without it. Double-sided: a notch shows the shaded interior.
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    side: T.DoubleSide,
    alphaTest: 0.5,
    alphaToCoverage: true,
  });
  material.name = 'Forest belt conifers';
  installBeltTrees(material);
  installFoliageShading(material);
  installFoliageWind(material);
  tagWeatherSurface(material, 'foliage');
  const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
  const distance = new T.MeshDistanceMaterial();
  for (const m of [depth, distance]) installFoliageWind(m);
  return { name: 'conifers', geometry, far, near, material, depth, distance };
}
const BELT_ALPHA_CUTOFF = 0.45;

/** Build the belts into `group` (vegetationGroup). Returns the tree count. */
export function buildForestBelts(
  track: Track,
  group: T.Object3D,
  services: readonly ServiceSite[] = serviceSitePlan(track),
  extraExclusion?: PlantingExclusion,
) {
  const trees = forestBeltPlan(track, services, extraExclusion);
  if (!trees.length) return 0;
  const broadleaf = trees.filter((t) => !t.conifer),
    conifers = trees.filter((t) => t.conifer);
  if (broadleaf.length) buildBuckets(broadleaf, group, broadleafKit(), FOREST_BELTS.bucket);
  if (conifers.length) buildBuckets(conifers, group, coniferKit(), FOREST_BELTS.coniferBucket);
  group.userData.forestBeltTrees = trees.length;
  return trees.length;
}
/** One InstancedMesh per bucket; each picks its tier per view as a draw range
 * over the kit's shared streams. */
function buildBuckets(trees: readonly BeltTree[], group: T.Object3D, kit: BeltKit, size: number) {
  const { geometry: crowns, far, near } = kit;
  const buckets = new Map<string, BeltTree[]>();
  for (const tree of trees) {
    const key = `${Math.floor(tree.x / size)}:${Math.floor(tree.z / size)}`;
    const list = buckets.get(key);
    if (list) list.push(tree);
    else buckets.set(key, [tree]);
  }
  const transform = new T.Object3D(),
    color = new T.Color();
  for (const [key, list] of buckets) {
    // Each bucket owns a wrapper over the shared streams, so its draw range is
    // its own; the attributes and index are shared.
    const geometry = new T.BufferGeometry();
    for (const [name, attribute] of Object.entries(crowns.attributes))
      geometry.setAttribute(name, attribute);
    geometry.setIndex(crowns.index);
    geometry.boundingBox = crowns.boundingBox!.clone();
    geometry.boundingSphere = crowns.boundingSphere!.clone();
    geometry.setDrawRange(far.start, far.count);
    const mesh = new T.InstancedMesh(geometry, kit.material, list.length);
    mesh.name = `Forest belt ${kit.name} ${key}`;
    mesh.userData.fullCount = list.length;
    mesh.userData.forestBelt = true;
    mesh.customDepthMaterial = kit.depth;
    mesh.customDistanceMaterial = kit.distance;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    list.forEach((tree, i) => {
      transform.position.set(tree.x, tree.y, tree.z);
      transform.rotation.set(0, tree.yaw, 0);
      transform.scale.set(tree.width, tree.height, tree.width);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, beltTint(tree, color));
    });
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    const sphere = mesh.boundingSphere!.clone(),
      centre = new T.Vector3(),
      eye = new T.Vector3();
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      centre.copy(sphere.center).applyMatrix4(mesh.matrixWorld);
      const gap = camera.getWorldPosition(eye).distanceTo(centre) - sphere.radius,
        tier = gap < FOREST_BELTS.detail ? near : far;
      geometry.setDrawRange(tier.start, tier.count);
    };
    group.add(mesh);
  }
}
