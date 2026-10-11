import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID_PRESENTATION_SECONDS } from '../core/grid-presentation.ts';
import { F, H, carBase } from '../simulation/protocol.ts';
import { crewTeamColour } from './crew-geometry.ts';
import { CrewPerformanceSampler } from './crew-performance.ts';
import { CrewPose, installCrewSkin } from './crew-pose.ts';
import {
  crewBodyGeometry,
  crewHandGeometry,
  humanSkinToneRGB,
  HumanHeadBatches,
} from './human-kit.ts';
import { CREW_BONES } from './people-asset.ts';
import { CUFF } from './pit-crew.ts';

/** The rest of a real grid around each car: an umbrella holder shading the
 * cockpit and a race engineer with a tablet and headset. They hold their
 * marks through the tyre work and walk off to the pit wall when the grid is
 * cleared. Pure function of presentation time (pause/seek/replay exact). */
export const GRID_CAST_CARS = 12;
const ROLES = 2;
const CAPACITY = GRID_CAST_CARS * ROLES;
/** Car-local marks beside the cockpit (feet on the grid, car origin ~0.52 m up). */
const FLOOR = -0.52;
export const GRID_CAST_MARKS = Object.freeze([
  { role: 'umbrella', x: -1.28, z: -0.15, yaw: Math.PI / 2 - 0.25 },
  { role: 'engineer', x: 1.32, z: 0.35, yaw: -Math.PI / 2 - 0.35 },
] as const);
export const GRID_CAST_LEAVE = 21;
/** Finger-grip socket of the crew hand mesh (same as the grid glove grip). */
const GRIP = new T.Vector3(0, 0.034, 0.041);
const WALK_SPEED = 1.15;

const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** Golf-style grid umbrella: eight scalloped panels on ribs, pole and grip.
 * `panels` selects the even (team colour) or odd (white) panels. */
