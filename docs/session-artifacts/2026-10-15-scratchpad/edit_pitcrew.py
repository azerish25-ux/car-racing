p = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/rendering/pit-crew.ts'
s = open(p).read()


def rep(old, new):
    global s
    assert old in s, old[:80]
    s = s.replace(old, new, 1)


rep("""import {
  PitFootwork,
  PitWheelTask,
  pitWheelOffset,
  pitClearance,
  pitGunWithdrawal,
  pitJackClearance,
} from './pit-footwork.ts';""", """import {
  PitFootwork,
  PitWheelTask,
  pitWheelOffset,
  pitClearance,
  pitGunWithdrawal,
  pitJackClearance,
  type PitFootRoute,
  type PitStandWithdrawal,
} from './pit-footwork.ts';
import {
  BIKE_FRONT_WHEEL,
  BIKE_REAR_WHEEL,
  BikeServicePose,
  BikeWheelTask,
  bikeServiceGeometry,
} from './bike-pit-service.ts';""")
rep("""import {
  F,
  H,
  HEADER,
  CAR_STRIDE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';""", """import {
  F,
  H,
  HEADER,
  CAR_STRIDE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { BIKE_PIT_SERVICE } from '../simulation/pit-service.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';
import { vehicleAt, type VehicleDefinition } from '../simulation/vehicles.ts';""")
rep("""export const PIT_CREW_PER_CAR = 15;
export const MAX_PIT_CREWS = 12;""", """export const PIT_CREW_PER_CAR = 15;
/** A motorcycle stop: two stands, a gun/off/on trio per wheel and the release. */
export const PIT_CREW_PER_BIKE = BIKE_PIT_SERVICE.crew;
export const MAX_PIT_CREWS = 12;""")
rep("""  private readonly wheelTask = new PitWheelTask();
  private readonly footwork = new PitFootwork();""", """  private readonly wheelTask = new PitWheelTask();
  private readonly footwork = new PitFootwork();
  /** Motorcycle service: one pose per stopped bike, the crew's own routes and
   * a second route instance for the footwork's look-ahead anchors. */
  private readonly bikePose = new BikeServicePose();
  private readonly bikeTask = new BikeWheelTask();
  private readonly bikeFootRoute = new BikeWheelTask();
  private footRoute: PitFootRoute | undefined;
  private footStand: PitStandWithdrawal | undefined;
  private readonly standAxis = new T.Vector3();
  private readonly standWithdrawal = { axis: this.standAxis, distance: 0.6, height: 0 };
  private readonly speck = new T.Matrix4().makeScale(1e-5, 1e-5, 1e-5);""")
rep("""    this.footwork.set(
      role,
      wheel,
      this.servicePhase,
      this.serviceClock,
      this.wheelLoad,
      floor,
      spread,
      supportRoot ?? this.actor.matrix,
    );""", """    this.footwork.set(
      role,
      wheel,
      this.servicePhase,
      this.serviceClock,
      this.wheelLoad,
      floor,
      spread,
      supportRoot ?? this.actor.matrix,
      this.footRoute,
      this.footStand,
    );""")
rep("""      this.car.quaternion.normalize();
      this.car.updateMatrix();
      this.activeCrews++;
      this.servicePhase = phase;
      this.serviceClock = clock;""", """      this.car.quaternion.normalize();
      this.car.updateMatrix();
      this.activeCrews++;
      const definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
      if (definition.dynamicsKind === 'bike' && definition.bike) {
        this.serviceBike(id, frame, o, definition, this.cache.levels[id] as 0 | 1);
        continue;
      }
      this.servicePhase = phase;
      this.serviceClock = clock;""")
