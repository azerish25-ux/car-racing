import * as T from 'three';
import { TREE_SPECIES } from '../../simulation/open-world/placement.ts';
import { gridHeight, TILE_SIZE } from '../../simulation/open-world/terrain-tiles.ts';
import { hash01 } from '../../simulation/open-world/noise.ts';
import type { TileMeshData } from '../../workers/open-world-protocol.ts';
import type { QualityPreset } from '../options.ts';
import { chainShaderHook, injectAfter, injectBefore } from '../studio/shader-hooks.ts';
import { FLORA_ROLE, floraRole } from './flora-roles.ts';
import { bindSeasonUniforms } from './season.ts';
import { LEAF_GLSL, LEAF_VERTEX_GLSL } from './season-flora.ts';
import { FAR_CANOPY_LEVELS, TERRAIN_EXTENT } from './terrain.ts';
import { ROLE_FORM } from './vegetation.ts';

/**
 * Forest canopy beyond the planted terrain levels (FAR_CANOPY_LEVELS: 1 km
 * tiles from ~1.6 km out, to 4 km tiles): the woods of the hills read as
 * a textured mass of crowns with shadowed gaps (016, 024, 036, 043, 050,
 * 052) instead of smooth green ground. Crowns stand on the drawn tile's own
 * surface where its forest weight carries trees, at the near placement's
 * density (placement.ts: forest × 0.62 per 8 m cell) gathered into fewer,
 * wider crowns per coarser level, off roads, towns, rock, sand, snow and
 * above the tree line; species, form and season follow the near trees
 * (floraRole, ROLE_FORM, owLeafSeason). Drawing only: no collider exists or
 * is needed this far out (the planted levels carry the trunks the physics
 * collides with). One camera-facing quad per crown, one instanced draw per
 * tile, the crown shape, its lobes, clumps and sphere-like lighting drawn in
 * the fragment shader.
 */
export const FAR_CANOPY = Object.freeze({
  /** Crown spacing (m) on terrain levels 2, 3 and 4. */
  spacing: Object.freeze([9, 14, 22] as const),
  /** Spacing multiplier per preset (LOW draws none). */
  tier: Object.freeze({ low: 0, medium: 1.15, high: 1, ultra: 0.9 } as Record<
    QualityPreset,
    number
  >),
  /** Tiles planned per frame at least, and more within this budget (ms). */
  buildsPerFrame: 1,
  budgetMs: 3,
  /** Floats per crown: x, ground y, z, height, width, role, hash, tint. */
  stride: 8,
});

const ORIGIN = -TERRAIN_EXTENT / 2;
const res = (level: number) => (level <= 2 ? 64 : 32);

