import * as T from 'three';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import type { ClosedSheet, WingSheet } from './body-sheet.ts';
import type { ClosedBodyModel, Greenhouse } from './closed-body.ts';
import type { BuiltLod, CarMaterials } from './common.ts';
import { flipWinding, rodGeometry, roundedBox, tubeGeometry, type Pt } from './loft.ts';
import { sharedMaterials } from './materials.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';

/** Original festival body furniture, authored from the construction principles
 * in reference IDs 001–025 and 089–100. No screenshot, logo or licensed mesh is
 * shipped. The body frame, live wheels, cabin, lamps and component damage remain
 * the authoritative simulation-driven assemblies. Static pieces merge into the
 * existing material draws; the extra optical cover is one shared material. */
const CLASSES = new Set([
  'road',
  'street',
  'gt',
  'gt-sport',
  'club',
  'touring',
  'hypercar',
  'prototype',
]);
export function festivalDetailFor(def: VehicleDefinition | undefined, sheet: ClosedSheet) {
  return !!def && CLASSES.has(String(def.classId)) && sheet.style !== 'rally';
}

const opticalCover = new T.MeshPhysicalMaterial({
  name: 'Festival clear optical covers',
  color: 0xe9f2f6,
  roughness: 0.035,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.02,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
});
opticalCover.userData.vehicleLampLens = true;
const amber = new T.MeshStandardMaterial({
  name: 'Festival amber reflectors',
  color: 0xe56c08,
  roughness: 0.21,
  metalness: 0.32,
});
const darkOptics = new T.MeshStandardMaterial({
  name: 'Festival dark optical cavities',
  color: 0x070a0d,
  roughness: 0.27,
  metalness: 0.25,
});

export interface FasciaOpening {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  depth: number;
}
/** Openings are bounded by the real end section, not invented car dimensions.
 * Keeping the same aperture outline in LOD0/1 prevents a grille pop at 35 m. */
export function festivalFasciaOpenings(model: ClosedBodyModel, rear = false): FasciaOpening[] {
  const { f, s } = model;
  if (rear && !(s.sideIntake || s.style === 'prototype' || s.numbers === 'door')) return [];
  if (!rear && s.grille <= 0) return [];
  const z = rear ? model.zRear : model.zFront;
  const profile = model.ring(z, 0).half;
  const bottom = Math.min(...profile.map((p) => p[1]));
  const top = Math.max(...profile.map((p) => p[1]));
  // A festival form's fascia is mostly intake (refs 011, 014, 019, 090).
  const share = model.festival ? 0.58 : 0.5;
  const height = rear
    ? Math.min(0.14, Math.max(0.075, (top - bottom) * 0.21))
    : Math.min(s.style === 'truck' ? 0.3 : model.festival ? 0.26 : 0.2, (top - bottom) * share);
  const y = rear
    ? Math.min(f.y(s.tail) - 0.3, top - height * 0.8)
    : bottom + (top - bottom) * (model.festival ? 0.47 : 0.49);
  const available = Math.min(model.sideX(z, y - height * 0.5), model.sideX(z, y + height * 0.5));
  const width = available * (rear ? 1.62 : 1.55);
  if (!(width > 0.14 && height > 0.025)) return [];
  const depth = rear ? 0.09 : s.style === 'truck' ? 0.15 : 0.11;
  const split = !rear && (s.style === 'supercar' || s.style === 'prototype');
  if (split)
    return [-1, 1].map((side) => ({
      x: side * width * 0.26,
      y,
      width: width * 0.44,
      height,
      radius: Math.min(height * 0.22, 0.025),
      depth,
    }));
  return [{ x: 0, y, width, height, radius: Math.min(height * 0.22, 0.035), depth }];
}

/** A rounded rectangle outline; `step` > 0 adds points along the straight
 * sides (a festival form curves its end faces, and the contour must follow). */
