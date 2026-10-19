import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const MX_TRACKSIDE_MODELS = [
  'canopy',
  'tool-trolley',
  'pressure-washer',
  'water-tank',
  'marshal-post',
  'speaker-stack',
] as const;
export type MxTracksideModel = (typeof MX_TRACKSIDE_MODELS)[number];
export type MxTracksideDetail = 'near' | 'course';
export type MxTracksideMaterial = 'metal' | 'coated' | 'rubber' | 'fabric' | 'timber';
export type MxTracksidePalette = Record<MxTracksideMaterial, T.MeshStandardMaterial>;
export interface MxTracksidePart {
  name: string;
  material: MxTracksideMaterial;
  geometry: T.BufferGeometry;
}
type V3 = readonly [number, number, number];

/** Original, metre-scale asset sources. The same evaluated part buffers are
 * exported to Blender; no commercial image, logo, mesh or network asset is used. */
export function mxTracksidePalette(): MxTracksidePalette {
  const make = (name: MxTracksideMaterial, roughness: number, metalness = 0) =>
    new T.MeshStandardMaterial({
      name: `MX trackside ${name}`,
      color: 0xffffff,
      vertexColors: true,
      roughness,
      metalness,
      side: name === 'fabric' ? T.DoubleSide : T.FrontSide,
    });
  return {
    metal: make('metal', 0.46, 0.76),
    coated: make('coated', 0.53),
    rubber: make('rubber', 0.89),
    fabric: make('fabric', 0.94),
    timber: make('timber', 0.87),
  };
}

const PAINT = 0x49625c,
  ORANGE = 0xae5b36,
  STEEL = 0xa2aaa5,
  DARK = 0x222a2a;

class Builder {
  readonly parts: MxTracksidePart[] = [];
  readonly round: number;
  constructor(readonly detail: MxTracksideDetail) {
    this.round = detail === 'near' ? 16 : 10;
  }
  add(name: string, material: MxTracksideMaterial, hex: number, source: T.BufferGeometry) {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    const pos = g.getAttribute('position'),
      base = new T.Color(hex);
    const color = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      // Continuous object-space handling wear: duplicated face vertices agree,
      // so neither seams nor triangulation acquire random speckled colours.
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i);
      const grain = Math.sin(x * 47 + z * 23) * Math.sin(y * 31 - z * 13);
      const grime = Math.max(0, 1 - y / 0.32) * 0.095;
      const shade = 0.965 + grain * 0.022 - grime;
      color.set([base.r * shade, base.g * shade, base.b * shade], i * 3);
    }
    g.setAttribute('color', new T.BufferAttribute(color, 3));
    g.name = name;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    this.parts.push({ name, material, geometry: g });
  }
  box(
    name: string,
    material: MxTracksideMaterial,
    color: number,
    size: V3,
    at: V3,
    bevel = 0.01,
    rotation?: V3,
  ) {
    const r = Math.min(bevel, Math.min(...size) * 0.23);
    const g =
      this.detail === 'near' && r > 0
        ? new RoundedBoxGeometry(...size, 1, r)
        : new T.BoxGeometry(...size);
    if (rotation) g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rotation)));
    g.translate(...at);
    this.add(name, material, color, g);
  }
  bar(
    name: string,
    material: MxTracksideMaterial,
    color: number,
    a: V3,
    b: V3,
    radius = 0.017,
    sides = this.round,
  ) {
    const p = new T.Vector3(...a),
      q = new T.Vector3(...b),
      d = q.clone().sub(p);
    if (d.length() < 1e-6) throw new Error(`Zero-length MX model member: ${name}`);
    const g = new T.CylinderGeometry(radius, radius, d.length(), sides);
    g.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize()),
    );
    g.translate(...p.add(q).multiplyScalar(0.5).toArray());
    this.add(name, material, color, g);
  }
  ring(
    name: string,
    material: MxTracksideMaterial,
    color: number,
    at: V3,
    radius: number,
    tube: number,
    rotation: V3 = [0, 0, 0],
  ) {
    const g = new T.TorusGeometry(radius, tube, this.detail === 'near' ? 6 : 4, this.round * 2);
    g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rotation)));
    g.translate(...at);
    this.add(name, material, color, g);
  }
  curve(name: string, material: MxTracksideMaterial, color: number, points: V3[], radius: number) {
    const g = new T.TubeGeometry(
      new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p))),
      Math.max(this.detail === 'near' ? 32 : 16, points.length),
      radius,
      this.detail === 'near' ? 6 : 4,
      false,
    );
    this.add(name, material, color, g);
  }
  bolt(at: V3, axis: 'x' | 'z' = 'z') {
    const end = [...at] as [number, number, number];
    end[axis === 'x' ? 0 : 2] += 0.01;
    this.bar('Hex-head frame fastener', 'metal', STEEL, at, end, 0.009, 6);
  }
  wheel(name: string, x: number, y: number, z: number, radius: number, width: number) {
    this.bar(
      `${name} rubber tread`,
      'rubber',
      0x292a27,
      [x - width / 2, y, z],
      [x + width / 2, y, z],
      radius,
    );
    for (const side of [-1, 1]) {
      const px = x + side * (width / 2 + 0.002);
      this.bar(
        `${name} recessed hub`,
        'metal',
        STEEL,
        [px, y, z],
        [px + side * 0.009, y, z],
        radius * 0.46,
      );
      this.bar(
        `${name} axle cap`,
        'coated',
        DARK,
        [px + side * 0.009, y, z],
        [px + side * 0.018, y, z],
        radius * 0.17,
        8,
      );
    }
  }
}

