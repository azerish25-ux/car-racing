import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import {
  add,
  beam,
  exhaustGeometry,
  numberTexture,
  staticSag,
  superLoft,
  tube,
  tyreGeometry,
  type BikeMaterials,
  type BikePoseValues,
} from '../bike.ts';
import { liveryScheme } from '../car-livery.ts';
import { Rider, type RiderDetail } from '../rider.ts';
import { installMudOn, type MudUniforms } from './mud.ts';

/** Off-road motorcycle geometry (m): a 27 degree rake, a long fork with
 * ~300 mm of travel between the axle and the lower clamp, and the rider's
 * contact points for a standing-friendly riding position. */
const RAKE = 0.47,
  OFFSET = 0.022,
  FORK = 0.92,
  CLAMPS = 0.2;
/**
 * Procedural motocross / supercross / supermoto bike (WP41 presentation).
 * Original design, no real manufacturer: a steel perimeter frame and
 * aluminium swingarm, single-cylinder engine with radiators behind wing
 * shrouds, a high beak-less front fender on the lower clamp, a long
 * upswept rear fender, number boards front and side, a flat long seat, a
 * long upside-down fork with plastic guards, spoked wheels and knobby tyres
 * (treaded road tyres on the supermoto), and an off-road rider who stands
 * and dabs from the snapshot. Same pose contract and LOD levels as the road
 * bike; a mud coat follows the entrant's O.MUD.
 */
