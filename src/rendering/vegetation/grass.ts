import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { SURFACE, trackPoint, type Track } from '../../simulation/track.ts';
import type { VegetationSpecies } from './library.ts';
import { plantHash } from './species.ts';

/**
 * Meadow grass along the circuit edge (photographed clump cards baked from
 * the landscape meadow patches): a band from the barrier foot to
 * `GRASS.band` metres beyond it on both sides, where the camera looks while
 * racing. Each clump is three crossed cards with its own atlas tile, size,
 * turn and tint; the shader sways the tips and shrinks clumps into the
 * ground at the grass distance. Instanced per 100 m chunk of lap; chunks
 * beyond the grass distance are not drawn.
 */
export const GRASS = Object.freeze({
  /** Along-track spacing of candidate rows (m). */
  step: 0.75,
  /** Band beyond the barrier (m). */
  band: 16,
  /** Candidates per row and side. */
  candidates: 8,
  /** Clump scale of the baked tile (1.4 m x 0.7 m) and its height stretch. */
  width: [0.45, 0.95] as const,
  height: [0.85, 1.2] as const,
  /** Metres of lap per instanced chunk. */
  chunk: 100,
  /** Share of a clump's height sunk into the ground (hides the baked
   * patch's soil line). */
  sink: 0.07,
});

export interface GrassClump {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  yaw: number;
  tile: number;
  tint: number;
}

export interface GrassPlanOptions {
  /** Ground height under (x, z) at lap station s and lateral l. */
  ground(s: number, l: number, x: number, z: number): number;
  /** False where nothing may grow (stands, paddock, structures, sea). */
  allow(x: number, z: number): boolean;
  /** Atlas tiles: the first `green` are green meadow, the rest late summer. */
  tiles: number;
  green: number;
  /** Share of late-summer tiles (dry palettes more). */
  dry: number;
  /** Density multiplier (0..1). */
  density?: number;
}

/** Deterministic clump placement along both edges of the lap. */
export function grassPlan(track: Track, options: GrassPlanOptions): GrassClump[] {
  const p = trackPoint(),
    q = trackPoint(),
    out: GrassClump[] = [];
  const density = clamp(options.density ?? 1, 0, 1);
  for (let k = 0, s = 0; s < track.length; k++, s = k * GRASS.step) {
    track.at(s, p);
    if (track.isCovered(s)) continue;
    for (const side of [-1, 1] as const) {
      const boundary = track.boundaryAt(p, side);
      for (let c = 0; c < GRASS.candidates; c++) {
        const h = plantHash(k, c * 2 + (side > 0 ? 1 : 0), 0x6a55);
        // Most clumps near the barrier, thinning outward; a few at its foot.
        const u = plantHash(k, c, 0x1f3 + side);
        const offset = c === 0 ? -1.1 + u * 1.0 : 0.4 + GRASS.band * u * u;
        if (h > density * (c === 0 ? 0.7 : 1 - 0.45 * (offset / GRASS.band))) continue;
        const along = (plantHash(k, c, 0x77) - 0.5) * GRASS.step;
        const l = side * (boundary + offset);
        const x = p.x + p.tx * along + p.nx * l,
          z = p.z + p.tz * along + p.nz * l;
        // The nearest section decides (hairpins, parallel legs): never on a road.
        const nl = track.nearest(x, z, q);
        const nside = nl < 0 ? -1 : 1;
        const limit = track.boundaryAt(q, nside);
        if (offset >= 0 ? Math.abs(nl) < limit + 0.3 : Math.abs(nl) < q.width + 1.5) continue;
        // At the barrier foot only on grass run-off.
        if (offset < 0 && track.runoffSurface(q, nl) !== SURFACE.GRASS) continue;
        if (!options.allow(x, z)) continue;
        const dry = plantHash(k, c, 0x5d) < options.dry;
        const tile = dry
          ? options.green +
            Math.floor(plantHash(k, c, 0x31) * Math.max(1, options.tiles - options.green))
          : Math.floor(plantHash(k, c, 0x31) * options.green);
        out.push({
          x,
          y: options.ground(q.s, nl, x, z) - 0.04,
          z,
          width: GRASS.width[0] + (GRASS.width[1] - GRASS.width[0]) * plantHash(k, c, 0x91),
          height: GRASS.height[0] + (GRASS.height[1] - GRASS.height[0]) * plantHash(k, c, 0x92),
          yaw: plantHash(k, c, 0x93) * Math.PI * 2,
          tile: Math.min(options.tiles - 1, tile),
          tint: plantHash(k, c, 0x94),
        });
      }
    }
  }
  return out;
}

