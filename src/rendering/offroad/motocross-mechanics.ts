import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { add, tube, type BikeMaterials } from '../bike.ts';
import { batchBikeRigidMeshes } from '../bike-rigid-batch.ts';

const UP = new T.Vector3(0, 1, 0);
const SPRING_RADIUS = 0.034;
const WIRE_RADIUS = 0.005;
const TURNS = 7;
const SPRING_START = 0.048;
const SPRING_END = 0.038;

function angularSamples(steps: number, turns = 1) {
  const values = new Float64Array((steps + 1) * 2);
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * turns * Math.PI * 2;
    values[i * 2] = Math.cos(angle);
    values[i * 2 + 1] = Math.sin(angle);
  }
  return values;
}

/** One small reusable dynamic tube. Its topology, attributes and culling
 * objects survive every suspension sample; only real vertex data changes. */
function dynamicTube(rows: number, columns: number) {
  const geometry = new T.BufferGeometry(),
    vertices = (rows + 1) * (columns + 1),
    uv = new Float32Array(vertices * 2),
    indices: number[] = [];
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      const i = row * (columns + 1) + column;
      uv[i * 2] = column / columns;
      uv[i * 2 + 1] = row / rows;
      if (row < rows && column < columns) {
        const next = i + columns + 1;
        indices.push(i, i + 1, next, i + 1, next + 1, next);
      }
    }
  for (const name of ['position', 'normal'])
    geometry.setAttribute(
      name,
      new T.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(T.DynamicDrawUsage),
    );
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.boundingBox = new T.Box3();
  geometry.boundingSphere = new T.Sphere();
  return geometry;
}

/** A coil-over with two real mounting eyes. +Y runs from the upper chassis
 * eye to the lower arm eye. The damper body never scales; the rod slides into
 * it, and a rebuilt helix preserves both wire thickness and spring diameter.
 * Reference 011 exposes the under-seat coil and 031 exposes its attachments.
 * This is an original direct-mount visual mechanism, not a linkage solver. */
export class MotocrossRearShock {
  readonly root = new T.Group();
  readonly lower = new T.Group();
  readonly coil: T.Mesh;
  private readonly rows: number;
  private readonly columns: number;
  private readonly helixAngles: Float64Array;
  private readonly wireAngles: Float64Array;
  private readonly direction = new T.Vector3();
  private lastLength = Number.NaN;

  constructor(detail: 'high' | 'mid', materials: BikeMaterials) {
    this.root.name = 'Motocross two-anchor telescoping rear shock';
    this.lower.name = 'Motocross moving lower shock eye and piston';
    this.rows = detail === 'high' ? 112 : 70;
    this.columns = detail === 'high' ? 6 : 5;
    this.helixAngles = angularSamples(this.rows, TURNS);
    this.wireAngles = angularSamples(this.columns);
    const sides = detail === 'high' ? 16 : 10;
    // Machined upper eye, body and spring seat are one rigid material batch.
    add(this.root, new T.TorusGeometry(0.014, 0.007, 5, sides), materials.aluminium).rotation.y =
      Math.PI / 2;
    add(
      this.root,
      new T.CylinderGeometry(0.011, 0.011, 0.028, sides),
      materials.aluminium,
      0,
      0.025,
    );
    add(
      this.root,
      new T.CylinderGeometry(0.024, 0.024, 0.16, sides),
      materials.aluminium,
      0,
      0.115,
    );
    add(
      this.root,
      new T.CylinderGeometry(0.041, 0.041, 0.011, sides),
      materials.aluminium,
      0,
      SPRING_START - 0.008,
    );
    // The lower eye and a fixed-length rod move together. At full extension
    // the rod still overlaps the upper damper, rather than becoming two rods.
    add(this.lower, new T.TorusGeometry(0.014, 0.007, 5, sides), materials.steel).rotation.y =
      Math.PI / 2;
    add(this.lower, new T.CylinderGeometry(0.008, 0.008, 0.255, sides), materials.steel, 0, -0.14);
    add(
      this.lower,
      new T.CylinderGeometry(0.041, 0.037, 0.012, sides),
      materials.steel,
      0,
      -SPRING_END + 0.01,
    );
    this.coil = add(this.root, dynamicTube(this.rows, this.columns), materials.band);
    this.coil.name = 'Motocross constant-diameter suspension coil';
    // Keep the deforming coil behind its own articulation boundary so rigid
    // batching cannot bake it into the static top hardware.
    const coilGroup = new T.Group();
    coilGroup.name = 'Motocross deforming suspension spring';
    this.root.add(coilGroup);
    coilGroup.add(this.coil);
    this.root.add(this.lower);
    batchBikeRigidMeshes(this.root);
    batchBikeRigidMeshes(this.lower);
    this.update(new T.Vector3(), new T.Vector3(0, -0.36, -0.08));
  }

