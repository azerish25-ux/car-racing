import * as T from 'three';
import kit from '../assets/mx-authored-kit.mesh.json';

export type MxApparelPart = 'torso' | 'upper-arm' | 'forearm' | 'thigh' | 'shin';
export type MxAuthoredPart = MxApparelPart | 'safety-pad';
type MeshData = {
  position: number[];
  normal: number[];
  uv: number[];
  index: number[];
};

/** Original Blender-authored cloth cages baked in the existing game's metre
 * coordinates. Return separately owned buffers: disposing one rider or venue
 * must not invalidate another instance. No asynchronous load or mutable cache. */
export function mxAuthoredGeometry(part: MxAuthoredPart, detail: 'high' | 'mid' = 'high') {
  const levels: { high: MeshData; mid?: MeshData } = kit.meshes[part];
  const data = detail === 'mid' && levels.mid ? levels.mid : levels.high;
  const geometry = new T.BufferGeometry();
  geometry.name = `MX Blender-authored ${part} (${detail})`;
  geometry.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      data.position.map((value) => value * kit.positionScale),
      3,
    ),
  );
  geometry.setAttribute(
    'normal',
    new T.Float32BufferAttribute(
      data.normal.map((value) => value * kit.normalScale),
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new T.Float32BufferAttribute(
      data.uv.map((value) => value * kit.uvScale),
      2,
    ),
  );
  geometry.setIndex(data.index);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.authoring = kit.authoring.source;
  return geometry;
}