/** Instanced clumps in lap chunks, drawn within the grass distance. */
export class TrackGrass {
  readonly root = new T.Group();
  private readonly chunks: { mesh: T.InstancedMesh; centre: T.Vector3; radius: number }[] = [];
  private readonly eye = new T.Vector3();
  constructor(species: VegetationSpecies, clumps: readonly GrassClump[]) {
    this.root.name = 'Photographed meadow grass';
    const grass = species.grass;
    if (!grass) throw new Error('Not a grass species');
    const height = species.info.impostorHeight,
      width = species.info.impostorHalfWidth * 2;
    const cells = new Map<string, GrassClump[]>();
    for (const clump of clumps) {
      const key = `${Math.floor(clump.x / GRASS.chunk)}:${Math.floor(clump.z / GRASS.chunk)}`;
      const list = cells.get(key);
      if (list) list.push(clump);
      else cells.set(key, [clump]);
    }
    const m = new T.Matrix4(),
      rotation = new T.Quaternion(),
      up = new T.Vector3(0, 1, 0),
      position = new T.Vector3(),
      scale = new T.Vector3(),
      color = new T.Color();
    for (const [key, list] of cells) {
      const mesh = new T.InstancedMesh(grass.geometry, grass.material, list.length);
      mesh.name = `Meadow grass ${key}`;
      const tiles = new Float32Array(list.length);
      list.forEach((clump, i) => {
        rotation.setFromAxisAngle(up, clump.yaw);
        // The unit cross spans 1 x 1: scale it to the tile's metres.
        scale.set(width * clump.width, height * clump.width * clump.height, width * clump.width);
        // The baked patch's own ground line sinks below the verge.
        m.compose(position.set(clump.x, clump.y - GRASS.sink * scale.y, clump.z), rotation, scale);
        mesh.setMatrixAt(i, m);
        const b = 0.94 + 0.24 * clump.tint;
        mesh.setColorAt(i, color.setRGB(b * (0.97 + 0.06 * clump.tint), b, b * 0.95));
        tiles[i] = clump.tile;
      });
      mesh.geometry = grass.geometry.clone();
      mesh.geometry.setAttribute('grassTile', new T.InstancedBufferAttribute(tiles, 1));
      mesh.customDepthMaterial = grass.depth;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      mesh.userData.fullCount = list.length;
      mesh.userData.photoVegetation = 'grass';
      const sphere = mesh.boundingSphere!;
      this.chunks.push({ mesh, centre: sphere.center.clone(), radius: sphere.radius });
      this.root.add(mesh);
    }
  }
  /** Chunks within `distance` (m) of the camera are drawn. */
  update(camera: T.Camera, distance: number) {
    camera.getWorldPosition(this.eye);
    for (const chunk of this.chunks)
      chunk.mesh.visible =
        distance > 0 && this.eye.distanceTo(chunk.centre) - chunk.radius < distance;
  }
  get clumps() {
    return this.chunks.reduce((n, c) => n + c.mesh.count, 0);
  }
  dispose() {
    this.root.removeFromParent();
    for (const chunk of this.chunks) {
      chunk.mesh.geometry.dispose();
      chunk.mesh.dispose();
    }
    this.chunks.length = 0;
  }
}
