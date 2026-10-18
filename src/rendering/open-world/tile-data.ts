import { gridHeight } from '../../simulation/open-world/terrain-tiles.ts';
import { smoothstep } from '../../simulation/open-world/noise.ts';
import {
  treesForTile,
  TREE_STRIDE,
  type StructureGrid,
} from '../../simulation/open-world/placement.ts';
import { TILE_SIZE } from '../../simulation/open-world/terrain-tiles.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import type { TileMeshData, TileRequest } from '../../workers/open-world-protocol.ts';

/** Metres beyond the usable road edge over which the finest tiles measure
 * the edge clearance (ground cover: mown verge, shrub bands). */
const EDGE_SPAN = 14;
/** Packed tree stride in tile data: the placement fields plus ground y. */
export const TILE_TREE_STRIDE = TREE_STRIDE + 1;

/**
 * Render data of one terrain tile (pure; runs in the tile worker): carved
 * heights from the same TerrainCarver physics uses (identical at the
 * finest level), normals, PBR layer weights by slope, height and biome
 * (rock, soil, sand, snow; grass is the remainder) and shading masks (road
 * verge, forest floor, field pattern, town/airfield ground), plus the trees
 * standing on it for the near levels and, on the finest level, the ground
 * cover masks of the grass carpet (ground-cover.ts).
 */
export function buildTileData(
  world: OpenWorld,
  structures: StructureGrid,
  req: TileRequest,
): TileMeshData {
  const start = performance.now();
  const { x0, z0, size, res } = req,
    step = size / res,
    side = res + 1,
    field = world.field,
    region = world.region;
  // One border vertex each side for normals.
  const carved = world.carver.build(x0, z0, step, res, 1, size <= TILE_SIZE ? EDGE_SPAN : 0),
    full = side + 2;
  const heights = new Float32Array(side * side),
    normals = new Float32Array(side * side * 3),
    splat = new Float32Array(side * side * 4),
    shade = new Float32Array(side * side * 4),
    // Ground cover on the finest level only (the grass carpet's reach).
    finest = size <= TILE_SIZE,
    cover = new Float32Array(finest ? side * side * 2 : 0);
  let minY = Infinity,
    maxY = -Infinity;
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const v = j * side + i,
        c = (j + 1) * full + (i + 1),
        h = carved.heights[c];
      heights[v] = h;
      minY = Math.min(minY, h);
      maxY = Math.max(maxY, h);
      const dx = (carved.heights[c + 1] - carved.heights[c - 1]) / (2 * step),
        dz = (carved.heights[c + full] - carved.heights[c - full]) / (2 * step),
        len = Math.hypot(dx, 1, dz);
      normals[v * 3] = -dx / len;
      normals[v * 3 + 1] = 1 / len;
      normals[v * 3 + 2] = -dz / len;
      const x = x0 + i * step,
        z = z0 + j * step,
        slope = Math.hypot(dx, dz),
        road = carved.road[c],
        roadDistance = carved.distance[c];
      // Layer weights.
      const snowLine = field.snowLine(x, z);
      const snow =
        smoothstep(snowLine - 25, snowLine + 35, h) * (1 - smoothstep(0.75, 1.05, slope));
      // Rock: steep ground, cuttings beside roads, high bare ground.
      // Rock in the road cuttings only: embankment fills are grassed (042,
      // 050: grass down to the guardrail).
      const cut = road > 0.05 && road < 0.98 && slope > 0.45 && carved.cut[c] > 0.4 ? 0.8 : 0;
      const rock =
        Math.max(smoothstep(0.5, 0.85, slope), cut, smoothstep(480, 620, h) * 0.45) *
        (1 - snow * 0.7);
      const coast = field.coastDistance(x, z, step);
      const valley = field.valleyAt(x, z);
      const sand =
        Math.max(
          (1 - smoothstep(region.seaLevel + 1.8, region.seaLevel + 4.2, h)) *
            (1 - smoothstep(140, 260, coast)),
          valley.distance < region.valley.channel * 1.6 ? 0.75 : 0,
        ) *
        (1 - rock);
      const town = Math.max(
        field.flatWeight('town', x, z),
        field.flatWeight('village', x, z) * 0.6,
      );
      const airfield = field.flatWeight('airfield', x, z);
      const farm =
        h < 150 ? smoothstep(0.42, 0.5, field.farmPattern(x, z)) * (1 - town) * (1 - airfield) : 0;
      // Soil: ploughed fields, bare verges and worn town ground.
      // Bare verge only on the first metres past the shoulder: Japanese
      // roads keep grass and weeds up to the edge (042, 050, 090).
      const verge = road > 0 ? smoothstep(8.5, 3.5, roadDistance) * 0.6 : 0;
      const soil = Math.min(1, farm * 0.55 + verge + town * 0.35) * (1 - rock) * (1 - sand);
      splat[v * 4] = rock;
      splat[v * 4 + 1] = soil;
      splat[v * 4 + 2] = sand;
      splat[v * 4 + 3] = snow;
      const forest = field.forestDensity(x, z);
      shade[v * 4] = road;
      shade[v * 4 + 1] = forest;
      shade[v * 4 + 2] = farm ? field.farmPattern(x, z) : 0;
      shade[v * 4 + 3] = Math.max(town, airfield);
      if (finest) {
        // Grass grows on the natural ground: not on rock, sand, snow, town
        // paving, the dusty verge, in water or inside a building; mown short
        // on the airfield (farm plots are decided per plot by the shader).
        let grass =
          (1 - smoothstep(0.15, 0.55, rock)) *
          (1 - smoothstep(0.2, 0.6, sand)) *
          (1 - snow) *
          (1 - town) *
          (1 - 0.65 * airfield) *
          (1 - 0.55 * verge);
        if (h < region.seaLevel + 1.2 || valley.channel || structures.blocks(x, z, 1)) grass = 0;
        cover[v * 2] = grass;
        cover[v * 2 + 1] = carved.edge[c];
      }
    }
  // Trees on the near levels, grounded on this tile's own surface.
  let trees = new Float32Array(0);
  if ((req.trees > 0 || req.colliders) && size <= TILE_SIZE * 2) {
    const parts: Float32Array[] = [];
    for (let tz = z0; tz < z0 + size; tz += TILE_SIZE)
      for (let tx = x0; tx < x0 + size; tx += TILE_SIZE)
        parts.push(
          treesForTile(
            world,
            Math.floor(tx / TILE_SIZE),
            Math.floor(tz / TILE_SIZE),
            structures,
            req.trees,
            !!req.colliders,
          ),
        );
    const count = parts.reduce((n, p) => n + p.length / TREE_STRIDE, 0);
    trees = new Float32Array(count * TILE_TREE_STRIDE);
    let o = 0;
    for (const part of parts)
      for (let k = 0; k < part.length; k += TREE_STRIDE) {
        for (let f = 0; f < TREE_STRIDE; f++) trees[o + f] = part[k + f];
        trees[o + TREE_STRIDE] = gridHeight(
          heights,
          side,
          (part[k] - x0) / step,
          (part[k + 1] - z0) / step,
          step,
        );
        o += TILE_TREE_STRIDE;
      }
  }
  return {
    type: 'tile',
    id: req.id,
    heights,
    normals,
    splat,
    shade,
    trees,
    cover,
    minY,
    maxY,
    ms: performance.now() - start,
  };
}
