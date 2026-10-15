import type { Controls } from '../simulation/config.ts';
import type { FestivalResult } from '../simulation/open-world/festival-events.ts';
import type {
  FestivalCommand,
  FestivalStatus,
  FreeRoamOptions,
} from '../simulation/open-world/session.ts';

/** Messages to the festival simulation worker. */
export type ToOpenWorld =
  | { type: 'init'; options: Omit<FreeRoamOptions, 'region'> }
  | { type: 'input'; input: Controls }
  | { type: 'pause'; value: boolean }
  | { type: 'command'; command: FestivalCommand }
  | { type: 'recycle'; buffer: ArrayBuffer };
/** Messages from the festival simulation worker. */
export type FromOpenWorld =
  | { type: 'ready'; buildMs: number; vehicle: string }
  | { type: 'frame'; buffer: ArrayBuffer }
  | { type: 'status'; status: FestivalStatus }
  | { type: 'result'; result: FestivalResult }
  | { type: 'error'; message: string };

/** Messages to the terrain tile worker (render meshes). */
export interface TileRequest {
  type: 'tile';
  id: number;
  /** Tile origin and size (m) and vertices per side minus one. */
  x0: number;
  z0: number;
  size: number;
  res: number;
  /** Trees for LOD0/LOD1 tiles (render density 0..1; 0 = none). */
  trees: number;
  /** Keep every tree with a trunk collider whatever `trees` is (the
   * finest level, where the car can reach them): physics collides with
   * every trunk, so each must be drawn. */
  colliders?: boolean;
}
export type ToTileWorker = TileRequest | { type: 'cancel'; id: number };
/** A built terrain tile: positions are local to the tile origin. */
export interface TileMeshData {
  type: 'tile';
  id: number;
  /** (res + 1)² heights, normals (xyz), splat weights (rock, soil, sand,
   * snow) and verge/forest/farm shading (road, forest, farm, wet). */
  heights: Float32Array;
  normals: Float32Array;
  splat: Float32Array;
  shade: Float32Array;
  /** Packed trees (TREE_STRIDE) with ground y appended per tree. */
  trees: Float32Array;
  minY: number;
  maxY: number;
  ms: number;
}
export type FromTileWorker = TileMeshData | { type: 'error'; id: number; message: string };
