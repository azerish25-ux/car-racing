import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  TF,
  TRAFFIC_FLAG,
  TRAFFIC_HEADER,
  TRAFFIC_STRIDE,
} from '../simulation/open-world/ambient-traffic.ts';
import { vehicleAt, type VehicleDefinition } from '../simulation/vehicles.ts';
import { installSpecularIBL } from './studio/ibl-energy.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';
import { PLATE, plateAtlas, plateSlot, plateUv } from './open-world/festival-plates.ts';

/** Most ambient cars drawn at once (the simulation caps the field lower). */
export const TRAFFIC_CAPACITY = 48;

/** Japanese everyday traffic (references 006, 030, 038, 056, 059, 061, 091):
 * kei tall wagons and kei trucks, compact hatches, saloons, minivans and a
 * cab-over light truck, in the white / pearl / silver / black that dominates
 * Japanese roads. Each body is authored at its real size with the ground at
 * y = 0 and stretched only in plan to the simulated collision footprint, so a
 * car never overhangs or falls short of what it collides with; heights stay
 * real and wheels stay round (a vertex correction undoes the stretch on the
 * wheels). One instanced draw per body type carries paint, glass, trim,
 * wheels, lamps and plates through per-vertex material classes; one more
 * draws the soft ground contact under every car. */
export type TrafficBody = 'sedan' | 'hatch' | 'kei' | 'keiTruck' | 'minivan' | 'truck';
interface Shape {
  body: TrafficBody;
  /** Overall length and width (m). */
  length: number;
  width: number;
  /** Tyre radius and section width (m); rear and front axle z. */
  wheel: number;
  tyre: number;
  axles: readonly [number, number];
  /** Sill (body underside) height above the road. */
  floor: number;
  /** Lower-body stations, rear to front: z, half width, belt (deck) height. */
  rings: readonly (readonly [number, number, number])[];
  crown: number;
  /** Greenhouse: base (windscreen foot, rear-glass foot) and roof (front,
   * rear) stations, roof height and half width, and side-window pillars. */
  cabin: {
    base: readonly [number, number];
    roof: readonly [number, number];
    roofY: number;
    roofHalf: number;
    pillars: readonly number[];
    /** Rear glass inset (m) inside its painted frame (a cab's small window). */
    rearInset?: number;
  };
  /** Open load bed behind the cab (z from, z to, side height). */
  bed?: readonly [number, number, number];
  wheels: 'alloy' | 'steel';
  kei: boolean;
  /** Lamp layout: head centre height, tail centre height, vertical tails. */
  head: number;
  tail: number;
  tallTail: boolean;
}
export const TRAFFIC_SHAPES: Readonly<Record<TrafficBody, Shape>> = {
  sedan: {
    body: 'sedan',
    length: 4.85,
    width: 1.8,
    wheel: 0.33,
    tyre: 0.215,
    axles: [-1.42, 1.43],
    floor: 0.2,
    rings: [
      [-2.425, 0.79, 0.74],
      [-2.3, 0.86, 0.86],
      [-1.9, 0.9, 0.93],
      [-1.2, 0.9, 0.95],
      [0, 0.9, 0.92],
      [1.0, 0.9, 0.88],
      [1.7, 0.88, 0.83],
      [2.2, 0.85, 0.77],
      [2.425, 0.78, 0.68],
    ],
    crown: 0.05,
    cabin: {
      base: [1.0, -1.32],
      roof: [0.18, -0.72],
      roofY: 1.45,
      roofHalf: 0.66,
      pillars: [-0.2],
    },
    wheels: 'alloy',
    kei: false,
    head: 0.7,
    tail: 0.82,
    tallTail: false,
  },
  hatch: {
    body: 'hatch',
    length: 4.0,
    width: 1.7,
    wheel: 0.3,
    tyre: 0.185,
    axles: [-1.24, 1.28],
    floor: 0.18,
    rings: [
      [-2.0, 0.76, 0.8],
      [-1.88, 0.82, 0.92],
      [-1.4, 0.85, 0.95],
      [0, 0.85, 0.92],
      [1.0, 0.84, 0.86],
      [1.6, 0.81, 0.78],
      [2.0, 0.75, 0.66],
    ],
    crown: 0.05,
    cabin: {
      base: [0.95, -1.8],
      roof: [0.22, -1.6],
      roofY: 1.52,
      roofHalf: 0.64,
      pillars: [-0.32, -1.32],
    },
    wheels: 'alloy',
    kei: false,
    head: 0.74,
    tail: 1.02,
    tallTail: true,
  },
  kei: {
    body: 'kei',
    length: 3.4,
    width: 1.48,
    wheel: 0.28,
    tyre: 0.155,
    axles: [-1.18, 1.2],
    floor: 0.17,
    rings: [
      [-1.7, 0.69, 0.9],
      [-1.62, 0.73, 0.98],
      [-1.2, 0.74, 1.0],
      [0, 0.74, 0.98],
      [1.0, 0.74, 0.92],
      [1.45, 0.72, 0.84],
      [1.7, 0.68, 0.74],
    ],
    crown: 0.04,
    cabin: {
      base: [1.3, -1.64],
      roof: [0.62, -1.66],
      roofY: 1.76,
      roofHalf: 0.68,
      pillars: [-0.02, -1.08],
    },
    wheels: 'steel',
    kei: true,
    head: 0.84,
    tail: 1.02,
    tallTail: true,
  },
  keiTruck: {
    body: 'keiTruck',
    length: 3.4,
    width: 1.48,
    wheel: 0.27,
    tyre: 0.145,
    axles: [-1.02, 0.92],
    floor: 0.22,
    rings: [
      [-1.7, 0.73, 0.7],
      [-0.45, 0.73, 0.7],
      [-0.4, 0.74, 1.02],
      [1.2, 0.74, 1.04],
      [1.6, 0.73, 1.02],
      [1.7, 0.71, 0.96],
    ],
    crown: 0.03,
    cabin: {
      // A near-upright cab-over screen (ref 006).
      base: [1.66, -0.43],
      roof: [1.4, -0.41],
      roofY: 1.78,
      roofHalf: 0.66,
      pillars: [0.55],
      rearInset: 0.22,
    },
    bed: [-1.7, -0.47, 0.28],
    wheels: 'steel',
    kei: true,
    head: 0.8,
    tail: 0.56,
    tallTail: false,
  },
  minivan: {
    body: 'minivan',
    length: 4.7,
    width: 1.72,
    wheel: 0.32,
    tyre: 0.195,
    axles: [-1.4, 1.42],
    floor: 0.2,
    rings: [
      [-2.35, 0.8, 0.96],
      [-2.26, 0.84, 1.03],
      [-1.8, 0.86, 1.05],
      [0, 0.86, 1.03],
      [1.3, 0.86, 0.98],
      [1.95, 0.83, 0.88],
      [2.35, 0.77, 0.76],
    ],
    crown: 0.04,
    cabin: {
      base: [1.72, -2.26],
      roof: [0.78, -2.29],
      roofY: 1.86,
      roofHalf: 0.78,
      pillars: [0.38, -0.98],
    },
    wheels: 'alloy',
    kei: false,
    head: 0.86,
    tail: 1.18,
    tallTail: true,
  },
  truck: {
    body: 'truck',
    length: 6.0,
    width: 1.95,
    wheel: 0.37,
    tyre: 0.205,
    axles: [-1.1, 2.15],
    floor: 0.36,
    rings: [
      [-3.0, 0.97, 0.98],
      [-1.15, 0.97, 0.98],
      [1.15, 0.97, 0.98],
      [1.2, 0.96, 1.18],
      [2.8, 0.96, 1.18],
      [2.95, 0.93, 1.05],
      [3.0, 0.9, 0.85],
    ],
    crown: 0.03,
    cabin: {
      base: [2.92, 1.2],
      roof: [2.45, 1.22],
      roofY: 2.2,
      roofHalf: 0.9,
      pillars: [2.0],
      rearInset: 0.32,
    },
    bed: [-3.0, 1.12, 0.42],
    wheels: 'steel',
    kei: false,
    head: 0.9,
    tail: 0.78,
    tallTail: false,
  },
};
export const TRAFFIC_BODIES = Object.keys(TRAFFIC_SHAPES) as TrafficBody[];

