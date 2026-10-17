import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tagWeatherSurface } from './weather-presentation.ts';
import { helmetLiveryTexture, riderPanelTexture } from './bike-livery.ts';
import { bikeSurfaceMaps } from './bike-surface-detail.ts';
import { batchBikeRigidMeshes } from './bike-rigid-batch.ts';
import { sampleProfile } from './profile-sampling.ts';
import { gpRacingBoot, installGpLeatherFinish } from './gp-rider-gear.ts';
import { motocrossFabricMaps, motocrossGraphics } from './offroad/motocross-detail.ts';
import {
  addMotocrossBoot,
  addMotocrossHelmet,
  drapeMotocrossFabric,
  motocrossHelmetShell,
} from './offroad/motocross-gear.ts';
import {
  helmetShell,
  visorGeometry,
  helmetSpoilerGeometry,
  helmetPoint,
  visorBounds,
  VISOR_PHI,
  helmetPatch,
} from './helmet-shell.ts';

/** Procedural road-racing rider (WP34 presentation): one-piece leathers with
 * armour caps, aero hump, knee/elbow sliders, gloves, boots and a full-face
 * helmet with a tinted visor. The pose is solved every frame from the bike
 * snapshot: lean (the rider hangs off and leans further than the bike), rider
 * offset, tuck behind the screen on straights, sitting up under braking, hands
 * on the clip-ons (two-bone IK to the steered grips) and feet on the pegs.
 * Separated, the same rider slides, tumbles, stands and jogs back to the bike.
 * Original design; no real person, team or equipment brand is depicted. */
export interface RiderColours {
  primary: number;
  secondary: number;
  accent: number;
}
export interface RiderPose {
  /** Chassis lean (rad, + left) and hang-off offset (m, + left). */
  lean: number;
  offset: number;
  tuck: number;
  /** 0 coasting .. 1 hard braking. */
  braking: number;
  steer: number;
  /** Off-road (WP41): 0 seated .. 1 standing on the pegs. */
  standing?: number;
  /** Foot dab: -1 right foot down .. +1 left foot down. */
  dab?: number;
  /** Body fore/aft over the bike: -1 back (throttle) .. +1 forward. */
  body?: number;
}
export type RiderDetail = 'high' | 'mid' | 'far';
/** Road leathers, or an off-road kit (textile jersey and pants, peaked
 * helmet with goggles, tall boots). */
export type RiderKit = 'leathers' | 'motocross';
const Y = new T.Vector3(0, 1, 0);
/** Tapered capsule along +Y from 0 to `length` (joint at the origin). */
function limbGeometry(r0: number, r1: number, length: number, sides: number) {
  const points: T.Vector2[] = [];
  const caps = Math.max(3, Math.round(sides / 4));
  for (let i = 0; i <= caps; i++) {
    const a = -Math.PI / 2 + (i / caps) * (Math.PI / 2);
    points.push(new T.Vector2(Math.cos(a) * r0, Math.sin(a) * r0));
  }
  for (let i = 1; i < 6; i++) {
    const t = i / 6,
      bulge = Math.sin(t * Math.PI) * 0.12 * Math.max(r0, r1);
    points.push(new T.Vector2(T.MathUtils.lerp(r0, r1, t) + bulge, t * length));
  }
  for (let i = 0; i <= caps; i++) {
    const a = (i / caps) * (Math.PI / 2);
    points.push(new T.Vector2(Math.cos(a) * r1, length + Math.sin(a) * r1));
  }
  return new T.LatheGeometry(points, sides);
}
type LimbShape = 'upper-arm' | 'forearm' | 'thigh' | 'shin';
type BodySection = readonly [number, number, number, number, number];
/** Cross sections of clothed anatomy, measured along each existing IK bone.
 * The shoulder/biceps, forearm mass, quadriceps and calf have separate peaks;
 * the wrist, elbow, patella and ankle taper instead of forming rigid capsules.
 * [fraction along bone, centre Z, half width, front depth, rear depth]. */
const ROAD_LIMB_SECTIONS: Record<LimbShape, readonly BodySection[]> = {
  'upper-arm': [
    [-0.11, 0, 0.002, 0.003, 0.003],
    [-0.055, 0, 0.035, 0.034, 0.039],
    [0, 0.002, 0.049, 0.045, 0.052],
    [0.18, 0.004, 0.055, 0.051, 0.058],
    [0.42, 0.003, 0.05, 0.046, 0.054],
    [0.68, 0, 0.041, 0.038, 0.045],
    [0.87, 0, 0.036, 0.034, 0.039],
    [1, 0, 0.033, 0.032, 0.035],
    [1.1, 0, 0.002, 0.003, 0.003],
  ],
  forearm: [
    [-0.1, 0, 0.002, 0.003, 0.003],
    [0, 0, 0.038, 0.04, 0.04],
    [0.15, -0.003, 0.047, 0.051, 0.047],
    [0.33, -0.003, 0.044, 0.047, 0.045],
    [0.64, 0, 0.034, 0.036, 0.036],
    [0.89, 0, 0.028, 0.03, 0.03],
    [1, 0, 0.027, 0.029, 0.029],
    [1.08, 0, 0.002, 0.003, 0.003],
  ],
  thigh: [
    [-0.1, 0, 0.003, 0.004, 0.004],
    [-0.04, 0, 0.061, 0.068, 0.064],
    [0.05, 0.003, 0.08, 0.082, 0.075],
    [0.25, 0.003, 0.081, 0.083, 0.075],
    [0.46, 0.004, 0.072, 0.074, 0.065],
    [0.72, 0.001, 0.058, 0.061, 0.053],
    [0.9, 0, 0.051, 0.053, 0.047],
    [1, 0, 0.048, 0.047, 0.047],
    [1.09, 0, 0.003, 0.004, 0.004],
  ],
  shin: [
    [-0.1, 0, 0.003, 0.004, 0.004],
    [0, 0.002, 0.049, 0.055, 0.046],
    [0.2, -0.006, 0.048, 0.047, 0.055],
    [0.4, -0.009, 0.049, 0.045, 0.059],
    [0.65, -0.004, 0.04, 0.039, 0.044],
    [0.9, 0, 0.031, 0.034, 0.032],
    [1, 0, 0.032, 0.035, 0.031],
    [1.08, 0, 0.003, 0.004, 0.004],
  ],
};
function roadLimbSections(shape: LimbShape, length: number): BodySection[] {
  return ROAD_LIMB_SECTIONS[shape].map(([t, z, w, front, back]) => [t * length, z, w, front, back]);
}
/** A stitched insert conforms to the underlying anatomical loft. Optional
 * accordion folds rise only 1.5–4.5 mm; plain side panels follow the same skin. */
