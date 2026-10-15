/**
 * Binary little-endian PLY reader for the landscape plant meshes (float x y z
 * nx ny nz u v vertices, `list uint8 int` faces). Polygons are fanned into
 * triangles. Node only.
 */
export interface PlyMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Triangle vertex indices. */
  indices: Uint32Array;
}

const SIZES: Record<string, number> = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

function read(view: DataView, type: string, offset: number) {
  switch (type) {
    case 'char':
    case 'int8':
      return view.getInt8(offset);
    case 'uchar':
    case 'uint8':
      return view.getUint8(offset);
    case 'short':
    case 'int16':
      return view.getInt16(offset, true);
    case 'ushort':
    case 'uint16':
      return view.getUint16(offset, true);
    case 'int':
    case 'int32':
      return view.getInt32(offset, true);
    case 'uint':
    case 'uint32':
      return view.getUint32(offset, true);
    case 'float':
    case 'float32':
      return view.getFloat32(offset, true);
    case 'double':
    case 'float64':
      return view.getFloat64(offset, true);
  }
  throw new Error(`PLY: unsupported type ${type}`);
}

export function parsePly(bytes: Uint8Array): PlyMesh {
  const headerEnd = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(
    'end_header\n',
  );
  if (headerEnd < 0) throw new Error('PLY: no header');
  const header = new TextDecoder().decode(bytes.subarray(0, headerEnd)).split('\n');
  if (header[0].trim() !== 'ply' || !header[1].startsWith('format binary_little_endian'))
    throw new Error('PLY: binary little-endian expected');
  interface Element {
    name: string;
    count: number;
    properties: { name: string; type: string; list?: { count: string; item: string } }[];
  }
  const elements: Element[] = [];
  for (const line of header.slice(2)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'element') elements.push({ name: parts[1], count: +parts[2], properties: [] });
    else if (parts[0] === 'property') {
      const element = elements.at(-1)!;
      if (parts[1] === 'list')
        element.properties.push({
          name: parts[4],
          type: 'list',
          list: { count: parts[2], item: parts[3] },
        });
      else element.properties.push({ name: parts[2], type: parts[1] });
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = headerEnd + 'end_header\n'.length;
  let positions = new Float32Array(0),
    normals = new Float32Array(0),
    uvs = new Float32Array(0);
  const triangles: number[] = [];
  let indices = new Uint32Array(0);
  for (const element of elements) {
    if (element.name === 'vertex') {
      const n = element.count;
      positions = new Float32Array(n * 3);
      normals = new Float32Array(n * 3);
      uvs = new Float32Array(n * 2);
      const slot: Record<string, [Float32Array, number]> = {
        x: [positions, 0],
        y: [positions, 1],
        z: [positions, 2],
        nx: [normals, 0],
        ny: [normals, 1],
        nz: [normals, 2],
        u: [uvs, 0],
        v: [uvs, 1],
        s: [uvs, 0],
        t: [uvs, 1],
      };
      const fixed = element.properties.every((p) => !p.list);
      if (!fixed) throw new Error('PLY: list property on vertices');
      for (let i = 0; i < n; i++)
        for (const p of element.properties) {
          const value = read(view, p.type, offset);
          offset += SIZES[p.type];
          const target = slot[p.name];
          if (target) target[0][i * (target[0] === uvs ? 2 : 3) + target[1]] = value;
        }
    } else if (element.name === 'face') {
      const list = element.properties.find((p) => p.list && /vertex_ind/.test(p.name));
      if (!list || element.properties.length !== 1) throw new Error('PLY: unsupported face layout');
      const countType = list.list!.count,
        itemType = list.list!.item,
        itemSize = SIZES[itemType];
      // Fast path for triangles and quads of int32 indices.
      const out = new Uint32Array(element.count * 6);
      let k = 0;
      for (let f = 0; f < element.count; f++) {
        const count = read(view, countType, offset) as number;
        offset += SIZES[countType];
        const first = read(view, itemType, offset) as number;
        let previous = read(view, itemType, offset + itemSize) as number;
        for (let j = 2; j < count; j++) {
          const next = read(view, itemType, offset + j * itemSize) as number;
          if (k + 3 > out.length) {
            for (let m = 0; m < k; m++) triangles.push(out[m]);
            k = 0;
          }
          out[k++] = first;
          out[k++] = previous;
          out[k++] = next;
          previous = next;
        }
        offset += count * itemSize;
      }
      if (triangles.length) {
        for (let m = 0; m < k; m++) triangles.push(out[m]);
        indices = Uint32Array.from(triangles);
      } else indices = out.slice(0, k);
    } else {
      throw new Error(`PLY: unexpected element ${element.name}`);
    }
  }
  return { positions, normals, uvs, indices };
}