  update(upperEye: T.Vector3, lowerEye: T.Vector3) {
    this.direction.subVectors(lowerEye, upperEye);
    const length = this.direction.length();
    if (!Number.isFinite(length) || length < 0.19 || length > 0.58) return;
    this.root.position.copy(upperEye);
    this.root.quaternion.setFromUnitVectors(UP, this.direction.multiplyScalar(1 / length));
    this.lower.position.y = length;
    if (length === this.lastLength) return;
    this.lastLength = length;
    const span = length - SPRING_START - SPRING_END,
      circumference = SPRING_RADIUS * TURNS * Math.PI * 2,
      tangentLength = Math.hypot(circumference, span),
      by = circumference / tangentLength,
      radialTilt = span / tangentLength,
      positions = this.coil.geometry.getAttribute('position'),
      normals = this.coil.geometry.getAttribute('normal');
    for (let row = 0; row <= this.rows; row++) {
      const t = row / this.rows,
        ca = this.helixAngles[row * 2],
        sa = this.helixAngles[row * 2 + 1];
      for (let column = 0; column <= this.columns; column++) {
        const cp = this.wireAngles[column * 2],
          sp = this.wireAngles[column * 2 + 1],
          nx = cp * ca + sp * radialTilt * sa,
          ny = sp * by,
          nz = cp * sa - sp * radialTilt * ca,
          i = row * (this.columns + 1) + column;
        positions.setXYZ(
          i,
          SPRING_RADIUS * ca + WIRE_RADIUS * nx,
          SPRING_START + t * span + WIRE_RADIUS * ny,
          SPRING_RADIUS * sa + WIRE_RADIUS * nz,
        );
        normals.setXYZ(i, nx, ny, nz);
      }
    }
    positions.needsUpdate = normals.needsUpdate = true;
    this.coil.geometry.computeBoundingBox();
    this.coil.geometry.computeBoundingSphere();
  }
}

/** Shaped floating MX caliper, with a genuine 4-mm rotor throat. A pair of
 * front piston bosses and one rear boss stays readable without retaining a
 * mesh per bolt. Canonical +Z points radially outwards from the rotor centre.
 * Ref 005/012/027 show this housing, carrier and hydraulic connection. */
