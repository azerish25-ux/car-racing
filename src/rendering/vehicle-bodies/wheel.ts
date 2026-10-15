import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../../core/math.ts';
import { revolveX, roundedBox, type Pt } from './loft.ts';
import { discMaterial, sharedMaterials, tyreMaterial, type TreadPattern } from './materials.ts';

/** Wheel assemblies for procedural bodies (WP30). Each corner is a pivot
 * (steer + camber, at the hub) carrying a non-spinning tyre whose loaded
 * contact patch and sidewall bulge stay at the road, a non-spinning brake
 * caliper, and a spinning group with the rim, spokes, centre lock, disc and
 * bell. Rims leave real openings so the disc and caliper read through the
 * spokes. Axle along X; `side` is +1 for a left (+X) wheel, -1 for right. */
export type SpokeStyle =
  | 'split'
  | 'straight'
  | 'mesh'
  | 'beadlock'
  | 'slotted'
  | 'kart'
  // Laced wire wheel: many thin crossed spokes (classic road and club cars).
  | 'wire';
export interface WheelSheet {
  /** Tyre section width (m) front and rear. */
  width: readonly [number, number];
  /** Rim bead-seat radius (m). */
  rimRadius: number;
  spokes: number;
  style: SpokeStyle;
  rimColor: number;
  caliperColor: number;
  tread: TreadPattern;
  centreLock: boolean;
  /** Brake disc radius relative to the rim radius (0 = no visible disc). */
  disc: number;
}
export type Detail = 0 | 1 | 2;
const SEGMENTS = [64, 30, 14] as const;
/** Tyre cross-section: bead, bulging sidewall, rounded shoulder, crown. */
function tyreProfile(R: number, rim: number, half: number, detail: Detail): Pt[] {
  const wall = R - rim,
    shoulder = Math.min(0.045, wall * 0.42, half * 0.35);
  const pts: Pt[] = [
    [rim - 0.004, -half * 0.86],
    [rim + wall * 0.18, -half * 0.99],
    [rim + wall * 0.5, -half * 1.03],
    [R - shoulder * 0.9, -half * 0.97],
    [R - shoulder * 0.25, -half + shoulder * 0.55],
    [R, -half + shoulder * 1.4],
    [R, half - shoulder * 1.4],
    [R - shoulder * 0.25, half - shoulder * 0.55],
    [R - shoulder * 0.9, half * 0.97],
    [rim + wall * 0.5, half * 1.03],
    [rim + wall * 0.18, half * 0.99],
    [rim - 0.004, half * 0.86],
  ];
  if (detail === 2) return [pts[0], pts[2], pts[4], pts[5], pts[6], pts[7], pts[9], pts[11]];
  if (detail === 1) return pts.filter((_, i) => i !== 1 && i !== 10);
  return pts;
}
function tyreGeometry(R: number, rim: number, half: number, detail: Detail) {
  const g = revolveX(tyreProfile(R, rim, half, detail), SEGMENTS[detail]);
  const p = g.getAttribute('position'),
    bind = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    bind[i * 3] = x / half;
    bind[i * 3 + 1] = Math.hypot(y, z) / R;
    bind[i * 3 + 2] = Math.atan2(z, -y);
  }
  g.setAttribute('tyreBind', new T.BufferAttribute(bind, 3));
  g.computeVertexNormals();
  return g;
}
/** One spoke: a tapered, slightly concave bar from the hub to the barrel. */
function spokeGeometry(inner: number, outer: number, width: number, depth: number, dish: number) {
  const g = new T.BoxGeometry(depth, outer - inner, 1, 1, 4, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + (outer - inner) / 2) / (outer - inner);
    const w = width * (1.25 - 0.45 * t);
    p.setZ(i, Math.sign(p.getZ(i)) * w * 0.5);
    // Concave face: the hub sits inboard of the lip.
    p.setX(i, p.getX(i) - dish * (1 - t) * (1 - t));
    p.setY(i, p.getY(i) + (outer + inner) / 2);
  }
  g.computeVertexNormals();
  return g;
}
/** Revolve a profile given in outboard-positive axial coordinates, mirrored
 * for a right wheel with its winding preserved (three's lathe normal is
 * (da, -dr) for the traversal direction). */
