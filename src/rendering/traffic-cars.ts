import * as T from 'three';
import {
  TF,
  TRAFFIC_FLAG,
  TRAFFIC_HEADER,
  TRAFFIC_STRIDE,
} from '../simulation/open-world/ambient-traffic.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { installSpecularIBL } from './studio/ibl-energy.ts';

/** Most ambient cars drawn at once (the simulation caps the field lower). */
export const TRAFFIC_CAPACITY = 48;
/** Same generic 4.5 m footprint and registry scaling as the traffic physics. */
const BODY = { halfWidth: 0.92, halfHeight: 0.72, halfLength: 2.25 };
const PAINT = [
  0xd8dde2, 0x1f2a36, 0x8a1c1c, 0x2f5d8c, 0x3d3f42, 0xb7a27a, 0x24553a, 0xe2e2da, 0x6b6f76,
  0x7a2f55,
];
type Point = readonly [number, number, number];
type Parts = T.BufferGeometry[];

function add(parts: Parts, geometry: T.BufferGeometry, tint: number) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const color = new T.Color(tint),
    colors = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
  g.setAttribute('color', new T.BufferAttribute(colors, 3));
  parts.push(g);
}
function patch(parts: Parts, points: Point[], index: number[], tint: number) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(points.flat(), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  add(parts, g, tint);
}
/** Convex face with an explicit outward direction. */
function face(parts: Parts, points: Point[], outward: Point, tint: number) {
  const a = new T.Vector3(...points[0]),
    b = new T.Vector3(...points[1]),
    c = new T.Vector3(...points[2]);
  const reverse =
    b
      .sub(a)
      .cross(c.sub(a))
      .dot(new T.Vector3(...outward)) < 0;
  const index: number[] = [];
  for (let i = 1; i < points.length - 1; i++)
    index.push(0, reverse ? i + 1 : i, reverse ? i : i + 1);
  patch(parts, points, index, tint);
}
function box(
  parts: Parts,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  l: number,
  tint: number,
) {
  add(parts, new T.BoxGeometry(w, h, l).translate(x, y, z), tint);
}
function merge(parts: Parts) {
  const count = parts.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
  const out = new T.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const values = new Float32Array(count * 3);
    let offset = 0;
    for (const g of parts) {
      values.set(g.getAttribute(name).array as Float32Array, offset);
      offset += g.getAttribute(name).count * 3;
    }
    out.setAttribute(name, new T.BufferAttribute(values, 3));
  }
  parts.forEach((g) => g.dispose());
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Original compact body, +z forward. Four shared material batches provide
 * paint, opaque reflective glass, neutral mechanical details and lamps.
 * Keeping glass/tyres out of the paint batch prevents blue or red tyres.
 * No textures, per-car meshes or extra simulation state are required. */
