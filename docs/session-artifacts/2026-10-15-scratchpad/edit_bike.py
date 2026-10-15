import sys
root = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/'


def edit(path, pairs):
    p = root + path
    s = open(p).read()
    for old, new in pairs:
        assert old in s, (path, old[:90])
        s = s.replace(old, new, 1)
    open(p, 'w').write(s)


edit('src/rendering/bike.ts', [
    ("""import { mudUniforms } from './offroad/mud.ts';
""", """import { mudUniforms } from './offroad/mud.ts';
import {
  BikeServicePose,
  BikeServiceRig,
  BikeWheelTask,
  bikeServiceGeometry,
  forkLocalOffset,
} from './bike-pit-service.ts';
import { pitServiceActive } from './pit-presentation.ts';
"""),
    ("""    this.steer.rotation.y = v.steer;
    this.forkLower.position.y = -(FORK_LENGTH + this.sag.fork - v.fork);
    this.frontSpin.rotation.x = v.frontRotation;
    this.rearSpin.rotation.x = v.rearRotation;
    this.spring.scale.y = T.MathUtils.clamp(1 - (v.shock - this.sag.shock) * 3, 0.6, 1.2);""",
     """    this.steer.rotation.y = v.steer;
    this.forkLower.position.y = -(FORK_LENGTH + this.sag.fork - v.fork);
    this.frontSpin.rotation.x = v.frontRotation;
    this.rearSpin.rotation.x = v.rearRotation;
    // Pit service: the rear wheel rolls back out of the swingarm and the
    // front drops out of the fork while the axles are drawn (bike-pit-service).
    this.rearWheel.position.copy(this.rearAxle);
    this.rearWheel.position.z -= v.rearWheelOut ?? 0;
    forkLocalOffset(
      this.scratch.set(0, -(v.frontWheelDrop ?? 0), 0),
      RAKE,
      v.steer,
      this.frontSpin.position,
    ).z += FORK_OFFSET;
    this.spring.scale.y = T.MathUtils.clamp(1 - (v.shock - this.sag.shock) * 3, 0.6, 1.2);"""),
    ("""  mud?: number;
  mudWet?: number;
}
interface Entry {
  definition: VehicleDefinition;
  materials: BikeMaterials;
  levels: (BikeModel | DirtBikeModel)[];
  level: number;
}""", """  mud?: number;
  mudWet?: number;
  /** Pit service (bike frame, m): rear wheel out of the swingarm (backwards)
   * and front wheel out of the fork (down), from the shared service pose. */
  rearWheelOut?: number;
  frontWheelDrop?: number;
}
interface Entry {
  definition: VehicleDefinition;
  materials: BikeMaterials;
  levels: (BikeModel | DirtBikeModel)[];
  level: number;
  /** Paddock stands and carried wheels, shown only during a pit service. */
  rig: BikeServiceRig;
}"""),
    ("""    for (const level of levels) this.install(level.root);
    return { definition, materials, levels, level: -1 };
  }
  private dispose(entry: Entry) {
    for (const level of entry.levels) {
      this.root.remove(level.root);
      if (level.rider.root.parent) level.rider.root.parent.remove(level.rider.root);
      level.dispose();
    }
    entry.materials.dispose();
  }""", """    for (const level of levels) this.install(level.root);
    const rig = new BikeServiceRig(bikeServiceGeometry(definition));
    this.root.add(rig.root);
    this.install(rig.root);
    return { definition, materials, levels, level: -1, rig };
  }
  private dispose(entry: Entry) {
    for (const level of entry.levels) {
      this.root.remove(level.root);
      if (level.rider.root.parent) level.rider.root.parent.remove(level.rider.root);
      level.dispose();
    }
    this.root.remove(entry.rig.root);
    entry.rig.dispose();
    entry.materials.dispose();
  }
  /** The service rig of entrant `id` (diagnostics and tests), if it is a bike. */
  serviceRig(id: number) {
    return this.entries.get(id)?.rig ?? null;
  }
  /** Shared service pose of a stopped bike from the discrete snapshot fields
   * the crew presentation reads (phase, service clock, stand lift); null when
   * the entrant is not in an active service. */
  private servicePose(frame: Float32Array, id: number, definition: VehicleDefinition) {
    const o = carBase(id),
      phase = frame[o + F.PIT_PHASE],
      clock = frame[o + F.PIT_CLOCK];
    if (!frame[o + F.IN_PIT] || !pitServiceActive(phase, clock, frame[o + F.SPEED])) return null;
    return this.service.set(bikeServiceGeometry(definition), phase, clock, frame[o + F.JACK_HEIGHT]);
  }"""),
    ("""  private readonly position = new T.Vector3();
  constructor() {
    this.root.name = 'Motorcycles (procedural)';
  }""", """  private readonly position = new T.Vector3();
  private readonly service = new BikeServicePose();
  private readonly serviceTask = new BikeWheelTask();
  private readonly lift = new T.Vector3();
  constructor() {
    this.root.name = 'Motorcycles (procedural)';
  }"""),
    ("""      const car = cars[id].root;
      car.visible = false;
      if (id >= b[H.CARS]) {
        for (const level of entry.levels) level.root.visible = false;
        continue;
      }""", """      const car = cars[id].root;
      car.visible = false;
      if (id >= b[H.CARS]) {
        for (const level of entry.levels) level.root.visible = false;
        entry.rig.update(null, this.serviceTask, car.position, car.quaternion);
        continue;
      }
      // Discrete service fields as the presented frame carries them.
      const service = this.servicePose(alpha < 1 ? a : b, id, definition);
      entry.rig.update(service, this.serviceTask, car.position, car.quaternion);
      this.values.rearWheelOut = service ? service.hubs[1].z - service.mounted[1].z : 0;
      this.values.frontWheelDrop = service ? service.hubs[0].y - service.mounted[0].y : 0;"""),
    ("""      const model = entry.levels[level];
      model.root.position.copy(car.position);
      model.root.quaternion.copy(car.quaternion);
      this.pose(model, a, b, alpha, id);""", """      const model = entry.levels[level];
      model.root.position.copy(car.position);
      model.root.quaternion.copy(car.quaternion);
      // On the stands the whole machine (and its seated rider) rises by the
      // recorded lift along its own up axis; the stands stay on the floor.
      if (service)
        model.root.position.add(this.lift.set(0, service.lift, 0).applyQuaternion(car.quaternion));
      this.pose(model, a, b, alpha, id);"""),
])
edit('src/rendering/offroad/dirt-bike-model.ts', [
    ("""    this.frontSpin.rotation.x = v.frontRotation;
    this.rearSpin.rotation.x = v.rearRotation;
    this.spring.scale.y = T.MathUtils.clamp(1 - (v.shock - this.sag.shock) * 2.2, 0.5, 1.2);""",
     """    this.frontSpin.rotation.x = v.frontRotation;
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
    this.spring.scale.y = T.MathUtils.clamp(1 - (v.shock - this.sag.shock) * 2.2, 0.5, 1.2);"""),
])
print('ok')
