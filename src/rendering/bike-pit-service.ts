import * as T from 'three';
import { clamp, smooth } from '../core/math.ts';
import { BIKE_PIT_SERVICE, carServiceClock } from '../simulation/pit-service.ts';
import type { VehicleDefinition } from '../simulation/vehicles.ts';
import { pitClearance, pitGunWithdrawal, pitJackClearance } from './pit-footwork.ts';
import type { PitRole } from './pit-role-performance.ts';

/** Motorcycle pit service presentation (one shared pose per stopped bike).
 *
 * Every position here is in the entrant's recorded frame (the snapshot pose,
 * origin at the centre of mass, +z forward, +x to the rider's left, ground at
 * y = -cgHeight). The crew (`PitCrewView`), the stands and carried wheels
 * (`BikeServiceRig`) and the mounted wheels of the bike model all read this
 * one pose, so a hand, the stand it pushes and the wheel it carries cannot
 * disagree. The service clock is the simulation's; the authored crew actions
 * are keyed on the car clock, so the pose remaps it once (`carServiceClock`).
 * Snapshot wheel slots: 0 = front, 2 = rear. */
export const BIKE_FRONT_WHEEL = 0;
export const BIKE_REAR_WHEEL = 2;
/** Axle nuts and the wheel crew are on the right (-x); new wheels come from the left. */
const RIGHT = -1;
/** Rear wheel out of the swingarm slots (m, backwards); front out of the fork (m, down). */
export const BIKE_REAR_OUT = 0.3;
export const BIKE_FRONT_DROP = 0.075;
/** Paddock stand lever: handle length (m), raised / pushed-down angles (rad). */
const HANDLE = 0.95,
  HANDLE_UP = 0.62,
  HANDLE_DOWN = 0.2,
  STAND_WITHDRAW = 0.6;

export interface BikeServiceGeometry {
  /** Centre-of-mass height over the ground (m). */
  readonly height: number;
  /** Front / rear axle distance ahead of / behind the centre of mass (m). */
  readonly front: number;
  readonly rear: number;
  readonly frontRadius: number;
  readonly rearRadius: number;
}
const GEOMETRIES = new WeakMap<VehicleDefinition, BikeServiceGeometry>();
/** Service geometry of a motorcycle definition (cached: read every frame). */
export function bikeServiceGeometry(definition: VehicleDefinition): BikeServiceGeometry {
  const cached = GEOMETRIES.get(definition);
  if (cached) return cached;
  const b = definition.bike;
  if (!b) throw new Error(`${definition.id} has no motorcycle block`);
  const geometry = Object.freeze({
    height: b.cgHeight,
    front: b.cgToFront,
    rear: b.cgToRear,
    frontRadius: b.frontWheelRadius,
    rearRadius: b.rearWheelRadius,
  });
  GEOMETRIES.set(definition, geometry);
  return geometry;
}

export interface BikeStandPose {
  /** Stand wheels on the ground: the lever pivot. */
  readonly pivot: T.Vector3;
  /** Left (+x) and right lifting hooks: swingarm spools / fork bottoms. */
  readonly hooks: readonly [T.Vector3, T.Vector3];
  /** Handle grip (cross-bar centre) the operator pushes down. */
  readonly grip: T.Vector3;
  /** Operator root on the floor, behind (rear) or ahead of (front) the grip. */
  readonly operator: T.Vector3;
  readonly yaw: number;
}

const DEFAULT_GEOMETRY: BikeServiceGeometry = Object.freeze({
  height: 0.62,
  front: 0.7,
  rear: 0.75,
  frontRadius: 0.3,
  rearRadius: 0.32,
});
const stand = (): BikeStandPose => ({
  pivot: new T.Vector3(),
  hooks: [new T.Vector3(), new T.Vector3()],
  grip: new T.Vector3(),
  operator: new T.Vector3(),
  yaw: 0,
});