function canopy(b: Builder) {
  // Four sewn roof panels, each sharing a true hip seam. Edges sag between
  // corner attachments; neither a cone primitive nor a solid pyramid.
  const corners: V3[] = [
    [-2.3, 2.49, -2.3],
    [2.3, 2.49, -2.3],
    [2.3, 2.49, 2.3],
    [-2.3, 2.49, 2.3],
  ];
  const rows = b.detail === 'near' ? 9 : 5,
    cols = b.detail === 'near' ? 14 : 8;
  for (let side = 0; side < 4; side++) {
    const a = new T.Vector3(...corners[side]),
      c = new T.Vector3(...corners[(side + 1) % 4]);
    const pos: number[] = [],
      uv: number[] = [],
      index: number[] = [];
    for (let r = 0; r <= rows; r++)
      for (let j = 0; j <= cols; j++) {
        const t = r / rows,
          u = j / cols,
          edge = a.clone().lerp(c, u);
        const y =
          3.55 * (1 - t) +
          edge.y * t -
          0.12 * Math.sin(u * Math.PI) * t * t -
          0.02 * Math.sin(u * Math.PI * 6) * Math.sin(t * Math.PI);
        pos.push(edge.x * t, y, edge.z * t);
        uv.push(u, t);
        if (r && j) {
          const q = r * (cols + 1) + j,
            p = q - cols - 1;
          // The apex is a shared point geometrically, but each panel keeps UVs.
          if (r > 1) index.push(p - 1, p, q - 1);
          index.push(p, q, q - 1);
        }
      }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    b.add('Tensioned sewn canopy roof panel', 'fabric', side % 2 ? 0xd7d4c6 : 0xc6cabe, g);
    b.bar('Raised stitched hip seam', 'fabric', 0xbfc4b7, [0, 3.552, 0], corners[side], 0.006, 5);
    const centre = a.clone().add(c).multiplyScalar(0.5);
    const strip = new T.PlaneGeometry(4.6, 0.23, cols, 1),
      sp = strip.getAttribute('position');
    for (let i = 0; i < sp.count; i++)
      sp.setY(i, sp.getY(i) - 0.11 * Math.cos((sp.getX(i) / 4.6) * Math.PI) ** 2);
    strip.rotateY(side % 2 ? Math.PI / 2 : 0).translate(centre.x, 2.4, centre.z);
    strip.computeVertexNormals();
    b.add('Hanging hemmed valance', 'fabric', side % 2 ? PAINT : ORANGE, strip);
  }
  for (const x of [-2.16, 2.16])
    for (const z of [-2.16, 2.16]) {
      b.box('Canopy spreader foot', 'metal', 0x737e78, [0.2, 0.025, 0.2], [x, 0.013, z], 0.005);
      b.bar(
        'Telescoping lower canopy leg',
        'metal',
        0xb4bab6,
        [x, 0.03, z],
        [x, 1.42, z],
        0.024,
        8,
      );
      b.bar('Telescoping upper canopy leg', 'metal', STEEL, [x, 1.05, z], [x, 2.54, z], 0.031, 8);
      b.box('Leg height locking collar', 'coated', DARK, [0.085, 0.1, 0.085], [x, 1.2, z]);
      b.box(
        'Fabric-covered ballast weight',
        'rubber',
        0x41433b,
        [0.26, 0.28, 0.25],
        [x + Math.sign(x) * 0.045, 0.17, z],
        0.04,
      );
      b.bar('Roof centre tension rib', 'metal', STEEL, [x, 2.49, z], [0, 3.47, 0], 0.013, 6);
    }
  for (let side = 0; side < 4; side++) {
    const a = new T.Vector3(...corners[side]).multiply(new T.Vector3(0.94, 1, 0.94));
    const c = new T.Vector3(...corners[(side + 1) % 4]).multiply(new T.Vector3(0.94, 1, 0.94));
    for (let k = 0; k < 4; k++)
      for (const flip of [false, true]) {
        const p = a.clone().lerp(c, k / 4),
          q = a.clone().lerp(c, (k + 1) / 4);
        p.y = flip ? 2.04 : 2.32;
        q.y = flip ? 2.32 : 2.04;
        b.bar('Folding scissor-truss link', 'metal', STEEL, p.toArray(), q.toArray(), 0.012, 6);
      }
  }
}