function revolveSided(profile: readonly Pt[], segments: number, side: number) {
  const mapped = profile.map(([r, a]) => [r, a * side] as const);
  return revolveX(side < 0 ? mapped.reverse() : mapped, segments);
}
function rimGeometry(sheet: WheelSheet, half: number, side: number, detail: Detail) {
  const rim = sheet.rimRadius,
    face = half * 0.62,
    parts: T.BufferGeometry[] = [];
  const seg = SEGMENTS[detail];
  // Barrel (facing the axle, seen through the spokes) and the polished lip.
  parts.push(
    revolveSided(
      [
        [rim - 0.012, half * 0.85],
        [rim - 0.012, -half * 0.85],
      ],
      seg,
      side,
    ),
  );
  parts.push(
    revolveSided(
      [
        [rim + 0.006, half * 0.8 - 0.004],
        [rim + 0.01, half * 0.8 + 0.01],
        [rim + 0.004, half * 0.8 + 0.018],
        [rim - 0.03, half * 0.8 + 0.016],
        [rim - 0.034, half * 0.8 + 0.004],
      ],
      seg,
      side,
    ),
  );
  const hubR = Math.max(0.035, rim * 0.24);
  if (sheet.style === 'beadlock' || sheet.style === 'kart' || detail === 2)
    // Dished centre (rim to hub, facing outboard).
    parts.push(
      revolveSided(
        [
          [rim - 0.012, face + 0.02],
          [rim * 0.55, face - 0.012],
          [hubR, face - 0.03],
        ],
        seg,
        side,
      ),
    );
  if (detail < 2) {
    const count = sheet.style === 'beadlock' ? 0 : sheet.spokes;
    const wire = sheet.style === 'wire';
    const pair = sheet.style === 'split' || sheet.style === 'mesh' || wire ? 2 : 1;
    const width =
      sheet.style === 'slotted'
        ? rim * 0.34
        : sheet.style === 'straight'
          ? rim * 0.16
          : sheet.style === 'kart'
            ? rim * 0.3
            : wire
              ? rim * 0.022
              : rim * 0.1;
    for (let k = 0; k < count; k++)
      for (let q = 0; q < pair; q++) {
        // Wire spokes cross: each pair leans a full spoke pitch apart.
        const spread =
          pair === 2 ? (q - 0.5) * (sheet.style === 'mesh' ? 0.5 : wire ? 1.6 : 0.2) : 0;
        const s = spokeGeometry(
          hubR * 0.9,
          rim - 0.006,
          width,
          wire ? 0.008 : 0.026,
          side * (wire ? 0.06 : 0.035),
        );
        s.rotateX(((k + spread) / count) * Math.PI * 2);
        s.translate(side * face, 0, 0);
        parts.push(s);
      }
    if (sheet.style === 'beadlock')
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        parts.push(
          new T.CylinderGeometry(0.007, 0.007, 0.012, 6)
            .rotateZ(Math.PI / 2)
            .translate(
              side * (half * 0.8 + 0.018),
              Math.cos(a) * (rim - 0.012),
              Math.sin(a) * (rim - 0.012),
            ),
        );
      }
  }
  // Hub, and a centre-lock nut or a five-stud cap.
  parts.push(
    new T.CylinderGeometry(hubR, hubR * 1.05, 0.05, Math.max(8, seg / 3))
      .rotateZ(Math.PI / 2)
      .translate(side * (face - 0.012), 0, 0),
  );
  if (detail < 2) {
    parts.push(
      new T.CylinderGeometry(hubR * 0.52, hubR * 0.6, 0.04, sheet.centreLock ? 6 : 16)
        .rotateZ(Math.PI / 2)
        .translate(side * (face + 0.018), 0, 0),
    );
    if (!sheet.centreLock)
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        parts.push(
          new T.CylinderGeometry(0.008, 0.008, 0.03, 6)
            .rotateZ(Math.PI / 2)
            .translate(side * (face + 0.016), Math.cos(a) * hubR * 0.7, Math.sin(a) * hubR * 0.7),
        );
      }
  }
  return mergeParts(parts);
}
/** Merge non-indexed copies of `parts` (disposing them) with smooth normals. */
function mergeParts(parts: T.BufferGeometry[]) {
  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(f.attributes))
      if (name !== 'position' && name !== 'normal') f.deleteAttribute(name);
    return f;
  });
  const merged = mergeGeometries(flat, false);
  for (const g of parts) g.dispose();
  for (const g of flat) g.dispose();
  merged.computeVertexNormals();
  return merged;
}
function discGeometry(sheet: WheelSheet, half: number, side: number, detail: Detail) {
  const R = sheet.rimRadius * sheet.disc,
    x = side * half * 0.18;
  const seg = SEGMENTS[detail];
  // A closed ventilated ring, and the bell rising outboard to the hub.
  return mergeParts([
    revolveX(
      [
        [R * 0.58, -0.016],
        [R, -0.016],
        [R, 0.016],
        [R * 0.58, 0.016],
        [R * 0.58, -0.016],
      ],
      seg,
    ).translate(x, 0, 0),
    revolveSided(
      [
        [R * 0.58, 0.012],
        [R * 0.36, 0.06],
      ],
      Math.max(10, seg / 2),
      side,
    ).translate(x, 0, 0),
  ]);
}
function caliperGeometry(sheet: WheelSheet, half: number, side: number) {
  const R = sheet.rimRadius * sheet.disc;
  // Axial x radial x tangential; straddles the disc edge at the rear-upper
  // quadrant with its outboard face proud of the disc.
  const body = roundedBox(0.075, 0.1, R * 0.62, 0.014, 2);
  body.rotateX(-0.55);
  body.translate(
    side * (half * 0.18 + 0.012),
    Math.cos(0.55) * R * 0.86,
    -Math.sin(0.55) * R * 0.86,
  );
  return body;
}
export class WheelAssembly {
  /** Steer/camber pivot at the hub (car frame). */
  readonly pivot = new T.Group();
  /** Rolling parts (rim, spokes, disc, bell). */
  readonly spin = new T.Group();
  readonly tyre: T.Mesh;
  readonly pose: { value: T.Vector4 };
  readonly disc: T.MeshStandardMaterial | null;
  readonly radius: number;
  constructor(radius: number, side: number, front: boolean, sheet: WheelSheet, detail: Detail) {
    this.radius = radius;
    const half = sheet.width[front ? 0 : 1] / 2;
    const rubber = tyreMaterial(sheet.tread);
    this.pose = rubber.pose;
    this.pose.value.set(0, 0, radius, 0);
    this.tyre = new T.Mesh(tyreGeometry(radius, sheet.rimRadius, half, detail), rubber.material);
    this.tyre.name = 'Tyre (non-spinning, loaded)';
    this.pivot.add(this.tyre, this.spin);
    const rim = new T.Mesh(
      rimGeometry(sheet, half, side, detail),
      sharedMaterials.rim(sheet.rimColor),
    );
    rim.name = 'Rim';
    this.spin.add(rim);
    if (sheet.disc > 0 && detail < 2) {
      this.disc = discMaterial();
      const disc = new T.Mesh(discGeometry(sheet, half, side, detail), this.disc);
      disc.name = 'Brake disc';
      this.spin.add(disc);
      const caliper = new T.Mesh(
        caliperGeometry(sheet, half, side),
        sharedMaterials.caliper(sheet.caliperColor),
      );
      caliper.name = 'Brake caliper';
      this.pivot.add(caliper);
    } else this.disc = null;
    this.pivot.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = detail === 0;
        o.receiveShadow = true;
      }
    });
  }
  /** Pose from interpolated snapshot fields (wheel-pose.ts conventions). */
  update(
    hubY: number,
    steer: number,
    camber: number,
    phase: number,
    load: number,
    pressure: number,
    discTemp: number,
  ) {
    this.pivot.position.y = hubY;
    this.pivot.rotation.set(0, steer, -camber);
    this.spin.rotation.x = phase;
    // Presentation-only deflection from the recorded load (bounded).
    const stiffness = 260000 * clamp((pressure || 155) / 155, 0.3, 2) * (this.radius / 0.335);
    const deflection = clamp(Math.max(0, load) / stiffness, 0, this.radius * 0.06);
    this.pose.value.set(phase, deflection, this.radius, deflection * 0.6);
    if (this.disc) this.disc.emissiveIntensity = clamp((discTemp - 500) / 450, 0, 2);
  }
}
