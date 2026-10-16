import * as T from 'three';
import { mergeStatic } from './geometry.ts';

/** Batch only direct rigid meshes. Child groups are articulation boundaries:
 * steering, wheel spin, suspension, fingers/boots and the live dashboard are
 * never flattened into their parent. Preserve shadow flags and attribute sets. */
export function batchBikeRigidMeshes(parent: T.Group) {
  const buckets = new Map<string, T.Mesh[]>();
  for (const child of [...parent.children]) {
    if (
      !(child instanceof T.Mesh) ||
      child instanceof T.SkinnedMesh ||
      Array.isArray(child.material)
    )
      continue;
    if (child.renderOrder !== 0 || Object.keys(child.geometry.morphAttributes).length) continue;
    const attrs = Object.entries((child.geometry as T.BufferGeometry).attributes)
      .map(([key, a]) => `${key}:${a.itemSize}:${a.normalized}`)
      .sort()
      .join(',');
    const key = `${child.castShadow}/${child.receiveShadow}/${attrs}`;
    const meshes = buckets.get(key) ?? [];
    meshes.push(child);
    buckets.set(key, meshes);
  }
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const group = new T.Group();
    group.name = 'Batched rigid motorcycle detail';
    parent.add(group);
    for (const mesh of meshes) group.add(mesh);
    mergeStatic(group);
    for (const child of group.children)
      if (child instanceof T.Mesh) {
        child.castShadow = meshes[0].castShadow;
        child.receiveShadow = meshes[0].receiveShadow;
      }
  }
}