/** One bike's service pose at a recorded (phase, service clock, stand lift). */
export class BikeServicePose {
  geometry: BikeServiceGeometry = DEFAULT_GEOMETRY;
  phase = 0;
  /** Simulation service clock (s) and its car-clock equivalent. */
  clock = 0;
  carClock = 0;
  /** Recorded stand lift (m, F.JACK_HEIGHT). */
  lift = 0;
  floor = -0.62;
  /** 0..1: how far the mounted wheels are out (axle drawn). */
  out = 0;
  gunAway = 0;
  clear = 0;
  /** 0..1: stands pulled clear after lowering. */
  withdraw = 0;
  readonly hubs = [new T.Vector3(), new T.Vector3()];
  /** Mounted wheel centre (hub plus its current out offset), front / rear. */
  readonly mounted = [new T.Vector3(), new T.Vector3()];
  /** Fully out position of each wheel, where carried and mounted wheels swap. */
  readonly exchange = [new T.Vector3(), new T.Vector3()];
  readonly rearStand = stand();
  readonly frontStand = stand();
  /** Release board on its pole and the release actor's root. */
  readonly sign = new T.Vector3();
  readonly release = new T.Vector3();
  set(geometry: BikeServiceGeometry, phase: number, clock: number, lift: number) {
    if (![phase, clock, lift].every(Number.isFinite) || clock < 0)
      throw new Error('Invalid bike pit service state');
    this.geometry = geometry;
    this.phase = phase;
    this.clock = clock;
    this.carClock = carServiceClock(BIKE_PIT_SERVICE, clock);
    this.lift = clamp(lift, 0, BIKE_PIT_SERVICE.liftHeight);
    const g = geometry,
      t = this.carClock;
    this.floor = -g.height;
    this.out = phase === 3 ? smooth(1.35, 2.1, t) : phase === 4 ? 1 - smooth(2.2, 3.25, t) : 0;
    this.gunAway = pitGunWithdrawal(phase, t);
    this.clear = pitClearance(phase, t);
    this.withdraw = pitJackClearance(phase, t, this.lift) / 1.55;
    const [front, rear] = this.hubs;
    front.set(0, g.frontRadius - g.height + this.lift, g.front);
    rear.set(0, g.rearRadius - g.height + this.lift, -g.rear);
    this.exchange[0].copy(front).add(bikeWheelOutVector(BIKE_FRONT_WHEEL, 1, SCRATCH));
    this.exchange[1].copy(rear).add(bikeWheelOutVector(BIKE_REAR_WHEEL, 1, SCRATCH));
    for (let i = 0; i < 2; i++) this.mounted[i].copy(this.hubs[i]).lerp(this.exchange[i], this.out);
    this.poseStand(this.rearStand, -1);
    this.poseStand(this.frontStand, 1);
    this.sign.set(0.95 + this.clear, this.floor + 0.96, g.front + 1.4);
    this.release.set(this.sign.x + 0.42, this.floor, this.sign.z + 0.2);
    return this;
  }
  private poseStand(pose: BikeStandPose, end: -1 | 1) {
    const axle = end > 0 ? this.hubs[0] : this.hubs[1],
      slide = end * STAND_WITHDRAW * this.withdraw;
    const lever = this.lift / BIKE_PIT_SERVICE.liftHeight;
    const angle = HANDLE_UP + (HANDLE_DOWN - HANDLE_UP) * lever;
    pose.pivot.set(0, this.floor + 0.05, axle.z + end * (end > 0 ? 0.32 : 0.3) + slide);
    // Rear: hooks under the swingarm spools just ahead of the axle; front:
    // under the fork bottoms either side of the axle. They ride with the lift.
    const hookZ = (end > 0 ? axle.z : axle.z + 0.08) + slide,
      hookX = end > 0 ? 0.105 : 0.14;
    pose.hooks[0].set(hookX, axle.y - 0.02, hookZ);
    pose.hooks[1].set(-hookX, axle.y - 0.02, hookZ);
    pose.grip.set(
      0,
      pose.pivot.y + HANDLE * Math.sin(angle),
      pose.pivot.z + end * HANDLE * Math.cos(angle),
    );
    pose.operator.set(0, this.floor, pose.grip.z + end * 0.37);
    (pose as { yaw: number }).yaw = end > 0 ? Math.PI : 0;
  }
  stand(end: 'front' | 'rear') {
    return end === 'front' ? this.frontStand : this.rearStand;
  }
  /** Index into `hubs`/`mounted`/`exchange` for a snapshot wheel slot. */
  static slot(wheel: number) {
    if (wheel !== BIKE_FRONT_WHEEL && wheel !== BIKE_REAR_WHEEL)
      throw new Error('Invalid motorcycle service wheel');
    return wheel === BIKE_FRONT_WHEEL ? 0 : 1;
  }
}
const SCRATCH = new T.Vector3();

/** Mounted wheel displacement (bike frame) at `out` 0..1 for a wheel slot. */
export function bikeWheelOutVector(wheel: number, out: number, target: T.Vector3) {
  BikeServicePose.slot(wheel);
  return wheel === BIKE_REAR_WHEEL
    ? target.set(0, 0, -BIKE_REAR_OUT * out)
    : target.set(0, -BIKE_FRONT_DROP * out, 0);
}

/** Actor routes for the bike crew, with the footwork's route signature: the
 * carried wheel centre, the actor root on the floor, its yaw and engagement,
 * from the recorded service state only (no accumulated paths). `time` is the
 * car-equivalent service clock, as the authored actions use. */