rep("""  update(frame: Float32Array, camera: T.Vector3, visible = true, fov = 58, aspect = 16 / 9) {""", """  /** A machinery source keeps its exact per-crew count: unused car tools of
   * a motorcycle crew are specks at the entrant origin (never drawn visibly). */
  private unused(batch: T.InstancedMesh, count: number) {
    for (let i = 0; i < count; i++) this.put(batch, this.speck);
  }
  /** Motorcycle service (BIKE_PIT_SERVICE): rear and front paddock stands,
   * a gun/off/on trio on each axle (right-hand nuts, new wheels from the
   * left) and the release; nine actors on the recorded service clock. The
   * stands and carried wheels themselves are drawn by the bike presentation
   * from the same BikeServicePose. */
  private serviceBike(
    id: number,
    frame: Float32Array,
    o: number,
    definition: VehicleDefinition,
    detail: 0 | 1,
  ) {
    const phase = frame[o + F.PIT_PHASE];
    const pose = this.bikePose.set(
      bikeServiceGeometry(definition),
      phase,
      frame[o + F.PIT_CLOCK],
      frame[o + F.JACK_HEIGHT],
    );
    const t = pose.carClock,
      floor = pose.floor;
    this.servicePhase = phase;
    this.serviceClock = t;
    this.wheelLoad = 0;
    this.bikeTask.bind(pose);
    this.footRoute = this.bikeFootRoute.bind(pose);
    this.footStand = undefined;
    try {
      for (const wheel of [BIKE_FRONT_WHEEL, BIKE_REAR_WHEEL]) {
        const hub = pose.hubs[BikeServicePose.slot(wheel)],
          halfWidth = wheel === BIKE_FRONT_WHEEL ? 0.06 : 0.1,
          radius =
            (wheel === BIKE_FRONT_WHEEL ? pose.geometry.frontRadius : pose.geometry.rearRadius) *
            0.86;
        // Nut gun on the right-hand axle end (the chain side is the left).
        const socket = this.socket.set(-(0.13 + 0.28 * pose.gunAway + pose.clear), hub.y, hub.z);
        const gunRotation = this.toolRotation.setFromAxisAngle(UP, Math.PI / 2);
        const gunMatrix = this.gunMatrix.copy(this.propAt(this.guns, socket, gunRotation));
        const actuated = phase === 3 && t < 1 ? 1 : phase === 4 && t >= 3.05 && t < 3.4 ? 1 : 0;
        this.wheelGuns?.put(this.matrix, actuated, 0, 1);
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
        const gun = this.bikeTask.set('gun', wheel, phase, t, 0, hub.y, floor);
        this.person(
          id,
          'gun',
          wheel,
          gun.root.x,
          floor,
          gun.root.z,
          gun.yaw,
          clamp(hub.y - floor + 0.08, 0.2, 0.38),
          0.85,
          detail,
        );
        // Old wheel out (right) and new wheel in (left); the carried wheel is
        // the bike presentation's, at the same route centre.
        for (const install of [false, true]) {
          const task = this.bikeTask.set(
            install ? 'install' : 'remove',
            wheel,
            phase,
            t,
            0,
            hub.y,
            floor,
          );
          const side = install ? 1 : -1;
          const q = this.toolRotation.setFromAxisAngle(UP, task.yaw);
          for (let hand = 0; hand < 2; hand++) {
            // Both hands on the near sidewall, fore and aft of the top.
            const angle = (hand === 0 ? 1 : -1) * (1.15 - 0.25 * task.engagement);
            this.hand(
              hand,
              this.point.set(
                task.center.x + side * halfWidth,
                task.center.y + Math.cos(angle) * radius,
                task.center.z + Math.sin(angle) * radius,
              ),
              q,
            );
          }
          const workingHip = clamp(task.center.y - floor + 0.04, 0.24, 0.43);
          this.person(
            id,
            install ? 'install' : 'remove',
            wheel,
            task.root.x,
            floor,
            task.root.z,
            task.yaw,
            0.43 + (workingHip - 0.43) * task.engagement,
            0.35 + 0.5 * task.engagement,
            detail,
            0.11,
          );
        }
      }
      // Paddock stands: the operator pushes the handle down to lift, then
      // draws the lowered stand straight out along the bike's axis.
      for (const end of [-1, 1] as const) {
        const stand = pose.stand(end > 0 ? 'front' : 'rear');
        const q = this.toolRotation.setFromAxisAngle(UP, stand.yaw);
        for (let h = 0; h < 2; h++)
          this.hand(
            h,
            this.point.set((h ? 1 : -1) * (end > 0 ? -1 : 1) * 0.12, stand.grip.y, stand.grip.z),
            q,
          );
        this.standAxis.set(0, 0, end);
        this.standWithdrawal.height = pose.lift;
        this.footStand = this.standWithdrawal;
        this.jackFootRoot
          .makeRotationY(stand.yaw)
          .setPosition(0, floor, stand.operator.z - end * 0.6 * pose.withdraw);
        this.person(
          id,
          end > 0 ? 'front-jack' : 'rear-jack',
          -1,
          stand.operator.x,
          floor,
          stand.operator.z,
          stand.yaw,
          clamp(stand.grip.y - floor + 0.015, 0.28, 0.69),
          0.52,
          detail,
          0.14,
          this.jackFootRoot,
        );
        this.footStand = undefined;
      }
      const grip = pose.sign;
      const q = this.toolRotation.setFromAxisAngle(UP, -Math.PI / 2);
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
      this.person(
        id,
        'release',
        -1,
        pose.release.x,
        floor,
        pose.release.z,
        -Math.PI / 2,
        0.84,
        0.08,
        detail,
      );
    } finally {
      this.footRoute = this.footStand = undefined;
    }
    // Car tools a bike crew does not use keep the machinery batch complete.
    if (!this.wheelGuns) this.unused(this.guns, 2);
    if (!this.pitJacks) {
      this.unused(this.jacks, 2);
      this.unused(this.handles, 6);
    }
  }
  update(frame: Float32Array, camera: T.Vector3, visible = true, fov = 58, aspect = 16 / 9) {""")
open(p, 'w').write(s)
print('ok')
