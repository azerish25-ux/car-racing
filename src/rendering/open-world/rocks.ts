import * as T from 'three';
import { gridHeight, TILE_SIZE } from '../../simulation/open-world/terrain-tiles.ts';
import { hash01 } from '../../simulation/open-world/noise.ts';
import type { TileMeshData } from '../../workers/open-world-protocol.ts';
import type { QualityPreset } from '../options.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { bindSeasonUniforms } from './season.ts';
import { SEASON_DECL_GLSL } from './season-flora.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';
import { TERRAIN_EXTENT } from './terrain.ts';

/**
 * Rock outcrops and boulders on the festival's steep ground and high slopes
 * (022: grey granite blocks and scree among alpine grass; 060: dark crags in
 * the snow): where the terrain's rock layer shows (slopes over ~27 deg, road
 * cuttings, the Varda massif's high ground), half sunk into the drawn tile's
 * surface, a few scattered boulders on the open high meadows. Drawing only
 * and kept clear of the roads (4 m past the usable edge on the finest tiles,
 * beyond the carving reach on the next level), on ground too steep to drive
 * across, so no collider is implied. One instanced draw per rocky tile.
 */
export const ROCKS = Object.freeze({
  /** Candidate spacing (m) on the finest and the next terrain level. */
  spacing: Object.freeze([6, 12] as const),
  /** Draw distance (m) per preset; LOW draws none. */
  range: Object.freeze({ low: 0, medium: 650, high: 950, ultra: 1300 } as Record<
    QualityPreset,
    number
  >),
  /** Floats per rock: x, y, z, size x, y, z, yaw, tilt. */
  stride: 8,
});

const ORIGIN = -TERRAIN_EXTENT / 2;

/** Rocks of one near tile (pure; unit-tested). */
export function planRockTile(data: TileMeshData, level: number, ix: number, iz: number) {
  const size = TILE_SIZE * 2 ** level,
    r = Math.round(Math.sqrt(data.heights.length)) - 1,
    side = r + 1,
    step = size / r,
    x0 = ORIGIN + ix * size,
    z0 = ORIGIN + iz * size,
    s = ROCKS.spacing[Math.min(1, level)],
    n = Math.floor(size / s),
    finest = data.cover.length === side * side * 2,
    out: number[] = [];
  const lerp = (array: Float32Array, stride: number, k: number, fx: number, fz: number) => {
    const i = Math.min(r - 1, Math.floor(fx)),
      j = Math.min(r - 1, Math.floor(fz)),
      u = fx - i,
      v = fz - j;
    return (
      (array[(j * side + i) * stride + k] * (1 - u) + array[(j * side + i + 1) * stride + k] * u) *
        (1 - v) +
      (array[((j + 1) * side + i) * stride + k] * (1 - u) +
        array[((j + 1) * side + i + 1) * stride + k] * u) *
        v
    );
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const gx = Math.round(x0 / s) + i,
        gz = Math.round(z0 / s) + j;
      const x = x0 + (i + 0.1 + 0.8 * hash01(gx, gz, 0x70c1)) * s,
        z = z0 + (j + 0.1 + 0.8 * hash01(gz, gx, 0x70c2)) * s,
        fx = (x - x0) / step,
        fz = (z - z0) / step;
      const rock = lerp(data.splat, 4, 0, fx, fz),
        pick = hash01(gx, gz, 0x70c3);
      const y = gridHeight(data.heights, side, fx, fz, step);
      // Outcrops on the rock layer; a few boulders on high open ground.
      const high = Math.max(0, Math.min(1, (y - 330) / 200)) * 0.05;
      const chance = Math.max(0, (rock - 0.32) * 0.9) + high;
      if (pick > chance) continue;
      if (lerp(data.splat, 4, 3, fx, fz) > 0.7 || lerp(data.splat, 4, 2, fx, fz) > 0.3) continue;
      if (lerp(data.shade, 4, 3, fx, fz) > 0.1) continue;
      // Clear of the roads and their cuttings (no boulder lines along a cut).
      if (finest ? lerp(data.cover, 2, 1, fx, fz) < 10 : lerp(data.shade, 4, 0, fx, fz) > 0.005)
        continue;
      if (y < 3) continue;
      // Sizes: many blocks of a metre or two, a few crags of 4-7 m.
      const h1 = hash01(gx, gz, 0x70c4),
        h2 = hash01(gz, gx, 0x70c5),
        big = h1 < 0.12 && rock > 0.55,
        base = big ? 3.5 + 3.5 * h2 : 0.6 + 1.8 * h2 * h2;
      const sx = base * (0.9 + 0.5 * hash01(gx, gz, 0x70c6)),
        sy = base * (0.55 + 0.4 * hash01(gz, gx, 0x70c7)),
        sz = base * (0.8 + 0.5 * hash01(gx + 7, gz, 0x70c8));
      // Half sunk into the slope.
      out.push(x, y - sy * 0.38, z, sx, sy, sz, h1 * 6.283, (h2 - 0.5) * 0.5);
    }
  return Float32Array.from(out);
}