export function addMotocrossBrakeCaliper(
  parent: T.Group,
  front: boolean,
  detail: 'high' | 'mid',
  materials: BikeMaterials,
  rotorOffset: number,
) {
  const radius = front ? 0.131 : 0.117,
    side = front ? 1 : -1,
    x = front ? 0.056 : -0.06,
    angle = front ? Math.PI - 0.2 : -0.7,
    half = front ? 0.052 : 0.039,
    sides = detail === 'high' ? 12 : 8;
  const place = (g: T.BufferGeometry, material: T.Material, px = 0, py = 0, pz = 0) => {
    g.translate(px, py, pz);
    g.rotateX(angle);
    g.translate(x, 0, rotorOffset);
    return add(parent, g, material);
  };
  // Two separate jaws leave the thin disc visible through the centre. The
  // bridge joins only beyond its outer radius, so it cannot cut the rotor.
  for (const sign of [-1, 1]) {
    const shape = new T.Shape();
    shape.moveTo(-half, radius - 0.024);
    shape.lineTo(-half + 0.009, radius - 0.038);
    shape.lineTo(half - 0.007, radius - 0.034);
    shape.quadraticCurveTo(half + 0.006, radius - 0.014, half - 0.004, radius + 0.009);
    shape.lineTo(-half + 0.008, radius + 0.009);
    shape.closePath();
    const body = new T.ExtrudeGeometry(shape, {
      depth: 0.011,
      bevelEnabled: true,
      bevelSize: 0.0018,
      bevelThickness: 0.001,
      bevelSegments: 1,
      curveSegments: 3,
      steps: 1,
    });
    // Shape XY is tangential Y / radial Z; extrusion is the axle X axis.
    body.applyMatrix4(new T.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    place(body, materials.caliper, sign * 0.014 - 0.0055);
    place(
      new T.BoxGeometry(0.003, half * 1.45, 0.026),
      materials.dark,
      sign * 0.005,
      0,
      radius - 0.017,
    );
  }
  place(
    new RoundedBoxGeometry(0.042, half * 1.55, 0.009, 1, 0.002),
    materials.caliper,
    0,
    0,
    radius + 0.009,
  );
  for (const y of front ? [-0.026, 0.025] : [0]) {
    const boss = new T.CylinderGeometry(front ? 0.018 : 0.023, front ? 0.019 : 0.024, 0.004, sides);
    boss.rotateZ(Math.PI / 2);
    place(boss, materials.caliper, side * 0.024, y, radius - 0.014);
  }
  // The slim carrier continues to the real axle lug/swingarm rail. Its
  // inboard end is outside the disc plane and cannot rotate with the wheel.
  place(
    tube(
      [
        [side * 0.034, 0, 0.017],
        [side * 0.034, -half * 0.72, radius - 0.057],
        [side * 0.027, -half * 0.76, radius - 0.004],
      ],
      0.008,
      8,
      5,
    ),
    materials.caliper,
  );
  const banjo = new T.Vector3(side * 0.026, -half * 0.72, radius + 0.004);
  const bolt = new T.CylinderGeometry(0.006, 0.006, 0.011, 6);
  bolt.rotateZ(Math.PI / 2);
  place(bolt, materials.caliper, banjo.x, banjo.y, banjo.z);
  banjo.applyAxisAngle(new T.Vector3(1, 0, 0), angle).add(new T.Vector3(x, 0, rotorOffset));
  return banjo;
}

/** Flexible middle of the front brake hose, from the existing handlebar
 * cable to the sliding fork-guard clip. Both ends stay attached at any fork
 * travel. The fixed lower hose continues to the caliper on the fork lower. */
export class MotocrossBrakeHose {
  readonly root = new T.Group();
  readonly mesh: T.Mesh;
  private readonly rows = 18;
  private readonly columns = 5;
  private readonly angles = angularSamples(this.columns);
  private lastY = Number.NaN;

  constructor(material: T.Material) {
    this.root.name = 'Motocross flexible front brake line';
    this.mesh = add(this.root, dynamicTube(this.rows, this.columns), material);
    this.update(-0.92);
  }

  update(forkLowerY: number) {
    if (!Number.isFinite(forkLowerY) || forkLowerY === this.lastY) return;
    this.lastY = forkLowerY;
    const endY = forkLowerY + 0.51,
      positions = this.mesh.geometry.getAttribute('position'),
      normals = this.mesh.geometry.getAttribute('normal');
    // Cubic coordinates: bar cable endpoint, two elastic guides, lower clip.
    for (let row = 0; row <= this.rows; row++) {
      const t = row / this.rows,
        u = 1 - t,
        x = u ** 3 * -0.054 + 3 * u * u * t * 0.154 + 3 * u * t * t * 0.148 + t ** 3 * 0.123,
        y = u ** 3 * 0.11 + 3 * u * u * t * 0.075 + 3 * u * t * t * (endY + 0.17) + t ** 3 * endY,
        z = u ** 3 * 0.05 + 3 * u * u * t * 0.053 + 3 * u * t * t * 0.035 + t ** 3 * 0.035,
        dx = 3 * u * u * 0.208 + 6 * u * t * -0.006 + 3 * t * t * -0.025,
        dy = 3 * u * u * -0.035 + 6 * u * t * (endY + 0.095) + 3 * t * t * -0.17,
        dz = 3 * u * u * 0.003 + 6 * u * t * -0.018,
        tangentLength = Math.hypot(dx, dy, dz),
        xy = Math.hypot(dx, dy),
        nx = dy / xy,
        ny = -dx / xy,
        bx = (-dz * ny) / tangentLength,
        by = (dz * nx) / tangentLength,
        bz = (dx * ny - dy * nx) / tangentLength;
      for (let column = 0; column <= this.columns; column++) {
        const cp = this.angles[column * 2],
          sp = this.angles[column * 2 + 1],
          px = nx * cp + bx * sp,
          py = ny * cp + by * sp,
          pz = bz * sp,
          i = row * (this.columns + 1) + column;
        positions.setXYZ(i, x + px * 0.004, y + py * 0.004, z + pz * 0.004);
        normals.setXYZ(i, px, py, pz);
      }
    }
    positions.needsUpdate = normals.needsUpdate = true;
    this.mesh.geometry.computeBoundingBox();
    this.mesh.geometry.computeBoundingSphere();
  }
}