function trolley(b: Builder) {
  b.box('Welded cabinet carcass', 'coated', PAINT, [0.92, 0.72, 0.5], [0, 0.54, 0], 0.025);
  b.box(
    'Rubber-lined recessed worktop',
    'rubber',
    0x343a35,
    [0.87, 0.023, 0.455],
    [0, 0.919, 0],
    0.014,
  );
  for (const x of [-0.465, 0.465])
    b.box('Rolled worktop edge', 'metal', STEEL, [0.024, 0.07, 0.54], [x, 0.915, 0]);
  for (const z of [-0.257, 0.257])
    b.box('Rolled worktop edge', 'metal', STEEL, [0.94, 0.07, 0.02], [0, 0.915, z]);
  for (let i = 0; i < 6; i++) {
    const y = 0.267 + i * 0.105;
    b.box(
      'Separated drawer face',
      'coated',
      i % 2 ? 0x536c64 : PAINT,
      [0.824, 0.089, 0.018],
      [0, y, 0.263],
      0.004,
    );
    b.box(
      'Drawer recessed pull channel',
      'rubber',
      DARK,
      [0.72, 0.019, 0.013],
      [0, y + 0.025, 0.278],
      0.003,
    );
    b.bar(
      'Drawer rolled aluminium pull',
      'metal',
      STEEL,
      [-0.345, y + 0.029, 0.29],
      [0.345, y + 0.029, 0.29],
      0.008,
      8,
    );
  }
  b.bar(
    'Trolley key cylinder',
    'metal',
    STEEL,
    [0.35, 0.845, 0.256],
    [0.35, 0.845, 0.267],
    0.012,
    10,
  );
  for (const x of [-0.33, 0.33])
    for (const z of [-0.17, 0.17]) {
      b.wheel('Swivel caster', x, 0.072, z, 0.071, 0.045);
      b.box('Caster swivel fork', 'metal', 0x838e89, [0.085, 0.12, 0.065], [x, 0.128, z], 0.007);
    }
  b.curve(
    'Bent tubular pushing handle',
    'metal',
    STEEL,
    [
      [0.46, 0.75, -0.18],
      [0.58, 0.76, -0.18],
      [0.6, 0.77, 0],
      [0.58, 0.76, 0.18],
      [0.46, 0.75, 0.18],
    ],
    0.016,
  );
  b.bar('Rubber trolley handle grip', 'rubber', DARK, [0.6, 0.77, -0.1], [0.6, 0.77, 0.1], 0.023);
  b.box('Tool tray', 'coated', ORANGE, [0.32, 0.037, 0.19], [-0.2, 0.95, -0.05], 0.012);
  for (let i = 0; i < (b.detail === 'near' ? 6 : 3); i++) {
    const x = -0.32 + i * 0.045;
    b.bar(
      'Socket set',
      'metal',
      0xa9b0ab,
      [x, 0.967, -0.06],
      [x, 1.002 + i * 0.004, -0.06],
      0.012 + i * 0.0015,
      8,
    );
  }
  b.bar('Ratchet handle', 'metal', STEEL, [0.09, 0.947, 0.04], [0.32, 0.947, 0.04], 0.009, 8);
  b.ring('Ratchet head', 'metal', STEEL, [0.33, 0.95, 0.04], 0.018, 0.007, [Math.PI / 2, 0, 0]);
}