export class BikeWheelTask {
  readonly center = new T.Vector3();
  readonly root = new T.Vector3();
  engagement = 0;
  hasSpare = false;
  yaw = 0;
  geometry: BikeServiceGeometry = DEFAULT_GEOMETRY;
  lift = 0;
  /** Bind to a stopped bike's pose (geometry and stand lift) before routing. */
  bind(source: BikeServicePose) {
    this.geometry = source.geometry;
    this.lift = source.lift;
    return this;
  }
  set(
    role: PitRole,
    wheel: number,
    phase: number,
    time: number,
    load: number,
    recordedHubY: number,
    floor: number,
  ) {
    void load;
    void recordedHubY;
    if (![phase, time, floor].every(Number.isFinite)) throw new Error('Invalid bike crew route');
    const g = this.geometry;
    const clear = pitClearance(phase, time);
    if (role === 'release') {
      this.root.set(0.95 + clear + 0.42, floor, g.front + 1.6);
      this.yaw = -Math.PI / 2;
      this.engagement = 1;
      this.hasSpare = false;
      return this;
    }
    if (role === 'front-jack' || role === 'rear-jack') throw new Error('Stands are not routed');
    BikeServicePose.slot(wheel);
    const front = wheel === BIKE_FRONT_WHEEL;
    const hubY = (front ? g.frontRadius : g.rearRadius) - g.height + this.lift,
      hubZ = front ? g.front : -g.rear;
    if (role === 'gun') {
      this.root.set(RIGHT * (0.8 + 0.28 * pitGunWithdrawal(phase, time) + clear), floor, hubZ);
      this.yaw = (-RIGHT * Math.PI) / 2;
      this.engagement = 1;
      this.hasSpare = false;
      return this;
    }
    const install = role === 'install',
      side = install ? -RIGHT : RIGHT,
      along = front ? 1 : -1;
    // The same timing as the car's off/on carriers, on the car clock.
    const engagement = install
      ? phase < 4
        ? smooth(1.35, 2.2, time)
        : phase === 4
          ? 1
          : 1 - smooth(3.5, 4.15, time)
      : phase < 3
        ? smooth(0.2, 0.8, time)
        : phase === 3
          ? 1
          : 1 - smooth(2.2, 2.9, time);
    const out =
      phase === 3 ? smooth(1.35, 2.1, time) : phase === 4 ? 1 - smooth(2.2, 3.25, time) : 0;
    // Old wheel leaves from (and the new one arrives at) the fully-out
    // exchange point; otherwise the carrier holds the mounted wheel.
    const transfer = (install && phase < 4) || (!install && phase >= 4) ? 1 : out;
    bikeWheelOutVector(wheel, transfer, SCRATCH);
    const tx = SCRATCH.x,
      ty = hubY + SCRATCH.y,
      tz = hubZ + SCRATCH.z;
    this.center.set(side * (0.95 + clear), floor + 0.36, hubZ + along * 0.55);
    this.center.x += (tx - this.center.x) * engagement;
    this.center.y += (ty - this.center.y) * engagement;
    this.center.z += (tz - this.center.z) * engagement;
    this.root.set(
      this.center.x + side * (0.45 - 0.05 * engagement),
      floor,
      this.center.z + along * (0.3 + 0.5 * engagement),
    );
    this.yaw = Math.atan2(this.center.x - this.root.x, this.center.z - this.root.z);
    this.engagement = engagement;
    this.hasSpare = install ? phase < 4 : phase >= 4;
    return this;
  }
}

/** Stands and carried wheels for one motorcycle entrant: plain procedural
 * props, visible only while that bike is in service. The mounted wheels and
 * the bike's lift are posed by the bike model from the same pose. */