/** Crowns of one far tile (pure; unit-tested): see FAR_CANOPY.stride. */
export function planCanopyTile(
  data: TileMeshData,
  level: number,
  ix: number,
  iz: number,
  spacingScale = 1,
): Float32Array {
  const size = TILE_SIZE * 2 ** level,
    r = res(level),
    side = r + 1,
    step = size / r,
    x0 = ORIGIN + ix * size,
    z0 = ORIGIN + iz * size,
    s =
      FAR_CANOPY.spacing[
        Math.min(FAR_CANOPY.spacing.length - 1, Math.max(0, level - FAR_CANOPY_LEVELS[0]))
      ] * spacingScale,
    n = Math.floor(size / s),
    // Placement cells (8 m) gathered under one crown site.
    gather = (s / 8) ** 2,
    out: number[] = [];
  const lerp = (array: Float32Array, stride: number, k: number, fx: number, fz: number) => {
    const i = Math.min(r - 1, Math.floor(fx)),
      j = Math.min(r - 1, Math.floor(fz)),
      u = fx - i,
      v = fz - j,
      a = array[(j * side + i) * stride + k],
      b = array[(j * side + i + 1) * stride + k],
      c = array[((j + 1) * side + i) * stride + k],
      d = array[((j + 1) * side + i + 1) * stride + k];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(x0 / s) + i,
        gz = Math.floor(z0 / s) + j;
      const x = x0 + (i + 0.15 + 0.7 * hash01(gx, gz, 0xfc1)) * s,
        z = z0 + (j + 0.15 + 0.7 * hash01(gz, gx, 0xfc2)) * s;
      const fx = (x - x0) / step,
        fz = (z - z0) / step;
      const forest = lerp(data.shade, 4, 1, fx, fz),
        // Open ground: rare field trees (the rest of the open planting is shrubs).
        p = forest > 0.25 ? forest * 0.62 : 0.006,
        chance = Math.min(1, p * gather),
        pick = hash01(gx, gz, 0xfc3);
      if (pick > chance) continue;
      if (
        lerp(data.shade, 4, 0, fx, fz) > 0.02 ||
        lerp(data.shade, 4, 3, fx, fz) > 0.3 ||
        lerp(data.splat, 4, 0, fx, fz) > 0.35 ||
        lerp(data.splat, 4, 2, fx, fz) > 0.3 ||
        lerp(data.splat, 4, 3, fx, fz) > 0.25
      )
        continue;
      const y = gridHeight(data.heights, side, fx, fz, step);
      if (y < 2 || y > 520) continue;
      const h2 = hash01(gx, gz, 0xfc4),
        h3 = hash01(gz, gx, 0xfc5);
      const conifer = y > 260 || (forest > 0.25 && h2 < 0.25 && y > 120);
      const species = conifer ? TREE_SPECIES.CONIFER : TREE_SPECIES.BROADLEAF,
        tree = conifer ? 11 + 13 * h3 : 9 + 9 * h3;
      const role = floraRole({ x, z, y, species, height: tree, road: 0, town: 0 });
      const [hf, wf] = ROLE_FORM[role] ?? ROLE_FORM[FLORA_ROLE.BROADLEAF];
      const height = tree * hf,
        width = height * wf * Math.sqrt(Math.max(1, p * gather));
      out.push(x, y - 0.3, z, height, width, role, hash01(gx, gz, 0xfc6), h2);
    }
  return Float32Array.from(out);
}

const CANOPY_VERTEX = /* glsl */ `
attribute vec4 fcA;
attribute vec4 fcB;
uniform vec3 fcEye;
varying vec2 vFcUv;
varying vec3 vFcRight;
varying vec3 vFcToEye;
varying float vFcTint;
${LEAF_VERTEX_GLSL}
`;
const CANOPY_FRAGMENT = /* glsl */ `
varying vec2 vFcUv;
varying vec3 vFcRight;
varying vec3 vFcToEye;
varying float vFcTint;
${LEAF_GLSL}
float fcHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fcNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fcHash(i), fcHash(i + vec2(1.0, 0.0)), u.x), mix(fcHash(i + vec2(0.0, 1.0)), fcHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 fcN;
`;