function roundedOutline(w: number, h: number, r: number, segments: number, step = 0): Pt[] {
  r = Math.min(r, w * 0.48, h * 0.48);
  const out: Pt[] = [];
  const corners = [
    [w / 2 - r, -h / 2 + r, -Math.PI / 2],
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
  ];
  corners.forEach(([x, y, angle], c) => {
    for (let k = 0; k <= segments; k++) {
      const a = angle + ((k / segments) * Math.PI) / 2;
      out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    if (step <= 0) return;
    const from = out[out.length - 1],
      [nx, ny, na] = corners[(c + 1) % 4],
      to: Pt = [nx + Math.cos(na) * r, ny + Math.sin(na) * r];
    const n = Math.floor(Math.hypot(to[0] - from[0], to[1] - from[1]) / step);
    for (let k = 1; k < n; k++)
      out.push([from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n]);
  });
  return out;
}
/** Conforming refinement of a flat indexed geometry until no edge is longer
 * than `max` (each long edge is halved everywhere it is shared). */
export function refineFlat(geometry: T.BufferGeometry, max: number) {
  const pos = Array.from(geometry.getAttribute('position').array as ArrayLike<number>);
  let tris = Array.from(geometry.getIndex()!.array as ArrayLike<number>);
  const length = (a: number, b: number) =>
    Math.hypot(
      pos[a * 3] - pos[b * 3],
      pos[a * 3 + 1] - pos[b * 3 + 1],
      pos[a * 3 + 2] - pos[b * 3 + 2],
    );
  for (let pass = 0; pass < 8; pass++) {
    const mids = new Map<string, number>();
    const mid = (a: number, b: number) => {
      if (length(a, b) <= max) return -1;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let m = mids.get(key);
      if (m === undefined) {
        m = pos.length / 3;
        for (let k = 0; k < 3; k++) pos.push((pos[a * 3 + k] + pos[b * 3 + k]) / 2);
        mids.set(key, m);
      }
      return m;
    };
    const next: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      let [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
      let ab = mid(a, b),
        bc = mid(b, c),
        ca = mid(c, a);
      const split = (ab >= 0 ? 1 : 0) + (bc >= 0 ? 1 : 0) + (ca >= 0 ? 1 : 0);
      if (split === 0) next.push(a, b, c);
      else if (split === 3) next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      else if (split === 1) {
        if (ab >= 0) next.push(a, ab, c, ab, b, c);
        else if (bc >= 0) next.push(a, b, bc, a, bc, c);
        else next.push(a, b, ca, ca, b, c);
      } else {
        // Rotate so the unsplit edge is c-a.
        while (ca >= 0) {
          [a, b, c] = [b, c, a];
          [ab, bc, ca] = [bc, ca, ab];
        }
        next.push(ab, b, bc, a, ab, bc, a, bc, c);
      }
    }
    const done = next.length === tris.length;
    tris = next;
    if (done) break;
  }
  const normal = new T.Vector3(),
    first = geometry.getAttribute('normal');
  if (first) normal.fromBufferAttribute(first, 0);
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  const normals = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) normals.set([normal.x, normal.y, normal.z], i);
  out.setAttribute('normal', new T.BufferAttribute(normals, 3));
  out.setIndex(tris);
  geometry.dispose();
  return out;
}
function asVectors(points: readonly Pt[]) {
  return points.map(([x, y]) => new T.Vector2(x, y));
}
/** An actual front/rear body cap with triangulated holes. This replaces the
 * filled triangle fan only at the near/mid LOD; it is not a black decal. */
