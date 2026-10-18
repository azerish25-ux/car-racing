import * as T from 'three';

/** Keep the front race graphic intact and give the unprinted reverse and
 * bevels a real two-dimensional texture footprint in the blank left margin.
 * A single UV for a whole face is singular under anisotropic filtering.
 * Extruded panels have separate corner vertices, so each face can use its
 * dominant plane without changing geometry, normals, or the front's UVs. */
export function mapUnprintedPlateBack(geometry: T.BufferGeometry) {
  if (geometry.index) throw new Error('Number-plate UVs require separate face corners');
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!,
    positions = geometry.getAttribute('position'),
    normals = geometry.getAttribute('normal'),
    uv = geometry.getAttribute('uv'),
    size = box.getSize(new T.Vector3()),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    face = new T.Vector3();
  const coordinate = (vertex: number, axis: number) =>
    (positions.getComponent(vertex, axis) - box.min.getComponent(axis)) /
    Math.max(1e-8, size.getComponent(axis));
  for (let i = 0; i < positions.count; i += 3) {
    if (normals.getZ(i) >= 0.5) continue;
    a.fromBufferAttribute(positions, i);
    b.fromBufferAttribute(positions, i + 1);
    c.fromBufferAttribute(positions, i + 2);
    face.crossVectors(b.sub(a), c.sub(a));
    const x = Math.abs(face.x),
      y = Math.abs(face.y),
      z = Math.abs(face.z),
      uAxis = z >= x && z >= y ? 0 : x >= y ? 2 : 0,
      vAxis = z >= x && z >= y ? 1 : x >= y ? 1 : 2;
    for (let vertex = i; vertex < i + 3; vertex++)
      uv.setXY(
        vertex,
        (4 + 8 * coordinate(vertex, uAxis)) / 512,
        0.36 + 0.28 * coordinate(vertex, vAxis),
      );
  }
  uv.needsUpdate = true;
}