function canopyMaterial(eye: { value: T.Vector3 }) {
  const material = new T.MeshStandardMaterial({
    name: 'Festival far canopy',
    roughness: 0.92,
    metalness: 0,
    side: T.DoubleSide,
    alphaTest: 0.5,
  });
  chainShaderHook(material, 'festival-far-canopy-v1', (shader) => {
    shader.uniforms.fcEye = eye;
    bindSeasonUniforms(shader);
    injectAfter(shader, 'common', CANOPY_VERTEX, 'vertex');
    injectAfter(
      shader,
      'begin_vertex',
      /* glsl */ `{
  // A quad standing on the crown's ground point, turned to the camera.
  vec3 base = fcA.xyz;
  vec2 toEye = fcEye.xz - base.xz;
  toEye /= max(length(toEye), 1e-3);
  vec3 right = vec3(toEye.y, 0.0, -toEye.x);
  transformed = base + right * (uv.x - 0.5) * fcB.x + vec3(0.0, uv.y * fcA.w, 0.0);
  vFcUv = uv;
  vFcRight = right;
  vFcToEye = vec3(toEye.x, 0.0, toEye.y);
  vFcTint = fcB.w;
  vOwTree = vec3(fcB.y, fcB.z, 0.0);
  vOwSpeck = vec3(uv * vec2(9.0, 12.0), fcB.z * 61.0);
}`,
      'vertex',
    );
    injectAfter(shader, 'common', CANOPY_FRAGMENT, 'fragment');
    injectBefore(
      shader,
      'alphatest_fragment',
      /* glsl */ `{
  vec2 q = vFcUv;
  float role = vOwTree.x, h = vOwTree.y;
  float cover;
  vec3 n;
  if (abs(role - ${FLORA_ROLE.CEDAR}.0) < 0.5) {
    // Sugi spire: foliage nearly to the ground, ragged tiers.
    float v = q.y;
    float w = 0.5 * pow(max(0.0, 1.0 - v), 0.85) * (0.82 + 0.3 * fcNoise(vec2(v * 14.0, h * 17.0)));
    float x = (q.x - 0.5) / max(w, 1e-3);
    cover = step(abs(x), 1.0) * step(0.05, v);
    n = vec3(x * 0.8, 0.35 + 0.4 * v, sqrt(max(0.05, 1.0 - x * x * 0.64)));
  } else {
    // Rounded crown of lobes on a clear trunk (broadleaf, cherry, maple, pine).
    vec2 c = vec2(0.5, 0.6);
    vec2 d = (q - c) / vec2(0.5, 0.4);
    float best = dot(d, d);
    vec2 bestD = d;
    for (int k = 0; k < 5; k++) {
      float a = float(k) * 2.4 + h * 6.283;
      vec2 o = vec2(cos(a) * 0.3, sin(a) * 0.22 + 0.06);
      float r = 0.48 + 0.22 * fract(h * 7.0 + float(k) * 0.37);
      vec2 e = (q - c - o * vec2(1.0, 1.0)) / (vec2(0.5, 0.4) * r);
      float dd = dot(e, e);
      if (dd < best) { best = dd; bestD = e; }
    }
    best += 0.35 * (fcNoise(q * 9.0 + h * 13.0) - 0.5);
    cover = step(best, 1.0);
    n = vec3(bestD.x * 0.85, bestD.y * 0.85 + 0.25, sqrt(max(0.05, 1.0 - dot(bestD, bestD) * 0.72)));
  }
  // Leaf clumps: lit tufts and shadowed gaps inside the crown.
  float clump = fcNoise(q * vec2(7.0, 9.0) + h * 31.0) * 0.6 + fcNoise(q * vec2(17.0, 21.0) + h * 7.0) * 0.4;
  float occlusion = mix(0.55, 1.0, smoothstep(0.1, 0.85, q.y)) * mix(0.55, 1.15, clump);
  vec3 base = vec3(0.074, 0.1, 0.02) * (0.8 + 0.4 * vFcTint) * occlusion;
  owTexel = base;
  diffuseColor.rgb = owLeafSeason(base, 0.094);
  // Winter: bare deciduous crowns read as a grey-brown haze of twigs.
  if (owSeason.w > 0.5 && owDeciduous(role)) cover *= step(0.4, fcNoise(q * 23.0 + h * 5.0));
  diffuseColor.a = cover;
  fcN = normalize(n);
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_begin',
      /* glsl */ `{
  vec3 worldN = normalize(vFcRight * fcN.x + vec3(0.0, 1.0, 0.0) * fcN.y + vFcToEye * fcN.z);
  normal = normalize((viewMatrix * vec4(worldN, 0.0)).xyz);
  diffuseColor.rgb = owLeafSnow(diffuseColor.rgb, worldN.y, vec2(0.45, 0.95));
}`,
      'fragment',
    );
  });
  return material;
}

interface CanopyTile {
  key: number;
  mesh: T.Mesh | null;
  count: number;
}

export class FarCanopy {
  readonly root = new T.Group();
  readonly stats = { tiles: 0, crowns: 0 };
  private readonly eye = { value: new T.Vector3() };
  private readonly material = canopyMaterial(this.eye);
  private readonly quad: T.BufferGeometry;
  private readonly tiles = new Map<number, CanopyTile>();
  private wanted = new Map<number, { data: TileMeshData; level: number; ix: number; iz: number }>();
  private scale = FAR_CANOPY.tier.medium;
  constructor() {
    this.root.name = 'Festival far forest canopy';
    const quad = new T.BufferGeometry();
    quad.setAttribute(
      'position',
      new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3),
    );
    quad.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    quad.setAttribute(
      'normal',
      new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
    );
    quad.setIndex([0, 1, 2, 1, 3, 2]);
    this.quad = quad;
  }
  /** The drawn far tiles (TerrainStreamer.canopyTiles). */
  sync(tiles: ReadonlyMap<number, { data: TileMeshData; level: number; ix: number; iz: number }>) {
    this.wanted = new Map(tiles);
    for (const [key, tile] of this.tiles)
      if (!tiles.has(key)) {
        this.drop(tile);
        this.tiles.delete(key);
      }
  }
  private drop(tile: CanopyTile) {
    if (!tile.mesh) return;
    this.root.remove(tile.mesh);
    tile.mesh.geometry.dispose();
  }
  private build(key: number, entry: { data: TileMeshData; level: number; ix: number; iz: number }) {
    const crowns = planCanopyTile(entry.data, entry.level, entry.ix, entry.iz, this.scale);
    const count = crowns.length / FAR_CANOPY.stride;
    const tile: CanopyTile = { key, mesh: null, count };
    if (count) {
      // Own copies of the quad: disposing a tile frees only its buffers.
      const geometry = new T.InstancedBufferGeometry().copy(this.quad as T.InstancedBufferGeometry);
      const buffer = new T.InstancedInterleavedBuffer(crowns, FAR_CANOPY.stride, 1);
      geometry.setAttribute('fcA', new T.InterleavedBufferAttribute(buffer, 4, 0));
      geometry.setAttribute('fcB', new T.InterleavedBufferAttribute(buffer, 4, 4));
      geometry.instanceCount = count;
      const size = TILE_SIZE * 2 ** entry.level,
        x0 = ORIGIN + entry.ix * size,
        z0 = ORIGIN + entry.iz * size;
      geometry.boundingBox = new T.Box3(
        new T.Vector3(x0 - 20, entry.data.minY - 5, z0 - 20),
        new T.Vector3(x0 + size + 20, entry.data.maxY + 35, z0 + size + 20),
      );
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new T.Sphere());
      const mesh = new T.Mesh(geometry, this.material);
      mesh.name = `Far canopy L${entry.level} ${entry.ix},${entry.iz}`;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
      tile.mesh = mesh;
    }
    this.tiles.set(key, tile);
  }
  /** Per frame: plan pending tiles (budgeted), camera for the billboards. */
  update(camera: T.Camera, preset: QualityPreset, budgetMs: number = FAR_CANOPY.budgetMs) {
    const scale = FAR_CANOPY.tier[preset];
    this.root.visible = scale > 0;
    if (scale <= 0) return;
    if (scale !== this.scale) {
      // A new density: replan every tile.
      for (const tile of this.tiles.values()) this.drop(tile);
      this.tiles.clear();
      this.scale = scale;
    }
    camera.getWorldPosition(this.eye.value);
    // At least one tile per frame, more while the frame's planning budget lasts.
    const start = performance.now();
    let builds = FAR_CANOPY.buildsPerFrame;
    for (const [key, entry] of this.wanted) {
      if (this.tiles.has(key)) continue;
      if (builds-- <= 0 && performance.now() - start > budgetMs) break;
      this.build(key, entry);
    }
    let crowns = 0;
    for (const tile of this.tiles.values()) crowns += tile.count;
    this.stats.tiles = this.tiles.size;
    this.stats.crowns = crowns;
  }
  /** Plan every pending tile now (loading screens and scenery review). */
  flush(camera: T.Camera, preset: QualityPreset) {
    this.update(camera, preset, Infinity);
  }
  dispose() {
    for (const tile of this.tiles.values()) this.drop(tile);
    this.tiles.clear();
    this.quad.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