export function festivalFasciaCap(model: ClosedBodyModel, detail: Detail, rear = false) {
  const z = rear ? model.zRear : model.zFront;
  // A festival form duplicates its crease points; the outline needs each once.
  const half = model
    .ring(z, detail)
    .half.filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);
  const outline = [
    ...half,
    ...half
      .slice(1, -1)
      .reverse()
      .map(([x, y]) => [-x, y] as const),
  ];
  const shape = new T.Shape(asVectors(outline));
  const step = model.festival ? 0.05 : 0;
  for (const mouth of festivalFasciaOpenings(model, rear)) {
    const contour = roundedOutline(
      mouth.width,
      mouth.height,
      mouth.radius,
      detail === 0 ? 4 : 2,
      step,
    );
    shape.holes.push(new T.Path(contour.map(([x, y]) => new T.Vector2(x + mouth.x, y + mouth.y))));
  }
  let geometry: T.BufferGeometry = new T.ShapeGeometry(shape).translate(0, 0, z);
  // A festival form curves the face afterwards: refine it so it bends.
  if (model.festival) geometry = refineFlat(geometry, detail === 0 ? 0.07 : 0.14);
  // An array material needs an explicit draw group in Three.js.
  geometry.addGroup(0, geometry.index?.count ?? geometry.getAttribute('position').count, 0);
  return rear ? flipWinding(geometry) : geometry;
}
function tunnel(contour: readonly Pt[], depth: number, inset: number, direction: number) {
  const vertices: number[] = [],
    indices: number[] = [];
  for (const [x, y] of contour) vertices.push(x, y, 0, x * inset, y * inset, -direction * depth);
  for (let i = 0; i < contour.length; i++) {
    const a = i * 2,
      b = ((i + 1) % contour.length) * 2;
    if (direction > 0) indices.push(a, b, a + 1, b, b + 1, a + 1);
    else indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
function surround(contour: readonly Pt[], width: number) {
  const xs = contour.map((p) => Math.abs(p[0])),
    ys = contour.map((p) => Math.abs(p[1]));
  const sx = 1 + width / Math.max(...xs),
    sy = 1 + width / Math.max(...ys);
  const shape = new T.Shape(contour.map(([x, y]) => new T.Vector2(x * sx, y * sy)));
  shape.holes.push(new T.Path(asVectors(contour)));
  return new T.ExtrudeGeometry(shape, {
    depth: 0.006,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 2,
    steps: 1,
  });
}

function addFascia(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  detail: Detail,
  rear: boolean,
) {
  const sign = rear ? -1 : 1;
  const z = rear ? model.zRear : model.zFront;
  parts.addGrouped(
    festivalFasciaCap(model, detail, rear),
    [mats.paint],
    rear ? 'Sculpted rear fascia' : 'Sculpted front fascia',
  );
  for (const mouth of festivalFasciaOpenings(model, rear)) {
    const contour = roundedOutline(
      mouth.width,
      mouth.height,
      mouth.radius,
      detail === 0 ? 4 : 2,
      model.festival ? 0.05 : 0,
    );
    const at = placed(mouth.x, mouth.y, z);
    // Cooling cavities need a rough, dark liner. Exposed satin carbon on the
    // lower rear tunnel caught the bright sky as a white strip in chase view.
    // Keep the higher-sheen carbon at the front, where it is an exposed duct.
    const liner =
      rear || model.festival ? sharedMaterials.plastic() : sharedMaterials.carbonSatin();
    parts.add(tunnel(contour, mouth.depth, 0.89, sign), liner, at);
    const lip = surround(contour, 0.01);
    if (rear) lip.rotateY(Math.PI);
    parts.add(lip, rear ? sharedMaterials.trim() : mats.paint, at);
    const coreZ = z - sign * (mouth.depth - 0.012);
    // Overlap all four walls of the 0.89-inset tunnel. The former 0.86-high
    // core left an edge seam that could reveal the body interior obliquely.
    parts.add(
      roundedBox(mouth.width * 0.94, mouth.height * 0.94, 0.014, 0.003, 1),
      rear ? sharedMaterials.plastic() : darkOptics,
      placed(mouth.x, mouth.y, coreZ - sign * 0.01),
    );
    const rows = detail === 0 ? Math.max(4, Math.round(mouth.height / 0.012)) : 4;
    for (let k = 0; k < rows; k++) {
      const y = mouth.y + ((k + 0.5) / rows - 0.5) * mouth.height * 0.8;
      parts.add(
        roundedBox(mouth.width * 0.85, rear ? 0.006 : 0.0035, 0.009, 0.0015, 1),
        rear ? sharedMaterials.trim() : sharedMaterials.steel(),
        placed(mouth.x, y, coreZ),
      );
    }
    // Real slats ahead of the radiator are separated by daylight-visible gaps.
    const bars = rear
      ? 7
      : model.s.style === 'truck'
        ? 9
        : model.s.lamps.front === 'round'
          ? 11
          : 7;
    for (let k = 1; k < bars; k++) {
      const x = mouth.x + (k / bars - 0.5) * mouth.width * 0.92;
      parts.add(
        roundedBox(rear ? 0.011 : 0.009, mouth.height * 0.78, 0.025, 0.002, 1),
        model.s.lamps.front === 'round' && !rear
          ? sharedMaterials.chrome()
          : sharedMaterials.trim(),
        placed(x, mouth.y, z - sign * 0.026),
      );
    }
    if (model.s.style === 'truck' && !rear)
      parts.add(
        roundedBox(mouth.width * 0.92, 0.025, 0.03, 0.005, 1),
        sharedMaterials.chrome(),
        placed(mouth.x, mouth.y, z + 0.002),
      );
  }
}

function surfacePlacement(model: ClosedBodyModel, x: number, z: number) {
  const ax = Math.abs(x),
    side = Math.sign(x) || 1;
  const dz = (model.surfaceY(z + 0.015, ax) - model.surfaceY(z - 0.015, ax)) / 0.03;
  const dx = (model.surfaceY(z, ax + 0.015) - model.surfaceY(z, Math.max(0, ax - 0.015))) / 0.03;
  return placed(x, model.surfaceY(z, ax), z, -Math.atan(dz), 0, side * Math.atan(dx));
}
function inLocal(base: T.Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  return base.clone().multiply(placed(x, y, z, rx, ry, rz));
}
function addProjector(
  parts: Parts,
  base: T.Matrix4,
  mats: CarMaterials,
  radius: number,
  detail: Detail,
) {
  const segments = detail === 0 ? 24 : 12;
  const bowl = new T.LatheGeometry(
    [
      new T.Vector2(radius * 0.52, 0.006),
      new T.Vector2(radius * 0.7, 0.008),
      new T.Vector2(radius * 0.94, 0.016),
      new T.Vector2(radius, 0.025),
      new T.Vector2(radius * 0.95, 0.03),
    ],
    segments,
  );
  parts.add(bowl, sharedMaterials.chrome(), base);
  parts.add(
    new T.TorusGeometry(radius * 0.87, radius * 0.06, 6, segments).rotateX(Math.PI / 2),
    sharedMaterials.chrome(),
    inLocal(base, 0, 0.031, 0),
  );
  parts.add(
    new T.SphereGeometry(radius * 0.64, segments, 10).scale(1, 0.38, 1),
    mats.head,
    inLocal(base, 0, 0.026, 0),
  );
}
/** A swept optical pocket with bevelled edges, following the fender surface. */
function opticalPanel(width: number, depth: number, height: number, side: number) {
  const outline = [
    [-0.5, -0.33],
    [-0.43, 0.35],
    [0.29, 0.47],
    [0.5, 0.08],
    [0.4, -0.46],
  ];
  const shape = new T.Shape(outline.map(([x, z]) => new T.Vector2(x * width * side, -z * depth)));
  return new T.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.005,
    bevelSegments: 2,
    steps: 1,
  }).rotateX(-Math.PI / 2);
}
/** Each headlamp's surface frame (local y along the body normal, z forward)
 * and, for a swept optical panel, its width and depth (m). */