function washer(b: Builder) {
  for (const x of [-0.24, 0.24]) {
    b.curve(
      'Continuous washer roll cage',
      'coated',
      0x394542,
      [
        [x, 0.16, 0.29],
        [x, 0.12, -0.26],
        [x, 0.39, -0.33],
        [x, 1.02, -0.29],
        [x, 1.12, -0.2],
      ],
      0.021,
    );
    b.wheel('All-terrain washer wheel', x, 0.16, -0.23, 0.158, 0.075);
    b.box('Washer vibration foot', 'rubber', DARK, [0.09, 0.075, 0.09], [x, 0.06, 0.235]);
  }
  b.bar(
    'Washer handle crossbar',
    'coated',
    0x394542,
    [-0.24, 1.12, -0.2],
    [0.24, 1.12, -0.2],
    0.021,
  );
  b.bar('Washer handle grip', 'rubber', DARK, [-0.16, 1.12, -0.2], [0.16, 1.12, -0.2], 0.027);
  b.box('Engine mount plate', 'metal', 0x7c8981, [0.46, 0.026, 0.47], [0, 0.22, 0.01]);
  b.box('Painted engine housing', 'coated', ORANGE, [0.26, 0.29, 0.3], [-0.045, 0.38, 0.025], 0.04);
  b.box(
    'Fuel tank with rolled corners',
    'coated',
    0xd1cebd,
    [0.35, 0.15, 0.25],
    [-0.025, 0.57, -0.02],
    0.028,
  );
  b.bar('Fuel filler cap', 'rubber', DARK, [-0.025, 0.64, -0.02], [-0.025, 0.68, -0.02], 0.034, 12);
  b.bar('Motor recoil housing', 'coated', DARK, [-0.02, 0.37, 0.15], [-0.02, 0.37, 0.213], 0.105);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    b.bar(
      'Recoil cooling slot',
      'rubber',
      0x101a18,
      [-0.02 + Math.cos(a) * 0.04, 0.37 + Math.sin(a) * 0.04, 0.216],
      [-0.02 + Math.cos(a) * 0.083, 0.37 + Math.sin(a) * 0.083, 0.216],
      0.006,
      5,
    );
  }
  for (let i = 0; i < 5; i++)
    b.box(
      'Cast motor cooling fin',
      'metal',
      0x7e8780,
      [0.13, 0.015, 0.23],
      [0.15, 0.315 + i * 0.035, 0.01],
      0.003,
    );
  b.box('Brass pressure pump', 'metal', 0x9c8b55, [0.13, 0.11, 0.15], [0.16, 0.27, 0.185]);
  b.bar('Pump outlet fitting', 'metal', 0xa29362, [0.22, 0.28, 0.2], [0.29, 0.28, 0.2], 0.015, 6);
  const points: V3[] = [];
  const turns = 4,
    steps = b.detail === 'near' ? 100 : 56;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * turns * Math.PI * 2;
    points.push([Math.cos(a) * 0.16, 0.83 + Math.sin(a) * 0.15, -0.14 + (i / steps) * 0.1]);
  }
  b.curve('Coiled high-pressure hose', 'rubber', 0x292d29, points, 0.009);
  b.bar('Stowed pressure lance', 'metal', STEEL, [0.22, 0.3, 0.08], [0.27, 0.91, -0.04], 0.007, 8);
  b.box(
    'Lance trigger grip',
    'rubber',
    DARK,
    [0.04, 0.12, 0.09],
    [0.271, 0.958, -0.04],
    0.012,
    [0.2, 0, -0.1],
  );
}

