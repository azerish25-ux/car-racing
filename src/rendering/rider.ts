import * as T from 'three';
import { helmetShell, visorGeometry } from './helmet-shell.ts';

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
/** Superelliptic body section loft along +Y (torso, hump). */
function bodyLoft(
  sections: readonly (readonly [number, number, number, number, number])[],
  sides: number,
) {
  // [y, z centre, half-width, half-depth front, half-depth back]
  const p: number[] = [],
    indices: number[] = [];
  for (const [y, cz, w, front, back] of sections)
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2,
        c = Math.cos(a),
        s = Math.sin(a);
      const shape = (v: number) => Math.sign(v) * Math.abs(v) ** 0.8;
      p.push(shape(c) * w, y, cz + shape(s) * (s > 0 ? front : back));
    }
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
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
  private readonly upperArms: Bone[];
  private readonly forearms: Bone[];
  private readonly thighs: Bone[];
  private readonly shins: Bone[];
  private readonly hands: T.Group[] = [];
  private readonly feet: T.Group[] = [];
  private readonly materials: T.Material[] = [];
  private readonly q = new T.Quaternion();
  private readonly euler = new T.Euler();
  private readonly v = [0, 1, 2, 3, 4, 5].map(() => new T.Vector3());
  constructor(
    colours: RiderColours,
    readonly detail: RiderDetail = 'high',
    readonly kit: RiderKit = 'leathers',
  ) {
    const sides = detail === 'high' ? 20 : detail === 'mid' ? 12 : 6;
    const mx = kit === 'motocross';
    // Textile kit: matte woven fabric with a soft sheen, no lacquer.
    const leather = new T.MeshPhysicalMaterial(
      mx
        ? { color: colours.primary, roughness: 0.84, sheen: 0.35, sheenRoughness: 0.7, name: 'Rider jersey and pants (textile)' }
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
        ? { color: colours.secondary, roughness: 0.86, sheen: 0.3, sheenRoughness: 0.75, name: 'Rider kit panels (textile)' }
        : {
            color: colours.secondary,
            roughness: 0.52,
            clearcoat: 0.2,
            clearcoatRoughness: 0.6,
            name: 'Rider leather panels',
          },
    );
    const armour = new T.MeshStandardMaterial({
      color: colours.accent,
      roughness: 0.32,
      metalness: 0.1,
      name: 'Rider armour caps',
    });
    const glove = new T.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.62 });
    const slider = new T.MeshStandardMaterial({
      color: 0xd9dad6,
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
      color: 0x26394a,
      roughness: 0.07,
      metalness: 0.55,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      name: 'Tinted visor',
    });
    this.materials.push(leather, panel, armour, glove, slider, helmet, visor);
    this.root.name = 'Rider';
    this.root.add(this.torso);
    // Torso: pelvis at the origin, spine along +Y, chest forward (+Z).
    part(
      this.torso,
      bodyLoft(
        [
          [-0.06, 0, 0.15, 0.1, 0.09],
          [0.05, 0, 0.165, 0.11, 0.1],
          [0.17, 0.01, 0.16, 0.1, 0.1],
          [0.3, 0.02, 0.17, 0.11, 0.1],
          [0.42, 0.02, 0.2, 0.11, 0.09],
          [0.5, 0.02, 0.17, 0.08, 0.08],
          [0.55, 0.03, 0.08, 0.05, 0.05],
        ],
        sides,
      ),
      leather,
    );
    // Aero hump (spine protector and airbag housing) on the back.
    if (detail !== 'far' && !mx)
      part(
        this.torso,
        bodyLoft(
          [
            [0.16, -0.08, 0.04, 0.02, 0.03],
            [0.3, -0.1, 0.085, 0.03, 0.06],
            [0.46, -0.08, 0.095, 0.03, 0.07],
            [0.58, -0.05, 0.06, 0.02, 0.05],
          ],
          sides,
        ),
        panel,
      );
    // Contrast side panels and a shoulder cap per side.
    for (const side of [1, -1]) {
      if (detail === 'far') break;
      const flank = part(this.torso, limbGeometry(0.035, 0.03, 0.3, sides), panel);
      flank.position.set(side * 0.15, 0.08, 0);
      // Low-profile shoulder armour moulded into the leathers.
      const cap = part(this.torso, new T.SphereGeometry(0.055, sides, sides / 2), armour);
      cap.position.set(side * 0.175, 0.46, 0.0);
      cap.scale.set(0.75, 0.55, 1.0);
    }
    // Head and helmet: neck pivot at the top of the spine.
    this.head.position.set(0, RIDER.spine + 0.04, 0.03);
    this.torso.add(this.head);
    const shell = part(
      this.head,
      detail === 'far' ? new T.SphereGeometry(0.14, 8, 6) : helmetShell(),
      helmet,
    );
    shell.position.set(0, 0.15, 0.02);
    if (detail !== 'far' && mx) {
      // Off-road helmet: a peak over the eye port, a chin bar and goggles
      // on their strap in place of a visor.
      const peak = part(this.head, new T.BoxGeometry(0.2, 0.012, 0.13), helmet);
      peak.position.set(0, 0.26, 0.16);
      peak.rotation.x = -0.32;
      const chin = part(this.head, new T.BoxGeometry(0.12, 0.06, 0.08), helmet);
      chin.position.set(0, 0.05, 0.17);
      chin.rotation.x = 0.5;
      const goggle = part(this.head, new T.BoxGeometry(0.17, 0.05, 0.03), visor);
      goggle.position.set(0, 0.17, 0.165);
      const strap = part(this.head, new T.TorusGeometry(0.14, 0.012, 6, sides), glove);
      strap.position.set(0, 0.17, 0.02);
      strap.rotation.x = Math.PI / 2;
    } else if (detail !== 'far') {
      const shield = part(this.head, visorGeometry(0.004), visor);
      shield.position.copy(shell.position);
      // Rear aero spoiler on the helmet.
      const fin = part(this.head, new T.BoxGeometry(0.16, 0.025, 0.07), helmet);
      fin.position.set(0, 0.24, -0.12);
      fin.rotation.x = -0.35;
    }
    const limb = (r0: number, r1: number, length: number, material: T.Material) => {
      const bone = new Bone(length, this.root);
      part(bone.group, limbGeometry(r0, r1, length, sides), material);
      return bone;
    };
    this.upperArms = [0, 1].map(() => limb(0.046, 0.038, RIDER.upperArm, leather));
    this.forearms = [0, 1].map(() => limb(0.039, 0.031, RIDER.forearm, panel));
    this.thighs = [0, 1].map(() => limb(0.072, 0.052, RIDER.thigh, leather));
    this.shins = [0, 1].map(() => limb(0.05, 0.037, RIDER.shin, panel));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      if (detail !== 'far' && mx) {
        // Knee braces over the pants and elbow guards.
        const brace = part(this.shins[i].group, new T.CylinderGeometry(0.06, 0.058, 0.16, sides), armour);
        brace.position.set(0, 0.02, 0.0);
        const guard = part(this.forearms[i].group, new T.SphereGeometry(0.042, sides, sides / 2), armour);
        guard.scale.set(1, 1.3, 0.9);
        guard.position.set(side * 0.01, 0.02, -0.02);
      } else if (detail !== 'far') {
        // Elbow slider, knee armour and the replaceable knee slider puck on
        // the outside of each knee, which touches the road when hung off.
        const elbow = part(
          this.forearms[i].group,
          new T.SphereGeometry(0.045, sides, sides / 2),
          armour,
        );
        elbow.scale.set(1, 1.4, 0.9);
        elbow.position.set(side * 0.01, 0.02, -0.02);
        const knee = part(
          this.shins[i].group,
          new T.SphereGeometry(0.062, sides, sides / 2),
          armour,
        );
        knee.position.set(0, 0.0, 0.02);
        knee.scale.set(1.1, 1.2, 0.9);
        const puck = part(
          this.shins[i].group,
          new T.CylinderGeometry(0.045, 0.05, 0.03, sides),
          slider,
        );
        puck.rotation.z = Math.PI / 2;
        puck.position.set(side * 0.065, 0.02, 0.0);
      }
      const hand = new T.Group();
      part(hand, new T.BoxGeometry(0.075, 0.06, 0.11), glove).position.set(0, 0, 0.03);
      if (detail === 'high') {
        const knuckle = part(hand, new T.BoxGeometry(0.07, 0.02, 0.05), armour);
        knuckle.position.set(0, 0.035, 0.04);
      }
      this.forearms[i].group.add(hand);
      hand.position.set(0, RIDER.forearm + 0.02, 0);
      this.hands.push(hand);
      const foot = new T.Group();
      part(foot, new T.BoxGeometry(0.085, 0.09, 0.27), glove).position.set(0, -0.02, 0.06);
      // Tall off-road boots up the shin.
      if (mx) part(foot, new T.CylinderGeometry(0.058, 0.05, 0.3, sides), glove).position.set(0, -0.17, 0);
      if (detail !== 'far') {
        const toe = part(foot, new T.BoxGeometry(0.03, 0.03, 0.06), slider);
        toe.position.set(side * 0.045, -0.05, 0.16);
      }
      this.shins[i].group.add(foot);
      foot.position.set(0, RIDER.shin + 0.02, 0);
      this.feet.push(foot);
    }
  }
  /** Riding pose in the bike's (sprung) frame. */
  ride(pose: RiderPose) {
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
    pelvis.y += standing * 0.3;
    pelvis.z += standing * 0.04 - body * 0.1;
    // The body leans further into the corner than the bike; tucks on the
    // straight; sits up and braces under braking.
    const into = T.MathUtils.clamp(lean * 0.22 + offset * 0.5, -0.32, 0.32);
    let pitch = T.MathUtils.lerp(1.05, 1.42, tuck) - braking * 0.3 + Math.abs(lean) * 0.1;
    // An off-road rider sits up; standing, bends at the hips over the bars.
    if (this.kit === 'motocross') pitch = 0.42 + braking * 0.1 + Math.abs(lean) * 0.08;
    pitch = T.MathUtils.lerp(pitch, 0.78 + body * 0.25, standing);
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
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const inside = side * Math.sign(offset || lean) > 0;
      shoulder
        .set(side * RIDER.shoulderWidth, RIDER.spine - 0.04, 0.0)
        .applyQuaternion(this.torso.quaternion)
        .add(pelvis);
      pole.copy(shoulder).add(target.set(side * 0.35, -0.3, -0.1));
      twoBone(this.upperArms[i], this.forearms[i], shoulder, this.grips[i], pole, joint);
      hip
        .set(side * RIDER.hipWidth, 0, 0)
        .applyQuaternion(this.torso.quaternion)
        .add(pelvis);
      // Feet on the pegs; the inside knee opens toward the road when hung off.
      const out = inside ? 0.35 + Math.abs(offset) * 1.4 : 0.25;
      pole.copy(hip).add(target.set(side * out, 0.15, 0.55));
      // A dabbed foot leaves its peg toward the ground ahead of it.
      const down = side * dab > 0 ? Math.abs(dab) : 0;
      if (down > 0) {
        target.set(side * 0.34, -0.86, 0.32).add(this.pegs[i]);
        target.lerpVectors(this.pegs[i], target, down);
        twoBone(this.thighs[i], this.shins[i], hip, target, pole, joint);
      } else twoBone(this.thighs[i], this.shins[i], hip, this.pegs[i], pole, joint);
      this.feet[i].rotation.set(-0.35, 0, 0);
      this.hands[i].rotation.set(0.2, 0, 0);
    }
  }
  /** Separated rider: `phase` 0 sliding/tumbling, 1 standing/jogging, 2 at the bike. */
  separated(phase: number, tumble: number, time: number) {
    const [pelvis, a, b, joint, pole, c] = this.v;
    const lying = phase === 0;
    pelvis.set(0, lying ? 0.0 : 0.95, 0);
    this.torso.position.copy(pelvis);
    // Lying: torso along the slide direction, rolled by the tumble.
    this.euler.set(lying ? Math.PI / 2 - 0.1 : 0.12, 0, lying ? tumble : 0, 'ZYX');
    this.torso.quaternion.setFromEuler(this.euler);
    this.head.rotation.set(lying ? -0.6 : -0.1, 0, 0);
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
  }
  dispose() {
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
void Y;
