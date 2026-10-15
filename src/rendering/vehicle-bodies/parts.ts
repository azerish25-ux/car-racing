import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Collects small static parts by material and merges each material's parts
 * into one mesh (one draw per material per LOD). Large lofts with material
 * groups are kept as their own multi-material meshes. */
export class Parts {
  private readonly lists = new Map<T.Material, T.BufferGeometry[]>();
  private readonly meshes: T.Mesh[] = [];
  add(geometry: T.BufferGeometry, material: T.Material, matrix?: T.Matrix4) {
    if (matrix) geometry.applyMatrix4(matrix);
    let list = this.lists.get(material);
    if (!list) this.lists.set(material, (list = []));
    list.push(geometry);
    return geometry;
  }
  /** A geometry with groups and one material per group index. */
  addGrouped(geometry: T.BufferGeometry, materials: readonly T.Material[], name: string) {
    const mesh = new T.Mesh(geometry, materials as T.Material[]);
    mesh.name = name;
    this.meshes.push(mesh);
    return mesh;
  }
  /** Merge into `group`; returns the meshes created. */
  build(group: T.Group, castShadow: boolean) {
    const out: T.Mesh[] = [];
    for (const [material, list] of this.lists) {
      const flat = list.map(normalize);
      const merged = flat.length === 1 ? flat[0] : mergeGeometries(flat, false);
      if (flat.length > 1) for (const g of flat) g.dispose();
      for (const g of list) if (!flat.includes(g)) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new T.Mesh(merged, material);
      mesh.name = `${material.name || material.type} parts`;
      out.push(mesh);
    }
    out.push(...this.meshes);
    for (const mesh of out) {
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.lists.clear();
    this.meshes.length = 0;
    return out;
  }
}
/** Non-indexed, with exactly position/normal/uv (zeros if missing). */
function normalize(g: T.BufferGeometry) {
  const f = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(f.attributes))
    if (name !== 'position' && name !== 'normal' && name !== 'uv') f.deleteAttribute(name);
  if (!f.getAttribute('normal')) f.computeVertexNormals();
  if (!f.getAttribute('uv'))
    f.setAttribute(
      'uv',
      new T.BufferAttribute(new Float32Array(f.getAttribute('position').count * 2), 2),
    );
  f.clearGroups();
  return f;
}
/** Place a part: translate, then rotate (Euler XYZ, radians), then scale. */
export function placed(
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  return new T.Matrix4().compose(
    new T.Vector3(x, y, z),
    new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)),
    new T.Vector3(sx, sy, sz),
  );
}