function trafficGeometry() {
  const paint: Parts = [],
    glazing: Parts = [],
    trim: Parts = [],
    lamps: Parts = [];
  const white = 0xffffff,
    dark = 0x172026,
    rubber = 0x15181b,
    metal = 0x9aa7af;
  const floor = -BODY.halfHeight + 0.18,
    axleY = -BODY.halfHeight + 0.33;
  const axles = [-1.47, 1.47],
    arch = 0.375;
  // Longitudinal stations: tail tapers, softly crowned bonnet, broad wings.
  const rings = [
    [-2.25, 0.76, -0.015],
    [-2.04, 0.86, 0.045],
    [-1.65, 0.91, 0.095],
    [-1.1, 0.9, 0.1],
    [0, 0.88, 0.1],
    [0.92, 0.9, 0.085],
    [1.48, 0.92, 0.065],
    [1.94, 0.86, 0.015],
    [2.25, 0.76, -0.035],
  ];
  const profile = (z: number) => {
    let i = 0;
    while (i < rings.length - 2 && z > rings[i + 1][0]) i++;
    const a = rings[i],
      b = rings[i + 1],
      t = (z - a[0]) / (b[0] - a[0]);
    return { width: a[1] + (b[1] - a[1]) * t, belt: a[2] + (b[2] - a[2]) * t };
  };
  const stations = rings.map((r) => r[0]);
  for (const z of axles) {
    // Close stations at the arch ends create a clean vertical return to
    // the sill; the other stations trace a circular open wheel cutout.
    stations.push(z - arch - 0.002, z + arch + 0.002);
    for (let i = 0; i <= 12; i++) stations.push(z + Math.cos((i / 12) * Math.PI) * arch);
  }
  stations.sort((a, b) => a - b);
  const zs = [...new Set(stations)];
  const shoulder = [-0.98, -0.82, -0.45, 0, 0.45, 0.82, 0.98];
  const top: Point[] = [],
    topIndex: number[] = [];
  for (const z of zs) {
    const p = profile(z);
    for (const x of shoulder) top.push([x * p.width, p.belt + 0.072 * (1 - (x / 0.98) ** 2), z]);
  }
  for (let row = 0; row < zs.length - 1; row++)
    for (let col = 0; col < shoulder.length - 1; col++) {
      const a = row * shoulder.length + col,
        b = a + shoulder.length;
      topIndex.push(a, b, a + 1, a + 1, b, b + 1);
    }
  patch(paint, top, topIndex, white);
  for (const side of [-1, 1]) {
    const points: Point[] = [],
      index: number[] = [];
    for (const z of zs) {
      const p = profile(z);
      let sill = floor;
      for (const axle of axles) {
        const d = Math.abs(z - axle);
        if (d < arch - 0.00001) sill = Math.max(sill, axleY + Math.sqrt(arch * arch - d * d));
      }
      points.push(
        [side * p.width * 0.94, sill, z],
        [side * p.width, sill + (p.belt - sill) * 0.58, z],
        [side * p.width * 0.98, p.belt, z],
      );
    }
    for (let row = 0; row < zs.length - 1; row++)
      for (let col = 0; col < 2; col++) {
        const a = row * 3 + col,
          b = a + 3;
        const triangles = [a, a + 1, b + 1, a, b + 1, b];
        index.push(...(side > 0 ? triangles : [a, b + 1, a + 1, a, b, b + 1]));
      }
    patch(paint, points, index, white);
    for (const axle of axles) {
      const lip: Point[] = [],
        well: Point[] = [],
        indices: number[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI;
        for (const radius of [arch, arch + 0.022]) {
          const z = axle + Math.cos(a) * radius;
          lip.push([side * (profile(z).width + 0.002), axleY + Math.sin(a) * radius, z]);
        }
        const z = axle + Math.cos(a) * arch,
          y = axleY + Math.sin(a) * arch;
        well.push([side * profile(z).width, y, z], [side * (profile(z).width - 0.18), y, z]);
        if (i < 16) {
          const j = i * 2;
          indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
        }
      }
      // The small rolled lip and recessed black liner give the opening
      // thickness. Paint does not bridge the tyre aperture.
      const lipIndex = indices.slice();
      if (side < 0)
        for (let i = 0; i < lipIndex.length; i += 3)
          [lipIndex[i + 1], lipIndex[i + 2]] = [lipIndex[i + 2], lipIndex[i + 1]];
      patch(paint, lip, lipIndex, white);
      patch(trim, well, indices, rubber);
    }
  }
  for (const z of [-BODY.halfLength, BODY.halfLength]) {
    const p = profile(z),
      points: Point[] = shoulder.map((x) => [
        x * p.width,
        p.belt + 0.072 * (1 - (x / 0.98) ** 2),
        z,
      ]);
    points.push([p.width * 0.96, floor, z], [-p.width * 0.96, floor, z]);
    face(paint, points, [0, 0, Math.sign(z)], white);
  }
  box(trim, 0, floor + 0.025, 0, 1.43, 0.045, 4.12, rubber);

  // Curved painted roof. Sloping front/rear glazing removes the old
  // rectangular glass box; painted margins remain visible as pillars.
  const roofRows = [
    [-0.7, 0.66, 0.675],
    [-0.44, 0.68, 0.712],
    [0.04, 0.68, 0.72],
    [0.33, 0.65, 0.692],
  ];
  const roof: Point[] = [],
    roofIndex: number[] = [],
    across = [-1, -0.7, 0, 0.7, 1];
  for (const [z, w, h] of roofRows)
    for (const x of across) roof.push([x * w, h - 0.027 * x * x, z]);
  for (let row = 0; row < roofRows.length - 1; row++)
    for (let col = 0; col < across.length - 1; col++) {
      const a = row * across.length + col,
        b = a + across.length;
      roofIndex.push(a, b, a + 1, a + 1, b, b + 1);
    }
  patch(paint, roof, roofIndex, white);
  const framedGlass = (points: Point[], normal: Point, tint = white) => {
    face(paint, points, normal, white);
    const centre = points
      .reduce((p, v) => p.add(new T.Vector3(...v)), new T.Vector3())
      .multiplyScalar(1 / points.length);
    const n = new T.Vector3(...normal).normalize().multiplyScalar(0.004);
    const inset: Point[] = points.map((p) => {
      const v = new T.Vector3(...p).sub(centre).multiplyScalar(0.9).add(centre).add(n);
      return [v.x, v.y, v.z];
    });
    face(glazing, inset, normal, tint);
  };
  framedGlass(
    [
      [-0.79, 0.155, 1.015],
      [-0.65, 0.665, 0.33],
      [0.65, 0.665, 0.33],
      [0.79, 0.155, 1.015],
    ],
    [0, 0.7, 0.8],
  );
  framedGlass(
    [
      [0.8, 0.14, -1.49],
      [0.66, 0.648, -0.7],
      [-0.66, 0.648, -0.7],
      [-0.8, 0.14, -1.49],
    ],
    [0, 0.8, -0.7],
  );
  for (const side of [-1, 1]) {
    framedGlass(
      [
        [side * 0.8, 0.145, -1.49],
        [side * 0.66, 0.648, -0.7],
        [side * 0.68, 0.685, -0.18],
        [side * 0.865, 0.17, -0.18],
      ],
      [side, 0.25, 0],
    );
    framedGlass(
      [
        [side * 0.865, 0.17, -0.12],
        [side * 0.68, 0.685, -0.12],
        [side * 0.65, 0.665, 0.33],
        [side * 0.79, 0.155, 1.015],
      ],
      [side, 0.25, 0],
    );
    // Narrow dark B pillar, bright belt trim and two separate handles.
    face(
      trim,
      [
        [side * 0.867, 0.176, -0.19],
        [side * 0.682, 0.69, -0.19],
        [side * 0.682, 0.69, -0.11],
        [side * 0.867, 0.176, -0.11],
      ],
      [side, 0.3, 0],
      dark,
    );
    box(trim, side * 0.874, 0.135, -0.12, 0.012, 0.022, 2.25, metal);
    for (const z of [-0.88, 0.12]) {
      box(trim, side * 0.892, -0.015, z, 0.023, 0.037, 0.17, dark);
      box(trim, side * 0.903, -0.002, z, 0.01, 0.013, 0.12, metal);
    }
    // Small mirror on an angled stalk, within the original tyre-width bound.
    box(trim, side * 0.858, 0.2, 0.76, 0.08, 0.038, 0.07, dark);
    add(
      paint,
      new T.SphereGeometry(1, 8, 5).scale(0.057, 0.055, 0.115).translate(side * 0.88, 0.235, 0.72),
      white,
    );
    box(glazing, side * 0.883, 0.235, 0.612, 0.085, 0.055, 0.008, 0xa3b5bf);
  }

  // Rounded tyre shoulders, dark brake disc and an inset alloy wheel with
  // five separate spokes. These remain one neutral batch for the field.
  const tyreProfile = [
    new T.Vector2(0.19, -0.12),
    new T.Vector2(0.29, -0.12),
    new T.Vector2(0.321, -0.092),
    new T.Vector2(0.33, -0.062),
    new T.Vector2(0.33, 0.062),
    new T.Vector2(0.321, 0.092),
    new T.Vector2(0.29, 0.12),
    new T.Vector2(0.19, 0.12),
  ];
  for (const side of [-1, 1])
    for (const z of axles) {
      const x = side * (BODY.halfWidth - 0.1);
      add(
        trim,
        new T.LatheGeometry(tyreProfile, 18).rotateZ(Math.PI / 2).translate(x, axleY, z),
        rubber,
      );
      add(
        trim,
        new T.CylinderGeometry(0.226, 0.226, 0.018, 16)
          .rotateZ(Math.PI / 2)
          .translate(side * 0.918, axleY, z),
        dark,
      );
      add(
        trim,
        new T.TorusGeometry(0.238, 0.016, 5, 18)
          .rotateY(Math.PI / 2)
          .translate(side * 0.93, axleY, z),
        metal,
      );
      for (let k = 0; k < 5; k++) {
        const a = (k * Math.PI * 2) / 5;
        add(
          trim,
          new T.BoxGeometry(0.021, 0.225, 0.043)
            .rotateX(a)
            .translate(side * 0.932, axleY + Math.cos(a) * 0.105, z + Math.sin(a) * 0.105),
          metal,
        );
      }
      add(
        trim,
        new T.CylinderGeometry(0.061, 0.061, 0.025, 10)
          .rotateZ(Math.PI / 2)
          .translate(side * 0.932, axleY, z),
        metal,
      );
    }

  // A low grille with true slat depth and a recessed rear number plate.
  box(trim, 0, -0.29, 2.254, 0.92, 0.25, 0.03, rubber);
  for (let i = 0; i < 4; i++) box(trim, 0, -0.2 - i * 0.054, 2.273, 0.84, 0.012, 0.016, 0x556168);
  box(trim, 0, -0.425, -2.25, 1.27, 0.15, 0.035, dark);
  box(trim, 0, -0.23, -2.258, 0.44, 0.19, 0.025, dark);
  box(trim, 0, -0.23, -2.275, 0.34, 0.105, 0.008, 0xbfc6c8);
  for (let i = 0; i < 6; i++)
    box(trim, -0.105 + i * 0.042, -0.23, -2.28, 0.018, 0.038, 0.005, dark);
  for (const side of [-1, 1]) {
    const x = side * 0.56;
    // Black optical surround, bright reflector, separate white projector
    // and thin running-light strip; no painted slab covers the emitters.
    box(trim, x, -0.047, 2.252, 0.365, 0.145, 0.038, dark);
    box(trim, x, -0.047, 2.274, 0.307, 0.1, 0.012, metal);
    for (const dx of [-0.077, 0.077])
      add(
        lamps,
        new T.CylinderGeometry(0.033, 0.033, 0.008, 10)
          .rotateX(Math.PI / 2)
          .translate(x + dx, -0.052, 2.285),
        0xfff3db,
      );
    box(lamps, x, -0.004, 2.283, 0.27, 0.014, 0.009, 0xf4f8ff);
    box(lamps, x + side * 0.139, -0.05, 2.283, 0.019, 0.062, 0.009, 0xff8c24);
    box(trim, side * 0.555, 0.014, -2.252, 0.365, 0.143, 0.038, dark);
    box(trim, side * 0.555, 0.014, -2.274, 0.325, 0.108, 0.01, 0x493038);
    for (let i = 0; i < 3; i++)
      box(lamps, side * 0.555 - 0.1 + i * 0.1, 0.025, -2.284, 0.077, 0.045, 0.008, 0xff2418);
    box(lamps, side * 0.705, 0.005, -2.284, 0.018, 0.088, 0.008, 0xff4828);
  }
  return { paint: merge(paint), glazing: merge(glazing), trim: merge(trim), lamps: merge(lamps) };
}

