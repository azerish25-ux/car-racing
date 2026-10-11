import * as T from 'three';
import manifest from './apx01-driver.manifest.json' with { type: 'json' };
import { mesh, mergeStatic, rod } from './geometry.ts';
import { helmetPoint } from './helmet-shell.ts';

/** Car-local anchor of each helmet tether on the HANS upright (x by side). */
export const HANS_ANCHOR = Object.freeze({ x: 0.04, y: 0.168, z: -0.49 });

/** Shared Blender torso envelope, including its low-amplitude compression folds.
 * Harness edges are projected individually; a flat strip intersects curved ribs. */
export function seatedTorsoFront(x: number, y: number) {
  if (!Number.isFinite(x + y)) throw new Error('Invalid seated torso coordinate');
  const p = manifest.torsoProfile;
  y = T.MathUtils.clamp(y, p[0][0], p.at(-1)![0]);
  let k = 0;
  while (k < p.length - 2 && y > p[k + 1][0]) k++;
  const a = p[k],
    b = p[k + 1],
    t = T.MathUtils.smoothstep(y, a[0], b[0]);
  const z = T.MathUtils.lerp(a[1], b[1], t),
    rx = T.MathUtils.lerp(a[2], b[2], t),
    rz = T.MathUtils.lerp(a[3], b[3], t);
  const ca = T.MathUtils.clamp(x / rx, -1, 1),
    front = Math.sqrt(Math.max(0, 1 - ca * ca));
  const fold = 0.0028 * Math.exp(-(((y + 0.155) / 0.1) ** 2)) * front * Math.sin(y * 104 + ca * 3);
  const seam = 0.0006 * Math.exp(-((ca / 0.027) ** 2)) * front;
  return z + front * rz + fold + seam;
}

/** Two shoulder, two lap and two anti-submarining straps terminate at one real
 * buckle. The thin solid webbing follows the loaded suit surface, not the seat. */