function tank(b: Builder) {
  for (const x of [-0.45, 0, 0.45])
    for (const z of [-0.44, 0.44])
      b.box('Pallet support block', 'rubber', 0x343b33, [0.2, 0.12, 0.19], [x, 0.06, z], 0.015);
  for (const z of [-0.44, 0.44])
    b.box('Pallet runner', 'timber', 0x7e7860, [1.19, 0.037, 0.21], [0, 0.019, z], 0.007);
  for (let i = 0; i < 6; i++)
    b.box(
      'Pallet deck plank',
      'timber',
      i % 2 ? 0x8a8268 : 0x797660,
      [0.17, 0.034, 1.01],
      [-0.5 + i * 0.2, 0.136, 0],
      0.004,
    );
  b.box(
    'Rounded opaque HDPE water vessel',
    'coated',
    0xc9cdbf,
    [1.09, 0.96, 0.91],
    [0, 0.64, 0],
    0.08,
  );
  for (const y of [0.21, 0.55, 0.87, 1.105]) {
    for (const z of [-0.475, 0.475])
      b.bar(
        'Water-tank cage horizontal rail',
        'metal',
        STEEL,
        [-0.57, y, z],
        [0.57, y, z],
        0.013,
        6,
      );
    for (const x of [-0.57, 0.57])
      b.bar('Water-tank cage end rail', 'metal', STEEL, [x, y, -0.475], [x, y, 0.475], 0.013, 6);
  }
  for (const z of [-0.475, 0.475])
    for (let i = 0; i < 7; i++) {
      const x = -0.55 + (i * 1.1) / 6;
      b.bar(
        'Welded tank-cage vertical member',
        'metal',
        STEEL,
        [x, 0.18, z],
        [x, 1.11, z],
        0.011,
        6,
      );
    }
  for (const x of [-0.57, 0.57])
    for (let i = 0; i < 5; i++) {
      const z = -0.46 + i * 0.23;
      b.bar('Welded tank-cage end member', 'metal', STEEL, [x, 0.18, z], [x, 1.11, z], 0.011, 6);
    }
  b.bar('Tank lid neck', 'coated', 0xb8bfab, [0, 1.1, 0], [0, 1.16, 0], 0.115);
  b.bar('Screw-on filler lid', 'rubber', DARK, [0, 1.16, 0], [0, 1.195, 0], 0.12);
  b.bar('Recessed outlet shroud', 'rubber', 0x434f42, [0, 0.24, 0.45], [0, 0.24, 0.52], 0.075);
  b.bar('Drain spigot', 'coated', 0xcecfc1, [0, 0.24, 0.49], [0, 0.24, 0.62], 0.039);
  b.box('Butterfly valve handle', 'coated', ORANGE, [0.145, 0.021, 0.04], [0, 0.304, 0.57]);
  b.box(
    'Blank original service-label holder',
    'coated',
    0xe1ddc5,
    [0.3, 0.22, 0.013],
    [-0.23, 0.77, 0.493],
    0.005,
  );
  for (let i = 0; i < 3; i++)
    b.box(
      'Water level ticks',
      'coated',
      0x657368,
      [0.1, 0.009, 0.004],
      [-0.25, 0.81 - i * 0.05, 0.503],
      0,
    );
}