export class BikeServiceRig {
  readonly root = new T.Group();
  private readonly tubes: T.Mesh[] = [];
  private readonly rollers: T.Mesh[] = [];
  private readonly spares: [T.Group, T.Group];
  private readonly geometries: T.BufferGeometry[] = [];
  private readonly materials: T.Material[] = [];
  private tube = 0;
  private roller = 0;
  private readonly up = new T.Vector3(0, 1, 0);
  private readonly a = new T.Vector3();
  private readonly b = new T.Vector3();
  constructor(geometry: BikeServiceGeometry) {
    this.root.name = 'Motorcycle pit stands and wheels';
    this.root.visible = false;
    const paint = new T.MeshStandardMaterial({ color: 0xb8322c, roughness: 0.45, metalness: 0.3 }),
      rubber = new T.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
      rim = new T.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.35, metalness: 0.7 });
    const tube = new T.CylinderGeometry(0.016, 0.016, 1, 10),
      roller = new T.CylinderGeometry(0.04, 0.04, 0.03, 14).rotateZ(Math.PI / 2);
    this.materials.push(paint, rubber, rim);
    this.geometries.push(tube, roller);
    // Two stands: two arms, a base bar, the handle, its cross-bar and the
    // hook bar each, on two rollers.
    for (let i = 0; i < 12; i++) {
      const mesh = new T.Mesh(tube, paint);
      mesh.castShadow = true;
      this.tubes.push(mesh);
      this.root.add(mesh);
    }
    for (let i = 0; i < 4; i++) {
      const mesh = new T.Mesh(roller, rubber);
      this.rollers.push(mesh);
      this.root.add(mesh);
    }
    this.spares = [
      this.spareWheel(geometry.frontRadius, 0.06, rubber, rim),
      this.spareWheel(geometry.rearRadius, 0.1, rubber, rim),
    ];
    this.root.add(...this.spares);
  }
  private spareWheel(radius: number, halfWidth: number, rubber: T.Material, metal: T.Material) {
    const group = new T.Group();
    group.name = 'Carried motorcycle wheel';
    const tyre = new T.TorusGeometry(radius - halfWidth, halfWidth, 10, 36).rotateY(Math.PI / 2),
      rim = new T.CylinderGeometry(
        radius - 2 * halfWidth,
        radius - 2 * halfWidth,
        halfWidth * 1.4,
        24,
      ).rotateZ(Math.PI / 2);
    this.geometries.push(tyre, rim);
    const meshes = [new T.Mesh(tyre, rubber), new T.Mesh(rim, metal)];
    for (const mesh of meshes) mesh.castShadow = true;
    group.add(...meshes);
    group.visible = false;
    return group;
  }
  private link(from: T.Vector3, to: T.Vector3, radius = 0.016) {
    const mesh = this.tubes[this.tube++];
    this.a.copy(to).sub(from);
    const length = Math.max(this.a.length(), 1e-4);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(this.up, this.a.normalize());
    mesh.scale.set(radius / 0.016, length, radius / 0.016);
  }
  private poseStand(s: BikeStandPose) {
    for (const x of [-0.2, 0.2]) {
      this.rollers[this.roller++].position.set(x, s.pivot.y, s.pivot.z);
      this.link(this.b.set(x, s.pivot.y, s.pivot.z), x > 0 ? s.hooks[0] : s.hooks[1]);
    }
    this.link(this.b.set(-0.2, s.pivot.y, s.pivot.z), this.a.set(0.2, s.pivot.y, s.pivot.z), 0.02);
    this.link(this.b.set(0, s.pivot.y, s.pivot.z), s.grip, 0.018);
    this.link(this.b.set(-0.17, s.grip.y, s.grip.z), this.a.set(0.17, s.grip.y, s.grip.z), 0.014);
    this.link(s.hooks[0], s.hooks[1], 0.012);
  }
  /** Stand and carried-wheel meshes in use (diagnostics). */
  get parts() {
    return {
      tubes: this.tube,
      rollers: this.roller,
      spares: this.spares.filter((s) => s.visible).length,
    };
  }
  /** Spare (carried) wheel centre in the entrant frame, front or rear slot. */
  spareCentre(wheel: number) {
    return this.spares[BikeServicePose.slot(wheel)].position;
  }
  /** Pose in the entrant frame at the recorded snapshot pose (`position`,
   * `quaternion`, without the stand lift); hidden when `pose` is null. */
  update(
    pose: BikeServicePose | null,
    task: BikeWheelTask,
    position: T.Vector3,
    quaternion: T.Quaternion,
  ) {
    this.root.visible = !!pose;
    if (!pose) return;
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);
    this.tube = this.roller = 0;
    this.poseStand(pose.rearStand);
    this.poseStand(pose.frontStand);
    task.bind(pose);
    for (const wheel of [BIKE_FRONT_WHEEL, BIKE_REAR_WHEEL]) {
      // A new wheel is carried in while the old one is still mounted; the old
      // one is carried away after the exchange (the mounted mesh is then new).
      const spare = this.spares[BikeServicePose.slot(wheel)];
      task.set(
        pose.phase < 4 ? 'install' : 'remove',
        wheel,
        pose.phase,
        pose.carClock,
        0,
        0,
        pose.floor,
      );
      spare.visible = task.hasSpare;
      spare.position.copy(task.center);
    }
  }
  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/** Convert a bike-frame wheel displacement into a fork-lower local offset
 * (models rake their steering mount by -rake about x, then steer about y). */
export function forkLocalOffset(out: T.Vector3, rake: number, steer: number, target: T.Vector3) {
  return target.copy(out).applyAxisAngle(X_AXIS, rake).applyAxisAngle(Y_AXIS, -steer);
}
const X_AXIS = new T.Vector3(1, 0, 0),
  Y_AXIS = new T.Vector3(0, 1, 0);
