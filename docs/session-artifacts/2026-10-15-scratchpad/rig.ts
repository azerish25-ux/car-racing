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
    return { tubes: this.tube, rollers: this.roller, spares: this.spares.filter((s) => s.visible).length };
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
      task.set(pose.phase < 4 ? 'install' : 'remove', wheel, pose.phase, pose.carClock, 0, 0, pose.floor);
      spare.visible = task.hasSpare;
      spare.position.copy(task.center);
    }
  }
  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

