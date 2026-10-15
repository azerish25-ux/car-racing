import {
  PitFootwork,
  PitWheelTask,
  pitWheelOffset,
  pitClearance,
  pitGunWithdrawal,
  pitJackClearance,
} from './pit-footwork.ts';
import { PitRolePerformance, type PitRole } from './pit-role-performance.ts';
export type { PitRole } from './pit-role-performance.ts';
import { crewPerformanceGeometry, CREW_PERFORMANCE } from './crew-performance.ts';
import { type PitJackBatches } from './a32-pit-jacks.ts';
import { A32JackPose, type PitJackFits } from './a32-jack-pose.ts';
import { type WheelGunBatches, WHEEL_GUN } from './wheel-gun.ts';
import type { WheelGunFit } from './wheel-gun-contact.ts';
import { A33WheelBatches, a33GripX } from './a33-spare-wheel-set.ts';
import { PIT_CREW_MAX_DISTANCE, PitPoseCache } from './pit-presentation.ts';
import { PitMachinery } from './pit-machinery.ts';
import * as T from 'three';
import { clamp } from '../core/math.ts';
import {
  F,
  H,
  HEADER,
  CAR_STRIDE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';
import { PEOPLE_ASSET, CREW_BONES, CREW_REST, peopleGeometry } from './people-asset.ts';
import { crewRoleColour, installCrewHelmetFinish } from './crew-geometry.ts';
import { installNearFade } from './crew-suit.ts';
import { CrewPose, CREW_THIGH, CREW_SHIN, installCrewSkin } from './crew-pose.ts';

/** Removal requires an unloaded hub. These offsets are also consumed by the
 * actual FormulaCar wheel, so a crew cannot animate a different service clock. */
export const serviceWheelOffset = pitWheelOffset;
export const PIT_CREW_PER_CAR = 15;
export const MAX_PIT_CREWS = 12;
const ACTORS = PIT_CREW_PER_CAR * MAX_PIT_CREWS;
const UP = new T.Vector3(0, 1, 0);
const FORWARD = new T.Vector3(0, 0, 1);
const UNIT = new T.Vector3(1, 1, 1);
/** Glove-local wrist (cuff) point: the skin's wrist target sits here. */
export const CUFF = new T.Vector3(0, -0.067, -0.008);
const GRIP = new T.Vector3(0, 0.034, 0.041);
interface ActorEvidence {
  car: number;
  role: PitRole;
  wheel: number;
  reachable: boolean[];
  wristError: number;
  gripError: number;
  floorY: number;
  root: number[];
  action: string;
  actionTime: number;
  hipOffset: number;
  feet: number[][];
  planted: boolean[];
  feetReachable: boolean[];
}

/** Fifteen task-specific, Blender-authored actors per stopped car, with one
 * shared bone atlas and bounded instanced batches. No per-actor draw calls,
 * wall-clock animation, new simulation state or asynchronous primitive swap. */
export class PitCrewView {
  readonly root = new T.Group();
  private readonly boneData = new Float32Array(ACTORS * CREW_BONES * 16);
  private readonly bones = new T.DataTexture(
    this.boneData,
    4 * CREW_BONES,
    ACTORS,
    T.RGBAFormat,
    T.FloatType,
  );
  private readonly cloth: readonly [T.InstancedMesh, T.InstancedMesh];
  private readonly heads: T.InstancedMesh;
  private readonly gloves: readonly [T.InstancedMesh, T.InstancedMesh];
  private readonly guns: T.InstancedMesh;
  readonly spareWheels = new A33WheelBatches(MAX_PIT_CREWS * 8);
  private readonly jacks: T.InstancedMesh;
  private readonly handles: T.InstancedMesh;
  private readonly signals: T.InstancedMesh;
  private machinery: PitMachinery;
  wheelGuns: WheelGunBatches | null = null;
  pitJacks: PitJackBatches | null = null;
  private readonly jackPose = new A32JackPose();
  private readonly jackFootPose = new A32JackPose();
  private readonly jackFootRoot = new T.Matrix4();
  private readonly jackFits: PitJackFits[] = [];
  private readonly gunFits: WheelGunFit[][] = [];
  private readonly wheelRotation = new T.Quaternion();
  private readonly wheelEuler = new T.Euler();
  private readonly gunYaw = new T.Quaternion();
  private readonly batches: readonly T.InstancedMesh[];
  private readonly slots: readonly [T.InstancedBufferAttribute, T.InstancedBufferAttribute];
  private readonly pose = new CrewPose();
  private readonly performances: Record<PitRole, PitRolePerformance> = {
    gun: new PitRolePerformance(),
    remove: new PitRolePerformance(),
    install: new PitRolePerformance(),
    'front-jack': new PitRolePerformance(),
    'rear-jack': new PitRolePerformance(),
    release: new PitRolePerformance(),
  };
  private servicePhase = 2;
  private serviceClock = 0;
  private wheelLoad = 0;
  private readonly wheelTask = new PitWheelTask();
  private readonly footwork = new PitFootwork();
  private readonly car = new T.Object3D();
  private readonly actor = new T.Object3D();
  private readonly prop = new T.Object3D();
  private readonly matrix = new T.Matrix4();
  private readonly gloveMatrices = [new T.Matrix4(), new T.Matrix4()];
  private readonly wrists = [new T.Vector3(), new T.Vector3()];
  private readonly grips = [new T.Vector3(), new T.Vector3()];
  private readonly orientations = [new T.Quaternion(), new T.Quaternion()];
  private readonly target = new T.Vector3();
  private readonly direction = new T.Vector3();
  private readonly local = new T.Vector3();
  private readonly rotation = new T.Quaternion();
  private readonly actorWorld = new T.Matrix4();
  private readonly footInverse = new T.Matrix4();
  private readonly records: ActorEvidence[] = Array.from({ length: ACTORS }, () => ({
    car: -1,
    role: 'gun',
    wheel: -1,
    reachable: [false, false],
    wristError: 0,
    gripError: 0,
    floorY: 0,
    root: new Array<number>(16).fill(0),
    action: '',
    actionTime: 0,
    hipOffset: 0,
    feet: [new Array<number>(3).fill(0), new Array<number>(3).fill(0)],
    planted: [true, true],
    feetReachable: [true, true],
  }));
  // Local scratch values have disjoint lifetimes from person/hand/propAt.
  // They never escape into a diagnostic snapshot or another renderer instance.
  private readonly point = new T.Vector3();
  private readonly socket = new T.Vector3();
  private readonly center = new T.Vector3();
  private readonly bar = new T.Vector3();
  private readonly endA = new T.Vector3();
  private readonly endB = new T.Vector3();
  private readonly toolRotation = new T.Quaternion();
  private readonly handRotation = new T.Quaternion();
  private readonly quarterTurn = new T.Quaternion().setFromAxisAngle(FORWARD, Math.PI / 2);
  private readonly gunSupportTurn = new T.Quaternion().setFromAxisAngle(UP, -Math.PI / 2);
  private readonly gunMatrix = new T.Matrix4();
  private readonly cache = new PitPoseCache();
  private actorSlot = 0;
  activeCrews = 0;
  activeActors = 0;

  constructor() {
    this.bones.generateMipmaps = false;
    this.bones.minFilter = this.bones.magFilter = T.NearestFilter;
    this.bones.name = 'Aurel state-driven crew bones';
    this.bones.needsUpdate = true;
    this.slots = [0, 1].map(() =>
      new T.InstancedBufferAttribute(new Float32Array(ACTORS), 1).setUsage(T.DynamicDrawUsage),
    ) as [T.InstancedBufferAttribute, T.InstancedBufferAttribute];
    const makeCloth = (role: 'crew_high' | 'crew_mid', i: 0 | 1) => {
      const g = crewPerformanceGeometry(role === 'crew_high' ? 'suit_near' : 'suit_mid');
      g.setAttribute('crewSlot', this.slots[i]);
      const material = new T.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.9,
      });
      material.userData.weatherSurface = 'fabric';
      installCrewSkin(material, this.bones, ACTORS, true);
      const batch = new T.InstancedMesh(g, material, ACTORS);
      // setColorAt otherwise creates this attribute at the first live stop and
      // changes Three's instancingColor shader variant after prepare() compiled
      // the empty crew. Allocate the same white-initialized buffer while loading.
      batch.instanceColor = new T.InstancedBufferAttribute(
        new Float32Array(ACTORS * 3).fill(1),
        3,
      ).setUsage(T.DynamicDrawUsage);
      const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
      installCrewSkin(depth, this.bones, ACTORS, false);
      batch.customDepthMaterial = depth;
      // Point-light shadows must use the same bones as the normal/shadow pass.
      const distance = new T.MeshDistanceMaterial();
      installCrewSkin(distance, this.bones, ACTORS, false);
      batch.customDistanceMaterial = distance;
      return batch;
    };
    this.cloth = [makeCloth('crew_high', 0), makeCloth('crew_mid', 1)];
    // A lens inside the crew dissolves the nearest fabric instead of filling
    // the frame with a helmet (screen-door fade under 1.2 m of view depth).
    for (const batch of this.cloth) installNearFade(batch.material as T.Material);
    this.heads = this.batch(crewPerformanceGeometry('helmet'), ACTORS, 0.35, 0.08);
    installCrewHelmetFinish(this.heads.material as T.MeshStandardMaterial);
    // D23: helmets in the team colour, allocated now so the instancing-colour
    // shader variant is the one prepare() compiled.
    this.heads.instanceColor = new T.InstancedBufferAttribute(
      new Float32Array(ACTORS * 3).fill(1),
      3,
    ).setUsage(T.DynamicDrawUsage);
    this.gloves = [
      this.batch(crewPerformanceGeometry('glove', true), ACTORS, 0.85),
      this.batch(crewPerformanceGeometry('glove'), ACTORS, 0.85),
    ];
    for (const batch of [this.heads, ...this.gloves]) installNearFade(batch.material as T.Material);
    this.guns = this.batch(peopleGeometry('wheel_gun'), MAX_PIT_CREWS * 4, 0.37, 0.55);
    this.jacks = this.batch(peopleGeometry('jack_base'), MAX_PIT_CREWS * 2, 0.4, 0.65);
    this.handles = this.batch(
      new T.CylinderGeometry(0.018, 0.018, 1, 10),
      MAX_PIT_CREWS * 7,
      0.42,
      0.5,
    );
    this.signals = this.batch(
      new T.CylinderGeometry(0.14, 0.14, 0.018, 24).rotateX(Math.PI / 2),
      MAX_PIT_CREWS,
      0.6,
    );
    (this.handles.material as T.MeshStandardMaterial).color.setHex(0x838e91);
    (this.signals.material as T.MeshStandardMaterial).color.setHex(0xd3aa4d);
    this.batches = [
      ...this.cloth,
      this.heads,
      ...this.gloves,
      this.guns,
      ...this.spareWheels.batches,
      this.jacks,
      this.handles,
      this.signals,
    ];
    this.machinery = new PitMachinery(
      [
        { mesh: this.guns, perCrew: 4 },
        { mesh: this.jacks, perCrew: 2 },
        { mesh: this.handles, perCrew: 7 },
        { mesh: this.signals, perCrew: 1 },
      ],
      MAX_PIT_CREWS,
    );
    this.root.name = 'Authored state-driven pit personnel';
    this.root.userData.authoredPeople = PEOPLE_ASSET;
    for (const batch of this.batches) {
      batch.count = 0;
      batch.frustumCulled = false; // per-car distance rejection below; bones exceed rest bounds
      batch.castShadow = true;
      batch.receiveShadow = true;
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
      if (![this.guns, this.jacks, this.handles, this.signals].includes(batch))
        this.root.add(batch);
    }
    this.root.add(this.machinery);
  }
  setWheelGunFits(car: number, fits: WheelGunFit[]) {
    if (fits.length !== 4 || car < 0 || car >= MAX_PIT_CREWS)
      throw new Error('Invalid wheel-gun fit registration');
    this.gunFits[car] = fits;
  }
  setPitJackFits(car: number, fits: PitJackFits) {
    if (
      !Number.isInteger(car) ||
      car < 0 ||
      car >= MAX_PIT_CREWS ||
      ![...fits.front, ...fits.rear].every(Number.isFinite)
    )
      throw new Error('Invalid A32 fit registration');
    this.jackFits[car] = fits;
  }
  installPitJacks(jacks: PitJackBatches) {
    if (this.pitJacks || this.cache.builds)
      throw new Error('A32 must be installed before crew warmup');
    this.pitJacks = jacks;
    this.rebuildMachinery();
    this.root.add(...jacks.batches);
  }
  installWheelGuns(guns: WheelGunBatches) {
    if (this.wheelGuns || this.cache.builds)
      throw new Error('A31 must be installed before crew warmup');
    this.wheelGuns = guns;
    this.rebuildMachinery();
    this.root.add(...guns.batches);
  }
  /** Installation order is irrelevant: retain the other agent's tool family. */
  private rebuildMachinery() {
    const previous = this.machinery;
    this.machinery = new PitMachinery(
      [
        ...(this.wheelGuns ? [] : [{ mesh: this.guns, perCrew: 4 }]),
        ...(this.pitJacks ? [] : [{ mesh: this.jacks, perCrew: 2 }]),
        { mesh: this.handles, perCrew: this.pitJacks ? 1 : 7 },
        { mesh: this.signals, perCrew: 1 },
      ],
      MAX_PIT_CREWS,
    );
    this.root.remove(previous);
    previous.dispose();
    previous.geometry.dispose();
    previous.material.dispose();
    previous.customDepthMaterial?.dispose();
    previous.customDistanceMaterial?.dispose();
    this.root.add(this.machinery);
  }
  private batch(geometry: T.BufferGeometry, count: number, roughness: number, metalness = 0) {
    return new T.InstancedMesh(
      geometry,
      new T.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: !!geometry.getAttribute('color'),
        roughness,
        metalness,
      }),
      count,
    );
  }
  private put(batch: T.InstancedMesh, local: T.Matrix4) {
    if (batch.count >= batch.instanceMatrix.count) throw new Error('Pit crew capacity exceeded');
    this.matrix.multiplyMatrices(this.car.matrix, local);
    batch.setMatrixAt(batch.count++, this.matrix);
  }
  private propAt(batch: T.InstancedMesh, position: T.Vector3, quaternion?: T.Quaternion) {
    this.prop.position.copy(position);
    this.prop.quaternion.copy(quaternion ?? this.rotation.identity());
    this.prop.scale.copy(UNIT);
    this.prop.updateMatrix();
    this.put(batch, this.prop.matrix);
    return this.prop.matrix;
  }
  private tube(a: T.Vector3, b: T.Vector3, radius = 1) {
    this.direction.copy(b).sub(a);
    const length = this.direction.length();
    this.prop.position.copy(a).add(b).multiplyScalar(0.5);
    this.prop.quaternion.setFromUnitVectors(UP, this.direction.normalize());
    this.prop.scale.set(radius, Math.max(length, 1e-4), radius);
    this.prop.updateMatrix();
    this.put(this.handles, this.prop.matrix);
  }
  private hand(i: number, grip: T.Vector3, orientation: T.Quaternion) {
    // The glove's curled fingers have a measured local grip centre; its cuff
    // supplies the skin's wrist target rather than stretching arms to props.
    this.grips[i].copy(grip);
    this.orientations[i].copy(orientation);
    this.local.copy(GRIP).applyQuaternion(orientation);
    this.target.copy(grip).sub(this.local);
    this.gloveMatrices[i].compose(this.target, orientation, UNIT);
    this.wrists[i].copy(CUFF).applyMatrix4(this.gloveMatrices[i]);
  }
  private person(
    car: number,
    role: PitRole,
    wheel: number,
    x: number,
    floor: number,
    z: number,
    yaw: number,
    hip: number,
    lean: number,
    detail: 0 | 1,
    spread = 0.15,
    supportRoot?: T.Matrix4,
  ) {
    this.actor.position.set(x, floor, z);
    this.actor.rotation.set(0, yaw, 0);
    this.actor.scale.copy(UNIT);
    this.actor.updateMatrix();
    const performance = this.performances[role].sample(
      role,
      this.servicePhase,
      this.serviceClock,
      lean,
    );
    performance.sampler.style.minimumKneeHeight = 0.11;
    this.footwork.set(
      role,
      wheel,
      this.servicePhase,
      this.serviceClock,
      this.wheelLoad,
      floor,
      spread,
      supportRoot ?? this.actor.matrix,
    );
    let posedHip = hip + performance.hipOffset;
    this.footInverse.copy(this.actor.matrix).invert();
    for (const foot of [0, 1] as const) {
      this.local.copy(this.footwork.feet[foot]).applyMatrix4(this.footInverse);
      const x = this.local.x - performance.sampler.style.pelvis.x - (foot ? 0.092 : -0.092);
      const z = this.local.z - performance.sampler.style.pelvis.z;
      const reach = CREW_THIGH + CREW_SHIN - 0.003;
      posedHip = Math.min(
        posedHip,
        this.local.y + Math.sqrt(Math.max(0.01, reach * reach - x * x - z * z)),
      );
    }
    this.pose.set(
      this.actor.matrix,
      posedHip,
      lean,
      this.wrists,
      spread,
      this.footwork.feet,
      performance.sampler.style,
    );
    // Human-length arms: when a handle is beyond reach, sink into the knees
    // (shoulders follow the pelvis) rather than stretching or detaching a hand.
    const missed = () =>
      Math.max(
        this.pose.endpoint(4, CREW_REST[5], this.local).distanceTo(this.wrists[0]),
        this.pose.endpoint(7, CREW_REST[8], this.local).distanceTo(this.wrists[1]),
      );
    for (let k = 0; k < 12 && missed() > 1e-6; k++) {
      posedHip -= 0.02;
      this.pose.set(
        this.actor.matrix,
        posedHip,
        lean,
        this.wrists,
        spread,
        this.footwork.feet,
        performance.sampler.style,
      );
    }
    this.pose.write(this.boneData, this.actorSlot);
    const cloth = this.cloth[detail];
    this.slots[detail].setX(cloth.count, this.actorSlot++);
    cloth.setColorAt(
      cloth.count,
      // D23: every crew member wears the team's kit, role-coded.
      crewRoleColour(car, role, this.activeActors),
    );
    this.put(cloth, this.actor.matrix);
    this.actorWorld.multiplyMatrices(this.car.matrix, this.actor.matrix);
    this.prop.position.copy(this.pose.joints[2]);
    this.prop.quaternion.copy(this.pose.rotations[2]);
    this.prop.scale.copy(UNIT);
    this.prop.updateMatrix();
    this.prop.matrix.premultiply(this.actor.matrix);
    this.put(this.heads, this.prop.matrix);
    this.heads.setColorAt(this.heads.count - 1, crewRoleColour(car, role, this.activeActors, true));
    let wristError = 0,
      gripError = 0;
    for (let i = 0; i < 2; i++) {
      this.put(this.gloves[i], this.gloveMatrices[i]);
      const fore = i === 0 ? 4 : 7;
      wristError = Math.max(
        wristError,
        this.pose.endpoint(fore, CREW_REST[fore + 1], this.local).distanceTo(this.wrists[i]),
      );
      gripError = Math.max(
        gripError,
        this.local.copy(GRIP).applyMatrix4(this.gloveMatrices[i]).distanceTo(this.grips[i]),
      );
    }
    // Small CPU witnesses are retained for inspection; they are not art approval.
    const record = this.records[this.activeActors];
    record.car = car;
    record.role = role;
    record.wheel = wheel;
    record.reachable[0] = this.pose.reachable[0];
    record.reachable[1] = this.pose.reachable[1];
    record.wristError = wristError;
    record.gripError = gripError;
    record.floorY = floor;
    record.action = performance.sampler.action;
    record.actionTime = performance.sampler.time;
    record.hipOffset = performance.hipOffset;
    for (const foot of [0, 1] as const) {
      this.footwork.feet[foot].toArray(record.feet[foot]);
      record.planted[foot] = this.footwork.planted[foot];
      record.feetReachable[foot] = this.pose.feetReachable[foot];
    }
    this.actorWorld.toArray(record.root);
    this.activeActors++;
  }
  update(frame: Float32Array, camera: T.Vector3, visible = true, fov = 58, aspect = 16 / 9) {
    const count = frame[H.CARS];
    if (
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX_PIT_CREWS ||
      frame.length < HEADER + count * CAR_STRIDE ||
      !Number.isFinite(camera.x + camera.y + camera.z)
    )
      throw new Error('Invalid pit crew frame');
    if (!this.cache.prepare(frame, camera, visible, fov, aspect)) {
      this.wheelGuns?.setView(camera, fov, aspect);
      this.pitJacks?.setView(camera, fov, aspect);
      return;
    }
    this.wheelGuns?.begin();
    this.pitJacks?.begin();
    this.spareWheels.begin();
    for (const batch of this.batches) batch.count = 0;
    this.actorSlot = this.activeActors = this.activeCrews = 0;
    for (let id = 0; id < count && visible; id++) {
      const o = carBase(id),
        phase = frame[o + F.PIT_PHASE],
        clock = frame[o + F.PIT_CLOCK];
      if (!Number.isFinite(phase + clock + frame[o + F.SPEED]))
        throw new Error('Invalid pit crew state');
      if (this.cache.levels[id] < 0) continue;
      this.car.position.set(frame[o + F.X], frame[o + F.Y], frame[o + F.Z]);
      const distance = this.car.position.distanceTo(camera);
      if (distance > PIT_CREW_MAX_DISTANCE) continue;
      this.car.quaternion.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      if (
        !Number.isFinite(
          this.car.position.lengthSq() +
            this.car.quaternion.lengthSq() +
            clock +
            frame[o + F.JACK_HEIGHT],
        ) ||
        this.car.quaternion.lengthSq() < 0.5
      )
        throw new Error('Invalid pit crew transform');
      this.car.quaternion.normalize();
      this.car.updateMatrix();
      this.activeCrews++;
      this.servicePhase = phase;
      this.serviceClock = clock;
      const floor = -0.43 - frame[o + F.JACK_HEIGHT],
        detail = this.cache.levels[id] as 0 | 1;
      const clear = pitClearance(phase, clock);
      for (let wheel = 0; wheel < 4; wheel++) {
        const [hubX, , hubZ] = WHEEL_POSITIONS[wheel],
          side = Math.sign(hubX);
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        if (!Number.isFinite(frame[p + W.LENGTH]) || frame[p + W.LENGTH] < 0)
          throw new Error('Invalid crew wheel contact');
        const length = frame[p + W.LENGTH] || 0.25,
          hubY = 0.05 - length;
        this.wheelLoad = frame[p + W.LOAD];
        const yaw = (-side * Math.PI) / 2;
        const gunAway = pitGunWithdrawal(phase, clock);
        const socket = this.socket.set(hubX + side * (0.21 + 0.28 * gunAway + clear), hubY, hubZ);
        const gunRotation = this.toolRotation.setFromAxisAngle(UP, yaw);
        const fit = this.gunFits[id]?.[wheel];
        if (this.wheelGuns && fit) {
          this.wheelEuler.set(0, frame[p + W.STEER], -frame[p + W.CAMBER]);
          this.wheelRotation.setFromEuler(this.wheelEuler);
          this.point
            .set(side * (fit.axial + 0.28 * gunAway + clear), 0, 0)
            .applyQuaternion(this.wheelRotation);
          socket.set(hubX, hubY, hubZ).add(this.point);
          gunRotation.copy(this.wheelRotation).multiply(this.gunYaw.setFromAxisAngle(UP, yaw));
        }
        const gunMatrix = this.gunMatrix.copy(this.propAt(this.guns, socket, gunRotation));
        const actuated =
          phase === 3 && clock < 1 ? 1 : phase === 4 && clock >= 3.05 && clock < 3.4 ? 1 : 0;
        // The nut is not independently simulated: keep its socket stationary
        // while engaged, rather than inventing an RPM/rotation through the nut.
        this.wheelGuns?.put(this.matrix, actuated, 0, fit?.socketScale ?? 1);
        this.hand(
          0,
          this.point
            .fromArray(WHEEL_GUN.sockets.SOCKET_HAND_PRIMARY.position)
            .applyMatrix4(gunMatrix),
          this.handRotation.copy(gunRotation).multiply(this.quarterTurn),
        );
        this.hand(
          1,
          this.point
            .fromArray(WHEEL_GUN.sockets.SOCKET_HAND_SUPPORT.position)
            .applyMatrix4(gunMatrix),
          this.handRotation.copy(gunRotation).multiply(this.gunSupportTurn),
        );
        this.person(
          id,
          'gun',
          wheel,
          hubX + side * (0.87 + 0.28 * gunAway + clear),
          floor,
          hubZ,
          yaw,
          clamp(hubY - floor + 0.08, 0.2, 0.38),
          0.85,
          detail,
        );
        // Removal and installation actors occupy separate fore/aft stations.
        // The mounted wheel is still rendered by FormulaCar, never duplicated.
        for (const install of [false, true]) {
          const station = install ? 1 : -1;
          // Approach/clearance are bounded by the actual service clock. At
          // 2.2 s the simulation exchanges compounds: the old carried wheel
          // and new mounted wheel meet the same withdrawal endpoint. Nothing
          // depends on previous render frames, including a replay rewind.
          const task = this.wheelTask.set(
            install ? 'install' : 'remove',
            wheel,
            phase,
            clock,
            frame[p + W.LOAD],
            hubY,
            floor,
          );
          const { engagement, center, hasSpare } = task;
          if (hasSpare) this.spareWheels.putCarLocal(wheel, center, this.car.matrix, detail);
          const actorX = task.root.x,
            actorZ = task.root.z,
            actorYaw = task.yaw;
          const q = this.toolRotation.setFromAxisAngle(UP, actorYaw);
          for (let hand = 0; hand < 2; hand++) {
            // Approach-side grips: a mechanic beside a tyre cannot reach its
            // opposite fore/aft edge through the wheel. Slide along the real
            // sidewall arc while approaching, rather than through its centre.
            const carryAngle = side * (hand === 0 ? -1 : 1) * Math.atan2(0.26, 0.12);
            const workAngle = station * (hand === 0 ? 0.6 : 1.25);
            const angle = carryAngle + (workAngle - carryAngle) * engagement;
            const radius = Math.hypot(0.26, 0.12);
            const grip = this.point.set(
              center.x + side * a33GripX(wheel, radius),
              center.y + Math.cos(angle) * radius,
              center.z + Math.sin(angle) * radius,
            );
            this.hand(hand, grip, q);
          }
          const workingHip = clamp(hubY - floor + 0.04, 0.24, 0.43);
          this.person(
            id,
            install ? 'install' : 'remove',
            wheel,
            actorX,
            floor,
            actorZ,
            actorYaw,
            0.43 + (workingHip - 0.43) * engagement,
            0.35 + 0.5 * engagement,
            detail,
            0.11,
          );
        }
      }
      for (const end of [-1, 1]) {
        const withdraw = end * pitJackClearance(phase, clock, frame[o + F.JACK_HEIGHT]);
        if (this.pitJacks) {
          const role = end > 0 ? 'front' : 'rear';
          const fits = this.jackFits[id];
          if (!fits) throw new Error('A32 missing measured car fit');
          const pose = this.jackPose.set(role, fits[role], floor).withdraw(withdraw);
          this.pitJacks.put(role, pose, this.car.matrix);
          for (let hand = 0; hand < 2; hand++)
            this.hand(hand, pose.grips[hand], pose.handOrientation);
          const gripHeight = pose.grips[0].y - floor;
          const support = this.jackFootPose.set(role, fits[role], -0.43);
          this.jackFootRoot.makeRotationY(end > 0 ? Math.PI : 0);
          this.jackFootRoot.setPosition(0, floor, support.grips[0].z + end * 0.37);
          this.person(
            id,
            end > 0 ? 'front-jack' : 'rear-jack',
            -1,
            withdraw,
            floor,
            pose.grips[0].z + end * 0.37,
            end > 0 ? Math.PI : 0,
            clamp(gripHeight + 0.015, 0.28, 0.69),
            0.52,
            detail,
            0.14,
            this.jackFootRoot,
          );
          continue;
        }
        const lift = clamp(frame[o + F.JACK_HEIGHT], 0, 0.22);
        const jack = this.point.set(withdraw, floor, end * 2.05);
        this.propAt(
          this.jacks,
          jack,
          this.toolRotation.setFromAxisAngle(UP, end > 0 ? Math.PI : 0),
        );
        const base = this.endA.set(withdraw, floor + 0.23, end * 2.05);
        const top = this.endB.set(withdraw, floor + 0.23 + lift, end * 2.05);
        this.tube(base, top, 1.9);
        const bar = this.bar.set(withdraw, floor + 0.9 - lift, end * 2.76);
        this.tube(this.point.set(withdraw, floor + 0.09, end * 2.05), bar);
        this.tube(
          this.endA.set(bar.x - 0.17, bar.y, bar.z),
          this.endB.set(bar.x + 0.17, bar.y, bar.z),
        );
        const yaw = end > 0 ? Math.PI : 0,
          q = this.toolRotation.setFromAxisAngle(UP, yaw);
        for (let h = 0; h < 2; h++)
          this.hand(
            h,
            this.point.set(bar.x + (h ? 1 : -1) * (end > 0 ? -1 : 1) * 0.12, bar.y, bar.z),
            q,
          );
        this.jackFootRoot.makeRotationY(yaw).setPosition(0, floor, end * 3.2);
        this.person(
          id,
          end > 0 ? 'front-jack' : 'rear-jack',
          -1,
          withdraw,
          floor,
          end * 3.2,
          yaw,
          0.69,
          0.42,
          detail,
          0.14,
          this.jackFootRoot,
        );
      }
      const signX = 2.7 + clear,
        signZ = 2.7;
      const q = this.toolRotation.setFromAxisAngle(UP, -Math.PI / 2);
      const grip = this.center.set(signX, floor + 0.96, signZ - 0.2);
      this.tube(
        this.endA.set(grip.x, grip.y - 0.36, grip.z),
        this.endB.set(grip.x, grip.y + 0.48, grip.z),
      );
      this.propAt(this.signals, this.endB, q);
      for (let h = 0; h < 2; h++)
        this.hand(
          h,
          this.point.set(grip.x, grip.y + h * 0.12, grip.z),
          this.handRotation.copy(q).multiply(this.quarterTurn),
        );
      this.person(id, 'release', -1, signX + 0.42, floor, signZ, -Math.PI / 2, 0.84, 0.08, detail);
    }
    this.spareWheels.finish();
    this.wheelGuns?.setView(camera, fov, aspect);
    this.pitJacks?.setView(camera, fov, aspect);
    this.machinery.update(this.activeCrews);
    this.root.visible = this.activeCrews > 0;
    if (this.activeActors) this.bones.needsUpdate = true;
    this.slots.forEach((slot, i) => {
      slot.clearUpdateRanges();
      if (this.cloth[i].count) {
        slot.addUpdateRange(0, this.cloth[i].count);
        slot.needsUpdate = true;
      }
    });
    for (const batch of this.batches) {
      batch.instanceMatrix.clearUpdateRanges();
      batch.instanceColor?.clearUpdateRanges();
      if (!batch.count) continue;
      batch.instanceMatrix.addUpdateRange(0, batch.count * 16);
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor) {
        batch.instanceColor.addUpdateRange(0, batch.count * 3);
        batch.instanceColor.needsUpdate = true;
      }
    }
    this.cache.commit();
  }
  actorCountFor(car: number) {
    let count = 0;
    for (let i = 0; i < this.activeActors; i++) if (this.records[i].car === car) count++;
    return count;
  }
  summary() {
    let unreachableArms = 0,
      unreachableFeet = 0,
      unsupportedActors = 0,
      maxWristError = 0,
      maxGripError = 0;
    for (let i = 0; i < this.activeActors; i++) {
      const record = this.records[i];
      unreachableArms += Number(!record.reachable[0]) + Number(!record.reachable[1]);
      unreachableFeet += record.feetReachable.filter((reachable) => !reachable).length;
      unsupportedActors += Number(!record.planted.some(Boolean));
      maxWristError = Math.max(maxWristError, record.wristError);
      maxGripError = Math.max(maxGripError, record.gripError);
    }
    return {
      ...PEOPLE_ASSET,
      crewAsset: CREW_PERFORMANCE.runtimeSHA256,
      authoredGunAction: this.performances.gun.sampler.action,
      authoredRoles: Object.fromEntries(
        Object.entries(this.performances).map(([role, p]) => [role, p.sampler.action]),
      ),
      spareWheels: this.spareWheels.diagnostics(),
      wheelGuns: this.wheelGuns?.diagnostics() ?? null,
      pitJacks: this.pitJacks?.diagnostics() ?? null,
      poseBuilds: this.cache.builds,
      poseReuses: this.cache.reuses,
      crews: this.activeCrews,
      actors: this.activeActors,
      nearActors: this.cloth[0].count,
      midActors: this.cloth[1].count,
      activeDrawBatches: this.root.children.filter((b) => (b as T.InstancedMesh).count > 0).length,
      boneTextureBytes: this.boneData.byteLength,
      machineryTextureBytes: this.machinery.instanceMatrix.array.byteLength,
      unreachableArms,
      unreachableFeet,
      unsupportedActors,
      maxWristError,
      maxGripError,
    };
  }
  diagnostics() {
    return {
      ...PEOPLE_ASSET,
      spareWheels: this.spareWheels.diagnostics(),
      wheelGuns: this.wheelGuns?.diagnostics() ?? null,
      pitJacks: this.pitJacks?.diagnostics() ?? null,
      poseBuilds: this.cache.builds,
      poseReuses: this.cache.reuses,
      crews: this.activeCrews,
      actors: this.activeActors,
      activeDrawBatches: this.root.children.filter((b) => (b as T.InstancedMesh).count > 0).length,
      boneTextureBytes: this.boneData.byteLength,
      machineryTextureBytes: this.machinery.instanceMatrix.array.byteLength,
      counts: this.batches.map((b) => b.count),
      crewAsset: CREW_PERFORMANCE.runtimeSHA256,
      authoredGunAction: this.performances.gun.sampler.action,
      authoredRoles: Object.fromEntries(
        Object.entries(this.performances).map(([role, p]) => [role, p.sampler.action]),
      ),
      roles: this.records.slice(0, this.activeActors).map((r) => ({
        ...r,
        root: [...r.root],
        reachable: [...r.reachable],
        feet: r.feet.map((p) => [...p]),
        planted: [...r.planted],
        feetReachable: [...r.feetReachable],
      })),
    };
  }
  /** The renderer's general traversal owns geometry/material disposal. */
  dispose() {
    this.bones.dispose();
    this.machinery.dispose();
    // These four meshes are bounded transform writers, not rendered children.
    // The palette batch owns copied geometry; dispose its source prototypes here.
    for (const batch of [this.guns, this.jacks, this.handles, this.signals]) {
      batch.geometry.dispose();
      (batch.material as T.Material).dispose();
      batch.dispose();
    }
  }
}