export function festivalHeadlampFrames(model: ClosedBodyModel) {
  const { s } = model;
  const z =
    model.zFront -
    (model.lampSetback() ?? (s.style === 'truck' ? 0.14 : s.lamps.front === 'pod' ? 0.3 : 0.16));
  return [-1, 1].map((side) => {
    const half = model.halfWidth(z);
    const x = side * half * (s.lamps.front === 'bar' ? 0.49 : 0.68);
    // A festival form's lamps sit flush in the nose roll, not on top of it.
    const base = surfacePlacement(model, x, z);
    if (model.festival) base.multiply(placed(0, -0.022, 0));
    return {
      side,
      half,
      base,
      width: s.lamps.front === 'bar' ? half * 0.56 : s.lamps.front === 'pod' ? 0.17 : 0.31,
      depth: s.lamps.front === 'pod' ? 0.2 : 0.12,
    };
  });
}
function addHeadlamps(parts: Parts, model: ClosedBodyModel, mats: CarMaterials, detail: Detail) {
  const { s } = model;
  for (const { side, base, width, depth } of festivalHeadlampFrames(model)) {
    const round = s.lamps.front === 'round' || s.lamps.front === 'twin';
    if (round) {
      const count = s.lamps.front === 'twin' ? 2 : 1;
      const radius = count === 2 ? 0.064 : 0.085;
      for (let k = 0; k < count; k++) {
        const at = inLocal(base, (k - (count - 1) / 2) * radius * 2.22, 0, 0);
        parts.add(
          new T.CylinderGeometry(radius * 1.16, radius * 1.22, 0.028, detail === 0 ? 28 : 12),
          darkOptics,
          inLocal(at, 0, 0.008, 0),
        );
        addProjector(parts, at, mats, radius, detail);
        parts.add(
          new T.TorusGeometry(radius * 1.07, 0.005, 6, detail === 0 ? 28 : 12).rotateX(Math.PI / 2),
          sharedMaterials.chrome(),
          inLocal(at, 0, 0.03, 0),
        );
        parts.add(
          new T.SphereGeometry(radius * 0.99, detail === 0 ? 24 : 12, 10).scale(1, 0.24, 1),
          opticalCover,
          inLocal(at, 0, 0.044, 0),
        );
      }
      continue;
    }
    parts.add(
      opticalPanel(width + 0.028, depth + 0.024, 0.026, side),
      darkOptics,
      inLocal(base, 0, -0.008, 0),
    );
    const count = s.style === 'truck' ? 4 : 3;
    for (let k = 0; k < count; k++) {
      const px = ((k + 0.5) / count - 0.5) * width * 0.65;
      addProjector(
        parts,
        inLocal(base, px, 0.003, -0.005),
        mats,
        Math.min(0.028, width / (count * 2.7)),
        detail,
      );
    }
    // A thin continuous guide surrounds distinct emitters, not one white block.
    parts.add(
      tubeGeometry(
        [
          [-side * width * 0.46, 0.033, -depth * 0.22],
          [-side * width * 0.4, 0.033, depth * 0.3],
          [side * width * 0.27, 0.033, depth * 0.4],
          [side * width * 0.43, 0.033, depth * 0.08],
        ],
        0.0038,
        detail === 0 ? 20 : 10,
        5,
      ),
      mats.head,
      base,
    );
    parts.add(
      roundedBox(0.018, 0.02, depth * 0.7, 0.005, 2),
      amber,
      inLocal(base, side * width * 0.42, 0.022, 0),
    );
    parts.add(opticalPanel(width, depth, 0.006, side), opticalCover, inLocal(base, 0, 0.047, 0));
  }
}

/** A band lying on a body end: along both sides from `reach` m inboard of the
 * end face round onto it, between car-frame heights `lo` and `hi`, `out` m
 * proud of the surface. `inner`: the face part stops that far inboard of each
 * corner (corner units) instead of crossing the face; `fade`: the side parts
 * rise from that offset to `out` toward the face; `ledge`: top and bottom
 * ledges close the gap to the surface (a bumper standing proud of the body). */