export function conformingBelt(path: readonly T.Vector2[], width: number) {
  if (
    path.length < 2 ||
    !Number.isFinite(width) ||
    width <= 0 ||
    width > 0.07 ||
    path.some((p) => !Number.isFinite(p.lengthSq()))
  )
    throw new Error('Invalid conforming restraint');
  const curve = new T.CatmullRomCurve3(path.map((p) => new T.Vector3(p.x, p.y, 0)));
  const points: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const rows = 32;
  for (let row = 0; row <= rows; row++) {
    const p = curve.getPoint(row / rows),
      t = curve.getTangent(row / rows);
    const across = new T.Vector2(t.y, -t.x).normalize().multiplyScalar(width / 2);
    for (const [side, depth] of [
      [-1, 0],
      [1, 0],
      [1, -0.0025],
      [-1, -0.0025],
    ]) {
      const x = p.x + across.x * side,
        y = p.y + across.y * side;
      points.push(x, y, seatedTorsoFront(x, y) + 0.0045 + depth);
      uv.push(side > 0 ? 1 : 0, (row / rows) * 4);
    }
    if (row < rows)
      for (let j = 0; j < 4; j++) {
        const a = row * 4 + j,
          b = row * 4 + ((j + 1) % 4);
        indices.push(a, b, a + 4, b, b + 4, a + 4);
      }
  }
  indices.push(
    0,
    2,
    1,
    0,
    3,
    2,
    rows * 4,
    rows * 4 + 1,
    rows * 4 + 2,
    rows * 4,
    rows * 4 + 2,
    rows * 4 + 3,
  );
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = 'Surface-fitted solid restraint webbing';
  return g;
}
export function addSeatedRestraints(parent: T.Group, webbing: T.Material, trim: T.Material) {
  const group = new T.Group();
  group.name = 'Coupled six-point driver restraint';
  parent.add(group);
  const metal = new T.MeshStandardMaterial({
    name: 'Satin harness adjusters',
    color: 0x879191,
    roughness: 0.38,
    metalness: 0.86,
  });
  for (const side of [-1, 1]) {
    for (const [path, width] of [
      [
        [
          [side * 0.11, 0.05],
          [side * 0.105, -0.038],
          [side * 0.076, -0.145],
          [side * 0.025, -0.228],
        ],
        0.045,
      ],
      [
        [
          [side * 0.141, -0.238],
          [side * 0.085, -0.223],
          [side * 0.024, -0.228],
        ],
        0.036,
      ],
      [
        [
          [side * 0.041, -0.279],
          [side * 0.026, -0.252],
          [side * 0.014, -0.23],
        ],
        0.025,
      ],
    ] as const)
      mesh(
        group,
        conformingBelt(
          path.map((p) => new T.Vector2(...p)),
          width,
        ),
        webbing,
      );
    // Two thin edge seams, raised by less than a millimetre, preserve the broad
    // readable webbing rather than covering it with decorative cylinders.
    for (const offset of [-0.018, 0.018]) {
      const seam = conformingBelt(
        [
          [side * 0.11 + offset, 0.048],
          [side * 0.104 + offset, -0.038],
          [side * 0.075 + offset, -0.14],
          [side * 0.027 + offset * 0.5, -0.222],
        ].map((p) => new T.Vector2(...p)),
        0.0013,
      );
      seam.translate(0, 0, 0.0006);
      mesh(group, seam, trim);
    }
    const x = side * 0.101,
      y = -0.055,
      z = seatedTorsoFront(x, y) + 0.008;
    const adjuster = mesh(group, new T.TorusGeometry(0.018, 0.0022, 6, 4), metal, x, y, z);
    adjuster.scale.set(1.12, 0.63, 1);
    adjuster.rotation.z = Math.PI / 4;
    rod(
      group,
      metal,
      new T.Vector3(x - 0.017, y, z + 0.001),
      new T.Vector3(x + 0.017, y, z + 0.001),
      0.0015,
    );
    // Seat-side fastener and a short strap rise visibly above the shoulder.
    const tail = new T.CatmullRomCurve3([
      new T.Vector3(side * 0.11, 0.05, seatedTorsoFront(side * 0.11, 0.05) + 0.003),
      new T.Vector3(side * 0.105, 0.119, -0.444),
      new T.Vector3(side * 0.112, 0.074, -0.561),
    ]);
    const tailPoints = Array.from({ length: 17 }, (_, i) => tail.getPoint(i / 16));
    const vertices: number[] = [],
      indices: number[] = [];
    for (const p of tailPoints) for (const dx of [-0.021, 0.021]) vertices.push(p.x + dx, p.y, p.z);
    for (let i = 0; i < 16; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    g.setAttribute(
      'uv',
      new T.Float32BufferAttribute(
        tailPoints.flatMap((_, i) => [0, i / 4, 1, i / 4]),
        2,
      ),
    );
    g.setIndex(indices);
    g.computeVertexNormals();
    const back = webbing.clone();
    back.side = T.DoubleSide;
    mesh(group, g, back);
    const anchor = mesh(
      group,
      new T.TorusGeometry(0.017, 0.002, 6, 12),
      metal,
      side * 0.112,
      0.074,
      -0.565,
    );
    anchor.scale.y = 0.68;
  }
  const z = seatedTorsoFront(0, -0.229) + 0.012;
  const buckle = mesh(group, new T.CylinderGeometry(0.024, 0.024, 0.009, 32), metal, 0, -0.229, z);
  buckle.rotation.x = Math.PI / 2;
  const inset = mesh(
    group,
    new T.CylinderGeometry(0.016, 0.016, 0.01, 24),
    trim,
    0,
    -0.229,
    z + 0.001,
  );
  inset.rotation.x = Math.PI / 2;
  const release = mesh(
    group,
    new T.CapsuleGeometry(0.003, 0.024, 3, 8),
    metal,
    0,
    -0.229,
    z + 0.008,
  );
  release.rotation.z = -0.6;
  mergeStatic(group);
  return group;
}

/** One source of truth for the helmet's fastener and the live tether endpoint. */
export function helmetTetherPost(side: number, out = new T.Vector3()) {
  if (side !== -1 && side !== 1) throw new Error('Invalid helmet tether side');
  helmetPoint(-0.067, side < 0 ? -0.3 : Math.PI + 0.3, 0.004, out);
  out.y += 0.12;
  out.z += 0.02;
  return out;
}
export class HelmetTethers {
  readonly root = new T.Group();
  private readonly straps: T.Mesh[] = [];
  private readonly position = new T.Vector3();
  private readonly end = new T.Vector3();
  private readonly rotation = new T.Quaternion();
  private readonly euler = new T.Euler();
  private readonly neck = new T.Vector3(0, 0.17, -0.4);
  private pitch = NaN;
  private roll = NaN;
  constructor(material: T.Material) {
    this.root.name = 'Helmet-to-neck-restraint webbing';
    for (const side of [-1, 1]) {
      const g = new T.BufferGeometry();
      g.setAttribute(
        'position',
        new T.BufferAttribute(new Float32Array(18 * 3), 3).setUsage(T.DynamicDrawUsage),
      );
      g.setAttribute(
        'normal',
        new T.BufferAttribute(new Float32Array(18 * 3), 3).setUsage(T.DynamicDrawUsage),
      );
      const uv: number[] = [];
      for (let row = 0; row < 9; row++) uv.push(0, row / 8, 1, row / 8);
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      const indices: number[] = [];
      for (let row = 0; row < 8; row++) {
        const a = row * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      g.setIndex(indices);
      const m = material.clone();
      m.side = T.DoubleSide;
      const strap = mesh(this.root, g, m);
      strap.userData.side = side;
      this.straps.push(strap);
    }
    this.update(0, 0);
  }
  update(pitch: number, roll: number) {
    if (!Number.isFinite(pitch + roll)) throw new Error('Invalid helmet restraint pose');
    if (pitch === this.pitch && roll === this.roll) return;
    this.pitch = pitch;
    this.roll = roll;
    this.rotation.setFromEuler(this.euler.set(pitch, 0, roll));
    for (const strap of this.straps) {
      const side = strap.userData.side as number;
      helmetTetherPost(side, this.end).applyQuaternion(this.rotation).add(this.neck);
      const p = strap.geometry.getAttribute('position');
      for (let row = 0; row < 9; row++) {
        const t = row / 8;
        this.position.set(side * HANS_ANCHOR.x, HANS_ANCHOR.y, HANS_ANCHOR.z).lerp(this.end, t);
        this.position.y -= 0.003 * Math.sin(Math.PI * t);
        p.setXYZ(row * 2, this.position.x - 0.0035, this.position.y, this.position.z);
        p.setXYZ(row * 2 + 1, this.position.x + 0.0035, this.position.y, this.position.z);
      }
      p.needsUpdate = true;
      strap.geometry.computeVertexNormals();
      strap.geometry.computeBoundingSphere();
      strap.geometry.computeBoundingBox();
    }
  }
}