function marshal(b: Builder) {
  const deck = 0.66;
  for (const x of [-0.7, 0.7])
    for (const z of [-0.55, 0.55]) {
      b.box(
        'Wide platform ground shoe',
        'metal',
        0x77837a,
        [0.24, 0.035, 0.24],
        [x, 0.018, z],
        0.006,
      );
      b.bar(
        'Braced platform support',
        'metal',
        STEEL,
        [x, 0.033, z],
        [x, deck + 1.02, z],
        0.025,
        8,
      );
      b.bolt([x, deck - 0.08, z + 0.025]);
    }
  for (const z of [-0.55, 0.55]) {
    b.bar(
      'Cross-braced platform diagonal',
      'metal',
      0x7f8a81,
      [-0.7, 0.1, z],
      [0.7, deck - 0.04, z],
      0.014,
      6,
    );
    b.bar(
      'Cross-braced platform diagonal',
      'metal',
      0x7f8a81,
      [-0.7, deck - 0.04, z],
      [0.7, 0.1, z],
      0.014,
      6,
    );
    b.box('Platform rim beam', 'metal', 0x718076, [1.54, 0.075, 0.07], [0, deck - 0.048, z]);
    for (const y of [deck + 0.55, deck + 1.02])
      b.bar('Platform safety rail', 'metal', STEEL, [-0.7, y, z], [0.7, y, z], 0.02, 8);
  }
  for (let i = 0; i < 8; i++)
    b.box(
      'Individual non-slip platform plank',
      'timber',
      i % 2 ? 0x807e66 : 0x969079,
      [0.177, 0.043, 1.17],
      [-0.662 + i * 0.189, deck - 0.012, 0],
      0.004,
    );
  for (const z of [-0.568, 0.568])
    b.box('Safety toe-board', 'coated', PAINT, [1.5, 0.1, 0.025], [0, deck + 0.053, z]);
  for (const y of [deck + 0.55, deck + 1.02])
    b.bar('Closed platform end rail', 'metal', STEEL, [-0.7, y, -0.55], [-0.7, y, 0.55], 0.02, 8);
  // +X remains open for a separate access ladder, never rails through an entry.
  for (const z of [-0.3, 0.3])
    b.bar(
      'Angled access ladder stringer',
      'metal',
      STEEL,
      [1.12, 0.03, z],
      [0.72, deck + 0.025, z],
      0.022,
      8,
    );
  for (let i = 0; i < 4; i++)
    b.box(
      'Open tread access step',
      'metal',
      0x828d84,
      [0.17, 0.022, 0.65],
      [1.07 - i * 0.09, 0.08 + i * 0.165, 0],
      0.004,
    );
  for (const x of [-0.69, 0.69])
    for (const z of [-0.54, 0.54])
      b.bar(
        'Marshal shade-post extension',
        'metal',
        STEEL,
        [x, deck + 1.02, z],
        [x, 2.35, z],
        0.02,
        8,
      );
  b.box(
    'Lightweight sloped shade roof',
    'coated',
    0xaab0a2,
    [1.92, 0.032, 1.62],
    [0.02, 2.4, 0],
    0.008,
    [0, 0, -0.06],
  );
  if (b.detail === 'near')
    for (let i = 0; i < 10; i++) {
      const x = -0.84 + i * 0.19;
      b.bar(
        'Roof stiffening ridge',
        'coated',
        0x979f91,
        [x, 2.426 - x * 0.06, -0.78],
        [x, 2.426 - x * 0.06, 0.78],
        0.008,
        5,
      );
    }
  for (let i = 0; i < 3; i++) {
    const x = -0.48 + i * 0.11;
    b.bar(
      'Stowed signal-flag pole',
      'timber',
      0x999477,
      [x, deck + 0.22, -0.58],
      [x + 0.025, deck + 1.48, -0.58],
      0.009,
      6,
    );
    b.box(
      'Rolled inactive marshal flag',
      'fabric',
      [0xb6a75e, 0x697d59, 0xc8c8b9][i],
      [0.055, 0.46, 0.05],
      [x + 0.02, deck + 1.17, -0.58],
      0.01,
    );
  }
}

