import { crewTeamColour } from './crew-geometry.ts';
import { crewBodyGeometry, crewHandGeometry, HumanHeadBatches } from './human-kit.ts';
import { CREW_BONES, CREW_REST } from './people-asset.ts';
import { CrewPose, installCrewSkin } from './crew-pose.ts';
import { CUFF } from './pit-crew.ts';
import * as T from 'three';
import { clamp } from '../core/math.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';

/** Blankets clear before the first red light and staff before the second.
 * Derived from race time, so pause/replay/seek cannot leave stale grid props.
 * These are presentation props, not a tire-temperature or grip override. */
export function gridPreparation(time: number, phase: number, speed: number) {
  if (![time, phase, speed].every(Number.isFinite) || phase >= 2 || speed > 0.5 || time < 0)
    return { blankets: false, crew: false, withdrawal: 1 };
  return { blankets: time < 0.85, crew: time < 1.8, withdrawal: clamp(time / 0.85, 0, 1) };
}
/** Car-local height of the grid surface. */
const CREW_FLOOR = -0.52;
const STAFF = 24;

/** Idle stances of grid staff, as wrist targets in the person's own frame
 * (Y up, facing +Z; the first hand belongs to the arm on the -X side). */
export const GRID_STANCES = Object.freeze([
  {
    name: 'relaxed',
    hands: [
      [-0.235, 0.86, 0.09],
      [0.235, 0.86, 0.09],
    ],
  },
  {
    name: 'hands behind back',
    hands: [
      [-0.07, 0.96, -0.16],
      [0.07, 0.94, -0.16],
    ],
  },
  {
    name: 'hand on hip',
    hands: [
      [-0.31, 0.97, 0.02],
      [0.235, 0.86, 0.09],
    ],
  },
  {
    name: 'tablet',
    hands: [
      [-0.12, 1.03, 0.27],
      [0.12, 1.03, 0.27],
    ],
  },
] as const);

const unit = (n: number) => n - Math.floor(n);
const hash = (a: number, b: number) => unit(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);

export interface GridStaffPose {
  stance: number;
  /** Hip height and forward lean of the solver. */
  hip: number;
  lean: number;
  /** Sideways weight shift of the whole person, metres. */
  sway: number;
  /** Head turn about the vertical, radians. */
  headYaw: number;
  /** Wrist targets in the person's own frame. */
  hands: [T.Vector3, T.Vector3];
}
/** A grid staff member's idle pose at race time `time`: a stance per person,
 * with breathing, weight shift, hand drift and head turns on slow periodic
 * cycles of race time, so pause, replay and seek reproduce it exactly. */