/** Per-vertex material classes: [paint, roughness, metalness, clearcoat] and
 * an emitter class (0 none, 1 head, 2 tail, 3 indicator, 4 plate). */
type Finish = readonly [number, number, number, number];
const PAINT: Finish = [1, 0.45, 0.15, 1];
const GLASS: Finish = [0, 0.04, 0.0, 1];
const PLASTIC: Finish = [0, 0.62, 0.0, 0];
const GLOSS_BLACK: Finish = [0, 0.3, 0.05, 0];
const CHROME: Finish = [0, 0.18, 1.0, 0];
const RUBBER: Finish = [0, 0.82, 0.0, 0];
const ALLOY: Finish = [0, 0.32, 0.85, 0];
const STEEL_WHEEL: Finish = [0, 0.45, 0.6, 0];
const LENS: Finish = [0, 0.1, 0.1, 1];
const PLATE_FACE: Finish = [0, 0.42, 0.15, 0];
/** Emitter classes; 4 and 5 are the lit rear and unlit front plates. */
const EMIT = { none: 0, head: 1, tail: 2, amber: 3, plate: 4, frontPlate: 5 } as const;
const COLOUR = {
  white: 0xffffff,
  glass: 0x0b1116,
  plastic: 0x16181a,
  black: 0x0a0b0c,
  chrome: 0xc5c9cc,
  rubber: 0x141516,
  alloy: 0xa9adb2,
  steel: 0x8c9196,
  head: 0xeef3f8,
  tail: 0xd2160e,
  amber: 0xff8a1e,
  reflector: 0x6e1410,
  plate: 0xffffff,
};

type Pt = readonly [number, number, number];
interface Piece {
  geometry: T.BufferGeometry;
  finish: Finish;
  colour: number;
  emit: number;
  /** Wheel hub (round-wheel correction and spin); null for the body. */
  hub?: readonly [number, number, number];
  spin?: boolean;
  plate?: boolean;
}
class Kit {
  readonly pieces: Piece[] = [];
  add(geometry: T.BufferGeometry, finish: Finish, colour: number, extra: Partial<Piece> = {}) {
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    this.pieces.push({ geometry, finish, colour, emit: EMIT.none, ...extra });
    return geometry;
  }
  patch(points: Pt[], index: number[], finish: Finish, colour: number, extra?: Partial<Piece>) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(points.flat(), 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return this.add(g, finish, colour, extra);
  }
  /** Convex face with an explicit outward direction. */
  face(points: Pt[], outward: Pt, finish: Finish, colour: number, extra?: Partial<Piece>) {
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
    return this.patch(points, index, finish, colour, extra);
  }
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    l: number,
    finish: Finish,
    colour: number,
    extra?: Partial<Piece>,
  ) {
    return this.add(new T.BoxGeometry(w, h, l).translate(x, y, z), finish, colour, extra);
  }
  /** One geometry with position, normal, uv, colour, finish, emitter, hub. */
  build() {
    const plain = plateUv(31);
    const parts = this.pieces.map((p) => {
      const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
      if (g !== p.geometry) p.geometry.dispose();
      const n = g.getAttribute('position').count;
      for (const name of Object.keys(g.attributes))
        if (name !== 'position' && name !== 'normal' && !(p.plate && name === 'uv'))
          g.deleteAttribute(name);
      if (!p.plate) {
        // Every non-plate surface samples the atlas's plain white slot.
        const uv = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
          uv[i * 2] = (plain[0] + plain[2]) / 2;
          uv[i * 2 + 1] = (plain[1] + plain[3]) / 2;
        }
        g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      }
      const colour = new T.Color(p.colour),
        colours = new Float32Array(n * 3),
        finish = new Float32Array(n * 4),
        emit = new Float32Array(n),
        hub = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        colour.toArray(colours, i * 3);
        finish.set(p.finish, i * 4);
        emit[i] = p.emit;
        if (p.hub) hub.set([p.hub[0], p.hub[1], p.hub[2], p.spin ? 2 : 1], i * 4);
      }
      g.setAttribute('color', new T.BufferAttribute(colours, 3));
      g.setAttribute('trafficFinish', new T.BufferAttribute(finish, 4));
      g.setAttribute('trafficEmit', new T.BufferAttribute(emit, 1));
      g.setAttribute('trafficHub', new T.BufferAttribute(hub, 4));
      return g;
    });
    const out = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Plan width and deck height of the lower body at z. */
