import * as T from 'three';
import { installCrowdShader, spectatorGeometry } from '../crowd.ts';
import { installCrowdImpostorShader, spectatorImpostorGeometry } from '../crowd-impostor.ts';

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

/** Authored standing spectators for the festival meets and hub (refs 025,
 * 046, 047, 072, 078-081): the game's sculpted crowd bodies (crowd.ts /
 * human-kit: clothed torso, arms, faces, caps, phones and cups, seated and
 * standing correspondence, per-person build and garments) in their standing
 * pose, on the festival crowd lines. Each cluster of up to 96 people is one
 * instanced draw at one level: the mid sculpt (1.4 k triangles) near the
 * camera, the low sculpt (0.6 k) beyond, the lit card past 300 m. MEDIUM
 * draws two in three people (instances sorted by a stable rank), HIGH most,
 * ULTRA all; LOW none. The circuit grandstands are not touched. */
export const FESTIVAL_SPECTATORS = Object.freeze({
  cluster: 96,
  /** Mid-sculpt range (m) and the share of people drawn, per tier. */
  near: { low: 0, medium: 32, high: 48, ultra: 64 } as Record<string, number>,
  share: { low: 0, medium: 0.66, high: 0.85, ultra: 1 } as Record<string, number>,
  card: 300,
});
/** The crowd bodies face -X with the standing body centred 0.49 m behind
 * the seat origin, feet 0.30 m below it, 1.6 m tall: turn them to face +z
 * (the crowd-line forward) on the line's ground point at its height. The
 * feet (bind space) land on that point. */
export const SPECTATOR_FEET = new T.Vector3(-0.49, -0.3, 0);
export const STANDING = new T.Matrix4()
  .makeScale(1.75 / 1.6, 1.75 / 1.6, 1.75 / 1.6)
  .multiply(new T.Matrix4().makeRotationY(Math.PI / 2))
  .multiply(new T.Matrix4().makeTranslation(0.49, 0.3, 0));