export function gridUmbrellaGeometry(panels: 0 | 1 | 'frame') {
  const radius = 0.72,
    rise = 0.26;
  if (panels === 'frame') {
    const parts: T.BufferGeometry[] = [
      new T.CylinderGeometry(0.009, 0.009, 1.12, 8).translate(0, 0.56, 0),
      new T.CylinderGeometry(0.016, 0.014, 0.16, 10).translate(0, -0.06, 0),
      new T.SphereGeometry(0.018, 8, 6).translate(0, 1.13 + 0.02, 0),
    ];
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2;
      const rib = new T.CylinderGeometry(0.0035, 0.0035, Math.hypot(radius, rise), 5);
      rib.rotateZ(Math.atan2(radius, rise));
      rib.translate(radius / 2, 1.12 - rise / 2, 0);
      rib.rotateY(a);
      parts.push(rib);
    }
    const g = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    return g;
  }
  const positions: number[] = [],
    indices: number[] = [];
  const rings = 8,
    steps = 10;
  for (let p = panels; p < 8; p += 2) {
    const base = positions.length / 3;
    for (let i = 0; i <= rings; i++) {
      const u = i / rings;
      for (let j = 0; j <= steps; j++) {
        const v = j / steps;
        const a = ((p + v) / 8) * Math.PI * 2;
        // Fabric sags between ribs and scallops at the hem.
        const sag = Math.sin(Math.PI * v);
        const r = radius * u * (1 - 0.05 * sag * u);
        const y = 1.12 - rise * u * u - 0.02 * sag * u + 0.004;
        positions.push(Math.cos(a) * r, y, -Math.sin(a) * r);
      }
    }
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < steps; j++) {
        const a = base + i * (steps + 1) + j,
          b = a + steps + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export class GridCastView {
  readonly root = new T.Group();
  private readonly boneData = new Float32Array(CAPACITY * CREW_BONES * 16);
  private readonly bones = new T.DataTexture(
    this.boneData,
    CREW_BONES * 4,
    CAPACITY,
    T.RGBAFormat,
    T.FloatType,
  );
  private readonly bodies: T.InstancedMesh[];
  private readonly slots = [0, 1].map(() =>
    new T.InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(T.DynamicDrawUsage),
  );
  private readonly heads = new HumanHeadBatches(
    CAPACITY,
    ['bare', 'headset', 'cap'],
    [0, 1],
    'Grid cast heads',
  );
  private readonly hands: T.InstancedMesh[];
  private readonly canopy: T.InstancedMesh[];
  private readonly frame: T.InstancedMesh;
  private readonly tablets: T.InstancedMesh;
  private readonly pose = new CrewPose();
  private readonly sampler = new CrewPerformanceSampler();
  private readonly car = new T.Object3D();
  private readonly actor = new T.Object3D();
  private readonly part = new T.Object3D();
  private readonly matrix = new T.Matrix4();
  private readonly world = new T.Matrix4();
  private readonly wrists = [new T.Vector3(), new T.Vector3()];
  private readonly feet = [new T.Vector3(), new T.Vector3()];
  private readonly tone = new T.Color();
  private readonly grips = [new T.Vector3(), new T.Vector3()];
  private readonly axis = new T.Vector3();
  private readonly gloveBind = [-1, 1].map((sign) =>
    new T.Quaternion()
      .setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI)
      .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (sign * Math.PI) / 2)),
  );
  private actors = 0;
  constructor() {
    this.root.name = 'Grid cast: umbrella holders and race engineers';
    this.bones.generateMipmaps = false;
    this.bones.minFilter = this.bones.magFilter = T.NearestFilter;
    this.bones.needsUpdate = true;
    this.bodies = ([0, 1] as const).map((lod) => {
      const g = crewBodyGeometry('polo', lod);
      g.setAttribute('crewSlot', this.slots[lod]);
      const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
      material.userData.weatherSurface = 'fabric';
      installCrewSkin(material, this.bones, CAPACITY, true, 'polo');
      const mesh = new T.InstancedMesh(g, material, CAPACITY);
      mesh.instanceColor = new T.InstancedBufferAttribute(
        new Float32Array(CAPACITY * 3).fill(1),
        3,
      ).setUsage(T.DynamicDrawUsage);
      const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
      installCrewSkin(depth, this.bones, CAPACITY, false);
      mesh.customDepthMaterial = depth;
      const distance = new T.MeshDistanceMaterial();
      installCrewSkin(distance, this.bones, CAPACITY, false);
      mesh.customDistanceMaterial = distance;
      return mesh;
    });
    // Bare hands in the person's own skin tone (instance colour).
    this.hands = [true, false].map(
      (left) =>
        new T.InstancedMesh(
          crewHandGeometry(1, left, true).deleteAttribute('color'),
          new T.MeshStandardMaterial({ roughness: 0.55 }),
          CAPACITY,
        ),
    );
    this.canopy = ([0, 1] as const).map(
      (p) =>
        new T.InstancedMesh(
          gridUmbrellaGeometry(p),
          new T.MeshStandardMaterial({
            color: p ? 0xf3f1ea : 0xffffff,
            roughness: 0.7,
            side: T.DoubleSide,
          }),
          GRID_CAST_CARS,
        ),
    );
    this.frame = new T.InstancedMesh(
      gridUmbrellaGeometry('frame'),
      new T.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.4, metalness: 0.6 }),
      GRID_CAST_CARS,
    );
    const tablet = new T.BoxGeometry(0.25, 0.012, 0.18);
    this.tablets = new T.InstancedMesh(
      tablet,
      new T.MeshStandardMaterial({ color: 0x15181c, roughness: 0.25, metalness: 0.3 }),
      GRID_CAST_CARS,
    );
    for (const mesh of this.meshes()) {
      if (mesh.instanceColor === null && mesh !== this.frame && mesh !== this.tablets)
        mesh.instanceColor = new T.InstancedBufferAttribute(
          new Float32Array(mesh.instanceMatrix.count * 3).fill(1),
          3,
        ).setUsage(T.DynamicDrawUsage);
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
    }
    this.root.add(...this.meshes());
  }
  private meshes() {
    return [
      ...this.bodies,
      ...this.heads.meshes,
      ...this.hands,
      ...this.canopy,
      this.frame,
      this.tablets,
    ];
  }
  private put(mesh: T.InstancedMesh, local: T.Matrix4, colour?: T.Color) {
    this.world.multiplyMatrices(this.car.matrix, local);
    if (colour) mesh.setColorAt(mesh.count, colour);
    mesh.setMatrixAt(mesh.count++, this.world);
  }
  /** `time` is presentation time; null hides the cast. */
  update(frame: Float32Array, camera: T.Vector3, time: number | null) {
    for (const mesh of this.meshes()) mesh.count = 0;
    this.heads.reset();
    this.actors = 0;
    if (time !== null && Number.isFinite(time) && frame[H.PHASE] < 2 && frame[H.TIME] <= 0)
      for (let id = 0; id < Math.min(GRID_CAST_CARS, frame[H.CARS]); id++) {
        const base = carBase(id);
        if (Math.abs(frame[base + F.SPEED]) > 0.5) continue;
        this.car.position.fromArray(frame, base + F.X);
        if (this.car.position.distanceToSquared(camera) > 110 ** 2) continue;
        this.car.quaternion.fromArray(frame, base + F.QX);
        this.car.updateMatrix();
        const exit = (Math.sign(frame[base + F.LATERAL]) || -1) * 10 - frame[base + F.LATERAL];
        for (let role = 0; role < ROLES; role++) this.person(id, role, time, exit);
      }
    for (const mesh of this.meshes()) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const slots of this.slots) slots.needsUpdate = true;
    this.heads.finish();
    this.bones.needsUpdate = true;
  }
  private person(id: number, role: number, time: number, exitX: number) {
    const mark = GRID_CAST_MARKS[role];
    const person = 200 + id * ROLES + role;
    // Staggered departures: nobody leaves in lockstep.
    const leave = GRID_CAST_LEAVE + ((id * 0.37 + role * 0.61) % 1) * 2.2;
    const turn = smooth((time - leave) / 1.1);
    // Each walks off on their own side of the car (never through it).
    const side = Math.sign(mark.x);
    const distance = Math.max(0, time - leave - 0.6) * WALK_SPEED;
    const route = Math.max(9, Math.abs(exitX - mark.x));
    if (distance >= route || time > GRID_PRESENTATION_SECONDS + 1) return;
    const walking = distance > 0;
    // Walk out sideways, past the car's flank, towards the pit wall side.
    // Face along the walked path (sideways, drifting rear/forward early on).
    const u = Math.min(1, distance / 3);
    const drift = (role ? 0.4 : -1.9) * ((6 * u * (1 - u)) / 3);
    const awayYaw = Math.atan2(side, drift);
    const yaw =
      mark.yaw + Math.atan2(Math.sin(awayYaw - mark.yaw), Math.cos(awayYaw - mark.yaw)) * turn;
    this.actor.position.set(
      mark.x + side * distance,
      FLOOR,
      mark.z + (role ? 0.4 : -1.9) * smooth(distance / 3),
    );
    this.actor.rotation.set(0, yaw, 0);
    this.actor.updateMatrix();
    // Idle weight shift or a walking cycle (distance-locked, no foot skating).
    if (walking) this.sampler.sample('walk', distance / WALK_SPEED, true);
    else this.sampler.sample('idle', time + id * 1.7 + role, true);
    const s = this.sampler;
    for (let h = 0; h < 2; h++) {
      this.feet[h].copy(s.joints[h ? 14 : 11]).applyMatrix4(this.actor.matrix);
    }
    const breathe = Math.sin(time * 1.6 + person) * 0.004;
    if (mark.role === 'umbrella') {
      // Both hands on the pole in front of the chest, umbrella over the cockpit.
      this.wrists[0].set(0.02, 1.07 + breathe, 0.2);
      this.wrists[1].set(0.05, 1.27 + breathe, walking ? 0.22 : 0.27);
    } else if (!walking) {
      this.wrists[0].set(-0.12, 1.03 + breathe, 0.27);
      this.wrists[1].set(0.12, 1.03 + breathe, 0.27);
    } else {
      this.wrists[0].copy(s.joints[5]);
      this.wrists[1].set(0.1, 1.0, 0.22);
    }
    for (let h = 0; h < 2; h++) this.wrists[h].applyMatrix4(this.actor.matrix);
    // Pose in car space, then upload in actor space via the actor matrix.
    this.pose.set(
      this.actor.matrix,
      Math.min(s.joints[0].y, 0.875),
      0,
      this.wrists,
      0.15,
      this.feet,
      s.style,
    );
    const slot = this.actors++;
    this.pose.write(this.boneData, slot);
    const lod = id === 0 ? 0 : 1;
    const body = this.bodies[lod];
    this.slots[lod].setX(body.count, slot);
    this.put(body, this.actor.matrix, crewTeamColour(id));
    // Head: looking at the cockpit while idle, ahead while walking.
    this.part.position.copy(this.pose.joints[2]);
    this.part.quaternion
      .copy(this.pose.rotations[2])
      .multiply(
        new T.Quaternion().setFromAxisAngle(
          this.part.up,
          walking ? 0 : Math.sin(time * 0.31 + person) * 0.35,
        ),
      );
    this.part.scale.set(1, 1, 1);
    this.part.updateMatrix();
    this.matrix.multiplyMatrices(this.actor.matrix, this.part.matrix);
    this.world.multiplyMatrices(this.car.matrix, this.matrix);
    this.heads.put(
      this.world,
      slot,
      crewTeamColour(id),
      lod,
      mark.role === 'umbrella' ? (id % 2 ? 2 : 0) : 1,
    );
    humanSkinToneRGB(slot, this.tone);
    for (let h = 0; h < 2; h++) {
      this.part.quaternion.copy(this.pose.rotations[h === 0 ? 4 : 7]).multiply(this.gloveBind[h]);
      this.part.position
        .copy(CUFF)
        .applyQuaternion(this.part.quaternion)
        .negate()
        .add(this.pose.joints[h === 0 ? 5 : 8]);
      this.part.updateMatrix();
      // The fist's grip socket, in the actor frame (the pole runs through it).
      this.grips[h].copy(GRIP).applyMatrix4(this.part.matrix);
      this.matrix.multiplyMatrices(this.actor.matrix, this.part.matrix);
      this.put(this.hands[h], this.matrix, this.tone);
    }
    if (mark.role === 'umbrella') {
      // The pole runs through both fists' grip sockets (lower fist at the
      // grip), so its lean towards the cockpit comes from the hands.
      this.axis.subVectors(this.grips[1], this.grips[0]).normalize();
      this.part.quaternion.setFromUnitVectors(this.part.up, this.axis);
      this.part.position.copy(this.grips[0]).addScaledVector(this.axis, -0.02);
      this.part.updateMatrix();
      this.matrix.multiplyMatrices(this.actor.matrix, this.part.matrix);
      this.put(this.canopy[0], this.matrix, crewTeamColour(id));
      this.put(this.canopy[1], this.matrix, this.tone.setRGB(1, 1, 1));
      this.put(this.frame, this.matrix);
    } else {
      this.part.position.copy(this.pose.joints[5]).lerp(this.pose.joints[8], 0.5);
      this.part.position.y += 0.03;
      this.part.quaternion.setFromEuler(new T.Euler(-0.75, 0, 0));
      this.part.updateMatrix();
      this.matrix.multiplyMatrices(this.actor.matrix, this.part.matrix);
      this.put(this.tablets, this.matrix);
    }
  }
  hide() {
    for (const mesh of this.meshes()) mesh.count = 0;
    this.heads.reset();
    this.actors = 0;
  }
  diagnostics() {
    return { actors: this.actors, umbrellas: this.frame.count, tablets: this.tablets.count };
  }
  dispose() {
    this.bones.dispose();
  }
}