function profile(shape: Shape, z: number) {
  const rings = shape.rings;
  let i = 0;
  while (i < rings.length - 2 && z > rings[i + 1][0]) i++;
  const a = rings[i],
    b = rings[i + 1],
    t = Math.max(0, Math.min(1, (z - a[0]) / (b[0] - a[0])));
  return { half: lerp(a[1], b[1], t), belt: lerp(a[2], b[2], t) };
}
function lowerBody(kit: Kit, s: Shape) {
  const arch = s.wheel + 0.04;
  const stations = s.rings.map((r) => r[0]);
  for (const z of s.axles) {
    // Close stations at the arch ends give a clean vertical return to the
    // sill; the others trace the open circular wheel cutout.
    stations.push(z - arch - 0.002, z + arch + 0.002);
    for (let i = 0; i <= 12; i++) stations.push(z + Math.cos((i / 12) * Math.PI) * arch);
  }
  const zs = [...new Set(stations.map((z) => Math.round(z * 1e4) / 1e4))]
    .filter((z) => z >= s.rings[0][0] && z <= s.rings[s.rings.length - 1][0])
    .sort((a, b) => a - b);
  const across = [-0.98, -0.82, -0.45, 0, 0.45, 0.82, 0.98];
  const top: Pt[] = [],
    topIndex: number[] = [];
  for (const z of zs) {
    const p = profile(s, z);
    for (const x of across) top.push([x * p.half, p.belt + s.crown * (1 - (x / 0.98) ** 2), z]);
  }
  for (let row = 0; row < zs.length - 1; row++)
    for (let col = 0; col < across.length - 1; col++) {
      const a = row * across.length + col,
        b = a + across.length;
      topIndex.push(a, b, a + 1, a + 1, b, b + 1);
    }
  kit.patch(top, topIndex, PAINT, COLOUR.white);
  for (const side of [-1, 1]) {
    const points: Pt[] = [],
      index: number[] = [];
    for (const z of zs) {
      const p = profile(s, z);
      let sill = s.floor;
      for (const axle of s.axles) {
        const d = Math.abs(z - axle);
        if (d < arch - 1e-5) sill = Math.max(sill, s.wheel + Math.sqrt(arch * arch - d * d));
      }
      points.push(
        [side * p.half * 0.95, sill, z],
        [side * p.half, sill + (p.belt - sill) * 0.55, z],
        [side * p.half * 0.985, p.belt, z],
      );
    }
    for (let row = 0; row < zs.length - 1; row++)
      for (let col = 0; col < 2; col++) {
        const a = row * 3 + col,
          b = a + 3;
        index.push(...(side > 0 ? [a, a + 1, b + 1, a, b + 1, b] : [a, b + 1, a + 1, a, b, b + 1]));
      }
    kit.patch(points, index, PAINT, COLOUR.white);
    // Arch lips and recessed black liners give the openings thickness.
    for (const axle of s.axles) {
      const lip: Pt[] = [],
        well: Pt[] = [],
        indices: number[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI;
        for (const radius of [arch, arch + 0.024]) {
          const z = axle + Math.cos(a) * radius;
          lip.push([side * (profile(s, z).half + 0.003), s.wheel + Math.sin(a) * radius, z]);
        }
        const z = axle + Math.cos(a) * arch,
          y = s.wheel + Math.sin(a) * arch;
        well.push([side * profile(s, z).half, y, z], [side * (profile(s, z).half - 0.2), y, z]);
        if (i < 16) {
          const j = i * 2;
          indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
        }
      }
      const lipIndex = indices.slice();
      if (side < 0)
        for (let i = 0; i < lipIndex.length; i += 3)
          [lipIndex[i + 1], lipIndex[i + 2]] = [lipIndex[i + 2], lipIndex[i + 1]];
      kit.patch(lip, lipIndex, s.kei ? PLASTIC : PAINT, s.kei ? COLOUR.plastic : COLOUR.white);
      kit.patch(well, indices, PLASTIC, COLOUR.plastic);
    }
  }
  // End faces.
  for (const z of [s.rings[0][0], s.rings[s.rings.length - 1][0]]) {
    const p = profile(s, z);
    const points: Pt[] = across.map((x) => [
      x * p.half,
      p.belt + s.crown * (1 - (x / 0.98) ** 2),
      z,
    ]);
    points.push([p.half * 0.95, s.floor, z], [-p.half * 0.95, s.floor, z]);
    kit.face(points, [0, 0, Math.sign(z)], PAINT, COLOUR.white);
  }
  // Underfloor, dark.
  const zr = s.rings[0][0],
    zf = s.rings[s.rings.length - 1][0];
  kit.box(
    0,
    s.floor + 0.02,
    (zr + zf) / 2,
    s.width * 0.82,
    0.04,
    zf - zr - 0.1,
    PLASTIC,
    COLOUR.black,
  );
}
/** Inset a convex polygon towards its centroid by `d` metres. */
function inset(points: readonly Pt[], d: number, lift: T.Vector3): Pt[] {
  const c = points
    .reduce((p, v) => p.add(new T.Vector3(...v)), new T.Vector3())
    .multiplyScalar(1 / points.length);
  return points.map((p) => {
    const v = new T.Vector3(...p).sub(c);
    const l = v.length();
    v.multiplyScalar(Math.max(0, 1 - d / Math.max(l, 1e-6)))
      .add(c)
      .add(lift);
    return [v.x, v.y, v.z] as const;
  });
}
function greenhouse(kit: Kit, s: Shape) {
  const { base, roof, roofY, roofHalf, pillars } = s.cabin;
  const edgeY = roofY - 0.03;
  const baseAt = (z: number) => {
    const p = profile(s, z);
    return { x: p.half * 0.93, y: p.belt + s.crown * 0.12 };
  };
  const bf = baseAt(base[0]),
    br = baseAt(base[1]);
  // Crowned roof.
  const across = [-1, -0.7, 0, 0.7, 1],
    rows = [roof[1], lerp(roof[1], roof[0], 0.33), lerp(roof[1], roof[0], 0.66), roof[0]];
  const pts: Pt[] = [],
    index: number[] = [];
  for (const z of rows) for (const x of across) pts.push([x * roofHalf, roofY - 0.03 * x * x, z]);
  for (let r = 0; r < rows.length - 1; r++)
    for (let c = 0; c < across.length - 1; c++) {
      const a = r * across.length + c,
        b = a + across.length;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  kit.patch(pts, index, PAINT, COLOUR.white);
  const framed = (points: Pt[], outward: Pt, margin: number) => {
    kit.face(points, outward, PAINT, COLOUR.white);
    const n = new T.Vector3(...outward).normalize().multiplyScalar(0.005);
    kit.face(inset(points, margin, n), outward, GLASS, COLOUR.glass);
  };
  // Windscreen and rear glass.
  framed(
    [
      [-bf.x, bf.y, base[0]],
      [-roofHalf, edgeY, roof[0]],
      [roofHalf, edgeY, roof[0]],
      [bf.x, bf.y, base[0]],
    ],
    [0, base[0] - roof[0], Math.max(0.05, edgeY - bf.y)],
    0.06,
  );
  framed(
    [
      [br.x, br.y, base[1]],
      [roofHalf, edgeY, roof[1]],
      [-roofHalf, edgeY, roof[1]],
      [-br.x, br.y, base[1]],
    ],
    [0, roof[1] - base[1], -Math.max(0.05, edgeY - br.y)],
    s.cabin.rearInset ?? 0.06,
  );
  // Side glass between pillars; the pillar faces are dark gloss trim.
  for (const side of [-1, 1]) {
    const cuts = [0, ...pillars.map((z) => (z - base[1]) / (base[0] - base[1])), 1];
    const lower = (t: number): Pt => {
      const z = lerp(base[1], base[0], t),
        b = baseAt(z);
      return [side * b.x, b.y, z];
    };
    const upper = (t: number): Pt => [side * roofHalf, edgeY, lerp(roof[1], roof[0], t)];
    for (let k = 0; k < cuts.length - 1; k++) {
      const t0 = cuts[k],
        t1 = cuts[k + 1];
      const quad = [lower(t0), upper(t0), upper(t1), lower(t1)];
      const out: Pt = [side, 0.25, 0];
      kit.face(quad, out, PAINT, COLOUR.white);
      const n = new T.Vector3(...out).normalize().multiplyScalar(0.005);
      kit.face(inset(quad, 0.045, n), out, GLASS, COLOUR.glass);
    }
    for (const z of pillars) {
      const t = (z - base[1]) / (base[0] - base[1]);
      const a = lower(t),
        b = upper(t);
      const w = 0.045;
      kit.face(
        [
          [a[0] * 1.004, a[1], a[2] - w],
          [b[0] * 1.006, b[1], b[2] - w],
          [b[0] * 1.006, b[1], b[2] + w],
          [a[0] * 1.004, a[1], a[2] + w],
        ],
        [side, 0.25, 0],
        GLOSS_BLACK,
        COLOUR.black,
      );
    }
    // Mirror: a body-colour shell on a dark stalk ahead of the A pillar.
    const mz = base[0] - 0.08,
      m = baseAt(mz);
    kit.box(side * (m.x + 0.03), m.y + 0.06, mz, 0.07, 0.03, 0.05, PLASTIC, COLOUR.black);
    kit.add(
      new T.SphereGeometry(1, 8, 6)
        .scale(0.045, 0.055, 0.1)
        .translate(side * (m.x + 0.07), m.y + 0.09, mz - 0.02),
      PAINT,
      COLOUR.white,
    );
    // Belt trim and door handles.
    const zb = (base[0] + base[1]) / 2,
      lb = base[0] - base[1];
    const belt = baseAt(zb);
    kit.box(
      side * (belt.x + 0.012),
      belt.y + 0.005,
      zb,
      0.012,
      0.018,
      lb * 0.96,
      GLOSS_BLACK,
      COLOUR.black,
    );
    for (const z of [base[0] - lb * 0.3, ...pillars.slice(0, 1).map((p) => p - 0.25)]) {
      const at = profile(s, z);
      kit.box(
        side * (at.half + 0.006),
        at.belt - 0.09,
        z,
        0.016,
        0.03,
        0.15,
        s.kei ? PLASTIC : PAINT,
        s.kei ? COLOUR.plastic : COLOUR.white,
      );
    }
  }
}
function loadBed(kit: Kit, s: Shape) {
  if (!s.bed) return;
  const [z0, z1, high] = s.bed;
  const p = profile(s, (z0 + z1) / 2),
    floor = p.belt + s.crown;
  const half = p.half * 0.99,
    len = z1 - z0;
  // Drop sides, tailgate and a guard frame behind the cab.
  for (const side of [-1, 1])
    kit.box(
      side * (half - 0.015),
      floor + high / 2,
      (z0 + z1) / 2,
      0.03,
      high,
      len,
      PAINT,
      COLOUR.white,
    );
  kit.box(0, floor + high / 2, z0 + 0.015, half * 2, high, 0.03, PAINT, COLOUR.white);
  kit.box(
    0,
    floor + 0.01,
    (z0 + z1) / 2,
    half * 2 - 0.06,
    0.02,
    len - 0.04,
    PLASTIC,
    COLOUR.plastic,
  );
  const guard = s.cabin.roofY - 0.06 - floor;
  for (const side of [-1, 0, 1])
    kit.box(
      side * (half - 0.04),
      floor + guard / 2,
      z1 - 0.03,
      0.03,
      guard,
      0.03,
      CHROME,
      0x9a9fa3,
    );
  kit.box(0, floor + guard, z1 - 0.03, half * 2 - 0.05, 0.035, 0.035, CHROME, 0x9a9fa3);
  for (let k = 1; k < 4; k++)
    kit.box(
      0,
      floor + high + (guard - high) * (k / 4),
      z1 - 0.03,
      half * 2 - 0.08,
      0.012,
      0.012,
      PLASTIC,
      COLOUR.black,
    );
  // Hinge rails on the drop sides.
  for (const side of [-1, 1])
    kit.box(
      side * (half + 0.002),
      floor + high - 0.03,
      (z0 + z1) / 2,
      0.008,
      0.02,
      len,
      GLOSS_BLACK,
      COLOUR.black,
    );
}
function wheels(kit: Kit, s: Shape) {
  const R = s.wheel,
    w = s.tyre,
    rim = R * (s.wheels === 'steel' ? 0.66 : 0.72);
  const tyreProfile = [
    [rim - 0.005, -w * 0.45],
    [rim + (R - rim) * 0.35, -w * 0.5],
    [R - 0.022, -w * 0.47],
    [R, -w * 0.32],
    [R, w * 0.32],
    [R - 0.022, w * 0.47],
    [rim + (R - rim) * 0.35, w * 0.5],
    [rim - 0.005, w * 0.45],
  ].map(([r, a]) => new T.Vector2(r, a));
  for (const side of [-1, 1])
    for (const z of s.axles) {
      const x = side * (profile(s, z).half - w * 0.5 - 0.012),
        hub = [x, R, z] as const;
      const face = x + side * w * 0.36;
      kit.add(
        new T.LatheGeometry(tyreProfile, 20).rotateZ(-Math.PI / 2).translate(x, R, z),
        RUBBER,
        COLOUR.rubber,
        { hub },
      );
      // Dark brake disc and hub behind the rim.
      kit.add(
        new T.CylinderGeometry(rim * 0.8, rim * 0.8, 0.02, 14)
          .rotateZ(Math.PI / 2)
          .translate(x, R, z),
        PLASTIC,
        0x2b2d30,
        { hub, spin: true },
      );
      if (s.wheels === 'alloy') {
        kit.add(
          new T.TorusGeometry(rim, 0.014, 5, 20).rotateY(Math.PI / 2).translate(face, R, z),
          ALLOY,
          COLOUR.alloy,
          { hub, spin: true },
        );
        for (let k = 0; k < 5; k++) {
          const a = (k * Math.PI * 2) / 5;
          for (const split of [-0.13, 0.13])
            kit.add(
              new T.BoxGeometry(0.02, rim * 0.92, 0.034)
                .translate(0, rim * 0.48, 0)
                .rotateX(a + split)
                .translate(face - side * 0.004, R, z),
              ALLOY,
              COLOUR.alloy,
              { hub, spin: true },
            );
        }
        kit.add(
          new T.CylinderGeometry(rim * 0.24, rim * 0.26, 0.03, 12)
            .rotateZ(Math.PI / 2)
            .translate(face, R, z),
          ALLOY,
          COLOUR.alloy,
          { hub, spin: true },
        );
      } else {
        // Pressed steel wheel behind a plain silver hubcap.
        kit.add(
          new T.CylinderGeometry(rim, rim, 0.012, 18)
            .rotateZ(Math.PI / 2)
            .translate(face - side * 0.012, R, z),
          STEEL_WHEEL,
          0x3a3d40,
          { hub, spin: true },
        );
        kit.add(
          new T.SphereGeometry(rim * 0.72, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2)
            .scale(1, 0.18, 1)
            .rotateZ((-side * Math.PI) / 2)
            .translate(face - side * 0.006, R, z),
          STEEL_WHEEL,
          COLOUR.steel,
          { hub, spin: true },
        );
      }
    }
}
function lamps(kit: Kit, s: Shape) {
  const zf = s.rings[s.rings.length - 1][0],
    zr = s.rings[0][0];
  const front = profile(s, zf),
    rear = profile(s, zr);
  // Lower bumpers and the grille.
  kit.box(
    0,
    s.floor + 0.13,
    zf + 0.012,
    front.half * 1.9,
    0.2,
    0.05,
    s.kei || s.body === 'truck' ? PLASTIC : PAINT,
    s.kei || s.body === 'truck' ? COLOUR.plastic : COLOUR.white,
  );
  kit.box(
    0,
    s.floor + 0.12,
    zr - 0.012,
    rear.half * 1.9,
    0.2,
    0.05,
    s.body === 'truck' || s.body === 'keiTruck' ? GLOSS_BLACK : PAINT,
    s.body === 'truck' || s.body === 'keiTruck' ? COLOUR.black : COLOUR.white,
  );
  const grilleY = (s.head + s.floor + 0.25) / 2;
  kit.box(
    0,
    grilleY,
    zf + 0.008,
    front.half * 0.9,
    Math.min(0.16, s.head - s.floor - 0.22),
    0.02,
    GLOSS_BLACK,
    COLOUR.black,
  );
  for (let k = 0; k < 4; k++)
    kit.box(
      0,
      grilleY - 0.05 + k * 0.033,
      zf + 0.02,
      front.half * 0.86,
      0.008,
      0.012,
      CHROME,
      0x7d8388,
    );
  for (const side of [-1, 1]) {
    // Headlamp: dark housing, bright reflector, projector and an LED line.
    const hx = side * front.half * 0.68,
      hw = front.half * (s.kei ? 0.42 : 0.5);
    kit.box(hx, s.head, zf + 0.01, hw, 0.12, 0.03, GLOSS_BLACK, COLOUR.black);
    kit.box(hx, s.head, zf + 0.02, hw * 0.88, 0.09, 0.012, CHROME, 0xd8dcdf);
    kit.add(
      new T.CylinderGeometry(0.03, 0.03, 0.01, 10)
        .rotateX(Math.PI / 2)
        .translate(hx - side * hw * 0.18, s.head - 0.005, zf + 0.03),
      LENS,
      COLOUR.head,
      { emit: EMIT.head },
    );
    kit.box(hx, s.head + 0.05, zf + 0.03, hw * 0.86, 0.012, 0.008, LENS, COLOUR.head, {
      emit: EMIT.head,
    });
    kit.box(hx + side * hw * 0.42, s.head, zf + 0.028, 0.03, 0.05, 0.008, LENS, COLOUR.amber, {
      emit: EMIT.amber,
    });
    // Tail lamps: tall corner clusters on wagons and vans, wide on saloons.
    const tx = side * rear.half * (s.tallTail ? 0.86 : 0.7),
      tw = s.tallTail ? 0.12 : rear.half * 0.5,
      th = s.tallTail ? 0.32 : 0.11;
    kit.box(tx, s.tail, zr - 0.01, tw + 0.02, th + 0.02, 0.03, GLOSS_BLACK, COLOUR.black);
    kit.box(tx, s.tail + th * 0.18, zr - 0.026, tw, th * 0.5, 0.01, LENS, COLOUR.tail, {
      emit: EMIT.tail,
    });
    kit.box(tx, s.tail - th * 0.28, zr - 0.026, tw, th * 0.22, 0.01, LENS, COLOUR.amber, {
      emit: EMIT.amber,
    });
    kit.box(
      side * rear.half * 0.6,
      s.floor + 0.14,
      zr - 0.04,
      0.09,
      0.03,
      0.008,
      LENS,
      COLOUR.reflector,
    );
  }
  // Registration plates (atlas slot 0 here; each instance offsets its own).
  const plateFace = (y: number, z: number, rear: boolean) => {
    const g = new T.PlaneGeometry(PLATE.width, PLATE.height);
    const [u0, v0, u1, v1] = plateUv(0);
    const uv = g.getAttribute('uv') as T.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
    if (rear) g.rotateY(Math.PI);
    kit.add(g.translate(0, y, z), PLATE_FACE, COLOUR.plate, {
      plate: true,
      emit: rear ? EMIT.plate : EMIT.frontPlate,
    });
    kit.box(
      0,
      y,
      z - (rear ? -0.006 : 0.006),
      PLATE.width + 0.012,
      PLATE.height + 0.012,
      0.01,
      PLASTIC,
      COLOUR.black,
    );
  };
  plateFace(s.floor + 0.2, zf + 0.045, false);
  plateFace(s.bed ? s.floor + 0.24 : Math.max(s.floor + 0.32, s.tail - 0.27), zr - 0.045, true);
}
/** One body type's merged geometry (ground at y = 0, +Z forward). */
export function trafficBodyGeometry(body: TrafficBody) {
  const s = TRAFFIC_SHAPES[body],
    kit = new Kit();
  lowerBody(kit, s);
  greenhouse(kit, s);
  loadBed(kit, s);
  wheels(kit, s);
  lamps(kit, s);
  return kit.build();
}

/** Body types a machine can be drawn as: those whose real plan size is close
 * to its collision footprint (a body is stretched at most this far). */
const fits = new WeakMap<VehicleDefinition, TrafficBody[]>();
export function trafficBodiesFor(def: VehicleDefinition): TrafficBody[] {
  const known = fits.get(def);
  if (known) return known;
  const [hx, , hz] = def.halfExtents;
  // Collision boxes carry ~6% clearance over the body they stand for.
  const L = hz * 2 * 0.94,
    W = hx * 2 * 0.94;
  const fit = TRAFFIC_BODIES.map((body) => {
    const s = TRAFFIC_SHAPES[body];
    return { body, d: Math.abs(Math.log(L / s.length)) + Math.abs(Math.log(W / s.width)) };
  }).sort((a, b) => a.d - b.d);
  const close = fit.filter((f) => f.d < 0.26).map((f) => f.body);
  const out = close.length ? close : [fit[0].body];
  fits.set(def, out);
  return out;
}
/** Japanese road paint mix: pearl white, silver, black and grey dominate. */
export const TRAFFIC_PAINT: readonly (readonly [number, number])[] = [
  [0xe8e9e4, 26],
  [0xf3f3ef, 8],
  [0xa7abaf, 14],
  [0x6d7175, 8],
  [0x111315, 16],
  [0x1f2a3f, 6],
  [0x7d1a1e, 4],
  [0xc9bda2, 5],
  [0x4b3d33, 3],
  [0x86aeb6, 3],
  [0xd9c25a, 2],
  [0x3f5642, 2],
  [0x9c2b2e, 3],
];
function hash(...values: number[]) {
  let h = 0x811c9dc5;
  for (const v of values) h = Math.imul(h ^ (v | 0), 0x01000193);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
export function trafficPaint(id: number) {
  const total = TRAFFIC_PAINT.reduce((s, p) => s + p[1], 0);
  let r = hash(id, 17) * total;
  for (const [colour, weight] of TRAFFIC_PAINT) if ((r -= weight) < 0) return colour;
  return TRAFFIC_PAINT[0][0];
}
/** The body a traffic car is drawn as (stable for its id and machine). */
export function trafficBodyOf(id: number, def: VehicleDefinition) {
  const options = trafficBodiesFor(def);
  return options[Math.floor(hash(id, 41) * options.length)];
}

const SHADER_KEY = 'traffic-vertex-finish-v1';
/** The shared body finish: per-vertex material classes, per-instance paint
 * (paint class only), lamp levels, plate slot and wheel spin. */
function trafficMaterial(plates: T.Texture | null) {
  const material = new T.MeshPhysicalMaterial({
    name: 'Ambient traffic finish',
    color: 0xffffff,
    vertexColors: true,
    map: plates,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    // Base-layer sheen sits under the clear coat (as on the festival cars);
    // glass and lenses reflect through their coat class.
    specularIntensity: 0.35,
  });
  chainShaderHook(material, SHADER_KEY, (shader) => {
    injectDeclarations(
      shader,
      'common',
      `attribute vec4 trafficFinish; attribute float trafficEmit; attribute vec4 trafficHub;
      attribute vec4 trafficLamp; attribute vec2 trafficPlate; attribute float trafficSpin;
      varying vec4 vTrafficFinish; varying vec3 vTrafficEmit;
      vec3 trafficScale() {
        #ifdef USE_INSTANCING
          return vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #else
          return vec3(1.0);
        #endif
      }
      vec3 trafficSpinX(vec3 p, float a) {
        float c = cos(a), s = sin(a);
        return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
      }`,
      'vertex',
    );
    // Paint colour only on the paint class (glass, tyres and trim keep theirs).
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      `vColor = vec3(1.0);
      #ifdef USE_COLOR
        vColor *= color;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vColor *= mix(vec3(1.0), instanceColor.rgb, trafficFinish.x);
      #endif
      vTrafficFinish = trafficFinish;
      vTrafficEmit = color * (trafficEmit == 1.0 ? trafficLamp.x : trafficEmit == 2.0 ? trafficLamp.y
        : trafficEmit == 3.0 ? trafficLamp.z : trafficEmit == 4.0 ? trafficLamp.w : 0.0);`,
    );
    // Round, rolling wheels under a plan-only stretch.
    injectAfter(
      shader,
      'beginnormal_vertex',
      `if (trafficHub.w > 0.5) {
        vec3 sc = trafficScale();
        if (trafficHub.w > 1.5) objectNormal = trafficSpinX(objectNormal, trafficSpin);
        objectNormal *= sc / sc.y;
      }`,
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      `if (trafficHub.w > 0.5) {
        vec3 sc = trafficScale(), d = transformed - trafficHub.xyz;
        if (trafficHub.w > 1.5) d = trafficSpinX(d, trafficSpin);
        transformed = trafficHub.xyz + d * (sc.y / sc);
      }`,
      'vertex',
    );
    injectAfter(
      shader,
      'uv_vertex',
      `#ifdef USE_MAP
        vMapUv += trafficPlate * step(3.5, trafficEmit);
      #endif`,
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      'varying vec4 vTrafficFinish; varying vec3 vTrafficEmit;',
      'fragment',
    );
    injectAfter(shader, 'roughnessmap_fragment', 'roughnessFactor = vTrafficFinish.y;', 'fragment');
    injectAfter(shader, 'metalnessmap_fragment', 'metalnessFactor = vTrafficFinish.z;', 'fragment');
    injectAfter(
      shader,
      'lights_physical_fragment',
      `#ifdef USE_CLEARCOAT
        material.clearcoat *= vTrafficFinish.w;
      #endif`,
      'fragment',
    );
    // Lamps glow in their lens colour; a lit plate glows through its print.
    injectAfter(
      shader,
      'emissivemap_fragment',
      `#ifdef USE_MAP
        totalEmissiveRadiance += vTrafficEmit * sampledDiffuseColor.rgb;
      #else
        totalEmissiveRadiance += vTrafficEmit;
      #endif`,
      'fragment',
    );
  });
  return material;
}
/** Soft ground contact (ambient occlusion) under every car: one quad each. */
function contactMaterial() {
  return new T.ShaderMaterial({
    name: 'Ambient traffic ground contact',
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    vertexShader: `varying vec2 footprint;
      void main() { footprint = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 footprint;
      void main() {
        vec2 f = abs(footprint);
        float r = pow(pow(f.x, 4.0) + pow(f.y, 4.0), 0.25);
        float a = 0.62 * (1.0 - smoothstep(0.55, 1.0, r));
        if (a < 0.003) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

interface Batch {
  body: TrafficBody;
  mesh: T.InstancedMesh;
  lamp: T.InstancedBufferAttribute;
  plate: T.InstancedBufferAttribute;
  spin: T.InstancedBufferAttribute;
  count: number;
}
/** One instanced draw per body type plus one for the ground contact. Pose,
 * interpolation, registry footprint, ids, paint and lamp state keep their
 * snapshot mapping; physics and traffic AI are unchanged. */
export class TrafficCars {
  readonly root = new T.Group();
  readonly batches: readonly Batch[];
  readonly contact: T.InstancedMesh;
  private readonly matrix = new T.Matrix4();
  private readonly shadeMatrix = new T.Matrix4();
  private readonly position = new T.Vector3();
  private readonly previous = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private readonly qa = new T.Quaternion();
  private readonly scale = new T.Vector3();
  private readonly down = new T.Vector3();
  private readonly colour = new T.Color();
  private readonly index = new Map<number, number>();
  /** Rolling wheel angle per traffic id (rad), and the last snapshot time. */
  private readonly phase = new Map<number, number>();
  private lastTime = NaN;
  /** Per drawn car: its batch and instance (diagnostics, inspection). */
  private readonly slots: { batch: Batch; instance: number }[] = [];
  count = 0;
  constructor() {
    this.root.name = 'Ambient traffic';
    const plates = plateAtlas();
    this.batches = TRAFFIC_BODIES.map((body) => {
      const geometry = trafficBodyGeometry(body);
      const lamp = new T.InstancedBufferAttribute(new Float32Array(TRAFFIC_CAPACITY * 4), 4);
      const plate = new T.InstancedBufferAttribute(new Float32Array(TRAFFIC_CAPACITY * 2), 2);
      const spin = new T.InstancedBufferAttribute(new Float32Array(TRAFFIC_CAPACITY), 1);
      for (const a of [lamp, plate, spin]) a.setUsage(T.DynamicDrawUsage);
      geometry.setAttribute('trafficLamp', lamp);
      geometry.setAttribute('trafficPlate', plate);
      geometry.setAttribute('trafficSpin', spin);
      const mesh = new T.InstancedMesh(geometry, trafficMaterial(plates), TRAFFIC_CAPACITY);
      mesh.name = `Ambient traffic ${body} (instanced)`;
      mesh.castShadow = mesh.receiveShadow = true;
      for (let i = 0; i < TRAFFIC_CAPACITY; i++) mesh.setColorAt(i, this.colour.setRGB(1, 1, 1));
      return { body, mesh, lamp, plate, spin, count: 0 };
    });
    this.contact = new T.InstancedMesh(
      new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
      contactMaterial(),
      TRAFFIC_CAPACITY,
    );
    this.contact.name = 'Ambient traffic ground contact (instanced)';
    this.contact.renderOrder = 1;
    for (const mesh of [...this.batches.map((b) => b.mesh), this.contact]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.root.add(mesh);
    }
    installSpecularIBL(this.root);
  }
  /** World pose (no scale) of drawn car `k`, or false. */
  poseOf(k: number, out: T.Matrix4) {
    const slot = this.slots[k];
    if (!slot || k >= this.count) return false;
    slot.batch.mesh.getMatrixAt(slot.instance, out);
    const p = new T.Vector3(),
      q = new T.Quaternion();
    out.decompose(p, q, new T.Vector3());
    return !!out.compose(p, q, new T.Vector3(1, 1, 1));
  }
  /** The batch and instance drawing car `k` (diagnostics). */
  slotOf(k: number) {
    return k < this.count ? this.slots[k] : undefined;
  }
  /** Pose from two traffic blocks (a older) at alpha; time blinks hazards. */
  update(
    a: Float32Array | null,
    b: Float32Array | null,
    alpha: number,
    night: number,
    time: number,
  ) {
    for (const batch of this.batches) batch.count = 0;
    this.slots.length = 0;
    if (!b || b.length < TRAFFIC_HEADER) {
      this.finish(0);
      return;
    }
    const n = Math.min(TRAFFIC_CAPACITY, Math.round(b[0]));
    // Wheels roll by the presented traffic time (block header [1]), which
    // advances smoothly between snapshots.
    const now =
      a && a.length >= TRAFFIC_HEADER && Number.isFinite(a[1]) && Number.isFinite(b[1])
        ? a[1] + (b[1] - a[1]) * alpha
        : b[1];
    const dt = Number.isFinite(this.lastTime)
      ? Math.max(0, Math.min(0.25, now - this.lastTime))
      : 0;
    this.lastTime = now;
    this.index.clear();
    if (a && a.length >= TRAFFIC_HEADER)
      for (let k = 0, m = Math.round(a[0]); k < m; k++)
        this.index.set(a[TRAFFIC_HEADER + k * TRAFFIC_STRIDE + TF.ID], k);
    const live = new Set<number>();
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
        [hx, hy, hz] = def.halfExtents,
        body = trafficBodyOf(Math.round(id), def),
        shape = TRAFFIC_SHAPES[body],
        batch = this.batches[TRAFFIC_BODIES.indexOf(body)],
        i = batch.count++;
      this.slots.push({ batch, instance: i });
      // The collision box centre stands max(0.5, hy) above the road.
      this.down.set(0, -Math.max(0.5, hy), 0).applyQuaternion(this.quaternion);
      this.position.add(this.down);
      this.scale.set((hx * 2) / shape.width, 1, (hz * 2) / shape.length);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      batch.mesh.setMatrixAt(i, this.matrix);
      this.scale.set(hx * 2 * 1.06, 1, hz * 2 * 1.04);
      this.shadeMatrix.compose(this.position, this.quaternion, this.scale);
      this.contact.setMatrixAt(k, this.shadeMatrix);
      batch.mesh.setColorAt(i, this.colour.setHex(trafficPaint(Math.round(id))));
      const flags = b[o + TF.FLAGS],
        hazard = (flags & TRAFFIC_FLAG.HAZARD) !== 0 && Math.floor(time * 2.5) % 2 === 0,
        brake = b[o + TF.BRAKE];
      const head = 0.25 + night * 2.4,
        tail = Math.max(0.35 + night * 1.6, brake > 0.05 ? 2.6 : 0),
        amber = hazard ? 3 : 0;
      batch.lamp.setXYZW(i, head, tail, amber, night * 0.45);
      const slot = plateSlot(Math.round(id), shape.kei);
      const [u0, v0] = plateUv(slot),
        [b0, c0] = plateUv(0);
      batch.plate.setXY(i, u0 - b0, v0 - c0);
      const speed = b[o + TF.SPEED];
      const angle = (this.phase.get(id) ?? hash(id, 3) * 6.28) + (speed * dt) / shape.wheel;
      this.phase.set(id, angle % (Math.PI * 2));
      batch.spin.setX(i, this.phase.get(id)!);
      live.add(id);
    }
    for (const id of this.phase.keys()) if (!live.has(id)) this.phase.delete(id);
    this.finish(n);
  }
  private finish(n: number) {
    this.count = n;
    for (const batch of this.batches) {
      const mesh = batch.mesh;
      mesh.count = batch.count;
      mesh.visible = batch.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      batch.lamp.needsUpdate = batch.plate.needsUpdate = batch.spin.needsUpdate = true;
    }
    this.contact.count = n;
    this.contact.visible = n > 0;
    this.contact.instanceMatrix.needsUpdate = true;
  }
  /** Lamp levels of drawn car `k`: head, tail, indicator, plate lamp. */
  lampsOf(k: number) {
    const slot = this.slotOf(k);
    if (!slot) return null;
    const l = slot.batch.lamp;
    return [
      l.getX(slot.instance),
      l.getY(slot.instance),
      l.getZ(slot.instance),
      l.getW(slot.instance),
    ];
  }
  dispose() {
    this.root.removeFromParent();
    for (const mesh of [...this.batches.map((b) => b.mesh), this.contact]) {
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
      mesh.dispose();
    }
    this.root.clear();
  }
}