/** Four bounded instanced material batches for the whole traffic field.
 * Position, interpolation, registry dimensions, ids, paint and lamp state
 * keep their existing snapshot mapping. Physics and traffic AI are unchanged. */
export class TrafficCars {
  readonly root = new T.Group();
  readonly bodies: T.InstancedMesh;
  readonly lamps: T.InstancedMesh;
  private readonly glazing: T.InstancedMesh;
  private readonly fixtures: T.InstancedMesh;
  private readonly batches: readonly T.InstancedMesh[];
  private readonly matrix = new T.Matrix4();
  private readonly position = new T.Vector3();
  private readonly previous = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private readonly qa = new T.Quaternion();
  private readonly scale = new T.Vector3();
  private readonly colour = new T.Color();
  private readonly index = new Map<number, number>();
  count = 0;
  constructor() {
    this.root.name = 'Ambient traffic';
    const geometry = trafficGeometry();
    this.bodies = new T.InstancedMesh(
      geometry.paint,
      new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.31, metalness: 0.3 }),
      TRAFFIC_CAPACITY,
    );
    this.bodies.name = 'Ambient traffic bodies (instanced)';
    this.bodies.castShadow = this.bodies.receiveShadow = true;
    this.glazing = new T.InstancedMesh(
      geometry.glazing,
      new T.MeshStandardMaterial({
        color: 0x172b36,
        vertexColors: true,
        roughness: 0.13,
        metalness: 0.28,
      }),
      TRAFFIC_CAPACITY,
    );
    this.glazing.name = 'Ambient traffic glazing (instanced)';
    this.fixtures = new T.InstancedMesh(
      geometry.trim,
      new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.52,
        metalness: 0.18,
        side: T.DoubleSide,
      }),
      TRAFFIC_CAPACITY,
    );
    this.fixtures.name = 'Ambient traffic wheels and trim (instanced)';
    this.fixtures.castShadow = this.fixtures.receiveShadow = true;
    this.lamps = new T.InstancedMesh(
      geometry.lamps,
      new T.MeshBasicMaterial({ vertexColors: true }),
      TRAFFIC_CAPACITY,
    );
    this.lamps.name = 'Ambient traffic lamps (instanced)';
    this.batches = [this.bodies, this.glazing, this.fixtures, this.lamps];
    for (const mesh of this.batches) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.root.add(mesh);
    }
    for (let i = 0; i < TRAFFIC_CAPACITY; i++) {
      this.bodies.setColorAt(i, this.colour.setRGB(1, 1, 1));
      this.lamps.setColorAt(i, this.colour.setRGB(1, 1, 1));
    }
    installSpecularIBL(this.root);
  }
  /** Pose from two traffic blocks (a older) at alpha; time blinks hazards. */
  update(
    a: Float32Array | null,
    b: Float32Array | null,
    alpha: number,
    night: number,
    time: number,
  ) {
    if (!b || b.length < TRAFFIC_HEADER) {
      for (const mesh of this.batches) mesh.count = 0;
      this.count = 0;
      return;
    }
    const n = Math.min(TRAFFIC_CAPACITY, Math.round(b[0]));
    this.index.clear();
    if (a && a.length >= TRAFFIC_HEADER)
      for (let k = 0, m = Math.round(a[0]); k < m; k++)
        this.index.set(a[TRAFFIC_HEADER + k * TRAFFIC_STRIDE + TF.ID], k);
    for (let k = 0; k < n; k++) {
      const o = TRAFFIC_HEADER + k * TRAFFIC_STRIDE,
        id = b[o + TF.ID],
        previous = this.index.get(id),
        p = previous === undefined || !a ? -1 : TRAFFIC_HEADER + previous * TRAFFIC_STRIDE;
      this.position.set(b[o + TF.X], b[o + TF.Y], b[o + TF.Z]);
      this.quaternion.set(b[o + TF.QX], b[o + TF.QY], b[o + TF.QZ], b[o + TF.QW]);
      if (p >= 0 && a) {
        this.position.copy(
          this.previous.set(a[p + TF.X], a[p + TF.Y], a[p + TF.Z]).lerp(this.position, alpha),
        );
        this.qa.set(a[p + TF.QX], a[p + TF.QY], a[p + TF.QZ], a[p + TF.QW]);
        this.quaternion.copy(this.qa.slerp(this.quaternion, alpha));
      }
      const def = vehicleAt(Math.round(b[o + TF.VEHICLE])),
        [hx, hy, hz] = def.halfExtents;
      this.scale.set(
        hx / BODY.halfWidth,
        Math.max(0.5, hy) / BODY.halfHeight,
        hz / BODY.halfLength,
      );
      this.matrix.compose(this.position, this.quaternion, this.scale);
      for (const mesh of this.batches) mesh.setMatrixAt(k, this.matrix);
      const paint = PAINT[Math.abs(Math.round(id) * 7919) % PAINT.length];
      this.bodies.setColorAt(k, this.colour.setHex(paint));
      const flags = b[o + TF.FLAGS],
        hazard = (flags & TRAFFIC_FLAG.HAZARD) !== 0 && Math.floor(time * 2.5) % 2 === 0,
        brake = b[o + TF.BRAKE];
      const glow = Math.max(0.35 + night * 2.2, brake > 0.05 ? 2.6 : 0, hazard ? 3 : 0);
      this.lamps.setColorAt(k, this.colour.setScalar(glow));
    }
    this.count = n;
    for (const mesh of this.batches) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
  dispose() {
    this.root.removeFromParent();
    for (const mesh of this.batches) {
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
      mesh.dispose();
    }
    this.root.clear();
  }
}
