import * as T from 'three';
import bodywork from './assets/gp-bodywork.mesh.json';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';

/** The nose's Boolean instrument well contains large planar triangle fans.
 * Area-weighted normals make their narrow rim triangles alternate between
 * the wall and the outer fairing, so the painted lip shows specular spokes.
 * Corner-angle weights are independent of that fan's triangle sizes. Smooth
 * only this connected component, joining its UV seam copies by position;
 * the tank, service panels and other material batches retain their normals.
 * Positions, UVs, indices and the model's triangle/draw budgets are unchanged. */
function smoothCowlNormals(geometry: T.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal'),
    index = geometry.index!,
    parent = new Uint32Array(position.count),
    vertex = new Uint32Array(position.count),
    points = new Map<string, number>();
  let nose = 0;
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
    let source = points.get(key);
    if (source === undefined) points.set(key, (source = i));
    parent[i] = vertex[i] = source;
    if (position.getZ(i) > position.getZ(nose)) nose = i;
  }
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < index.count; i += 3) {
    const a = root(index.getX(i));
    parent[root(index.getX(i + 1))] = a;
    parent[root(index.getX(i + 2))] = a;
  }
  const component = root(nose),
    weighted = new Float64Array(position.count * 3),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    ab = new T.Vector3(),
    ac = new T.Vector3(),
    bc = new T.Vector3(),
    face = new T.Vector3();
  const accumulate = (i: number, angle: number) => {
    const offset = vertex[i] * 3;
    weighted[offset] += face.x * angle;
    weighted[offset + 1] += face.y * angle;
    weighted[offset + 2] += face.z * angle;
  };
  for (let i = 0; i < index.count; i += 3) {
    const ia = index.getX(i),
      ib = index.getX(i + 1),
      ic = index.getX(i + 2);
    if (root(ia) !== component) continue;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    bc.subVectors(c, b);
    face.crossVectors(ab, ac);
    const area = face.length();
    if (area < 1e-12) continue;
    face.multiplyScalar(1 / area);
    accumulate(ia, Math.atan2(area, ab.dot(ac)));
    accumulate(ib, Math.atan2(area, -ab.dot(bc)));
    accumulate(ic, Math.atan2(area, ac.dot(bc)));
  }
  for (let i = 0; i < position.count; i++) {
    if (root(i) !== component) continue;
    face.fromArray(weighted, vertex[i] * 3);
    if (face.lengthSq() > 1e-20) {
      face.normalize();
      normal.setXYZ(i, face.x, face.y, face.z);
    }
  }
  normal.needsUpdate = true;
}

/** Original Blender-authored GP-R1 bodywork, in the existing chassis frame.
 * Only the rigid sprung shell is replaced. Forks, wheels, controls, rider IK
 * and pit-service articulation retain their production owners. No async swap
 * or late unshadowed mesh can appear during a replay. Geometry is owned by each
 * model; its existing disposal path releases it. Six material batches per LOD. */
function buildGroup(
  materials: BikeMaterials,
  source: typeof bodywork.high,
  name: string,
  smoothCowl = false,
): T.Group {
  const group = new T.Group();
  group.name = name;
  for (const part of source) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(part.position, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(part.normal, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(part.uv, 2));
    geometry.setIndex(part.index);
    if (smoothCowl && part.material === 'paint') smoothCowlNormals(geometry);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material =
      materials[
        part.material as 'paint' | 'secondary' | 'accent' | 'carbon' | 'dark' | 'seat' | 'aluminium'
      ];
    if (!material) throw new Error(`Unbound GP bodywork material: ${part.material}`);
    const mesh = new T.Mesh(geometry, material);
    mesh.name = `GP bodywork / ${part.material}`;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.authoredIn = 'Blender 5.2.2';
  group.userData.referenceRevision = 'motogp-100-r5-composite';
  return group;
}

export function gpBodywork(materials: BikeMaterials, detail: RiderDetail): T.Group {
  return buildGroup(
    materials,
    detail === 'high' ? bodywork.high : bodywork.mid,
    `GP-R1 authored shell (${detail})`,
    true,
  );
}
/** Full-fairing catalogue bikes share the open instrument well, not the GP-R1
 * tank, tail or aero. The existing box-wing and road-bike identities remain. */
export function gpUpperCowl(materials: BikeMaterials, detail: RiderDetail): T.Group {
  return buildGroup(
    materials,
    detail === 'high' ? bodywork.upperHigh : bodywork.upperMid,
    `Open motorcycle instrument cowl (${detail})`,
  );
}