function leatherPanelGeometry(
  sections: readonly BodySection[],
  from: number,
  to: number,
  folds: number,
  sides: number,
  angles: readonly [number, number] = [Math.PI * 1.06, Math.PI * 1.94],
  roundness = 1,
) {
  const ys = sections.map((s) => s[0]),
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    rows = folds ? folds * 4 : 16;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      y = T.MathUtils.lerp(from, to, t),
      values = [1, 2, 3, 4].map((k) =>
        sampleProfile(
          ys,
          sections.map((s) => s[k]),
          y,
        ),
      ),
      raised = 0.0015 + (1 - Math.cos(t * folds * Math.PI * 2)) * 0.0015 * Math.sin(t * Math.PI);
    for (let j = 0; j <= sides; j++) {
      const a = T.MathUtils.lerp(angles[0], angles[1], j / sides),
        shape = (value: number) => Math.sign(value) * Math.abs(value) ** roundness;
      positions.push(
        shape(Math.cos(a)) * (values[1] + raised),
        y,
        values[0] + shape(Math.sin(a)) * (values[Math.sin(a) > 0 ? 2 : 3] + raised),
      );
      uv.push(j / sides, t);
      if (i < rows && j < sides) {
        const at = i * (sides + 1) + j,
          next = at + sides + 1;
        indices.push(at, next, at + 1, at + 1, next, next + 1);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
/** Superelliptic body section loft along +Y (torso, hump). */
function bodyLoft(sections: readonly BodySection[], sides: number, roundness = 0.8) {
  // [y, z centre, half-width, half-depth front, half-depth back]
  const p: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const ys = sections.map((s) => s[0]);
  const samples: number[][] = [];
  const steps = sides >= 20 ? 4 : sides >= 12 ? 2 : 1;
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < steps; j++) {
      const y = T.MathUtils.lerp(ys[i], ys[i + 1], j / steps);
      samples.push([
        y,
        ...[1, 2, 3, 4].map((k) =>
          sampleProfile(
            ys,
            sections.map((s) => s[k]),
            y,
          ),
        ),
      ]);
    }
  samples.push([...sections[sections.length - 1]]);
  for (const [y, cz, w, front, back] of samples)
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2,
        c = Math.cos(a),
        s = Math.sin(a);
      const shape = (v: number) => Math.sign(v) * Math.abs(v) ** roundness;
      p.push(shape(c) * w, y, cz + shape(s) * (s > 0 ? front : back));
      uv.push(j / sides, (y - ys[0]) / (ys[ys.length - 1] - ys[0]));
    }
  for (let i = 0; i < samples.length - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
/** Replaceable knee slider: a thin asymmetrical polymer pad, not a joint disc. */
function kneeSliderGeometry() {
  const shape = new T.Shape();
  shape.moveTo(-0.025, -0.037);
  shape.bezierCurveTo(-0.036, -0.025, -0.032, 0.025, -0.018, 0.04);
  shape.quadraticCurveTo(0.002, 0.049, 0.023, 0.031);
  shape.quadraticCurveTo(0.033, 0.005, 0.026, -0.026);
  shape.quadraticCurveTo(0.017, -0.043, -0.025, -0.037);
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: 0.01,
    bevelEnabled: true,
    bevelSize: 0.004,
    bevelThickness: 0.003,
    bevelSegments: 2,
    curveSegments: 5,
  });
  geometry.translate(0, 0, -0.005);
  return geometry;
}
function part(parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material) {
  const m = new T.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
/** Bone: a group at the proximal joint whose +Y points at the distal joint. */
class Bone {
  readonly group = new T.Group();
  constructor(
    readonly length: number,
    parent: T.Object3D,
  ) {
    parent.add(this.group);
  }
  private static x = new T.Vector3();
  private static y = new T.Vector3();
  private static z = new T.Vector3();
  private static m = new T.Matrix4();
  aim(from: T.Vector3, to: T.Vector3, pole: T.Vector3) {
    const { x, y, z, m } = Bone;
    y.subVectors(to, from);
    const len = y.length();
    if (len < 1e-6) return;
    y.multiplyScalar(1 / len);
    z.subVectors(pole, from);
    z.addScaledVector(y, -z.dot(y));
    if (z.lengthSq() < 1e-10) z.set(0, 0, 1).addScaledVector(y, -y.z);
    z.normalize();
    x.crossVectors(y, z);
    m.makeBasis(x, y, z);
    this.group.position.copy(from);
    this.group.quaternion.setFromRotationMatrix(m);
  }
}
const scratch = {
  a: new T.Vector3(),
  b: new T.Vector3(),
  e: new T.Vector3(),
  m: new T.Vector3(),
};
/** Analytic two-bone IK: sets `upper` from root to the joint and `lower` on to the target. */
function twoBone(
  upper: Bone,
  lower: Bone,
  root: T.Vector3,
  target: T.Vector3,
  pole: T.Vector3,
  joint: T.Vector3,
) {
  const { e, m } = scratch;
  const l1 = upper.length,
    l2 = lower.length;
  e.subVectors(target, root);
  const d = T.MathUtils.clamp(e.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  e.normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d),
    sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  m.subVectors(pole, root);
  m.addScaledVector(e, -m.dot(e));
  if (m.lengthSq() < 1e-10) m.set(0, 1, 0);
  m.normalize();
  joint
    .copy(root)
    .addScaledVector(e, l1 * cosA)
    .addScaledVector(m, l1 * sinA);
  upper.aim(root, joint, pole);
  scratch.a.copy(root).addScaledVector(e, d);
  lower.aim(joint, scratch.a, pole);
}
/** Rider dimensions (m) for a ~1.75 m, 72 kg rider in leathers. */
export const RIDER = Object.freeze({
  hipWidth: 0.1,
  shoulderWidth: 0.185,
  spine: 0.48,
  upperArm: 0.29,
  forearm: 0.28,
  thigh: 0.44,
  shin: 0.44,
  neck: 0.12,
});
export class Rider {
  readonly root = new T.Group();
  /** Bike-frame anchors the bike supplies each frame: seat hip centre, the two
   * grips (after steering) and the two foot pegs. Index 0 left (+X), 1 right. */
  readonly seat = new T.Vector3(0, 0.3, -0.24);
  readonly grips = [new T.Vector3(0.3, 0.24, 0.35), new T.Vector3(-0.3, 0.24, 0.35)];
  readonly pegs = [new T.Vector3(0.17, -0.2, -0.3), new T.Vector3(-0.17, -0.2, -0.3)];
  private readonly torso = new T.Group();
  private readonly head = new T.Group();
  private readonly headShadow = new T.Group();
  private readonly upperArms: Bone[];
  private readonly forearms: Bone[];
  private readonly thighs: Bone[];
  private readonly shins: Bone[];
  private readonly hands: T.Group[] = [];
  private readonly feet: T.Group[] = [];
  private readonly exteriorForearms = [0, 1].map(() => ({
    position: new T.Vector3(),
    quaternion: new T.Quaternion(),
  }));
  private readonly exteriorUpperArms = [0, 1].map(() => ({
    position: new T.Vector3(),
    quaternion: new T.Quaternion(),
  }));
  private motocrossFirstPerson = false;
  private riding = false;
  private readonly materials: T.Material[] = [];
  private readonly q = new T.Quaternion();
  private readonly euler = new T.Euler();
  private readonly v = [0, 1, 2, 3, 4, 5].map(() => new T.Vector3());
  constructor(
    colours: RiderColours,
    readonly detail: RiderDetail = 'high',
    readonly kit: RiderKit = 'leathers',
    readonly raceNumber = 2,
  ) {
    const sides = detail === 'high' ? 20 : detail === 'mid' ? 12 : 6;
    const mx = kit === 'motocross';
    // Textile kit: matte woven fabric with a soft sheen, no lacquer.
    const leather = new T.MeshPhysicalMaterial(
      mx
        ? {
            color: colours.primary,
            roughness: 0.84,
            sheen: 0.35,
            sheenRoughness: 0.7,
            name: 'Rider jersey and pants (textile)',
          }
        : {
            color: colours.primary,
            roughness: 0.48,
            metalness: 0.02,
            clearcoat: 0.25,
            clearcoatRoughness: 0.55,
            name: 'Rider leathers',
          },
    );
    const panel = new T.MeshPhysicalMaterial(
      mx
        ? {
            color: colours.secondary,
            roughness: 0.86,
            sheen: 0.3,
            sheenRoughness: 0.75,
            name: 'Rider kit panels (textile)',
          }
        : {
            color: colours.secondary,
            roughness: 0.52,
            clearcoat: 0.2,
            clearcoatRoughness: 0.6,
            name: 'Rider leather panels',
          },
    );
    const armour = new T.MeshStandardMaterial({
      color: mx ? 0x34393a : 0x333b43,
      roughness: mx ? 0.74 : 0.49,
      metalness: mx ? 0.02 : 0.08,
      name: mx ? 'Rider armour caps' : 'Rider moulded armour caps',
    });
    const glove = new T.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.62 });
    const slider = new T.MeshStandardMaterial({
      color: 0x454b51,
      roughness: 0.68,
      name: 'Knee slider (scuffed polymer)',
    });
    const helmet = new T.MeshPhysicalMaterial({
      color: colours.primary,
      roughness: 0.22,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      name: 'Rider helmet shell',
    });
    const visor = new T.MeshPhysicalMaterial({
      color: 0x5e6f79,
      roughness: 0.1,
      metalness: 0.85,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      name: 'Tinted visor',
    });
    if (!mx && detail !== 'far') {
      // Smoked polymer is a dark dielectric, not a grey metal mirror. Keep
      // the actual visor and eye-port geometry and the near-camera shadow.
      visor.color.setHex(0x071018);
      visor.metalness = 0;
      visor.roughness = 0.13;
      visor.clearcoat = 0.82;
      visor.clearcoatRoughness = 0.09;
      helmet.metalness = 0;
      helmet.roughness = 0.29;
      helmet.clearcoat = 0.78;
      helmet.clearcoatRoughness = 0.18;
      const surface = bikeSurfaceMaps('leather');
      Object.assign(leather, surface);
      Object.assign(panel, surface);
      leather.normalScale.set(0.09, 0.09);
      panel.normalScale.set(0.08, 0.08);
      leather.roughness = 0.72;
      leather.clearcoat = 0.035;
      panel.roughness = 0.75;
      panel.clearcoat = 0.025;
      Object.assign(glove, bikeSurfaceMaps('seat'));
      glove.normalScale.set(0.2, 0.2);
      slider.roughness = 0.79;
    }
    const flex = new T.MeshStandardMaterial({
      color: 0x151a20,
      roughness: 0.91,
      name: 'Rider stretch fabric and seams',
    });
    this.materials.push(leather, panel, armour, glove, slider, helmet, visor, flex);
    const torsoLeather = leather.clone();
    const mxBoot = mx
      ? new T.MeshStandardMaterial({
          color: 0xe1ddd2,
          roughness: 0.65,
          name: 'Motocross moulded boot shell',
        })
      : null;
    const mxTrim = mx
      ? new T.MeshPhysicalMaterial({
          color: colours.accent,
          roughness: 0.38,
          clearcoat: 0.2,
          name: 'Motocross equipment trim',
        })
      : null;
    if (mxBoot && mxTrim) this.materials.push(mxBoot, mxTrim);
    if (mx && detail !== 'far') {
      const weave = motocrossFabricMaps();
      const sleeve = motocrossGraphics(colours, 'sleeve', raceNumber);
      for (const material of [leather, panel, torsoLeather]) {
        Object.assign(material, weave);
        material.normalScale.set(0.22, 0.22);
        material.color.setHex(0xffffff);
      }
      leather.map = panel.map = sleeve;
      torsoLeather.map = motocrossGraphics(colours, 'jersey', raceNumber);
      helmet.map = motocrossGraphics(colours, 'helmet', raceNumber);
      helmet.color.setHex(0xffffff);
      helmet.roughness = 0.27;
      visor.color.setHex(0x769c9e);
      visor.roughness = 0.14;
    }
    if (!mx && detail !== 'far') {
      leather.map = riderPanelTexture(colours, false);
      leather.color.setHex(0xffffff);
      torsoLeather.map = riderPanelTexture(colours, true);
      torsoLeather.color.setHex(0xffffff);
      helmet.map = helmetLiveryTexture(colours);
      helmet.color.setHex(0xffffff);
    }
    this.materials.push(torsoLeather);
    if (!mx && detail !== 'far')
      for (const material of [leather, panel, torsoLeather]) installGpLeatherFinish(material);
    for (const m of [leather, panel, torsoLeather])
      tagWeatherSurface(m, mx ? 'fabric' : 'leather', 0.85);
    tagWeatherSurface(flex, 'fabric', 0.65);
    tagWeatherSurface(glove, 'leather', 0.8);
    tagWeatherSurface(helmet, 'paint');
    tagWeatherSurface(armour, 'metal', 0.7);
    tagWeatherSurface(slider, 'paint', 0.6);
    this.root.name = 'Rider';
    this.torso.name = 'Rider torso';
    this.root.add(this.torso);
    const fabric = (g: T.BufferGeometry) => (mx && detail !== 'far' ? drapeMotocrossFabric(g) : g);
    // Torso: pelvis at the origin, spine along +Y, chest forward (+Z).
    const torsoSections: readonly BodySection[] = mx
      ? [
          [-0.06, 0, 0.15, 0.1, 0.09],
          [0.05, 0, 0.165, 0.11, 0.1],
          [0.17, 0.01, 0.16, 0.1, 0.1],
          [0.3, 0.02, 0.17, 0.11, 0.1],
          [0.42, 0.02, 0.2, 0.11, 0.09],
          [0.5, 0.02, 0.17, 0.08, 0.08],
          [0.55, 0.03, 0.08, 0.05, 0.05],
        ]
      : [
          [-0.06, 0, 0.15, 0.1, 0.09],
          [0.05, 0, 0.165, 0.11, 0.1],
          [0.17, 0.01, 0.145, 0.093, 0.092],
          [0.3, 0.02, 0.172, 0.128, 0.105],
          [0.42, 0.02, 0.2, 0.128, 0.1],
          [0.5, 0.02, 0.17, 0.08, 0.08],
          [0.55, 0.03, 0.08, 0.05, 0.05],
        ];
    part(this.torso, fabric(bodyLoft(torsoSections, sides)), torsoLeather);
    // Aero hump (spine protector and airbag housing) on the back.
    if (detail !== 'far' && !mx)
      part(
        this.torso,
        bodyLoft(
          [
            [0.12, -0.075, 0.012, 0.016, 0.018],
            [0.23, -0.1, 0.068, 0.025, 0.046],
            [0.36, -0.104, 0.086, 0.024, 0.052],
            [0.46, -0.085, 0.072, 0.021, 0.048],
            [0.54, -0.048, 0.032, 0.014, 0.027],
            [0.57, -0.035, 0.003, 0.003, 0.004],
          ],
          sides,
        ),
        panel,
      );
    // Contrast side panels and a shoulder cap per side.
    for (const side of [1, -1]) {
      if (detail === 'far') break;
      if (mx) {
        const flank = part(this.torso, limbGeometry(0.035, 0.03, 0.3, sides), panel);
        flank.position.set(side * 0.15, 0.08, 0);
      } else {
        const centreAngle = side > 0 ? 0 : Math.PI;
        const flank = part(
          this.torso,
          leatherPanelGeometry(
            torsoSections,
            0.07,
            0.425,
            0,
            detail === 'high' ? 12 : 8,
            [centreAngle - 0.43, centreAngle + 0.43],
            0.8,
          ),
          panel,
        );
        flank.name = 'Conformal torso leather side panel';
      }
      // Low-profile shoulder armour moulded into the leathers.
      const cap = part(
        this.torso,
        new T.SphereGeometry(0.055, sides, sides / 2),
        mx ? panel : armour,
      );
      cap.position.set(side * 0.175, 0.46, 0.0);
      cap.scale.set(0.75, 0.55, 1.0);
    }
    if (detail !== 'far' && !mx) {
      // A turned leather collar closes the neck opening instead of leaving
      // the torso and helmet as two unrelated glossy forms.
      const collar = part(this.torso, new T.TorusGeometry(0.062, 0.009, 6, 24), flex);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(0, 0.541, 0.03);
      collar.scale.y = 0.82;
      const lip = part(this.torso, new T.TorusGeometry(0.064, 0.003, 5, 24), panel);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(0, 0.549, 0.03);
      lip.scale.y = 0.82;
      if (detail === 'high') {
        const zip = part(
          this.torso,
          new T.TubeGeometry(
            new T.CatmullRomCurve3([
              new T.Vector3(0, 0.06, 0.113),
              new T.Vector3(0, 0.2, 0.117),
              new T.Vector3(0, 0.37, 0.151),
              new T.Vector3(0, 0.485, 0.108),
            ]),
            18,
            0.0016,
            4,
            false,
          ),
          flex,
        );
        zip.name = 'Recessed front zip seam';
        const pull = part(
          this.torso,
          new RoundedBoxGeometry(0.008, 0.021, 0.004, 1, 0.002),
          armour,
        );
        pull.position.set(0, 0.473, 0.116);
      }
    }
    // Head and helmet: neck pivot at the top of the spine.
    this.head.name = 'Rider head and helmet';
    this.head.position.set(0, RIDER.spine + 0.04, 0.03);
    this.torso.add(this.head);
    const shell = part(
      this.head,
      detail === 'far'
        ? new T.SphereGeometry(0.14, 8, 6)
        : mx
          ? motocrossHelmetShell()
          : helmetShell(),
      helmet,
    );
    shell.position.set(0, 0.15, 0.02);
    if (!mx) {
      // The followed rider's helmet surrounds the onboard lens and is hidden
      // from that view. Retain its ground shadow with a cheap closed silhouette;
      // it writes neither colour nor depth to the normal camera pass. Three's
      // shadow pass uses its own opaque depth material (alphaTest remains zero).
      const shadowOnly = new T.MeshBasicMaterial({
        name: 'Onboard helmet shadow only',
        transparent: true,
        opacity: 0,
        colorWrite: false,
        depthWrite: false,
      });
      this.materials.push(shadowOnly);
      this.headShadow.name = 'Onboard helmet shadow proxy';
      this.headShadow.visible = false;
      this.headShadow.position.copy(this.head.position);
      this.torso.add(this.headShadow);
      const silhouette = part(this.headShadow, new T.SphereGeometry(0.14, 18, 12), shadowOnly);
      silhouette.position.copy(shell.position);
      silhouette.scale.set(0.98, 1.02, 1.07);
      silhouette.receiveShadow = false;
    }
    if (mx) {
      addMotocrossHelmet(this.head, detail, helmet, visor, flex, mxTrim!);
    } else if (detail !== 'far') {
      const shield = part(this.head, visorGeometry(0.004), visor);
      shield.position.copy(shell.position);
      // Rear aero spoiler on the helmet.
      const fin = part(this.head, helmetSpoilerGeometry(detail === 'high' ? 16 : 8, 4), helmet);
      fin.position.copy(shell.position);
      // Conformal gasket follows the existing shaped eye port; no floating visor band.
      const outline: T.Vector3[] = [];
      for (const edge of [1, 0])
        for (let i = 0; i <= 40; i++) {
          const t = edge ? i / 40 : 1 - i / 40;
          const phi = T.MathUtils.lerp(VISOR_PHI[0], VISOR_PHI[1], t);
          outline.push(helmetPoint(visorBounds(phi)[edge], phi, 0.0045));
        }
      const seal = part(
        this.head,
        new T.TubeGeometry(new T.CatmullRomCurve3(outline, true), 80, 0.002, 5, true),
        flex,
      );
      seal.position.copy(shell.position);
      const brow = part(
        this.head,
        helmetPatch(0.048, 0.07, 0.15, Math.PI - 0.15, 0.0015, 3, 32),
        panel,
      );
      brow.position.copy(shell.position);
      for (const side of [-1, 1]) {
        const pivot = part(this.head, new T.CylinderGeometry(0.01, 0.01, 0.004, 12), glove);
        pivot.rotation.z = Math.PI / 2;
        pivot.position.set(side * 0.137, 0.153, 0.035);
        const vent = part(this.head, new RoundedBoxGeometry(0.061, 0.012, 0.006, 2, 0.003), flex);
        vent.position.set(side * 0.033, 0.095, 0.173);
        vent.rotation.y = side * 0.2;
      }
    }
    const limb = (
      shape: LimbShape,
      r0: number,
      r1: number,
      length: number,
      material: T.Material,
    ) => {
      const bone = new Bone(length, this.root);
      const geometry =
        !mx && detail !== 'far'
          ? bodyLoft(roadLimbSections(shape, length), sides, 1)
          : limbGeometry(r0, r1, length, sides);
      const segment = part(bone.group, fabric(geometry), material);
      if (!mx) segment.name = `Rider ${shape} leather volume`;
      return bone;
    };
    this.upperArms = [0, 1].map(() => limb('upper-arm', 0.046, 0.038, RIDER.upperArm, leather));
    this.forearms = [0, 1].map(() => limb('forearm', 0.039, 0.031, RIDER.forearm, panel));
    this.thighs = [0, 1].map(() => limb('thigh', 0.072, 0.052, RIDER.thigh, leather));
    this.shins = [0, 1].map(() => limb('shin', 0.05, 0.037, RIDER.shin, panel));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      if (mx) {
        const label = i === 0 ? 'left' : 'right';
        this.upperArms[i].group.name = `Motocross ${label} upper arm`;
        this.forearms[i].group.name = `Motocross ${label} forearm`;
        this.thighs[i].group.name = `Motocross ${label} thigh`;
        this.shins[i].group.name = `Motocross ${label} shin`;
      }
      if (detail !== 'far' && !mx) {
        const foldSides = detail === 'high' ? 12 : 8;
        const shoulderStretch = part(
          this.upperArms[i].group,
          leatherPanelGeometry(
            roadLimbSections('upper-arm', RIDER.upperArm),
            0.012,
            0.094,
            7,
            foldSides,
          ),
          flex,
        );
        shoulderStretch.name = 'Conforming shoulder accordion insert';
        const hipStretch = part(
          this.thighs[i].group,
          leatherPanelGeometry(roadLimbSections('thigh', RIDER.thigh), 0.042, 0.157, 9, foldSides),
          flex,
        );
        hipStretch.name = 'Conforming hip accordion insert';
        const elbowFlex = part(
          this.upperArms[i].group,
          new T.SphereGeometry(0.039, sides, sides / 2),
          flex,
        );
        elbowFlex.position.y = RIDER.upperArm;
        elbowFlex.scale.set(0.94, 0.85, 0.94);
        const kneeFlex = part(
          this.thighs[i].group,
          new T.SphereGeometry(0.053, sides, sides / 2),
          flex,
        );
        kneeFlex.position.y = RIDER.thigh;
        kneeFlex.scale.set(0.95, 0.8, 0.95);
        for (const [bone, shape, len] of [
          [this.upperArms[i], 'upper-arm', RIDER.upperArm],
          [this.thighs[i], 'thigh', RIDER.thigh],
        ] as const) {
          const sections = roadLimbSections(shape, len),
            ys = sections.map((s) => s[0]);
          const seamPoints = [0.025, len * 0.32, len * 0.65, len - 0.025].map((y) => {
            const [centre, width, back] = [1, 2, 4].map((k) =>
              sampleProfile(
                ys,
                sections.map((s) => s[k]),
                y,
              ),
            );
            return new T.Vector3(
              side * (width + 0.0012) * 0.7,
              y,
              centre - (back + 0.0012) * 0.714,
            );
          });
          const seam = part(
            bone.group,
            new T.TubeGeometry(new T.CatmullRomCurve3(seamPoints), 12, 0.0018, 4, false),
            panel,
          );
          seam.name = 'Stitched leather panel boundary';
        }
      }
      if (detail !== 'far' && mx) {
        // Low-profile protection under textile; no metallic road sliders.
        const brace = part(
          this.shins[i].group,
          new T.SphereGeometry(0.059, sides, sides / 2),
          panel,
        );
        brace.position.set(0, 0.01, 0.005);
        brace.scale.set(1.05, 1.4, 0.92);
        const guard = part(
          this.forearms[i].group,
          new T.SphereGeometry(0.042, sides, sides / 2),
          panel,
        );
        guard.scale.set(1, 1.3, 0.9);
        guard.position.set(side * 0.01, 0.02, -0.02);
      } else if (detail !== 'far') {
        // The armour sits under shaped leather. Only the small replaceable
        // polymer pads are exposed; a metallic sphere would read as a hinge.
        const elbow = part(
          this.forearms[i].group,
          bodyLoft(
            [
              [-0.028, -0.02, 0.012, 0.013, 0.016],
              [0.004, -0.025, 0.035, 0.02, 0.031],
              [0.039, -0.025, 0.038, 0.022, 0.037],
              [0.082, -0.021, 0.031, 0.018, 0.029],
              [0.118, -0.01, 0.015, 0.012, 0.015],
            ],
            sides,
            1,
          ),
          panel,
        );
        elbow.name = 'Leather-covered elbow protector';
        const elbowPad = part(
          this.forearms[i].group,
          new RoundedBoxGeometry(0.037, 0.053, 0.009, 2, 0.004),
          slider,
        );
        elbowPad.position.set(side * 0.008, 0.035, -0.063);
        elbowPad.rotation.y = side * 0.12;
        const knee = part(
          this.shins[i].group,
          bodyLoft(
            [
              [-0.044, 0.025, 0.017, 0.02, 0.019],
              [-0.015, 0.025, 0.047, 0.048, 0.031],
              [0.036, 0.019, 0.054, 0.052, 0.037],
              [0.095, 0.009, 0.047, 0.047, 0.035],
              [0.158, 0.005, 0.028, 0.032, 0.024],
              [0.18, 0.004, 0.006, 0.009, 0.009],
            ],
            sides,
            0.92,
          ),
          panel,
        );
        knee.name = 'Leather-covered knee and shin protector';
        const backing = part(
          this.shins[i].group,
          new RoundedBoxGeometry(0.007, 0.1, 0.082, 2, 0.003),
          glove,
        );
        backing.position.set(side * 0.054, 0.035, 0.007);
        const puck = part(this.shins[i].group, kneeSliderGeometry(), slider);
        puck.name = 'Shaped replaceable polymer knee slider';
        puck.rotation.y = (side * Math.PI) / 2;
        puck.position.set(side * 0.062, 0.035, 0.007);
      }
      const hand = new T.Group();
      if (mx) hand.name = `Motocross ${i === 0 ? 'left' : 'right'} hand`;
      part(
        hand,
        new RoundedBoxGeometry(0.069, 0.047, 0.079, detail === 'far' ? 1 : 3, 0.017),
        glove,
      ).position.set(0, 0.0, 0.016);
      if (detail !== 'far') {
        for (let finger = 0; finger < 4; finger++) {
          const x = -0.025 + finger * 0.0165;
          const points = [
            new T.Vector3(x, 0.013, 0.042),
            new T.Vector3(x, 0.013, 0.07),
            new T.Vector3(x, -0.007, 0.079),
            new T.Vector3(x, -0.025, 0.061),
          ];
          part(hand, new T.TubeGeometry(new T.CatmullRomCurve3(points), 9, 0.007, 6, false), glove);
        }
        const thumb = part(hand, limbGeometry(0.01, 0.008, 0.037, 8), glove);
        thumb.position.set(side * 0.036, -0.01, 0.007);
        thumb.rotation.set(0.85, 0, side * 0.4);
      }
      if (detail === 'high' && mx) {
        const knuckle = part(hand, new RoundedBoxGeometry(0.062, 0.013, 0.027, 3, 0.006), armour);
        knuckle.position.set(0, 0.025, 0.025);
      } else if (detail === 'high') {
        const knuckleBacking = part(
          hand,
          new RoundedBoxGeometry(0.062, 0.008, 0.027, 2, 0.006),
          panel,
        );
        knuckleBacking.position.set(0, 0.024, 0.025);
        for (let finger = 0; finger < 4; finger++) {
          const knuckle = part(hand, new T.SphereGeometry(0.0085, 10, 6), armour);
          knuckle.scale.set(1, 0.65, 1.15);
          knuckle.position.set(-0.024 + finger * 0.016, 0.03, 0.025);
        }
      }
      this.forearms[i].group.add(hand);
      hand.position.set(0, RIDER.forearm + 0.02, 0);
      this.hands.push(hand);
      const foot = new T.Group();
      if (mx) foot.name = `Motocross ${i === 0 ? 'left' : 'right'} boot`;
      if (mx) addMotocrossBoot(foot, detail, side, mxBoot!, flex, armour);
      else
        foot.add(
          gpRacingBoot(detail, side, {
            leather: glove,
            panel,
            sole: flex,
            armour,
            slider,
          }),
        );
      this.shins[i].group.add(foot);
      foot.position.set(0, RIDER.shin + 0.02, 0);
      this.feet.push(foot);
    }
    for (const group of [
      this.torso,
      this.head,
      ...this.hands,
      ...this.feet,
      ...this.upperArms.map((b) => b.group),
      ...this.forearms.map((b) => b.group),
      ...this.thighs.map((b) => b.group),
      ...this.shins.map((b) => b.group),
    ])
      batchBikeRigidMeshes(group);
  }
  /** Exclude the followed rider's own helmet from the first-person lens.
   * A stable MX eye needs its own arm presentation: sleeves enter from below
   * the camera, with the same wrists on the actual steered bar grips. */
  setFirstPerson(active: boolean, motocross = false) {
    this.head.visible = !active;
    this.headShadow.visible = active && this.kit !== 'motocross';
    this.headShadow.quaternion.copy(this.head.quaternion);
    if (this.kit === 'motocross') {
      const previous = this.motocrossFirstPerson;
      this.motocrossFirstPerson = active && motocross;
      this.torso.visible = !this.motocrossFirstPerson;
      for (const arm of this.upperArms) arm.group.visible = true;
      if (this.motocrossFirstPerson && this.riding) this.onboardArms();
      else if (previous)
        for (let i = 0; i < this.forearms.length; i++) {
          this.forearms[i].group.position.copy(this.exteriorForearms[i].position);
          this.forearms[i].group.quaternion.copy(this.exteriorForearms[i].quaternion);
          this.upperArms[i].group.position.copy(this.exteriorUpperArms[i].position);
          this.upperArms[i].group.quaternion.copy(this.exteriorUpperArms[i].quaternion);
        }
    }
  }
  private captureExteriorArms() {
    for (let i = 0; i < this.forearms.length; i++) {
      this.exteriorForearms[i].position.copy(this.forearms[i].group.position);
      this.exteriorForearms[i].quaternion.copy(this.forearms[i].group.quaternion);
      this.exteriorUpperArms[i].position.copy(this.upperArms[i].group.position);
      this.exteriorUpperArms[i].quaternion.copy(this.upperArms[i].group.quaternion);
    }
  }
  private onboardArms() {
    const [elbow, pole, offset, shoulder] = this.v;
    for (let i = 0; i < this.forearms.length; i++) {
      const side = i === 0 ? 1 : -1;
      // Preserve the authored forearm length and the exact hand contact. The
      // exterior standing elbow pole lies above this fixed bike-frame camera;
      // the first-person pole instead carries each sleeve out of the lower view.
      offset.set(side * 0.09, -0.13, -0.23).normalize();
      elbow.copy(this.grips[i]).addScaledVector(offset, RIDER.forearm);
      offset.set(side * 0.015, -0.16, -0.24).normalize();
      shoulder.copy(elbow).addScaledVector(offset, RIDER.upperArm);
      pole.copy(this.grips[i]);
      pole.z += 1;
      this.upperArms[i].aim(shoulder, elbow, pole);
      this.forearms[i].aim(elbow, this.grips[i], pole);
    }
  }
  /** Riding pose in the bike's (sprung) frame. */
  ride(pose: RiderPose) {
    this.riding = true;
    const lean = pose.lean,
      offset = pose.offset,
      tuck = T.MathUtils.clamp(pose.tuck, 0, 1),
      braking = T.MathUtils.clamp(pose.braking, 0, 1),
      standing = T.MathUtils.clamp(pose.standing ?? 0, 0, 1),
      dab = T.MathUtils.clamp(pose.dab ?? 0, -1, 1),
      body = T.MathUtils.clamp(pose.body ?? 0, -1, 1);
    const [pelvis, shoulder, joint, hip, pole, target] = this.v;
    // Hang off: the hips slide toward the inside and drop off the seat.
    pelvis.copy(this.seat);
    pelvis.x += offset * 0.6;
    pelvis.y -= Math.abs(offset) * 0.15;
    pelvis.z += braking * 0.05 - tuck * 0.05;
    pelvis.y -= tuck * 0.03;
    // Off-road: up on the pegs (knees flexed) and fore/aft over the bike.
    const mx = this.kit === 'motocross';
    // The original 30 cm rise exceeded a dirt rider's leg reach. Keep the
    // ankles planted on their pegs with flex left in the knees for a landing.
    pelvis.y += standing * (mx ? 0.17 : 0.3);
    pelvis.z += mx ? standing * 0.055 + body * 0.085 : standing * 0.04 - body * 0.1;
    // The body leans further into the corner than the bike; tucks on the
    // straight; sits up and braces under braking.
    const into = T.MathUtils.clamp(
      mx ? -lean * 0.3 + offset * 0.2 : lean * 0.22 + offset * 0.5,
      -0.32,
      0.32,
    );
    let pitch = T.MathUtils.lerp(1.05, 1.42, tuck) - braking * 0.3 + Math.abs(lean) * 0.1;
    // An off-road rider sits up; standing, bends at the hips over the bars.
    if (mx) pitch = 0.36 + braking * 0.12 + body * 0.16 + standing * 0.23;
    else pitch = T.MathUtils.lerp(pitch, 0.78 + body * 0.25, standing);
    const yaw = T.MathUtils.clamp(offset * 0.9, -0.3, 0.3) + pose.steer * 0.3;
    this.euler.set(pitch, yaw, -into, 'ZYX');
    this.torso.position.copy(pelvis);
    this.torso.quaternion.setFromEuler(this.euler);
    // Head: chin over the tank when tucked, eyes toward the horizon and the apex.
    this.head.rotation.set(
      -pitch + 0.3 + tuck * 0.12,
      lean * 0.3 + pose.steer * 0.6,
      (into + lean) * 0.45,
      'YXZ',
    );
    this.headShadow.quaternion.copy(this.head.quaternion);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const inside = side * Math.sign(offset || lean) > 0;
      shoulder
        .set(side * RIDER.shoulderWidth, RIDER.spine - 0.04, 0.0)
        .applyQuaternion(this.torso.quaternion)
        .add(pelvis);
      pole
        .copy(shoulder)
        .add(target.set(side * 0.35, mx ? -0.08 + standing * 0.15 : -0.3, mx ? 0.08 : -0.1));
      twoBone(this.upperArms[i], this.forearms[i], shoulder, this.grips[i], pole, joint);
      hip
        .set(side * RIDER.hipWidth, 0, 0)
        .applyQuaternion(this.torso.quaternion)
        .add(pelvis);
      // Feet on the pegs; the inside knee opens toward the road when hung off.
      const out = mx ? (inside ? 0.18 : 0.12) : inside ? 0.35 + Math.abs(offset) * 1.4 : 0.25;
      pole.copy(hip).add(target.set(side * out, 0.15, 0.55));
      // A dabbed foot leaves its peg toward the ground ahead of it.
      const down = side * dab > 0 ? Math.abs(dab) : 0;
      if (down > 0) {
        // Motocross: project the boot ahead of the peg, heel close to the
        // surface. The former 86 cm drop put the target far below the track.
        target.set(side * (mx ? 0.2 : 0.34), mx ? -0.015 : -0.86, 0.32).add(this.pegs[i]);
        target.lerpVectors(this.pegs[i], target, down);
        twoBone(this.thighs[i], this.shins[i], hip, target, pole, joint);
      } else twoBone(this.thighs[i], this.shins[i], hip, this.pegs[i], pole, joint);
      this.feet[i].rotation.set(mx ? -0.07 - down * 0.15 : -0.35, 0, 0);
      this.hands[i].rotation.set(0.2, 0, 0);
    }
    if (this.kit === 'motocross') {
      this.captureExteriorArms();
      if (this.motocrossFirstPerson) this.onboardArms();
    }
  }
  /** Separated rider: `phase` 0 sliding/tumbling, 1 standing/jogging, 2 at the bike. */
  separated(phase: number, tumble: number, time: number) {
    this.riding = false;
    const [pelvis, a, b, joint, pole, c] = this.v;
    const lying = phase === 0;
    pelvis.set(0, lying ? 0.0 : 0.95, 0);
    this.torso.position.copy(pelvis);
    // Lying: torso along the slide direction, rolled by the tumble.
    this.euler.set(lying ? Math.PI / 2 - 0.1 : 0.12, 0, lying ? tumble : 0, 'ZYX');
    this.torso.quaternion.setFromEuler(this.euler);
    this.head.rotation.set(lying ? -0.6 : -0.1, 0, 0);
    this.headShadow.quaternion.copy(this.head.quaternion);
    const stride = phase === 1 ? Math.sin(time * 9) * 0.45 : 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      a.set(side * RIDER.shoulderWidth, RIDER.spine - 0.04, 0)
        .applyQuaternion(this.torso.quaternion)
        .add(pelvis);
      // Hands: spread when sliding, swinging when jogging, on the bars at the bike.
      c.set(side * 0.38, lying ? 0.0 : -0.25, lying ? 0.35 : 0.15 + side * stride * 0.4);
      if (phase === 2) c.set(side * 0.25, -0.05, 0.45);
      c.applyQuaternion(this.torso.quaternion).add(a);
      pole.copy(a).add(b.set(side * 0.4, -0.4, -0.2));
      twoBone(this.upperArms[i], this.forearms[i], a, c, pole, joint);
      a.set(side * RIDER.hipWidth, 0, 0)
        .applyQuaternion(this.torso.quaternion)
        .add(pelvis);
      c.set(side * 0.16, -0.86, side * stride * 0.6);
      if (lying) c.set(side * 0.22, -0.82, -0.08);
      c.applyQuaternion(this.torso.quaternion).add(a);
      pole.copy(a).add(b.set(side * 0.1, 0, 0.6).applyQuaternion(this.torso.quaternion));
      twoBone(this.thighs[i], this.shins[i], a, c, pole, joint);
      this.feet[i].rotation.set(-1.4, 0, 0);
    }
    if (this.kit === 'motocross') this.captureExteriorArms();
  }
  dispose() {
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    const textures = new Set<T.Texture>();
    for (const m of this.materials) {
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
      m.dispose();
    }
    for (const texture of textures) texture.dispose();
  }
}
void Y;