function rank(i: number, seed: number) {
  let h = Math.imul((i + 1) ^ seed, 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export class FestivalSpectators {
  readonly root = new T.Group();
  readonly stats = { people: 0, clusters: 0 };
  private readonly uniforms = {
    crowdClock: { value: new T.Vector2() },
    crowdMotion: { value: 0.55 },
    crowdReaction: { value: new T.Vector2() },
  };
  private readonly geometries: T.BufferGeometry[];
  private readonly materials: T.Material[] = [];
  private readonly levelMaterials: { color: T.MeshStandardMaterial; range: T.Vector2 }[] = [];
  private readonly clusters: {
    mesh: T.InstancedMesh;
    levels: T.BufferGeometry[];
    centre: T.Vector3;
    count: number;
    level: number;
  }[] = [];
  private readonly eye = new T.Vector3();
  constructor() {
    this.root.name = 'Festival spectators (authored)';
    this.geometries = [
      spectatorGeometry(1, 'a'),
      spectatorGeometry(2, 'a'),
      spectatorImpostorGeometry(),
    ];
    for (let level = 0; level < 3; level++) {
      const range = new T.Vector2(0, 1);
      const color = new T.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
      color.vertexColors = true;
      const uniforms = { ...this.uniforms, crowdLodRange: { value: range } };
      if (level === 2) installCrowdImpostorShader(color, range);
      else installCrowdShader(color, uniforms, true);
      this.levelMaterials.push({ color, range });
      this.materials.push(color);
    }
    const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    installCrowdShader(
      depth,
      { ...this.uniforms, crowdLodRange: { value: new T.Vector2(0, 1) } },
      false,
    );
    this.materials.push(depth);
  }
  /** People of one crowd line (crowdLine), parented to `parent`. */
  add(people: ReturnType<typeof crowdLine>, parent: T.Object3D, seed: number) {
    const order = people
      .map((p, i) => ({ p, r: rank(i, seed) }))
      .sort((a, b) => a.r - b.r)
      .map((e) => e.p);
    // Spatial clusters along the line, each sorted by rank so a tier can
    // draw a stable leading share.
    for (let start = 0; start < people.length; start += FESTIVAL_SPECTATORS.cluster) {
      const group = people
        .slice(start, start + FESTIVAL_SPECTATORS.cluster)
        .map((p) => ({ p, r: order.indexOf(p) }))
        .sort((a, b) => a.r - b.r)
        .map((e) => e.p);
      const n = group.length,
        phase = new Float32Array(n),
        skin = new Float32Array(n * 3),
        style = new Float32Array(n * 4),
        centre = new T.Vector3(),
        m = new T.Matrix4(),
        c = new T.Color();
      group.forEach((person, i) => {
        const h = rank(start + i, seed ^ 0x51ed);
        phase[i] = h * Math.PI * 2;
        skin.set(c.setHex(person.skin).toArray(), i * 3);
        style.set(
          [0.9 + rank(i, seed + 3) * 0.2, 0.94 + rank(i, seed + 5) * 0.12, 1, rank(i, seed + 7)],
          i * 4,
        );
        centre.add(new T.Vector3().setFromMatrixPosition(person.matrix));
      });
      centre.multiplyScalar(1 / n);
      const attributes = {
        spectatorPhase: new T.InstancedBufferAttribute(phase, 1),
        spectatorSkin: new T.InstancedBufferAttribute(skin, 3),
        spectatorStyle: new T.InstancedBufferAttribute(style, 4),
      };
      const levels = this.geometries.map((base) => {
        const geometry = new T.BufferGeometry();
        for (const [name, attribute] of Object.entries(base.attributes))
          geometry.setAttribute(name, attribute);
        geometry.setIndex(base.index);
        geometry.boundingBox = base.boundingBox;
        geometry.boundingSphere = base.boundingSphere;
        for (const [name, attribute] of Object.entries(attributes))
          geometry.setAttribute(name, attribute);
        return geometry;
      });
      const mesh = new T.InstancedMesh(levels[1], this.levelMaterials[1].color, n);
      group.forEach((person, i) => {
        mesh.setMatrixAt(i, m.multiplyMatrices(person.matrix, STANDING));
        mesh.setColorAt(i, c.setHex(person.shirt));
      });
      mesh.name = 'Festival spectators';
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = this.materials[3] as T.MeshDepthMaterial;
      mesh.computeBoundingSphere();
      mesh.boundingSphere!.radius += 0.6;
      mesh.visible = false;
      parent.add(mesh);
      this.clusters.push({ mesh, levels, centre, count: n, level: 1 });
      this.stats.people += n;
      this.stats.clusters++;
    }
  }
  update(camera: T.Camera, time: number, preset: string) {
    camera.getWorldPosition(this.eye);
    const near = FESTIVAL_SPECTATORS.near[preset] ?? 32,
      share = FESTIVAL_SPECTATORS.share[preset] ?? 0.66;
    const cycle = Math.PI * 2;
    this.uniforms.crowdClock.value.set((time * 0.71) % cycle, (time * 0.43) % cycle);
    for (const cluster of this.clusters) {
      const d = cluster.centre.distanceTo(this.eye),
        level = d < near ? 0 : d < FESTIVAL_SPECTATORS.card ? 1 : 2,
        count = Math.round(cluster.count * share);
      const mesh = cluster.mesh;
      if (level !== cluster.level) {
        cluster.level = level;
        mesh.geometry = cluster.levels[level];
        mesh.material = this.levelMaterials[level].color;
      }
      mesh.castShadow = level === 0;
      mesh.visible = share > 0 && count > 0 && d < FESTIVAL_SPECTATORS.card * 2.5;
      mesh.count = count;
    }
  }
  dispose() {
    for (const cluster of this.clusters) {
      cluster.mesh.removeFromParent();
      cluster.mesh.dispose();
      for (const g of cluster.levels) g.dispose();
    }
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.clusters.length = 0;
  }
}
