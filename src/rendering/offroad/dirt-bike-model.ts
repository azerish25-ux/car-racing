import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import {
  add,
  beam,
  exhaustGeometry,
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
import { forkLocalOffset } from '../bike-pit-service.ts';
import { batchBikeRigidMeshes } from '../bike-rigid-batch.ts';
import { MotocrossChainDrive } from './motocross-chain-drive.ts';
import {
  motocrossGraphics,
  motocrossRotor,
  motocrossSidePanel,
  motocrossTread,
  mouldedPanel,
} from './motocross-detail.ts';

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
  /** Sight points on the authored control geometry, following steering. */
  readonly onboardControls = new T.Group();
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
  private readonly plastics: T.MeshStandardMaterial[] = [];
  private readonly chain?: MotocrossChainDrive;
  private disposed = false;
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
    const colours = {
      primary: new T.Color(scheme.primary).getHex(),
      secondary: new T.Color(scheme.secondary).getHex(),
      accent: new T.Color(scheme.accent).getHex(),
    };
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
      dark = plastic(0x1c1d20, 'Off-road black plastics'),
      board = new T.MeshPhysicalMaterial({
        map: motocrossGraphics(colours, 'number', (id % 98) + 2),
        roughness: 0.5,
        clearcoat: 0.1,
        name: 'Motocross factory number board',
      });
    this.plastics.push(board);
    const shroudMaterial = primary.clone();
    shroudMaterial.color.setHex(0xffffff);
    if (detail !== 'far') shroudMaterial.map = motocrossGraphics(colours, 'shroud', (id % 98) + 2);
    else shroudMaterial.color.set(scheme.primary);
    shroudMaterial.name = 'Motocross layered factory plastics';
    const rimMaterial = new T.MeshStandardMaterial({
      color: id % 2 ? scheme.primary : 0x33383b,
      metalness: 0.8,
      roughness: 0.32,
      name: 'Motocross anodised rim and hub',
    });
    const rotorMaterial = new T.MeshStandardMaterial({
      color: 0xa3a7a8,
      metalness: 0.88,
      roughness: 0.35,
      name: 'Motocross stainless wave rotor',
    });
    const chainMaterial = new T.MeshStandardMaterial({
      color: 0x938165,
      metalness: 0.78,
      roughness: 0.48,
      name: 'Motocross roller chain',
    });
    this.plastics.push(shroudMaterial, rimMaterial, rotorMaterial, chainMaterial);
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
      // When distant tread blocks disappear, their envelope stays in the
      // carcass so a LOD switch cannot make the wheel shrink off the ground.
      const knob = supermoto || detail === 'far' ? 0 : 0.016;
      add(
        spin,
        tyreGeometry(radius - knob, halfWidth, halfWidth * 1.15, rim + 0.012, sides),
        this.m.rubber,
      );
      if (knob > 0 && detail !== 'far')
        add(
          spin,
          motocrossTread(radius, halfWidth, knob, detail === 'high' ? 44 : 24),
          this.m.rubber,
        );
      // Rim hoop, hub and spokes.
      const hoop = add(spin, new T.CylinderGeometry(rim, rim, 0.033, sides, 1, true), rimMaterial);
      hoop.rotation.z = Math.PI / 2;
      for (const side of [-1, 1]) {
        const lip = add(spin, new T.TorusGeometry(rim, 0.006, 6, sides), rimMaterial, side * 0.019);
        lip.rotation.y = Math.PI / 2;
      }
      add(spin, new T.CylinderGeometry(0.034, 0.034, 0.092, 12), rimMaterial).rotation.z =
        Math.PI / 2;
      if (detail !== 'far') {
        add(spin, spokes(rim, detail === 'high' ? 36 : 20), this.m.steel, 0, 0, 0, false);
        for (const side of [-1, 1])
          add(
            spin,
            new T.CylinderGeometry(0.048, 0.048, 0.008, 12),
            rimMaterial,
            side * 0.041,
          ).rotation.z = Math.PI / 2;
        add(
          spin,
          motocrossRotor(front ? 0.131 : 0.117, detail),
          rotorMaterial,
          front ? 0.056 : -0.06,
        );
        if (!front) add(spin, motocrossRotor(0.115, detail, true), chainMaterial, 0.095);
        if (detail === 'high')
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            add(
              spin,
              new T.CylinderGeometry(0.004, 0.004, 0.006, 6),
              this.m.aluminium,
              front ? 0.06 : -0.064,
              Math.cos(a) * 0.061,
              Math.sin(a) * 0.061,
            ).rotation.z = Math.PI / 2;
          }
      }
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
    this.onboardControls.name = 'Motocross onboard control sights';
    this.steer.add(this.onboardControls);
    const controlSight = (name: string, x: number, y: number, z: number) => {
      const point = new T.Object3D();
      point.name = name;
      point.position.set(x, y, z);
      this.onboardControls.add(point);
    };
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
    controlSight('Motocross bar pad', 0, barY + 0.012, barZ + 0.03);
    add(
      this.steer,
      tube(
        [
          [-0.42, barY, barZ],
          [-0.28, barY, barZ + 0.01],
          [-0.17, barY - 0.044, barZ + 0.032],
          [0, barY - 0.05, barZ + 0.032],
          [0.17, barY - 0.044, barZ + 0.032],
          [0.28, barY, barZ + 0.01],
          [0.42, barY, barZ],
        ],
        0.012,
        detail === 'high' ? 36 : 16,
        8,
      ),
      this.m.aluminium,
    );
    if (detail !== 'far')
      add(
        this.steer,
        new RoundedBoxGeometry(0.22, 0.057, 0.065, 2, 0.014),
        primary,
        0,
        barY + 0.012,
        barZ + 0.03,
      );
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
      controlSight(`Motocross ${side > 0 ? 'left' : 'right'} grip`, side * 0.36, barY, barZ);
      if (detail === 'high') {
        const lever = add(
          this.steer,
          new RoundedBoxGeometry(0.14, 0.008, 0.016, 2, 0.004),
          this.m.aluminium,
          side * 0.3,
          barY - 0.01,
          barZ + 0.07,
        );
        lever.rotation.y = side * 0.25;
        // Join the ball to the actual outer blade endpoint after its yaw.
        // An independent forward offset leaves a visible gap from the cockpit.
        add(
          this.steer,
          new T.SphereGeometry(0.006, 8, 6),
          this.m.aluminium,
          side * (0.3 + Math.cos(0.25) * 0.07),
          barY - 0.01,
          barZ + 0.07 - Math.sin(0.25) * 0.07,
        );
        add(
          this.steer,
          new RoundedBoxGeometry(0.037, 0.026, 0.046, 2, 0.006),
          this.m.dark,
          side * 0.247,
          barY + 0.02,
          barZ + 0.033,
        );
      }
    }
    if (detail !== 'far')
      for (const side of [-1, 1])
        add(
          this.steer,
          tube(
            [
              [side * 0.24, barY + 0.013, barZ + 0.042],
              [side * 0.16, barY + 0.073, barZ + 0.075],
              [side * 0.054, CLAMPS - 0.09, 0.05],
            ],
            0.004,
            18,
            5,
          ),
          this.m.dark,
        );
    // Front number plate below the bar.
    const plate = add(
      this.steer,
      mouldedPanel(
        [
          [-0.138, 0.143],
          [0.138, 0.143],
          [0.155, 0.065],
          [0.119, -0.13],
          [0, -0.167],
          [-0.119, -0.13],
        ],
        0.008,
        0.005,
      ),
      board,
      0,
      CLAMPS - 0.075,
      OFFSET + 0.1,
    );
    plate.name = 'Motocross sculpted front number plate';
    // Race numbers are printed on the front. The cockpit sees the unprinted
    // moulding, not a mirrored duplicate of the graphics through the plate.
    const plateNormals = plate.geometry.getAttribute('normal'),
      plateUv = plate.geometry.getAttribute('uv');
    for (let i = 0; i < plateNormals.count; i++)
      if (plateNormals.getZ(i) < 0.5) plateUv.setXY(i, 8 / 512, 0.5);
    // High front fender on the lower clamp: the wheel rises into the gap.
    const fender = superLoft(
      [
        { z: -0.26, y: -0.09, w: 0.062, top: 0.012, bottom: 0.004 },
        { z: -0.05, y: -0.05, w: 0.095, top: 0.022, bottom: 0.004 },
        { z: 0.15, y: -0.06, w: 0.103, top: 0.025, bottom: 0.004 },
        { z: 0.36, y: -0.115, w: 0.082, top: 0.02, bottom: 0.004 },
        { z: 0.48, y: -0.17, w: 0.067, top: 0.008, bottom: 0.004 },
      ],
      sides,
      3,
    );
    add(this.steer, fender, primary, 0, -0.04, OFFSET);
    // Lower legs (stanchions and axle lugs) slide with the recorded compression.
    this.steer.add(this.forkLower);
    for (const side of [1, -1]) {
      add(
        this.forkLower,
        new T.CylinderGeometry(0.024, 0.024, 0.68, sides / 2),
        this.m.forkLower,
        side * 0.095,
        0.34,
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
          new RoundedBoxGeometry(0.049, 0.34, 0.054, 2, 0.013),
          primary,
          side * 0.115,
          0.2,
          OFFSET + 0.023,
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
    if (detail === 'high')
      add(
        this.forkLower,
        tube(
          [
            [0.113, 0.02, OFFSET - 0.1],
            [0.124, 0.25, OFFSET + 0.017],
            [0.123, 0.51, OFFSET + 0.013],
          ],
          0.004,
          16,
          5,
        ),
        this.m.dark,
      );
    // ---- Open perimeter frame, cast engine and folded radiator shrouds.
    const lightFrame = definition.id === 'mx250';
    for (const side of [1, -1]) {
      add(
        this.sprung,
        beam(
          [
            [side * 0.03, head.y - 0.01, head.z - 0.03],
            [side * 0.1, head.y - 0.1, head.z - 0.2],
            [side * 0.14, -0.07, -0.12],
            [side * 0.115, -0.35, -0.16],
          ],
          lightFrame ? 0.027 : 0.038,
          lightFrame ? 0.037 : 0.066,
          detail === 'high' ? 20 : 8,
        ),
        lightFrame ? primary : this.m.aluminium,
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
      add(
        this.sprung,
        tube(
          [
            [side * 0.065, head.y - 0.06, head.z - 0.03],
            [side * 0.11, -0.28, 0.19],
            [side * 0.12, -0.5, 0.07],
            [side * 0.1, -0.51, -0.17],
            [side * 0.11, -0.33, -0.2],
          ],
          lightFrame ? 0.014 : 0.018,
          detail === 'high' ? 28 : 12,
          8,
        ),
        lightFrame ? primary : this.m.aluminium,
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
    // The round clutch/ignition covers sit over sculpted magnesium cases;
    // the frame remains visibly open around them.
    add(
      this.sprung,
      new RoundedBoxGeometry(0.19, 0.17, 0.27, detail === 'high' ? 3 : 1, 0.055),
      this.m.aluminium,
      0,
      -0.39,
      -0.065,
    );
    for (const side of [-1, 1]) {
      const cover = add(
        this.sprung,
        new T.CylinderGeometry(side > 0 ? 0.086 : 0.1, side > 0 ? 0.086 : 0.1, 0.033, sides),
        this.m.dark,
        side * 0.106,
        -0.38,
        -0.057,
      );
      cover.rotation.z = Math.PI / 2;
      add(
        this.sprung,
        new T.CylinderGeometry(0.066, 0.066, 0.008, sides),
        this.m.aluminium,
        side * 0.125,
        -0.38,
        -0.057,
      ).rotation.z = Math.PI / 2;
      if (detail === 'high')
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          add(
            this.sprung,
            new T.CylinderGeometry(0.005, 0.005, 0.006, 6),
            this.m.steel,
            side * 0.127,
            -0.38 + Math.sin(a) * 0.078,
            -0.057 + Math.cos(a) * 0.078,
          ).rotation.z = Math.PI / 2;
        }
    }
    const barrel = add(
      this.sprung,
      new RoundedBoxGeometry(0.135, 0.21, 0.13, 2, 0.016),
      this.m.aluminium,
      0,
      -0.23,
      0.033,
    );
    barrel.rotation.x = -0.3;
    add(
      this.sprung,
      new RoundedBoxGeometry(0.166, 0.054, 0.167, 2, 0.015),
      this.m.dark,
      0,
      -0.106,
      0.015,
    ).rotation.x = -0.3;
    if (detail !== 'far')
      for (let i = 0; i < 6; i++)
        add(
          this.sprung,
          new RoundedBoxGeometry(0.141, 0.009, 0.137, 1, 0.009),
          this.m.steel,
          0,
          -0.304 + i * 0.025,
          0.055 - i * 0.007,
        ).rotation.x = -0.3;
    add(
      this.sprung,
      new RoundedBoxGeometry(0.218, 0.025, 0.35, 2, 0.015),
      this.m.dark,
      0,
      -0.52,
      -0.02,
    );
    // Radiators either side of the frame, under the wing shrouds.
    for (const side of [1, -1]) {
      add(
        this.sprung,
        new RoundedBoxGeometry(0.104, 0.266, 0.031, 1, 0.008),
        this.m.aluminium,
        side * 0.115,
        -0.105,
        0.19,
      );
      add(
        this.sprung,
        new T.BoxGeometry(0.087, 0.236, 0.009),
        this.m.dark,
        side * 0.115,
        -0.105,
        0.209,
      );
      if (detail !== 'far') {
        for (let k = 0; k < 13; k++)
          add(
            this.sprung,
            new T.BoxGeometry(0.087, 0.0035, 0.011),
            this.m.steel,
            side * 0.115,
            -0.214 + k * 0.018,
            0.218,
          );
        for (let k = 0; k < 4; k++)
          add(
            this.sprung,
            new T.BoxGeometry(0.004, 0.242, 0.015),
            dark,
            side * (0.08 + k * 0.024),
            -0.105,
            0.222,
          );
        add(
          this.sprung,
          tube(
            [
              [side * 0.119, -0.24, 0.18],
              [side * 0.11, -0.27, 0.13],
              [side * 0.076, -0.225, 0.04],
            ],
            0.011,
            12,
            6,
          ),
          dark,
        );
      }
      const shroud = add(
        this.sprung,
        motocrossSidePanel(
          [
            [-0.17, 0.135],
            [0.085, 0.168],
            [0.325, 0.105],
            [0.23, -0.028],
            [0.209, -0.265],
            [0.103, -0.299],
            [0.027, -0.118],
            [-0.129, -0.052],
          ],
          side,
        ),
        shroudMaterial,
        side * 0.184,
        0,
        0,
      );
      shroud.rotation.y = side * 0.12;
      shroud.name = 'Motocross folded radiator shroud';
      if (detail === 'high')
        for (const [z, y] of [
          [-0.122, 0.09],
          [0.156, -0.242],
          [0.277, 0.094],
        ])
          add(
            this.sprung,
            new T.CylinderGeometry(0.006, 0.006, 0.007, 6),
            this.m.steel,
            side * 0.194,
            y,
            z,
          ).rotation.z = Math.PI / 2;
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
    add(this.sprung, new T.CylinderGeometry(0.034, 0.039, 0.016, 12), this.m.dark, 0, 0.15, 0.091);
    if (detail !== 'far')
      add(
        this.sprung,
        tube(
          [
            [0, 0.16, 0.093],
            [0, 0.22, 0.075],
            [0, 0.22, 0.225],
            [0, 0.17, 0.283],
          ],
          0.004,
          18,
          5,
        ),
        this.m.dark,
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
    if (detail !== 'far')
      for (let i = 0; i < 6; i++)
        add(
          this.sprung,
          new RoundedBoxGeometry(0.17 - i * 0.01, 0.008, 0.015, 1, 0.003),
          dark,
          0,
          0.134 - i * 0.002,
          -0.23 - i * 0.062,
        );
    // Side number boards and the long, upswept rear fender.
    for (const side of [1, -1]) {
      const panel = add(
        this.sprung,
        motocrossSidePanel(
          [
            [-0.755, 0.047],
            [-0.348, 0.077],
            [-0.223, -0.031],
            [-0.347, -0.196],
            [-0.602, -0.093],
          ],
          side,
        ),
        board,
        side * 0.151,
        0,
        0,
      );
      panel.rotation.y = -side * 0.045;
      panel.name = 'Motocross tapered side number panel';
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
      primary,
    );
    // Exhaust: header from the head down the right side to the silencer.
    add(
      this.sprung,
      exhaustGeometry(
        [
          [0, -0.16, 0.14],
          [-0.098, -0.2, 0.23],
          [-0.16, -0.365, 0.11],
          [-0.155, -0.3, -0.14],
          [-0.163, -0.05, -0.46],
        ],
        0.022,
        detail === 'high' ? 32 : 10,
        8,
      ),
      this.m.titanium,
    );
    const silencer = new T.Group();
    silencer.name = 'Motocross tapered open exhaust silencer';
    silencer.position.set(-0.177, -0.005, -0.615);
    silencer.rotation.x = 0.22;
    this.sprung.add(silencer);
    add(
      silencer,
      new T.CylinderGeometry(0.049, 0.044, 0.342, sides / 2),
      this.m.aluminium,
    ).rotation.x = Math.PI / 2;
    add(
      silencer,
      new T.CylinderGeometry(0.046, 0.033, 0.065, sides / 2),
      this.m.dark,
      0,
      0,
      -0.189,
    ).rotation.x = Math.PI / 2;
    add(silencer, new T.TorusGeometry(0.025, 0.005, 6, sides / 2), this.m.steel, 0, 0, -0.222);
    add(silencer, new T.CircleGeometry(0.021, sides / 2), this.m.dark, 0, 0, -0.218).rotation.y =
      Math.PI;
    if (detail !== 'far')
      for (const z of [-0.115, 0.11])
        add(silencer, new T.TorusGeometry(0.049, 0.004, 5, sides / 2), this.m.steel, 0, 0, z);
    // Serrated hollow pegs retain the rider's authored contact points.
    for (const side of [-1, 1]) {
      for (const z of [-0.125, -0.075])
        add(
          this.sprung,
          new T.BoxGeometry(0.098, 0.014, 0.009),
          this.m.steel,
          side * 0.17,
          -0.449,
          z,
        );
      add(
        this.sprung,
        new T.BoxGeometry(0.011, 0.014, 0.059),
        this.m.steel,
        side * 0.217,
        -0.449,
        -0.1,
      );
      if (detail === 'high')
        for (let k = 0; k < 5; k++)
          for (const z of [-0.125, -0.075])
            add(
              this.sprung,
              new T.BoxGeometry(0.008, 0.025, 0.009),
              this.m.steel,
              side * (0.126 + k * 0.021),
              -0.444,
              z,
            );
    }
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
      this.chain = new MotocrossChainDrive(arm, detail, chainMaterial, this.mud);
      this.swingarm.add(this.chain.root);
      add(
        this.swingarm,
        new RoundedBoxGeometry(0.018, 0.027, 0.26, 1, 0.007),
        dark,
        0.102,
        0.047,
        -arm * 0.35,
      );
      add(
        this.swingarm,
        new RoundedBoxGeometry(0.038, 0.085, 0.084, 1, 0.012),
        dark,
        0.095,
        -0.074,
        -arm * 0.8,
      );
    }
    this.root.add(this.swingarm);
    this.rearWheel.position.copy(this.rearAxle);
    this.rearWheel.add(this.rearSpin);
    this.root.add(this.rearWheel);
    wheel(this.rearSpin, rearR, rearRim, supermoto ? 0.085 : 0.06, false);
    // ---- Off-road rider.
    this.rider = new Rider(colours, detail, 'motocross', (id % 98) + 2);
    this.rider.seat.set(0, 0.2, -0.24);
    this.rider.pegs[0].set(0.17, -0.44, -0.1);
    this.rider.pegs[1].set(-0.17, -0.44, -0.1);
    this.sprung.add(this.rider.root);
    // Repeated lugs, fins, fasteners and mechanical pieces are merged per
    // material inside each articulation boundary, including distant LODs.
    for (const group of [
      this.sprung,
      this.steer,
      this.forkLower,
      this.frontSpin,
      this.rearSpin,
      this.swingarm,
      this.spring,
      silencer,
    ])
      batchBikeRigidMeshes(group);
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
    // Pit service wheel exchange (see BikeModel.pose).
    this.rearWheel.position.copy(this.rearAxle);
    this.rearWheel.position.z -= v.rearWheelOut ?? 0;
    forkLocalOffset(
      this.scratch.set(0, -(v.frontWheelDrop ?? 0), 0),
      RAKE,
      v.steer,
      this.frontSpin.position,
    ).z += OFFSET;
    this.spring.scale.y = T.MathUtils.clamp(1 - (v.shock - this.sag.shock) * 2.2, 0.5, 1.2);
    this.sprung.updateMatrix();
    const p = this.scratch.copy(this.pivot).applyMatrix4(this.sprung.matrix);
    this.swingarm.position.copy(p);
    const dy = this.rearAxle.y - p.y,
      dz = this.rearAxle.z - p.z;
    this.swingarm.rotation.x = Math.atan2(dy, -dz);
    this.swingarm.scale.z = Math.hypot(dy, dz) / this.armLength;
    this.chain?.update(v.rearRotation, this.swingarm.scale.z);
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
    if (this.disposed) return;
    this.disposed = true;
    this.rider.root.removeFromParent();
    this.rider.dispose();
    this.root.traverse((o) => {
      if (o instanceof T.InstancedMesh) o.dispose();
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    for (const m of this.plastics) {
      m.map?.dispose();
      m.dispose();
    }
  }
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