export function endBand(
  model: ClosedBodyModel,
  rear: boolean,
  lo: number,
  hi: number,
  reach: number,
  out: number,
  steps: number,
  options: { inner?: number; fade?: number; ledge?: boolean } = {},
) {
  const zEnd = rear ? model.zRear : model.zFront,
    inward = rear ? 1 : -1,
    { inner, fade, ledge } = options;
  const position: number[] = [],
    index: number[] = [];
  /** A grid between successive polylines (rows), wound to face `outward`. */
  const grid = (rows: T.Vector3[][], outward: T.Vector3) => {
    const base = position.length / 3,
      n = rows[0].length;
    for (const row of rows) for (const p of row) position.push(p.x, p.y, p.z);
    const normal = new T.Vector3()
      .subVectors(rows[0][1], rows[0][0])
      .cross(new T.Vector3().subVectors(rows[1][0], rows[0][0]));
    const flip = normal.dot(outward) < 0;
    for (let r = 0; r < rows.length - 1; r++)
      for (let k = 0; k < n - 1; k++) {
        const a = base + r * n + k,
          b = a + 1,
          c = a + n,
          d = c + 1;
        if (flip) index.push(a, c, b, b, c, d);
        else index.push(a, b, c, b, d, c);
      }
  };
  // Rows every 2.5 cm, so a tall band follows the section's curvature.
  const rowCount = Math.max(1, Math.ceil((hi - lo) / 0.025)),
    heights = Array.from({ length: rowCount + 1 }, (_, r) => lo + ((hi - lo) * r) / rowCount);
  // Offset along the side parts: constant, or rising from `fade` to `out`.
  const offset = (k: number) => {
    if (fade === undefined) return out;
    const t = k / steps;
    return fade + (out - fade) * t * t * (3 - 2 * t);
  };
  const flush = 0.0015,
    ks = Array.from({ length: steps + 1 }, (_, k) => k);
  for (const side of [-1, 1]) {
    // Proud of the surface along its plan normal: round the corner wrap the
    // surface faces the end, where an x offset would slide along it.
    const at = (k: number, y: number, o: number) => {
      const z = zEnd + inward * reach * (1 - k / steps),
        x = model.sideX(z, y),
        slope = (model.sideX(z + 0.004, y) - model.sideX(z - 0.004, y)) / 0.008,
        n = Math.hypot(1, slope);
      return new T.Vector3(side * (x + o / n), y, z - (o * slope) / n);
    };
    grid(
      heights.map((y) => ks.map((k) => at(k, y, offset(k)))),
      new T.Vector3(side, 0, 0),
    );
    if (ledge)
      for (const [y, up] of [
        [hi, 1],
        [lo, -1],
      ])
        grid(
          [ks.map((k) => at(k, y, flush)), ks.map((k) => at(k, y, offset(k)))],
          new T.Vector3(0, up, 0),
        );
  }
  const face = new T.Vector3(0, 0, -inward);
  const across = (
    x0: (y: number, o: number) => number,
    x1: (y: number, o: number) => number,
    n: number,
  ) => {
    const row = (y: number, o: number) =>
      Array.from(
        { length: n + 1 },
        (_, k) => new T.Vector3(x0(y, o) + ((x1(y, o) - x0(y, o)) * k) / n, y, zEnd - inward * o),
      );
    grid(
      heights.map((y) => row(y, out)),
      face,
    );
    if (ledge)
      for (const [y, up] of [
        [hi, 1],
        [lo, -1],
      ])
        grid([row(y, flush), row(y, out)], new T.Vector3(0, up, 0));
  };
  const xe = (y: number, o: number) => model.sideX(zEnd, y) + o;
  if (inner === undefined) across((y, o) => -xe(y, o), xe, 16);
  else
    for (const side of [-1, 1])
      across(
        (y, o) => side * Math.max(0.02, xe(y, o) - inner),
        (y, o) => side * xe(y, o),
        4,
      );
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
/** A festival form's rear bumper: it stands `depth` proud of the tail below
 * a crease under the lamps (and under any rear cooling aperture), with a
 * black valance along its foot. Null for a plain catalogue body. */
export function festivalRearBumper(model: ClosedBodyModel) {
  if (!model.festival) return null;
  const { f, s } = model;
  const lamps = Math.min(f.y(s.tail) - 0.13, model.topY(model.zRear) - 0.06);
  const half = s.lamps.rear === 'strip' ? 0.0375 : s.lamps.rear === 'bar' ? 0.05 : 0.0575;
  const lo = model.endFloor(true) + 0.004;
  let hi = lo + (lamps - half - lo) * 0.62;
  for (const mouth of festivalFasciaOpenings(model, true))
    hi = Math.min(hi, mouth.y - mouth.height / 2 - 0.03);
  if (hi - lo < 0.12) return null;
  return { lo, hi, depth: s.style === 'truck' ? 0.04 : 0.026 };
}
function addRearBumper(parts: Parts, model: ClosedBodyModel, mats: CarMaterials, detail: Detail) {
  const bumper = festivalRearBumper(model),
    steps = detail === 0 ? 14 : 5;
  const valance = model.endFloor(true) + (model.valanceHeight() ?? 0.12);
  // The bumper wraps forward to the rear wheel opening.
  const f = model.f,
    reach = Math.max(0.2, Math.min(0.5, f.rearAxle - f.radius - 0.08 - model.zRear));
  if (!bumper) {
    parts.add(
      endBand(model, true, model.endFloor(true) + 0.004, valance, 0.24, 0.007, steps),
      sharedMaterials.plastic(),
    );
    return;
  }
  const { lo, hi, depth } = bumper;
  parts.add(
    endBand(model, true, lo, hi, reach, depth, steps, { fade: 0.004, ledge: true }),
    mats.paint,
  );
  parts.add(
    endBand(model, true, lo, Math.min(valance, hi - 0.03), reach, depth + 0.004, steps, {
      fade: 0.009,
    }),
    sharedMaterials.plastic(),
  );
}
/** Festival form tail lamps: a dark gloss band wrapping round the tail's
 * corners with continuous emitters (refs 013, 018, 053, 059). */
function addWrapTailLamps(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  detail: Detail,
) {
  const { f, s } = model;
  const y = Math.min(f.y(s.tail) - 0.13, model.topY(model.zRear) - 0.06);
  const steps = detail === 0 ? 10 : 4,
    kind = s.lamps.rear;
  const hh = kind === 'strip' ? 0.075 : kind === 'bar' ? 0.1 : 0.115;
  parts.add(endBand(model, true, y - hh / 2, y + hh / 2, 0.17, 0.003, steps), darkOptics);
  if (kind === 'strip') {
    parts.add(endBand(model, true, y + 0.004, y + 0.022, 0.15, 0.006, steps), mats.tail);
    parts.add(
      endBand(model, true, y - 0.028, y - 0.004, 0.15, 0.006, steps, { inner: 0.16 }),
      mats.tail,
    );
  } else if (kind === 'bar') {
    parts.add(
      endBand(model, true, y - 0.032, y + 0.032, 0.15, 0.006, steps, { inner: 0.34 }),
      mats.tail,
    );
    parts.add(endBand(model, true, y + 0.006, y + 0.02, 0.15, 0.006, steps), mats.tail);
  } else
    parts.add(
      endBand(model, true, y - 0.04, y + 0.04, 0.15, 0.006, steps, { inner: 0.3 }),
      mats.tail,
    );
}

function addTailLamps(parts: Parts, model: ClosedBodyModel, mats: CarMaterials, detail: Detail) {
  const { f, s } = model;
  if (model.festival && s.lamps.rear !== 'round') {
    addWrapTailLamps(parts, model, mats, detail);
    return;
  }
  const z = model.zRear - 0.006;
  const half = model.halfWidth(model.zRear) * 0.8;
  const y = Math.min(f.y(s.tail) - 0.13, model.topY(model.zRear) - 0.06);
  if (s.lamps.rear === 'round') {
    for (const side of [-1, 1])
      for (const [offset, radius] of [
        [0, 0.058],
        [-0.15, 0.047],
      ]) {
        const x = side * (half * 0.74 + offset);
        parts.add(
          new T.CylinderGeometry(radius * 1.2, radius * 1.2, 0.025, 20).rotateX(Math.PI / 2),
          darkOptics,
          placed(x, y, z + 0.01),
        );
        parts.add(
          new T.TorusGeometry(radius, 0.006, 6, detail === 0 ? 28 : 14),
          sharedMaterials.chrome(),
          placed(x, y, z - 0.013),
        );
        parts.add(
          new T.TorusGeometry(radius * 0.76, 0.009, 7, detail === 0 ? 28 : 14),
          mats.tail,
          placed(x, y, z - 0.017),
        );
        parts.add(
          new T.SphereGeometry(radius * 0.63, 18, 10).scale(1, 1, 0.24),
          mats.tail,
          placed(x, y, z - 0.012),
        );
        parts.add(
          new T.SphereGeometry(radius * 0.94, 18, 10).scale(1, 1, 0.2),
          opticalCover,
          placed(x, y, z - 0.025),
        );
      }
    return;
  }
  const pairs = s.lamps.rear === 'twin';
  const width = pairs ? 0.24 : half * (s.lamps.rear === 'strip' ? 1.8 : 1.7);
  const height = pairs ? 0.085 : s.lamps.rear === 'strip' ? 0.036 : 0.06;
  for (const x of pairs ? [-half * 0.74, half * 0.74] : [0]) {
    parts.add(
      roundedBox(width + 0.035, height + 0.025, 0.028, 0.01, 2),
      darkOptics,
      placed(x, y, z + 0.009),
    );
    const count = pairs ? 4 : detail === 0 ? 22 : 12;
    for (let k = 0; k < count; k++) {
      const px = x + ((k + 0.5) / count - 0.5) * width;
      parts.add(
        roundedBox((width / count) * 0.87, height * 0.62, 0.011, 0.003, 1),
        mats.tail,
        placed(px, y + height * 0.07, z - 0.011),
      );
    }
    parts.add(
      roundedBox(width * 0.18, 0.008, 0.014, 0.002, 1),
      sharedMaterials.chrome(),
      placed(x + width * 0.27, y - height * 0.29, z - 0.014),
    );
    parts.add(roundedBox(width, height, 0.006, 0.007, 2), opticalCover, placed(x, y, z - 0.024));
  }
}

/** Open-ended, double-wall exhaust: the dark inner bore remains visible at a
 * low rear angle. No filled cylinder cap sits across the mouth. */
export function festivalExhaustGeometry(radius: number, length: number, segments = 24) {
  const profile = [
    new T.Vector2(radius * 0.9, 0),
    new T.Vector2(radius * 0.91, length * 0.83),
    new T.Vector2(radius, length * 0.96),
    new T.Vector2(radius, length),
    new T.Vector2(radius * 0.82, length),
    new T.Vector2(radius * 0.79, length * 0.86),
    new T.Vector2(radius * 0.77, 0),
  ];
  return new T.LatheGeometry(profile, segments).rotateX(-Math.PI / 2);
}
function addExhausts(parts: Parts, model: ClosedBodyModel, detail: Detail) {
  const { f, s } = model;
  if (s.extras.includes('exhaust-rear'))
    for (const side of [-1, 1]) {
      const x = side * model.halfWidth(model.zRear) * 0.45;
      const y = f.y(s.floor + 0.14);
      parts.add(
        festivalExhaustGeometry(
          s.style === 'supercar' ? 0.052 : 0.046,
          0.14,
          detail === 0 ? 24 : 12,
        ),
        sharedMaterials.exhaust(),
        placed(x, y, model.zRear + 0.045),
      );
      parts.add(
        new T.CircleGeometry(0.035, 14).rotateY(Math.PI),
        darkOptics,
        placed(x, y, model.zRear + 0.025),
      );
    }
  if (s.extras.includes('exhaust-side'))
    for (const side of [-1, 1]) {
      const z = f.frontAxle - f.radius - 0.31,
        y = f.y(s.floor + 0.1);
      const x = side * (model.sideX(z, y) - 0.04);
      parts.add(
        festivalExhaustGeometry(0.043, 0.16, detail === 0 ? 24 : 12),
        sharedMaterials.exhaust(),
        placed(x, y, z, 0, (-side * Math.PI) / 2),
      );
    }
}

function addVents(parts: Parts, model: ClosedBodyModel, mats: CarMaterials, detail: Detail) {
  const { f, s } = model;
  if (s.bonnetVents)
    for (const side of [-1, 1]) {
      const z = (f.frontAxle + f.z(s.cabin[0])) / 2 + 0.05;
      const x = side * model.halfWidth(z) * 0.45;
      const at = surfacePlacement(model, x, z);
      parts.add(roundedBox(0.235, 0.018, 0.28, 0.018, 2), darkOptics, inLocal(at, 0, 0.006, 0));
      const count = detail === 0 ? 7 : 4;
      for (let k = 0; k < count; k++) {
        const zz = ((k + 0.5) / count - 0.5) * 0.235;
        parts.add(
          roundedBox(0.213, 0.01, 0.029, 0.004, 1),
          sharedMaterials.carbonSatin(),
          inLocal(at, 0, 0.024, zz, -0.28),
        );
      }
      // A fine rolled painted rim anchors the vent to the body surface.
      const edge = surround(roundedOutline(0.231, 0.275, 0.018, 3), 0.005).rotateX(-Math.PI / 2);
      parts.add(edge, mats.paint, inLocal(at, 0, 0.008, 0));
    }
  if (s.sideIntake)
    for (const side of [-1, 1]) {
      const z = f.rearAxle + f.radius + 0.36,
        y = f.y(s.belt) - 0.04;
      const x = side * (model.sideX(z, y) + 0.004);
      const at = placed(x, y, z, 0, (side * Math.PI) / 2);
      const contour = roundedOutline(0.44, 0.2, 0.028, 4);
      // The raised scoop projects just outside the lower-body skin; its inner
      // dark back is continuous with the body, so no bright plate closes it.
      parts.add(
        tunnel(contour, 0.045, 0.79, 1),
        sharedMaterials.carbonSatin(),
        inLocal(at, 0, 0, 0.05),
      );
      parts.add(surround(contour, 0.014), mats.paint, inLocal(at, 0, 0, 0.05));
      parts.add(roundedBox(0.36, 0.158, 0.008, 0.02, 2), darkOptics, inLocal(at, 0, 0, 0.004));
      for (let k = -2; k <= 2; k++)
        parts.add(
          roundedBox(0.008, 0.142, 0.024, 0.002, 1),
          sharedMaterials.trim(),
          inLocal(at, k * 0.06, 0, 0.016),
        );
    }
}

function addHardware(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  greenhouse: Greenhouse | null,
) {
  const { f, s } = model;
  const classic = s.lamps.front === 'round' && s.numbers === 'none';
  const trim = classic ? sharedMaterials.chrome() : sharedMaterials.trim();
  const [ws, rf, rr, rw] = s.cabin;
  for (const side of [-1, 1]) {
    // Separate handle and inset recess on every road door.
    for (const station of s.style === 'saloon'
      ? [(rf + rr) * 0.5 - 0.1, rr - 0.03]
      : [(rf + rr) * 0.5 + 0.06]) {
      const z = f.z(station),
        y = f.y(s.belt) + 0.04;
      const x = model.sideX(z, y);
      if (x < 0.1) continue;
      parts.add(
        roundedBox(0.012, 0.036, 0.15, 0.011, 2),
        sharedMaterials.trim(),
        placed(side * (x + 0.006), y, z),
      );
      parts.add(
        roundedBox(0.022, 0.018, 0.119, 0.007, 2),
        classic ? sharedMaterials.chrome() : mats.paint,
        placed(side * (x + 0.018), y + 0.002, z),
      );
    }
    const seal: [number, number, number][] = [];
    for (let k = 0; k <= 18; k++) {
      const z = f.z(ws + ((rw - ws) * k) / 18);
      seal.push([side * (model.halfWidth(z) * 0.8 - 0.01), model.topY(z) + 0.006, z]);
    }
    parts.add(tubeGeometry(seal, classic ? 0.004 : 0.003, 22, 5), trim);
    if (s.mirrors && !model.festival) {
      const z = f.z(ws) - 0.14,
        y = model.topY(z) + 0.08;
      const x = side * (model.halfWidth(z) * 0.8 + 0.08);
      parts.add(roundedBox(0.095, 0.009, 0.008, 0.003, 1), amber, placed(x, y - 0.015, z + 0.04));
    }
    if (s.numbers === 'door') {
      // Arch fasteners stay above the wheel cutout; no trim bridges an aperture.
      for (const axle of [f.frontAxle, f.rearAxle])
        for (const angle of [0.28, 0.65, 1.0, 1.45, 1.9, 2.4, 2.85]) {
          const z = axle + Math.cos(angle) * (f.radius + 0.08);
          const y =
            (axle === f.frontAxle ? f.hubFront : f.hubRear) + Math.sin(angle) * (f.radius + 0.075);
          if (y > model.topY(z) - 0.025) continue;
          const x = model.sideX(z, y);
          parts.add(
            new T.CylinderGeometry(0.005, 0.005, 0.003, 6).rotateZ(Math.PI / 2),
            sharedMaterials.steel(),
            placed(side * (x + 0.003), y, z),
          );
        }
      const z = f.frontAxle + 0.12;
      const x = side * model.halfWidth(z) * 0.48;
      const at = surfacePlacement(model, x, z);
      parts.add(
        new T.CylinderGeometry(0.016, 0.016, 0.003, 16),
        sharedMaterials.steel(),
        inLocal(at, 0, 0.007, 0),
      );
      parts.add(
        new T.TorusGeometry(0.009, 0.0018, 4, 12).rotateX(Math.PI / 2),
        sharedMaterials.chrome(),
        inLocal(at, 0, 0.011, 0),
      );
    }
  }
  // Wipers lie on the evaluated windscreen crown, clear of the cockpit volume.
  if (greenhouse) {
    const z = f.z(ws) - Math.max(0.055, (f.z(ws) - f.z(rf)) * 0.12);
    const crown = greenhouse.control(z);
    const y = crown[crown.length - 1][1] + 0.008;
    for (const side of [-1, 1])
      parts.add(
        rodGeometry(
          new T.Vector3(side * 0.09, y, z),
          new T.Vector3(side * 0.48, y + 0.006, z - 0.012),
          0.0035,
          5,
        ),
        sharedMaterials.trim(),
      );
    // Rear-screen demister wires follow the glass crown. Their submillimetre
    // thickness keeps the cabin transparent and avoids a heavy painted grid.
    for (let row = 1; row <= 9; row++) {
      const zz = f.z(rr + ((rw - rr) * row) / 10);
      const profile = greenhouse.control(zz);
      const w = profile[2][0] * 0.87,
        top = profile[profile.length - 1][1];
      const wire: [number, number, number][] = [];
      for (let k = -4; k <= 4; k++) {
        const xx = (w * k) / 4;
        wire.push([
          xx,
          top + 0.0018 - (Math.abs(xx) / Math.max(0.01, profile[2][0])) ** 2 * 0.026,
          zz,
        ]);
      }
      parts.add(tubeGeometry(wire, 0.0008, 12, 4), sharedMaterials.steel());
    }
  }
  if (s.numbers === 'door') {
    const x = -model.halfWidth(model.zFront) * 0.5,
      y = f.y(s.floor + 0.15),
      z = model.zFront + 0.03;
    parts.add(
      new T.TorusGeometry(0.024, 0.006, 7, 20),
      sharedMaterials.caliper(0xb62d28),
      placed(x, y, z, 0, -0.15),
    );
    parts.add(
      rodGeometry(
        new T.Vector3(x, y + 0.019, z - 0.008),
        new T.Vector3(x, y + 0.019, z - 0.046),
        0.008,
        6,
      ),
      sharedMaterials.steel(),
    );
  }
  if (classic) {
    for (const rear of [false, true]) {
      const z = rear ? model.zRear - 0.04 : model.zFront + 0.024;
      const y = f.y(s.floor + 0.2),
        w = model.halfWidth(rear ? model.zRear : model.zFront) * 0.9;
      parts.add(
        tubeGeometry(
          [
            [-w, y + 0.025, z + (rear ? 0.03 : -0.03)],
            [-w * 0.8, y, z],
            [w * 0.8, y, z],
            [w, y + 0.025, z + (rear ? 0.03 : -0.03)],
          ],
          0.018,
          18,
          8,
        ),
        sharedMaterials.chrome(),
      );
    }
  }
  if (s.style === 'truck') {
    const z = model.zFront + 0.023,
      y = f.y(s.floor + 0.08);
    parts.add(
      roundedBox(s.width * 0.58, 0.11, 0.1, 0.02, 2),
      sharedMaterials.steel(),
      placed(0, y, z, -0.28),
    );
    for (const x of [-0.4, -0.2, 0, 0.2, 0.4])
      parts.add(
        roundedBox(0.023, 0.1, 0.022, 0.004, 1),
        sharedMaterials.trim(),
        placed(x, y, z + 0.055, -0.28),
      );
  }
}

function addAeroEdges(model: ClosedBodyModel, detail: Detail, lod: BuiltLod) {
  const { f, s } = model;
  if (s.splitter < 0.07 || detail > 0) return;
  const parts = new Parts();
  for (const side of [-1, 1]) {
    const x = side * model.halfWidth(model.zFront - 0.25) * 0.94;
    const z = model.zFront - 0.09,
      y = f.y(s.floor + 0.055);
    const shape = new T.Shape([
      new T.Vector2(-0.19, 0),
      new T.Vector2(0.17, 0),
      new T.Vector2(0.13, 0.072),
      new T.Vector2(-0.16, 0.1),
    ]);
    const g = new T.ExtrudeGeometry(shape, {
      depth: 0.006,
      bevelEnabled: true,
      bevelSize: 0.002,
      bevelThickness: 0.002,
      bevelSegments: 1,
    }).rotateY(Math.PI / 2);
    parts.add(g, sharedMaterials.carbonSatin(), placed(x, y, z));
    parts.add(
      rodGeometry(
        new T.Vector3(x * 0.88, y - 0.027, z + 0.12),
        new T.Vector3(x * 0.83, y + 0.16, z - 0.06),
        0.0038,
        5,
      ),
      sharedMaterials.steel(),
    );
  }
  const group = new T.Group();
  group.name = 'Festival front aero detail (detachable)';
  parts.build(group, true);
  lod.group.add(group);
  lod.front.push(group);
}

export function addFestivalWingHardware(
  parts: Parts,
  model: ClosedBodyModel,
  w: WingSheet,
  detail: Detail,
) {
  if (
    detail !== 0 ||
    model.s.numbers !== 'door' ||
    w.kind === 'lip' ||
    w.kind === 'ducktail' ||
    w.kind === 'roof'
  )
    return;
  const span = model.s.width * w.span,
    z = model.f.z(w.at),
    y = model.f.y(w.height);
  for (const side of [-1, 1]) {
    const x = side * span * 0.28;
    const lowerZ = z - w.chord * 0.38;
    const lowerY = model.surfaceY(lowerZ, Math.abs(x));
    parts.add(
      rodGeometry(
        new T.Vector3(x, lowerY + 0.018, lowerZ + 0.09),
        new T.Vector3(x, y - 0.015, z - w.chord * 0.78),
        0.004,
        5,
      ),
      sharedMaterials.steel(),
    );
    for (const zz of [z - w.chord * 0.28, z - w.chord * 0.93])
      parts.add(
        new T.CylinderGeometry(0.007, 0.007, 0.006, 6).rotateZ(Math.PI / 2),
        sharedMaterials.steel(),
        placed(side * (span / 2 + 0.016), y + 0.02, zz),
      );
  }
}

/** Called only for LOD0/1 of festival road/GT/prototype bodies. */
export function buildFestivalDetail(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  detail: Detail,
  lod: BuiltLod,
  greenhouse: Greenhouse | null,
) {
  if (detail > 1) return;
  addFascia(parts, model, mats, detail, false);
  addFascia(parts, model, mats, detail, true);
  addHeadlamps(parts, model, mats, detail);
  addTailLamps(parts, model, mats, detail);
  if (model.festival) addRearBumper(parts, model, mats, detail);
  addExhausts(parts, model, detail);
  addVents(parts, model, mats, detail);
  if (detail === 0) addHardware(parts, model, mats, greenhouse);
  addAeroEdges(model, detail, lod);
  lod.group.userData.festivalBodyDetail = {
    revision: 1,
    frontApertures: festivalFasciaOpenings(model).length,
    rearApertures: festivalFasciaOpenings(model, true).length,
  };
}