function speakers(b: Builder) {
  // Two separate cabinets: rounded baffle lips, recessed drivers, open grille
  // slats and real carrying handles, not a flat image pasted onto a box.
  for (let level = 0; level < 2; level++) {
    const y = 0.11 + level * 0.8;
    b.box(
      'Textured moulded speaker cabinet',
      'rubber',
      0x363a35,
      [0.62, 0.76, 0.45],
      [0, y + 0.38, 0],
      0.045,
    );
    b.box(
      'Recessed speaker baffle',
      'coated',
      0x1c2420,
      [0.535, 0.65, 0.017],
      [0, y + 0.38, 0.228],
      0.013,
    );
    const cy = y + 0.3;
    b.bar(
      'Recessed woofer cone',
      'rubber',
      0x4d5147,
      [0, cy, 0.24],
      [0, cy, 0.248],
      0.188,
      b.round * 2,
    );
    b.ring('Driver suspension surround', 'rubber', 0x1c221e, [0, cy, 0.256], 0.172, 0.017);
    b.bar('Woofer dust cap', 'rubber', 0x383e35, [0, cy, 0.245], [0, cy, 0.267], 0.068, b.round);
    b.box(
      'Recessed horn throat',
      'rubber',
      0x111a16,
      [0.28, 0.125, 0.021],
      [0, y + 0.59, 0.245],
      0.018,
    );
    const rows = b.detail === 'near' ? 22 : 12;
    for (let i = 0; i < rows; i++)
      b.box(
        'Perforated metal grille horizontal',
        'metal',
        0x535d51,
        [0.505, 0.006, 0.009],
        [0, y + 0.086 + (i * 0.592) / (rows - 1), 0.287],
        0,
      );
    for (let i = 0; i < 9; i++)
      b.box(
        'Perforated metal grille vertical',
        'metal',
        0x535d51,
        [0.006, 0.61, 0.009],
        [-0.244 + i * 0.061, y + 0.385, 0.287],
        0,
      );
    for (const side of [-1, 1]) {
      const x = side * 0.316;
      b.box(
        'Inset carrying handle well',
        'coated',
        0x111a16,
        [0.009, 0.2, 0.1],
        [x, y + 0.43, 0],
        0.006,
      );
      b.bar(
        'Speaker carrying grip',
        'rubber',
        0x626558,
        [x + side * 0.009, y + 0.36, 0],
        [x + side * 0.009, y + 0.5, 0],
        0.014,
        8,
      );
      for (const z of [-0.15, 0.15])
        b.box(
          'Stacking isolation foot',
          'rubber',
          DARK,
          [0.06, 0.085, 0.075],
          [side * 0.22, y - 0.023, z],
          0.012,
        );
    }
    b.box(
      'Small maker-plate recess',
      'coated',
      0x9d9a7c,
      [0.08, 0.025, 0.007],
      [0, y + 0.077, 0.3],
      0.002,
    );
  }
  b.curve(
    'Rear audio cable service loop',
    'rubber',
    0x202b23,
    [
      [0.1, 0.87, -0.24],
      [0.14, 0.61, -0.31],
      [-0.02, 0.13, -0.33],
      [-0.2, 0.035, -0.13],
      [-0.32, 0.035, 0.13],
    ],
    0.008,
  );
}

/** Fresh buffers per request: disposing a venue cannot invalidate a preview. */
export function mxTracksideParts(
  kind: MxTracksideModel,
  detail: MxTracksideDetail = 'near',
): MxTracksidePart[] {
  const b = new Builder(detail);
  const build: Record<MxTracksideModel, (builder: Builder) => void> = {
    canopy,
    'tool-trolley': trolley,
    'pressure-washer': washer,
    'water-tank': tank,
    'marshal-post': marshal,
    'speaker-stack': speakers,
  };
  build[kind](b);
  // A stable floor datum for both export variants and ground placement.
  const floor = Math.min(...b.parts.map((p) => p.geometry.boundingBox!.min.y));
  for (const part of b.parts) {
    part.geometry.translate(0, -floor, 0);
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
  }
  return b.parts;
}

/** Bakes five material groups at most. Logical part names stay available for
 * review and export even though the renderer need not draw hundreds of parts. */
export function buildMxTracksideModel(kind: MxTracksideModel, detail: MxTracksideDetail = 'near') {
  const palette = mxTracksidePalette(),
    parts = mxTracksideParts(kind, detail),
    root = new T.Group();
  root.name = `MX authored ${kind}`;
  root.userData.model = kind;
  root.userData.detail = detail;
  root.userData.partNames = parts.map((p) => p.name);
  for (const role of Object.keys(palette) as MxTracksideMaterial[]) {
    const selected = parts.filter((p) => p.material === role);
    if (!selected.length) {
      palette[role].dispose();
      continue;
    }
    const geometry = mergeGeometries(
      selected.map((p) => p.geometry),
      false,
    );
    if (!geometry) throw new Error(`Incompatible MX ${kind}/${role} buffers`);
    selected.forEach((p) => p.geometry.dispose());
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, palette[role]);
    mesh.name = `${kind} / ${role}`;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}
