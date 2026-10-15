/**
 * The baked vegetation geometry container (scripts/assets/vegetation/bake.ts):
 *
 *   'VEG1' | u32 JSON length | JSON (info + blob layout) | 4-byte aligned blobs
 *
 * Blobs: `cards` (CARD_FLOATS floats per crown card: centre, right, up,
 * normal, half width, half height, atlas UV rectangle u0 v0 u1 v1, flex,
 * phase), and for trees the simplified trunk (`trunkPosition`,
 * `trunkNormal`, `trunkUv`, `trunkVisibility`, `trunkIndex`). Grass ships
 * `tiles` (count, columns, rows). Plant space: metres, +Y up, trunk base at
 * the origin. Pure parsing (unit-testable without WebGL).
 */
export const CARD_FLOATS = 20;
export const VEGETATION_MAGIC = 0x31474556; // 'VEG1' little-endian

export interface VegetationInfo {
  form: 'tree' | 'shrub' | 'grass';
  height: number;
  radius: number;
  bounds: number[];
  crownCentreY: number;
  trunkTriangles: number;
  cards: number;
  cardDensity: number;
  views: number;
  impostorHalfWidth: number;
  impostorHeight: number;
  impostorColumns: number;
  impostorRows: number;
  crownAlbedo: [number, number, number];
  sourceTriangles: number;
}

export interface VegetationGeometry {
  info: VegetationInfo;
  cards: Float32Array;
  trunk: {
    position: Float32Array;
    normal: Float32Array;
    uv: Float32Array;
    visibility: Float32Array;
    index: Uint16Array | Uint32Array;
  } | null;
  tiles: Float32Array | null;
}

interface Layout {
  offset: number;
  length: number;
  type: string;
}

export function parseVegetation(bytes: Uint8Array): VegetationGeometry {
  if (bytes.byteLength < 8) throw new Error('Vegetation: truncated container');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== VEGETATION_MAGIC) throw new Error('Vegetation: bad magic');
  const length = view.getUint32(4, true);
  if (length % 4 || 8 + length > bytes.byteLength) throw new Error('Vegetation: bad header');
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + length)),
  ) as VegetationInfo & {
    version: number;
    layout: Record<string, Layout>;
  };
  if (header.version !== 1) throw new Error('Vegetation: unknown version');
  const base = 8 + length;
  // Copy each blob into its own aligned buffer (the source may be unaligned).
  const blob = (name: string) => {
    const entry = header.layout[name];
    if (!entry) return null;
    if (base + entry.offset + entry.length > bytes.byteLength)
      throw new Error(`Vegetation: blob ${name} out of range`);
    const copy = bytes.slice(base + entry.offset, base + entry.offset + entry.length).buffer;
    switch (entry.type) {
      case 'Float32Array':
        return new Float32Array(copy);
      case 'Uint16Array':
        return new Uint16Array(copy);
      case 'Uint32Array':
        return new Uint32Array(copy);
    }
    throw new Error(`Vegetation: blob ${name} has unknown type ${entry.type}`);
  };
  const cards = (blob('cards') as Float32Array | null) ?? new Float32Array(0);
  if (cards.length % CARD_FLOATS) throw new Error('Vegetation: card records');
  const position = blob('trunkPosition') as Float32Array | null;
  const trunk = position
    ? {
        position,
        normal: blob('trunkNormal') as Float32Array,
        uv: blob('trunkUv') as Float32Array,
        visibility: blob('trunkVisibility') as Float32Array,
        index: blob('trunkIndex') as Uint16Array | Uint32Array,
      }
    : null;
  if (trunk) {
    const n = trunk.position.length / 3;
    if (
      trunk.normal.length !== n * 3 ||
      trunk.uv.length !== n * 2 ||
      trunk.visibility.length !== n ||
      trunk.index.length % 3
    )
      throw new Error('Vegetation: trunk attribute counts');
    for (const i of trunk.index) if (i >= n) throw new Error('Vegetation: trunk index range');
  }
  const { layout: _layout, version: _version, ...info } = header;
  return { info, cards, trunk, tiles: blob('tiles') as Float32Array | null };
}