/** A craggy boulder (unit radius): a subdivided sphere cut by a few
 * random planes into flat fractured faces and sharp edges, then roughened. */
function boulderGeometry(detail: number) {
  const g = new T.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position');
  const v = new T.Vector3();
  const planes: [T.Vector3, number][] = [];
  for (let k = 0; k < 9; k++) {
    const a = hash01(k, 1, 0x70d1) * Math.PI * 2,
      y = hash01(k, 2, 0x70d1) * 1.6 - 0.6;
    planes.push([
      new T.Vector3(
        Math.cos(a) * Math.sqrt(1 - y * y * 0.6),
        y,
        Math.sin(a) * Math.sqrt(1 - y * y * 0.6),
      ).normalize(),
      0.55 + 0.3 * hash01(k, 3, 0x70d1),
    ]);
  }
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    for (const [n, d] of planes) {
      const over = v.dot(n) - d;
      if (over > 0) v.addScaledVector(n, -over);
    }
    v.multiplyScalar(1 + 0.05 * Math.sin(v.x * 9.1 + v.z * 7.3) * Math.cos(v.y * 8.7));
    // Flatter top, a broad base sunk into the slope.
    v.y *= v.y > 0 ? 0.8 : 0.65;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** Granite matching the terrain rock layer (linear 0.17..0.29 grey-brown),
 * lichen and moss on the upward faces, darker cracks, snow in winter. */
function rockMaterial() {
  const material = new T.MeshStandardMaterial({
    name: 'Festival rock outcrops',
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0,
  });
  chainShaderHook(material, 'festival-rocks-v1', (shader) => {
    bindSeasonUniforms(shader);
    injectAfter(shader, 'common', `varying vec3 vRockWorld;\nvarying vec3 vRockUp;`, 'vertex');
    injectAfter(
      shader,
      'worldpos_vertex',
      /* glsl */ `
#ifdef USE_INSTANCING
vRockWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vRockUp = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
vRockWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRockUp = normalize(mat3(modelMatrix) * objectNormal);
#endif`,
      'vertex',
    );
    injectAfter(
      shader,
      'common',
      `varying vec3 vRockWorld;\nvarying vec3 vRockUp;\n${SEASON_DECL_GLSL}\n${OW_NOISE_GLSL}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      /* glsl */ `{
  vec3 w = vRockWorld;
  vec3 an = abs(normalize(vRockUp));
  // Triplanar layered noise: grain, banding and cracks.
  float nx = owFbm(w.zy * 0.9, 1.0), ny = owFbm(w.xz * 0.9, 1.0), nz = owFbm(w.xy * 0.9, 1.0);
  float grain = (nx * an.x + ny * an.y + nz * an.z) / max(an.x + an.y + an.z, 1e-3);
  float coarse = owFbm(w.xz * 0.11 + w.y * 0.07, 1.0);
  vec3 c = mix(vec3(0.17, 0.16, 0.145), vec3(0.3, 0.285, 0.255), smoothstep(0.25, 0.75, coarse));
  c *= 0.78 + 0.45 * grain;
  float crack = smoothstep(0.08, 0.0, abs(owNoise(w.xz * 0.7 + w.y * 0.9) - 0.5));
  c *= 1.0 - 0.45 * crack;
  float up = clamp(vRockUp.y, 0.0, 1.0);
  // Lichen and moss on the tops (022), dry in autumn.
  float moss = smoothstep(0.55, 0.9, up) * smoothstep(0.45, 0.7, owFbm(w.xz * 0.6 + 3.0, 1.0));
  vec3 mossC = owSeason.z > 0.5 ? vec3(0.16, 0.13, 0.06) : vec3(0.07, 0.1, 0.035);
  c = mix(c, mossC, moss * 0.7);
  // Snow on the upward faces in winter (060).
  c = mix(c, vec3(0.8, 0.82, 0.86), owSnowCover * smoothstep(0.35, 0.75, up + 0.25 * (grain - 0.5)));
  diffuseColor.rgb = c;
}`,
      'fragment',
    );
  });
  return material;
}

interface RockTile {
  mesh: T.InstancedMesh | null;
  count: number;
  centre: T.Vector3;
  radius: number;
}

export class RockOutcrops {
  readonly root = new T.Group();
  readonly stats = { tiles: 0, rocks: 0 };
  private readonly geometry = boulderGeometry(2);
  private readonly material = rockMaterial();
  private readonly tiles = new Map<number, RockTile>();
  private readonly eye = new T.Vector3();
  constructor() {
    this.root.name = 'Festival rock outcrops';
  }
  /** The drawn near tiles (TerrainStreamer.nearTiles). */
  sync(near: ReadonlyMap<number, { data: TileMeshData; level: number; ix: number; iz: number }>) {
    for (const [key, tile] of this.tiles)
      if (!near.has(key)) {
        if (tile.mesh) {
          this.root.remove(tile.mesh);
          tile.mesh.dispose();
        }
        this.tiles.delete(key);
      }
    const transform = new T.Object3D();
    for (const [key, entry] of near) {
      if (this.tiles.has(key)) continue;
      const rocks = planRockTile(entry.data, entry.level, entry.ix, entry.iz),
        count = rocks.length / ROCKS.stride,
        size = TILE_SIZE * 2 ** entry.level;
      const tile: RockTile = {
        mesh: null,
        count,
        centre: new T.Vector3(
          ORIGIN + (entry.ix + 0.5) * size,
          (entry.data.minY + entry.data.maxY) / 2,
          ORIGIN + (entry.iz + 0.5) * size,
        ),
        radius: size * 0.71,
      };
      if (count) {
        const mesh = new T.InstancedMesh(this.geometry, this.material, count);
        for (let k = 0; k < count; k++) {
          const o = k * ROCKS.stride;
          transform.position.set(rocks[o], rocks[o + 1], rocks[o + 2]);
          transform.rotation.set(rocks[o + 7], rocks[o + 6], rocks[o + 7] * 0.6, 'YXZ');
          transform.scale.set(rocks[o + 3], rocks[o + 4], rocks[o + 5]);
          transform.updateMatrix();
          mesh.setMatrixAt(k, transform.matrix);
        }
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.name = `Rock outcrops L${entry.level} ${entry.ix},${entry.iz}`;
        this.root.add(mesh);
        tile.mesh = mesh;
      }
      this.tiles.set(key, tile);
    }
  }
  /** Per frame: distance culling per tile. */
  update(camera: T.Camera, preset: QualityPreset) {
    const range = ROCKS.range[preset];
    this.root.visible = range > 0;
    if (range <= 0) return;
    camera.getWorldPosition(this.eye);
    let rocks = 0,
      tiles = 0;
    for (const tile of this.tiles.values()) {
      if (!tile.mesh) continue;
      const visible =
        Math.hypot(tile.centre.x - this.eye.x, tile.centre.z - this.eye.z) - tile.radius < range;
      tile.mesh.visible = visible;
      if (visible) {
        rocks += tile.count;
        tiles++;
      }
    }
    this.stats.rocks = rocks;
    this.stats.tiles = tiles;
  }
  dispose() {
    this.sync(new Map());
    this.geometry.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