export function gridStaffPose(
  person: number,
  time: number,
  out: GridStaffPose = {
    stance: 0,
    hip: 0,
    lean: 0,
    sway: 0,
    headYaw: 0,
    hands: [new T.Vector3(), new T.Vector3()],
  },
) {
  if (!Number.isInteger(person) || person < 0 || !Number.isFinite(time))
    throw new Error('Invalid grid staff pose');
  const phase = (k: number) => hash(person, k) * Math.PI * 2;
  const wave = (hz: number, k: number) => Math.sin(Math.PI * 2 * hz * time + phase(k));
  out.stance = Math.floor(hash(person, 9) * GRID_STANCES.length);
  // A slight knee bend under the rest hip, and breathing.
  out.hip = CREW_REST[0].y - 0.015 + 0.004 * wave(0.24, 1);
  out.lean = 0.04 + 0.012 * wave(0.07, 2);
  out.sway = 0.012 * wave(0.06, 3);
  out.headYaw = 0.25 * wave(0.05, 4);
  const stance = GRID_STANCES[out.stance];
  out.hands.forEach((hand, i) => {
    hand.fromArray(stance.hands[i]);
    hand.y += 0.006 * wave(0.24, 1) + 0.004 * wave(0.11, 5 + i);
  });
  return out;
}
export class GridPreparationView {
  readonly root = new T.Group();
  readonly blankets: T.InstancedMesh;
  readonly straps: T.InstancedMesh;
  private bodies: T.InstancedMesh;
  private heads: HumanHeadBatches;
  private gloves: readonly [T.InstancedMesh, T.InstancedMesh];
  private transform = new T.Object3D();
  private car = new T.Object3D();
  private readonly boneData = new Float32Array(STAFF * CREW_BONES * 16);
  private readonly bones = new T.DataTexture(
    this.boneData,
    4 * CREW_BONES,
    STAFF,
    T.RGBAFormat,
    T.FloatType,
  );
  private readonly slots = new T.InstancedBufferAttribute(new Float32Array(STAFF), 1);
  private readonly pose = new CrewPose();
  private readonly idle = gridStaffPose(0, 0);
  private readonly actor = new T.Object3D();
  private readonly wrists = [new T.Vector3(), new T.Vector3()];
  private readonly matrix = new T.Matrix4();
  private readonly basis = new T.Matrix4();
  private readonly fingers = new T.Vector3();
  private readonly palm = new T.Vector3();
  private readonly side = new T.Vector3();
  private readonly rotation = new T.Quaternion();
  private readonly head = new T.Quaternion();
  private readonly offset = new T.Vector3();
  private readonly teamColour = new T.Color();
  private readonly reach: boolean[] = [];
  private readonly stances: number[] = [];
  constructor() {
    this.blankets = new T.InstancedMesh(
      new T.CylinderGeometry(0.385, 0.385, 1, 24),
      new T.MeshStandardMaterial({ color: 0x151a20, roughness: 0.98 }),
      48,
    );
    this.straps = new T.InstancedMesh(
      new T.CylinderGeometry(0.391, 0.391, 0.027, 24, 1, true),
      new T.MeshStandardMaterial({ color: 0xdac779, roughness: 0.91 }),
      96,
    );
    // The Blender-authored crew (the same people asset and GPU instance
    // skinning as the pit crew) in team kit, with a real helmet and gloves,
    // posed in idle stances by the pit crew's own two-bone solver.
    this.bones.generateMipmaps = false;
    this.bones.minFilter = this.bones.magFilter = T.NearestFilter;
    this.bones.name = 'Aurel grid staff bones';
    this.bones.needsUpdate = true;
    this.slots.setUsage(T.DynamicDrawUsage);
    const body = crewBodyGeometry('polo', 1);
    body.setAttribute('crewSlot', this.slots);
    const kit = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9 });
    kit.userData.weatherSurface = 'fabric';
    installCrewSkin(kit, this.bones, STAFF, true, 'polo');
    this.bodies = new T.InstancedMesh(body, kit, STAFF);
    // Allocated up front so the instancing-colour shader variant never changes.
    this.bodies.instanceColor = new T.InstancedBufferAttribute(
      new Float32Array(STAFF * 3).fill(1),
      3,
    );
    const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    installCrewSkin(depth, this.bones, STAFF, false);
    this.bodies.customDepthMaterial = depth;
    const distance = new T.MeshDistanceMaterial();
    installCrewSkin(distance, this.bones, STAFF, false);
    this.bodies.customDistanceMaterial = distance;
    this.heads = new HumanHeadBatches(STAFF, ['cap-headset', 'headset'], [1], 'Grid staff heads');
    const glove = new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.85,
    });
    this.gloves = [
      new T.InstancedMesh(crewHandGeometry(1, true), glove, STAFF),
      new T.InstancedMesh(crewHandGeometry(1), glove, STAFF),
    ];
    this.root.name = 'Grid tire blankets and preparation staff · reference 047';
    this.root.add(this.blankets, this.straps, this.bodies, ...this.heads.meshes, ...this.gloves);
    for (const mesh of [this.blankets, this.straps, this.bodies, ...this.gloves]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    }
  }
  private place(
    mesh: T.InstancedMesh,
    x: number,
    y: number,
    z: number,
    scale: number,
    wheel = false,
    yaw = 0,
  ) {
    this.transform.position.set(x, y, z);
    this.transform.rotation.set(0, yaw, wheel ? Math.PI / 2 : 0);
    this.transform.scale.set(1, scale, 1);
    this.transform.updateMatrix();
    this.transform.matrix.premultiply(this.car.matrix);
    mesh.setMatrixAt(mesh.count++, this.transform.matrix);
  }
  private put(mesh: T.InstancedMesh, local: T.Matrix4) {
    this.matrix.multiplyMatrices(this.car.matrix, local);
    mesh.setMatrixAt(mesh.count++, this.matrix);
  }
  /** One staff member beside the cockpit, at car-local `x`, facing the car. */
  private person(person: number, x: number, yaw: number, time: number) {
    const idle = gridStaffPose(person, time, this.idle);
    const slot = this.bodies.count;
    this.actor.position.set(x, CREW_FLOOR, 0.4);
    this.actor.rotation.set(0, yaw, 0);
    this.actor.updateMatrix();
    this.actor.position.add(
      this.offset.set(idle.sway, 0, 0).applyQuaternion(this.actor.quaternion),
    );
    this.actor.updateMatrix();
    for (let i = 0; i < 2; i++) this.wrists[i].copy(idle.hands[i]).applyMatrix4(this.actor.matrix);
    this.pose.set(this.actor.matrix, idle.hip, idle.lean, this.wrists);
    this.pose.write(this.boneData, slot);
    this.slots.setX(slot, slot);
    this.reach[slot] = this.pose.reachable[0] && this.pose.reachable[1];
    this.stances[slot] = idle.stance;
    this.put(this.bodies, this.actor.matrix);
    // Helmet on the posed head, turning on its own.
    this.head.setFromAxisAngle(this.transform.up, idle.headYaw);
    this.transform.position.copy(this.pose.joints[2]);
    this.transform.quaternion.copy(this.pose.rotations[2]).multiply(this.head);
    this.transform.scale.set(1, 1, 1);
    this.transform.updateMatrix();
    this.matrix
      .multiplyMatrices(this.actor.matrix, this.transform.matrix)
      .premultiply(this.car.matrix);
    this.heads.put(
      this.matrix,
      slot,
      this.bodies.instanceColor
        ? this.teamColour.fromBufferAttribute(this.bodies.instanceColor as T.BufferAttribute, slot)
        : this.teamColour,
      0,
      person,
    );
    // Gloves continue the forearm, palms towards the body, cuffs on the wrists.
    for (let i = 0; i < 2; i++) {
      const elbow = this.pose.joints[i === 0 ? 4 : 7],
        wrist = this.pose.joints[i === 0 ? 5 : 8];
      this.fingers.copy(wrist).sub(elbow).normalize();
      this.palm.set(i === 0 ? 1 : -1, 0, 0);
      this.palm.addScaledVector(this.fingers, -this.palm.dot(this.fingers)).normalize();
      this.side.crossVectors(this.fingers, this.palm);
      this.basis.makeBasis(this.side, this.fingers, this.palm);
      this.rotation.setFromRotationMatrix(this.basis);
      this.transform.position.copy(CUFF).applyQuaternion(this.rotation).negate().add(wrist);
      this.transform.quaternion.copy(this.rotation);
      this.transform.updateMatrix();
      this.put(
        this.gloves[i],
        this.matrix.multiplyMatrices(this.actor.matrix, this.transform.matrix),
      );
    }
  }
  update(frame: Float32Array, camera: T.Vector3, enabled = true) {
    const meshes = [this.blankets, this.straps, this.bodies, ...this.gloves];
    this.heads.reset();
    for (const mesh of meshes) mesh.count = 0;
    for (let id = 0; enabled && id < Math.min(12, frame[H.CARS]); id++) {
      const o = carBase(id);
      const state = gridPreparation(frame[H.TIME], frame[H.PHASE], frame[o + F.SPEED]);
      if (!state.crew && !state.blankets) continue;
      this.car.position.fromArray(frame, o + F.X);
      if (this.car.position.distanceToSquared(camera) > 120 ** 2) continue;
      this.car.quaternion.fromArray(frame, o + F.QX);
      this.car.updateMatrix();
      if (state.blankets)
        WHEEL_POSITIONS.forEach(([x, y, z], wheel) => {
          const shift = Math.sign(x) * state.withdrawal * 0.5;
          const hubY = y - (frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LENGTH] || 0.25);
          const width = wheel < 2 ? 0.34 : 0.42;
          this.place(this.blankets, x + shift, hubY, z, width, true);
          for (const band of [-1, 1])
            this.place(this.straps, x + shift + band * width * 0.32, hubY, z, 1, true);
        });
      if (state.crew)
        for (const side of [-1, 1]) {
          // Beside the cockpit, feet on the grid (car origin is ~0.52 m up),
          // facing the car and stepping back as the blankets come off.
          const person = id * 2 + (side + 1) / 2;
          this.bodies.setColorAt(this.bodies.count, crewTeamColour(id));
          this.person(
            person,
            side * (1.8 + state.withdrawal * 1.8),
            -side * Math.PI * 0.5,
            frame[H.TIME],
          );
        }
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    this.bodies.instanceColor!.needsUpdate = true;
    this.heads.finish();
    if (this.bodies.count) {
      this.slots.needsUpdate = true;
      this.bones.needsUpdate = true;
    }
  }
  diagnostics() {
    return { blankets: this.blankets.count, staff: this.bodies.count };
  }
  /** Stance and arm reach of each posed staff member this frame. */
  poses() {
    return Array.from({ length: this.bodies.count }, (_, i) => ({
      stance: GRID_STANCES[this.stances[i]].name,
      reachable: this.reach[i],
    }));
  }
}
