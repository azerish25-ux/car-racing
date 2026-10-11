import * as T from 'three';
import source from './aurel-people.geometry.json' with { type: 'json' };
import manifest from './aurel-people.manifest.json' with { type: 'json' };

export const PEOPLE_ASSET = Object.freeze({
  generator: manifest.generator,
  sha256: manifest.runtimeSha256,
  exchangeSha256: manifest.exchangeSha256,
  finalArtApproved: false,
});
export const CREW_BONES = 15;
/** Human-proportioned rest skeleton (1.75 m adult): the authored hip, knee,
 * ankle and head joints, with anatomically placed shoulders (biacromial
 * ~0.42 m) and arm segments (upper arm 0.34 m, forearm 0.27 m; pit-stop handles
 * beyond that reach are met by crouching). The
 * procedural bodies in human-kit.json are sculpted and weighted around it. */
const ARM_REST: Record<number, [number, number, number]> = {
  3: [-0.21, 1.42, 0],
  4: [-0.21, 1.08, 0],
  5: [-0.21, 0.81, 0],
  6: [0.21, 1.42, 0],
  7: [0.21, 1.08, 0],
  8: [0.21, 0.81, 0],
};
export const CREW_REST = source.rest.map(
  (p, i) => new T.Vector3(...(ARM_REST[i] ?? (p as [number, number, number]))),
);
export type PeopleRole = keyof typeof source.meshes;
interface MeshData {
  position: number[];
  normal: number[];
  index: number[];
  color: number[];
  triangles: number;
  joints?: number[];
  weights?: number[];
  cloth?: number[];
  crowdJoint?: number[];
  skinMask?: number[];
  accessory?: number[];
  standing?: number[];
  standingNormal?: number[];
}
let verified = false;

/** The table is exported from the retained Blender scene alongside its GLB.
 * Both startup and fixtures use these exact meshes. There is no primitive
 * fallback and no per-person network request or asynchronous model swap. */
export function verifyPeopleAsset() {
  if (verified) return;
  if (source.version !== 1 || source.units !== 'metres-Y-up' || CREW_REST.length !== CREW_BONES)
    throw new Error('Unsupported Aurel people asset');
  for (const [role, data] of Object.entries(source.meshes) as [PeopleRole, MeshData][]) {
    const vertices = data.position.length / 3;
    if (
      !Number.isInteger(vertices) ||
      vertices < 3 ||
      vertices > 20000 ||
      data.normal.length !== vertices * 3 ||
      data.color.length !== vertices * 3 ||
      data.index.length !== data.triangles * 3 ||
      manifest.triangles[role] !== data.triangles
    )
      throw new Error(`Invalid authored people topology: ${role}`);
    for (const values of Object.values(data))
      if (Array.isArray(values) && !values.every(Number.isFinite))
        throw new Error(`Nonfinite authored people data: ${role}`);
    if (data.index.some((i) => !Number.isInteger(i) || i < 0 || i >= vertices))
      throw new Error(`Invalid authored people indices: ${role}`);
    if (role.startsWith('crew_')) {
      if (
        data.joints?.length !== vertices * 4 ||
        data.weights?.length !== vertices * 4 ||
        data.cloth?.length !== vertices
      )
        throw new Error(`Missing crew skin: ${role}`);
      for (let i = 0; i < vertices; i++) {
        const weights = data.weights.slice(i * 4, i * 4 + 4);
        if (
          weights.some((w) => w < 0 || w > 1) ||
          Math.abs(weights.reduce((a, b) => a + b, 0) - 1) > 1e-5 ||
          weights[2] !== 0 ||
          weights[3] !== 0 ||
          data.joints
            .slice(i * 4, i * 4 + 4)
            .some((j) => !Number.isInteger(j) || j < 0 || j >= CREW_BONES)
        )
          throw new Error(`Invalid two-influence crew skin: ${role}`);
      }
    }
    if (role.startsWith('spectator_')) {
      if (
        data.crowdJoint?.length !== vertices ||
        data.skinMask?.length !== vertices ||
        data.accessory?.length !== vertices ||
        data.standing?.length !== vertices * 3 ||
        data.standingNormal?.length !== vertices * 3
      )
        throw new Error(`Missing authored crowd deformation: ${role}`);
    }
  }
  verified = true;
}

/** Owned buffers: disposing a stand or a pit view cannot invalidate another. */
export function peopleGeometry(role: PeopleRole): T.BufferGeometry {
  verifyPeopleAsset();
  const data: MeshData = source.meshes[role];
  if (!data) throw new Error(`Unknown people mesh: ${role}`);
  const geometry = new T.BufferGeometry();
  for (const [name, values, size] of [
    ['position', data.position, 3],
    ['normal', data.normal, 3],
    ['color', data.color, 3],
    ['crewWeight', data.weights, 4],
    ['crewCloth', data.cloth, 1],
    ['crowdJoint', data.crowdJoint, 1],
    ['skinMask', data.skinMask, 1],
    ['crowdAccessory', data.accessory, 1],
    ['standingPosition', data.standing, 3],
    ['standingNormal', data.standingNormal, 3],
  ] as const) {
    if (values) geometry.setAttribute(name, new T.Float32BufferAttribute(values, size));
  }
  if (data.crowdJoint && data.skinMask && data.accessory) {
    // Pack tags to leave vertex attribute locations for matrices, colours and
    // standing correspondence on devices with sixteen available locations.
    const tags = new Float32Array(data.crowdJoint.length * 3);
    for (let i = 0; i < data.crowdJoint.length; i++)
      tags.set([data.crowdJoint[i], data.skinMask[i], data.accessory[i]], i * 3);
    geometry.setAttribute('crowdPerson', new T.BufferAttribute(tags, 3));
  }
  if (data.joints) geometry.setAttribute('crewJoint', new T.Uint16BufferAttribute(data.joints, 4));
  geometry.setIndex(data.index);
  geometry.name = `Blender Aurel ${role}`;
  geometry.userData = { authoredRole: role, sourceSha256: PEOPLE_ASSET.sha256 };
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Actual left-hand topology, not a negative instance scale (which reverses
 * triangle facing and breaks lighting/shadows on an instanced mesh). */
export function leftCrewGloveGeometry() {
  const geometry = peopleGeometry('glove');
  geometry.scale(-1, 1, 1);
  const index = geometry.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  geometry.name += ' left';
  return geometry;
}