export class DirtBikeModel {
  readonly root = new T.Group();
  readonly sprung = new T.Group();
  readonly rider: Rider;
  private readonly steerMount = new T.Group();
  private readonly steer = new T.Group();
  private readonly forkLower = new T.Group();
  private readonly frontSpin = new T.Group();
  private readonly rearWheel = new T.Group();
  private readonly rearSpin = new T.Group();
  private readonly swingarm = new T.Group();
  private readonly spring = new T.Group();
  private readonly pivot: T.Vector3;
  private readonly rearAxle: T.Vector3;
  private readonly armLength: number;
  private readonly sag: { fork: number; shock: number };
  private readonly gripLocal = [new T.Vector3(), new T.Vector3()];
  private readonly scratch = new T.Vector3();
  private readonly matrix = new T.Matrix4();
  private readonly plastics: T.MeshPhysicalMaterial[] = [];
  constructor(
    readonly definition: VehicleDefinition,
    readonly id: number,
    readonly detail: RiderDetail,
    private readonly m: BikeMaterials,
    private readonly mud: MudUniforms,
  ) {
    const b = definition.bike!,
      h = b.cgHeight,
      sides = detail === 'high' ? 36 : detail === 'mid' ? 18 : 10,
      supermoto = definition.tireFamily === 'supermoto',
      scheme = liveryScheme(id);
    this.sag = staticSag(definition);
    this.root.name = `${definition.name} ${id + 1} (${detail})`;
    this.root.add(this.sprung);
    // Moulded polypropylene: satin, slightly translucent-looking, no lacquer.
    const plastic = (color: T.ColorRepresentation, name: string) => {
      const mat = new T.MeshPhysicalMaterial({
        color,
        roughness: 0.42,
        metalness: 0,
        clearcoat: 0.15,
        clearcoatRoughness: 0.5,
        name,
      });
      this.plastics.push(mat);
      return mat;
    };
    const primary = plastic(scheme.primary, 'Off-road plastics'),
      white = plastic(0xe8e6df, 'Off-road white plastics'),
      dark = plastic(0x1c1d20, 'Off-road black plastics'),
      board = new T.MeshPhysicalMaterial({
        map: numberTexture((id % 98) + 2, '#ecebe4', scheme.primary),
        roughness: 0.5,
        clearcoat: 0.1,
        name: 'Number board',
      });
    this.plastics.push(board);
    // ---- Wheels: spoked rims and knobby (or treaded road) tyres.
    const frontR = b.frontWheelRadius,
      rearR = b.rearWheelRadius,
      frontRim = supermoto ? 0.2159 : 0.2667,
      rearRim = supermoto ? 0.2159 : 0.2286;
    const wheel = (
      spin: T.Group,
      radius: number,
      rim: number,
      halfWidth: number,
      front: boolean,
    ) => {
      const knob = supermoto ? 0 : 0.016;
      add(
        spin,
        tyreGeometry(radius - knob, halfWidth, halfWidth * 1.15, rim + 0.012, sides),
        this.m.rubber,
      );
      if (knob > 0 && detail !== 'far')
        add(
          spin,
          knobs(radius - knob, halfWidth, knob, detail === 'high' ? 40 : 22),
          this.m.rubber,
        );
      // Rim hoop, hub and spokes.
      const hoop = add(spin, new T.TorusGeometry(rim, 0.012, 6, sides), this.m.aluminium);
      hoop.rotation.y = Math.PI / 2;
      add(spin, new T.CylinderGeometry(0.045, 0.045, 0.12, 12), this.m.aluminium).rotation.z =
        Math.PI / 2;
      if (detail !== 'far')
        add(spin, spokes(rim, detail === 'high' ? 32 : 16), this.m.steel, 0, 0, 0, false);
      if (front)
        add(
          spin,
          new T.CylinderGeometry(0.135, 0.135, 0.005, sides),
          this.m.disc,
          0.055,
          0,
          0,
        ).rotation.z = Math.PI / 2;
      else
        add(
          spin,
          new T.CylinderGeometry(0.12, 0.12, 0.005, sides),
          this.m.disc,
          -0.06,
          0,
          0,
        ).rotation.z = Math.PI / 2;
    };
    // ---- Steering: a long fork on a 27 degree head.
    const front = new T.Vector3(0, frontR - h, b.cgToFront);
    const up = new T.Vector3(0, Math.cos(RAKE), -Math.sin(RAKE)),
      forward = new T.Vector3(0, Math.sin(RAKE), Math.cos(RAKE));
    const head = front.clone().addScaledVector(up, FORK).addScaledVector(forward, -OFFSET);
    this.steerMount.position.copy(head);
    this.steerMount.rotation.x = -RAKE;
    this.sprung.add(this.steerMount);
    this.steerMount.add(this.steer);
    // Outer fork tubes (anodised) through the clamps.
    for (const side of [1, -1])
      add(
        this.steer,
        new T.CylinderGeometry(0.03, 0.03, 0.5, sides / 2),
        this.m.forkUpper,
        side * 0.095,
        -0.13,
        OFFSET,
      );
    add(this.steer, new T.BoxGeometry(0.24, 0.035, 0.08), this.m.aluminium, 0, 0, OFFSET * 0.5);
    add(this.steer, new T.BoxGeometry(0.24, 0.03, 0.07), this.m.aluminium, 0, CLAMPS, OFFSET * 0.5);
    // Tapered bar on risers, crossbar pad, grips and levers.
    const barY = CLAMPS + 0.09,
      barZ = -0.06;
    const bar = add(
      this.steer,
      new T.CylinderGeometry(0.014, 0.011, 0.8, 10),
      this.m.aluminium,
      0,
      barY,
      barZ,
    );
    bar.rotation.z = Math.PI / 2;
    if (detail !== 'far')
      add(this.steer, new T.BoxGeometry(0.2, 0.04, 0.05), dark, 0, barY + 0.04, barZ + 0.01);
    for (const side of [1, -1]) {
      add(
        this.steer,
        new T.CylinderGeometry(0.012, 0.012, 0.09, 8),
        this.m.steel,
        side * 0.07,
        CLAMPS + 0.045,
        barZ * 0.5,
      );
      add(
        this.steer,
        new T.CylinderGeometry(0.018, 0.018, 0.12, 12),
        this.m.dark,
        side * 0.36,
        barY,
        barZ,
      ).rotation.z = Math.PI / 2;
      this.gripLocal[side > 0 ? 0 : 1].set(side * 0.36, barY, barZ);
      if (detail === 'high') {
        const lever = add(
          this.steer,
          new T.BoxGeometry(0.16, 0.008, 0.016),
          this.m.aluminium,
          side * 0.3,
          barY - 0.01,
          barZ + 0.07,
        );
        lever.rotation.y = side * 0.25;
      }
    }
    // Front number plate below the bar.
    const plate = add(
      this.steer,
      new T.CylinderGeometry(0.2, 0.2, 0.2, 12, 1, true, -0.55, 1.1),
      board,
      0,
      CLAMPS - 0.06,
      OFFSET + 0.06,
    );
    plate.scale.set(1, 1, 0.5);
    plate.rotation.y = 0;
    // High front fender on the lower clamp: the wheel rises into the gap.
    const fender = superLoft(
      [
        { z: -0.26, y: -0.09, w: 0.08, top: 0.012, bottom: 0.004 },
        { z: -0.05, y: -0.05, w: 0.1, top: 0.014, bottom: 0.004 },
        { z: 0.15, y: -0.06, w: 0.1, top: 0.014, bottom: 0.004 },
        { z: 0.36, y: -0.12, w: 0.085, top: 0.012, bottom: 0.004 },
        { z: 0.46, y: -0.17, w: 0.06, top: 0.01, bottom: 0.004 },
      ],
      sides,
      3,
    );
    add(this.steer, fender, supermoto ? primary : white, 0, -0.04, OFFSET);
    // Lower legs (stanchions and axle lugs) slide with the recorded compression.
    this.steer.add(this.forkLower);
    for (const side of [1, -1]) {
      add(
        this.forkLower,
        new T.CylinderGeometry(0.024, 0.024, 0.5, sides / 2),
        this.m.forkLower,
        side * 0.095,
        0.26,
        OFFSET,
      );
      add(
        this.forkLower,
        new T.BoxGeometry(0.05, 0.1, 0.07),
        this.m.dark,
        side * 0.095,
        0.01,
        OFFSET,
      );
      // Plastic fork guards over the stanchions.
      if (detail !== 'far')
        add(
          this.forkLower,
          new T.BoxGeometry(0.035, 0.34, 0.06),
          dark,
          side * 0.115,
          0.2,
          OFFSET + 0.025,
        );
    }
    add(
      this.forkLower,
      new T.BoxGeometry(0.04, 0.1, 0.06),
      this.m.caliper,
      0.055,
      0.0,
      OFFSET - 0.12,
    );
    this.forkLower.add(this.frontSpin);
    this.frontSpin.position.set(0, 0, OFFSET);
    wheel(this.frontSpin, frontR, frontRim, supermoto ? 0.06 : 0.042, true);
    // ---- Frame (steel perimeter), engine, radiators, bodywork.
    const fy = (y: number) => y;
    for (const side of [1, -1]) {
      add(
        this.sprung,
        tube(
          [
            [side * 0.03, head.y - 0.01, head.z - 0.03],
            [side * 0.12, head.y - 0.12, head.z - 0.25],
            [side * 0.13, fy(-0.06), -0.12],
            [side * 0.11, fy(-0.33), -0.16],
          ],
          0.016,
          detail === 'high' ? 24 : 8,
          8,
        ),
        this.m.steel,
      );
      // Subframe to the rear fender.
      add(
        this.sprung,
        tube(
          [
            [side * 0.11, -0.08, -0.14],
            [side * 0.1, 0.03, -0.42],
            [side * 0.06, 0.06, -0.68],
          ],
          0.011,
          8,
          6,
        ),
        this.m.aluminium,
      );
    }
    add(
      this.sprung,
      tube(
        [
          [0, head.y - 0.06, head.z - 0.02],
          [0, -0.1, head.z - 0.06],
          [0, -0.42, 0.02],
        ],
        0.017,
        12,
        8,
      ),
      this.m.steel,
    );
    // Single-cylinder engine: cases, barrel and head, skid plate.
    add(this.sprung, new T.BoxGeometry(0.2, 0.22, 0.34), this.m.aluminium, 0, -0.4, -0.02);
    const barrel = add(this.sprung, new T.BoxGeometry(0.15, 0.2, 0.15), this.m.dark, 0, -0.2, 0.04);
    barrel.rotation.x = -0.3;
    add(this.sprung, new T.BoxGeometry(0.17, 0.02, 0.36), this.m.aluminium, 0, -0.52, -0.02);
    // Radiators either side of the frame, under the wing shrouds.
    for (const side of [1, -1]) {
      add(this.sprung, new T.BoxGeometry(0.03, 0.24, 0.16), this.m.dark, side * 0.16, -0.1, 0.12);
      const shroud = add(
        this.sprung,
        superLoft(
          [
            { z: -0.12, y: 0.02, w: 0.012, top: 0.1, bottom: 0.14 },
            { z: 0.05, y: -0.02, w: 0.014, top: 0.12, bottom: 0.18 },
            { z: 0.2, y: -0.07, w: 0.012, top: 0.1, bottom: 0.14 },
          ],
          sides / 2,
          4,
        ),
        primary,
        side * 0.19,
        0,
        0,
      );
      shroud.rotation.y = side * 0.12;
    }
    // Tank under the shrouds and the long flat seat.
    add(
      this.sprung,
      superLoft(
        [
          { z: -0.12, y: 0.02, w: 0.11, top: 0.06, bottom: 0.08 },
          { z: 0.05, y: 0.03, w: 0.13, top: 0.08, bottom: 0.1 },
          { z: 0.2, y: 0.04, w: 0.1, top: 0.06, bottom: 0.08 },
        ],
        sides,
        3,
      ),
      primary,
    );
    add(
      this.sprung,
      superLoft(
        [
          { z: -0.72, y: 0.08, w: 0.07, top: 0.03, bottom: 0.03 },
          { z: -0.45, y: 0.085, w: 0.115, top: 0.045, bottom: 0.04 },
          { z: -0.15, y: 0.09, w: 0.12, top: 0.045, bottom: 0.04 },
          { z: 0.05, y: 0.1, w: 0.08, top: 0.04, bottom: 0.04 },
        ],
        sides,
        3,
      ),
      this.m.seat,
    );
    // Side number boards and the long, upswept rear fender.
    for (const side of [1, -1]) {
      const panel = add(
        this.sprung,
        new T.BoxGeometry(0.006, 0.17, 0.3),
        board,
        side * 0.13,
        -0.02,
        -0.46,
      );
      panel.rotation.x = 0.12;
    }
    add(
      this.sprung,
      superLoft(
        [
          { z: -0.7, y: 0.04, w: 0.11, top: 0.012, bottom: 0.004 },
          { z: -0.92, y: 0.09, w: 0.1, top: 0.012, bottom: 0.004 },
          { z: -1.08, y: 0.15, w: 0.07, top: 0.01, bottom: 0.004 },
        ],
        sides,
        3,
      ),
      supermoto ? primary : white,
    );
    // Exhaust: header from the head down the right side to the silencer.
    add(
      this.sprung,
      exhaustGeometry(
        [
          [0, -0.16, 0.14],
          [-0.08, -0.25, 0.1],
          [-0.12, -0.2, -0.15],
          [-0.13, -0.05, -0.45],
        ],
        0.022,
        detail === 'high' ? 32 : 10,
        8,
      ),
      this.m.titanium,
    );
    const silencer = add(
      this.sprung,
      new T.CylinderGeometry(0.045, 0.04, 0.36, sides / 2),
      this.m.aluminium,
      -0.14,
      0.0,
      -0.62,
    );
    silencer.rotation.x = Math.PI / 2 - 0.25;
    // Rear shock (spring compresses with the shock).
    if (detail !== 'far') {
      const coil: [number, number, number][] = [];
      for (let k = 0; k <= 64; k++) {
        const t = k / 64;
        coil.push([
          Math.cos(t * Math.PI * 16) * 0.035,
          -0.12 + t * 0.24,
          Math.sin(t * Math.PI * 16) * 0.035,
        ]);
      }
      add(this.spring, tube(coil, 0.006, 128, 6), this.m.band);
      add(this.spring, new T.CylinderGeometry(0.014, 0.014, 0.28, 8), this.m.steel);
      this.spring.position.set(0, -0.12, -0.26);
      this.spring.rotation.x = 0.3;
      this.sprung.add(this.spring);
    }
    // ---- Swingarm from the pivot to the rear axle on the ground.
    this.pivot = new T.Vector3(0, -0.36, -0.15);
    this.rearAxle = new T.Vector3(0, rearR - h, -b.cgToRear);
    const arm = (this.armLength = this.rearAxle.clone().sub(this.pivot).length());
    for (const side of [1, -1])
      add(
        this.swingarm,
        beam(
          [
            [side * 0.09, 0, 0],
            [side * 0.11, 0.01, -arm * 0.5],
            [side * 0.1, 0, -arm],
          ],
          0.03,
          0.07,
          detail === 'high' ? 14 : 6,
        ),
        this.m.aluminium,
      );
    add(this.swingarm, new T.CylinderGeometry(0.018, 0.018, 0.26, 10), this.m.steel).rotation.z =
      Math.PI / 2;
    if (detail !== 'far') {
      for (const y of [0.04, -0.04])
        add(this.swingarm, new T.BoxGeometry(0.01, 0.01, arm), this.m.steel, 0.1, y, -arm / 2);
      add(this.swingarm, new T.BoxGeometry(0.01, 0.05, 0.3), dark, 0.12, 0.05, -arm * 0.55);
    }
    this.root.add(this.swingarm);
    this.rearWheel.position.copy(this.rearAxle);
    this.rearWheel.add(this.rearSpin);
    this.root.add(this.rearWheel);
    wheel(this.rearSpin, rearR, rearRim, supermoto ? 0.085 : 0.06, false);
    // ---- Off-road rider.
    this.rider = new Rider(
      {
        primary: new T.Color(scheme.primary).getHex(),
        secondary: new T.Color(scheme.secondary).getHex(),
        accent: new T.Color(scheme.accent).getHex(),
      },
      detail,
      'motocross',
    );
    this.rider.seat.set(0, 0.2, -0.24);
    this.rider.pegs[0].set(0.17, -0.44, -0.1);
    this.rider.pegs[1].set(-0.17, -0.44, -0.1);
    this.sprung.add(this.rider.root);
    installMudOn(this.root, this.mud);
  }
  pose(v: BikePoseValues) {
    const b = this.definition.bike!,
      L = this.definition.spec.wheelbase;
    const df = (v.fork - this.sag.fork) * Math.cos(RAKE),
      dr = v.shock - this.sag.shock;
    this.sprung.rotation.x = Math.atan2(df - dr, L);
    this.sprung.position.y = -(dr + ((df - dr) * b.cgToRear) / L);
    this.steer.rotation.y = v.steer;
    this.forkLower.position.y = -(FORK + this.sag.fork - v.fork);
    this.frontSpin.rotation.x = v.frontRotation;
    this.rearSpin.rotation.x = v.rearRotation;
    this.spring.scale.y = T.MathUtils.clamp(1 - (v.shock - this.sag.shock) * 2.2, 0.5, 1.2);
    this.sprung.updateMatrix();
    const p = this.scratch.copy(this.pivot).applyMatrix4(this.sprung.matrix);
    this.swingarm.position.copy(p);
    const dy = this.rearAxle.y - p.y,
      dz = this.rearAxle.z - p.z;
    this.swingarm.rotation.x = Math.atan2(dy, -dz);
    this.swingarm.scale.z = Math.hypot(dy, dz) / this.armLength;
    this.m.disc.emissiveIntensity = 0;
    this.mud.offroadMud.value = T.MathUtils.clamp(v.mud ?? 0, 0, 1);
    this.mud.offroadMudWet.value = T.MathUtils.clamp((v.mudWet ?? 0) * 1.6, 0, 1);
    if (v.riding) {
      this.steerMount.updateMatrix();
      this.steer.updateMatrix();
      this.matrix.multiplyMatrices(this.steerMount.matrix, this.steer.matrix);
      for (let i = 0; i < 2; i++)
        this.rider.grips[i].copy(this.gripLocal[i]).applyMatrix4(this.matrix);
      this.rider.ride({
        lean: v.chassisLean,
        offset: v.riderOffset * 0.4,
        tuck: 0,
        braking: v.brake,
        steer: v.steer,
        standing: v.standing ?? 0,
        dab: v.dab ?? 0,
        body: v.body ?? 0,
      });
    }
  }
  dispose() {
    this.rider.dispose();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    for (const m of this.plastics) {
      m.map?.dispose();
      m.dispose();
    }
  }
}
/** Knobs around a tyre: centre and shoulder rows, staggered (one geometry). */
function knobs(radius: number, halfWidth: number, height: number, count: number) {
  const parts: T.BufferGeometry[] = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const rows = k % 2 === 0 ? [0] : [-0.65, 0.65];
    for (const x of rows) {
      const g = new T.BoxGeometry(0.026, height * 2, 0.024);
      g.translate(x * halfWidth, radius, 0);
      g.rotateX(a);
      parts.push(g);
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}
/** Laced spokes from the hub flanges to the rim, crossing (one geometry). */
function spokes(rim: number, count: number) {
  const parts: T.BufferGeometry[] = [];
  const hub = 0.045;
  for (let k = 0; k < count; k++) {
    const side = k % 2 === 0 ? 1 : -1,
      a = (k / count) * Math.PI * 2,
      b = a + side * 0.35;
    const from = new T.Vector3(side * 0.04, Math.cos(a) * hub, Math.sin(a) * hub),
      to = new T.Vector3(0, Math.cos(b) * (rim - 0.01), Math.sin(b) * (rim - 0.01));
    const length = from.distanceTo(to);
    const g = new T.CylinderGeometry(0.0022, 0.0022, length, 4, 1, true);
    const dir = to.clone().sub(from).normalize();
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir));
    g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}
