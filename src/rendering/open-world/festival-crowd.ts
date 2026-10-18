import * as T from 'three';

/** Standing festival crowd for the event dressing, measured from the
 * reference meet and drag frames (FH6 ref 025/049/072/077/079): people stand
 * one to three deep behind the barriers, ~0.6-0.8 m apart, 1.55-1.9 m tall,
 * in mixed bright and dark casual clothing. Two instanced draws per crowd
 * (clothed body, head); people are simple low-poly figures meant to read at
 * 15 m and beyond, not a character system. */
export const FESTIVAL_CROWD = Object.freeze({
  spacing: 0.72,
  rows: 3,
  rowDepth: 0.7,
  height: Object.freeze([1.55, 1.9] as const),
});

const SHIRTS = [
  0xe5167f, 0x2fb7c9, 0xc9f31d, 0xf2f2ee, 0x1f2328, 0xd8432f, 0xf0b62a, 0x3a5fb0, 0x6f7b45,
  0xb7b2a8, 0x7a2e57, 0x2c6e4f,
];
const SKIN = [0xe3b9a2, 0xc99a7e, 0xa97559, 0x84573f, 0x5c3c2c, 0xd4a68a];

function part(
  out: { position: number[]; normal: number[]; color: number[]; index: number[] },
  geometry: T.BufferGeometry,
  matrix: T.Matrix4,
  shade: number,
) {
  const p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal');
  const normalMatrix = new T.Matrix3().getNormalMatrix(matrix);
  const v = new T.Vector3(),
    offset = out.position.length / 3;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(matrix);
    out.position.push(v.x, v.y, v.z);
    v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
    out.normal.push(v.x, v.y, v.z);
    out.color.push(shade, shade, shade);
  }
  const index = geometry.index!;
  for (let i = 0; i < index.count; i++) out.index.push(offset + index.getX(i));
}
function finish(out: { position: number[]; normal: number[]; color: number[]; index: number[] }) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(out.position, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(out.normal, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(out.color, 3));
  g.setIndex(out.index);
  g.computeBoundingSphere();
  return g;
}
const compose = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0) =>
  new T.Matrix4().compose(
    new T.Vector3(x, y, z),
    new T.Quaternion().setFromEuler(new T.Euler(0, 0, rz)),
    new T.Vector3(sx, sy, sz),
  );

/** A 1.75 m figure facing +z: torso (white, takes the shirt colour), dark
 * trousers, arms; the head is a separate mesh (skin colour, dark
 * hair cap). */
export function crowdBodyGeometry() {
  const out = { position: [], normal: [], color: [], index: [] };
  const box = new T.BoxGeometry(1, 1, 1),
    cylinder = new T.CylinderGeometry(1, 0.85, 1, 6);
  part(out, cylinder, compose(0, 1.2, 0, 0.19, 0.56, 0.13), 1);
  part(out, box, compose(-0.09, 0.47, 0, 0.13, 0.9, 0.15), 0.16);
  part(out, box, compose(0.09, 0.47, 0, 0.13, 0.9, 0.15), 0.16);
  part(out, box, compose(-0.25, 1.17, 0, 0.09, 0.56, 0.1, 0.12), 1);
  part(out, box, compose(0.25, 1.17, 0, 0.09, 0.56, 0.1, -0.12), 1);
  box.dispose();
  cylinder.dispose();
  return finish(out);
}
export function crowdHeadGeometry() {
  const out = { position: [], normal: [], color: [], index: [] };
  const sphere = new T.SphereGeometry(1, 6, 4),
    cap = new T.SphereGeometry(1, 6, 1, 0, Math.PI * 2, 0, Math.PI * 0.42);
  part(out, sphere, compose(0, 1.62, 0, 0.1, 0.12, 0.11), 1);
  part(out, cap, compose(0, 1.635, -0.005, 0.107, 0.125, 0.117), 0.12);
  sphere.dispose();
  cap.dispose();
  return finish(out);
}

/** Matrices and colours for people standing in rows along a line. */
export function crowdLine(
  from: T.Vector3,
  to: T.Vector3,
  facing: T.Vector3,
  ground: (x: number, z: number) => number,
  seed: number,
  rows: number = FESTIVAL_CROWD.rows,
) {
  const people: { matrix: T.Matrix4; shirt: number; skin: number }[] = [];
  let h = seed >>> 0;
  const random = () => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x6d2b79f5;
    h ^= h >>> 13;
    return ((h >>> 0) % 100000) / 100000;
  };
  const along = to.clone().sub(from),
    length = along.length();
  along.normalize();
  const back = facing.clone().setY(0).normalize().negate();
  const yaw = Math.atan2(facing.x, facing.z);
  const q = new T.Quaternion(),
    position = new T.Vector3(),
    scale = new T.Vector3();
  for (let row = 0; row < rows; row++)
    for (let s = 0; s < length; s += FESTIVAL_CROWD.spacing * (0.85 + random() * 0.4)) {
      // Thin towards the back rows; leave gaps like a real crowd.
      if (random() < 0.12 + row * 0.18) continue;
      position
        .copy(from)
        .addScaledVector(along, s + (random() - 0.5) * 0.25)
        .addScaledVector(back, row * FESTIVAL_CROWD.rowDepth + random() * 0.25);
      position.y = ground(position.x, position.z);
      const height =
        FESTIVAL_CROWD.height[0] + random() * (FESTIVAL_CROWD.height[1] - FESTIVAL_CROWD.height[0]);
      const k = height / 1.75;
      q.setFromAxisAngle(new T.Vector3(0, 1, 0), yaw + (random() - 0.5) * 0.9);
      people.push({
        matrix: new T.Matrix4().compose(position, q, scale.set(k * (0.92 + random() * 0.18), k, k)),
        shirt: SHIRTS[Math.floor(random() * SHIRTS.length)],
        skin: SKIN[Math.floor(random() * SKIN.length)],
      });
    }
  return people;
}

/** One crowd: two instanced meshes sharing transforms. */
export function crowdMeshes(
  people: ReturnType<typeof crowdLine>,
  body: T.BufferGeometry,
  head: T.BufferGeometry,
  material: T.Material,
) {
  const bodies = new T.InstancedMesh(body, material, people.length),
    heads = new T.InstancedMesh(head, material, people.length);
  const c = new T.Color();
  people.forEach((p, i) => {
    bodies.setMatrixAt(i, p.matrix);
    heads.setMatrixAt(i, p.matrix);
    bodies.setColorAt(i, c.setHex(p.shirt));
    heads.setColorAt(i, c.setHex(p.skin));
  });
  bodies.name = 'Festival crowd bodies';
  heads.name = 'Festival crowd heads';
  for (const mesh of [bodies, heads]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
  }
  return [bodies, heads] as const;
}
