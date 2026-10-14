import { RoadContactFrame } from './road-contact.ts';
import { SkidContact, SKID_CONTACT } from './skid-contact.ts';
import { MARSHAL } from './marshal.ts';
import { FrictionClutch } from './clutch.ts';
import { DebrisPool } from './damage.ts';
import { approach, clamp, G, lerp, Vec3 } from '../core/math.ts';
import { aero, type AeroForces } from './aero.ts';
import { DRS, OVERTAKE } from './drs.ts';
import { FORMULA_APX01, setupFor, type VehicleDefinition, type VehicleSpec } from './vehicles.ts';
import {
  controls,
  DEFAULT_SETUP,
  type Assist,
  type Compound,
  type Controls,
  type Setup,
} from './config.ts';
import { RigidBody } from './rigid.ts';
import { brakeEfficiency, makeTire, solveTire, type Tire } from './tire.ts';
import { surfaceSample, trackPoint, type Track } from './track.ts';
/** The Formula car's wheel centres (renderer/tests); entrants use their definition. */
export const WHEEL_POSITIONS = FORMULA_APX01.wheelPositions;
export function engineTorque(rpm: number, spec: VehicleSpec = FORMULA_APX01.spec) {
  const curve = spec.torqueCurve;
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++)
    if (rpm <= curve[i][0])
      return lerp(
        curve[i - 1][1],
        curve[i][1],
        (rpm - curve[i - 1][0]) / (curve[i][0] - curve[i - 1][0]),
      );
  return 0;
}
export class Vehicle {
  readonly body = new RigidBody();
  readonly input: Controls = controls();
  readonly tires: Tire[];
  readonly contacts = [0, 1, 2, 3].map(() => surfaceSample());
  readonly contactPoints = [0, 1, 2, 3].map(() => new Vec3());
  readonly hubs = [0, 1, 2, 3].map(() => new Vec3());
  readonly origins = [0, 1, 2, 3].map(() => new Vec3());
  readonly pointVelocities = [0, 1, 2, 3].map(() => new Vec3());
  readonly contactFrames = [0, 1, 2, 3].map(() => new RoadContactFrame());
  readonly skid = new SkidContact();
  readonly normalLoads = new Float64Array(4);
  /** Actual angles used by the tire solve, retained for telemetry and presentation. */
  readonly wheelSteering = new Float64Array(4);
  readonly wheelCamber = new Float64Array(4);
  readonly aero: AeroForces = { front: 0, rear: 0, floor: 0, drag: 0, wake: 0 };
  readonly localVelocity = new Vec3();
  readonly forward = new Vec3(0, 0, 1);
  readonly up = new Vec3(0, 1, 0);
  readonly setup: Setup;
  readonly trackPosition = trackPoint();
  fuel = 24;
  readonly spec: VehicleSpec;
  readonly wheelPositions: VehicleDefinition['wheelPositions'];
  battery: number;
  rpm: number;
  readonly clutch: FrictionClutch;
  /** Driven wheel pair (rear for rwd, front for fwd). */
  private readonly drivenLeft: number;
  private readonly drivenRight: number;
  engineOutputTorque = 0;
  gear = 1;
  shiftClock = 0;
  steer = 0;
  throttle = 0;
  brake = 0;
  speed = 0;
  s = 0;
  lateral = 0;
  wake = 0;
  frontHealth = 1;
  rearHealth = 1;
  floorHealth = 1;
  suspensionDamage = 0;
  readonly cornerDamage = new Float64Array(4);
  readonly debris = new DebrisPool();
  lostMass = 0;
  sidepodHealth = 1;
  jackHeight = 0;
  pitYielding = false;
  pitLastS = 0;
  frontRideHeight = 0;
  rearRideHeight = 0;
  private frontDetached = false;
  private rearDetached = false;
  motorPower = 0;
  regenerationPower = 0;
  impact = 0;
  bottomEnergy = 0;
  gLong = 0;
  gLat = 0;
  gVert = 0;
  autoShift = true;
  pitRequested = false;
  inPit = false;
  pitPhase = 0;
  pitClock = 0;
  pitStops = 0;
  nextCompound: Compound = 'medium';
  /** Every compound this car has run in the session (mandatory stop rule). */
  readonly compoundsUsed = new Set<Compound>();
  aiTarget = 0;
  aiOffset = 0;
  retired = false;
  finishTime = 0;
  /** DRS: open request this step (player key or AI), granted state, flap 0..1. */
  drsRequest = false;
  drsOpen = false;
  drsFlap = 0;
  /** Seconds left of the ERS overtake boost. */
  overtakeClock = 0;
  /** Seconds spent overturned (on its side or roof) and nearly stationary. */
  upsetClock = 0;
  private force = new Vec3();
  private point = new Vec3();
  private localPoint = new Vec3();
  private localAccel = new Vec3();
  private relativeAir = new Vec3();
  private surface = surfaceSample();
  private axis = new Vec3();
  private down = new Vec3(0, -1, 0);
  constructor(
    readonly id: number,
    compound: Compound = 'medium',
    setup: Setup = DEFAULT_SETUP,
    readonly assist: Assist = 'sport',
    readonly definition: VehicleDefinition = FORMULA_APX01,
  ) {
    const spec = (this.spec = definition.spec);
    this.wheelPositions = definition.wheelPositions;
    this.setup =
      definition === FORMULA_APX01 ? { ...setup } : setupFor(definition, setup, DEFAULT_SETUP);
    this.battery = spec.maxBatteryJ * 0.8;
    this.rpm = spec.idleRPM;
    this.clutch = new FrictionClutch(spec.idleRPM, spec.wheelInertia);
    this.body.inertia.set(spec.inertia[0], spec.inertia[1], spec.inertia[2]);
    this.body.mass = spec.dryMass + this.fuel;
    this.drivenLeft = definition.drivetrain === 'fwd' ? 0 : 2;
    this.drivenRight = this.drivenLeft + 1;
    this.tires = [0, 1, 2, 3].map((i) =>
      makeTire(
        compound,
        i < 2 ? this.setup.frontPressure : this.setup.rearPressure,
        spec.wheelRadius,
        spec.wheelInertia,
        definition.tireGrip,
      ),
    );
    this.compoundsUsed.add(compound);
    this.updateWheelAlignment();
  }
  place(track: Track, s: number, offset = 0) {
    track.at(s, this.trackPosition);
    const p = this.trackPosition;
    this.body.position.set(p.x + p.nx * offset, p.y + p.bank * offset + 0.516, p.z + p.nz * offset);
    this.body.orientation.yaw(Math.atan2(p.tx, p.tz));
    this.body.velocity.set(0, 0, 0);
    this.body.omega.set(0, 0, 0);
    this.s = s;
    this.pitLastS = s;
    this.lateral = offset;
  }
  replaceTires(compound: Compound) {
    this.compoundsUsed.add(compound);
    for (let i = 0; i < 4; i++)
      this.tires[i] = makeTire(
        compound,
        i < 2 ? this.setup.frontPressure : this.setup.rearPressure,
        this.spec.wheelRadius,
        this.spec.wheelInertia,
        this.definition.tireGrip,
      );
  }
  shift(direction: number) {
    if (this.shiftClock > 0) return;
    const spec = this.spec,
      next = clamp(this.gear + Math.sign(direction), -1, spec.gearRatios.length - 2),
      ratio = spec.gearRatios[next + 1] * spec.finalDrive,
      predicted = Math.abs(
        ((this.tires[this.drivenLeft].omega + this.tires[this.drivenRight].omega) *
          0.5 *
          ratio *
          60) /
          (Math.PI * 2),
      );
    if (predicted > spec.limiterRPM || (next < 0 && this.speed > 2)) return;
    this.gear = next;
    this.shiftClock = 0.09;
  }
  private updateWheelAlignment() {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1,
        toe = (i < 2 ? this.setup.frontToe : this.setup.rearToe) * side,
        ackermann =
          i < 2
            ? Math.atan(
                (this.spec.wheelbase * Math.tan(this.steer)) /
                  (this.spec.wheelbase - this.wheelPositions[i][0] * Math.tan(this.steer)),
              )
            : 0;
      this.wheelSteering[i] = ackermann + toe + this.cornerDamage[i] * 0.07 * side;
      this.wheelCamber[i] = (i < 2 ? this.setup.frontCamber : this.setup.rearCamber) * side;
    }
  }
  step(dt: number, track: Track) {
    const b = this.body,
      spec = this.spec;
    b.mass = spec.dryMass + this.fuel - this.lostMass;
    this.debris.step(dt, track);
    b.clear();
    b.force.y = -b.mass * G;
    b.orientation.inverseRotate(b.velocity, this.localVelocity);
    b.orientation.rotate(this.axis.set(0, 0, 1), this.forward);
    b.orientation.rotate(this.axis.set(0, 1, 0), this.up);
    this.speed = b.velocity.length();
    this.bottomEnergy = 0;
    this.lateral = track.nearest(b.position.x, b.position.z, this.trackPosition);
    this.s = this.trackPosition.s;
    const speedSteer = this.assist === 'sport' ? 1 / (1 + this.speed * 0.018) : 1;
    this.steer = approach(this.steer, this.input.steer * spec.maxSteer * speedSteer, 1.6 * dt);
    this.throttle = clamp(this.input.throttle, 0, 1);
    this.brake = clamp(this.input.brake, 0, 1);
    // The automatic limiter reduces requested power, never clamps body velocity.
    if (this.inPit && track.pitSpeedZone(this.s))
      this.throttle *= clamp((MARSHAL.pitSpeed - this.speed) / 0.8, 0, 1);
    if (this.retired) {
      this.throttle = 0;
      this.brake = 1;
    }
    if (this.assist === 'sport') {
      const slip = Math.max(this.tires[2].slip, this.tires[3].slip);
      this.throttle /= 1 + Math.max(0, slip - 0.16) * 4.5;
    }
    if (this.input.reverse && this.speed < 1.5) this.gear = -1;
    else if (!this.input.reverse && this.gear < 0 && this.speed < 1.5) this.gear = 1;
    if (this.input.shift) {
      this.shift(this.input.shift);
      this.input.shift = 0;
      this.autoShift = false;
    }
    this.shiftClock = Math.max(0, this.shiftClock - dt);
    // Driven-axle speed (the name is historical: rear for the rwd Formula car).
    const signedRearOmega =
      (this.tires[this.drivenLeft].omega + this.tires[this.drivenRight].omega) * 0.5;
    const rearOmega = Math.abs(signedRearOmega);
    this.rpm = Math.max(0, (this.clutch.engineOmega * 30) / Math.PI);
    if (this.autoShift && this.gear > 0 && !this.input.manualClutch) {
      // Wheel-coupled RPM excludes free-revving launch slip from shift decisions.
      const coupledRPM =
        (rearOmega * Math.abs(spec.gearRatios[this.gear + 1] * spec.finalDrive) * 30) / Math.PI;
      if (coupledRPM > spec.shiftRPM && this.gear < spec.gearRatios.length - 2) this.shift(1);
      else if (coupledRPM < spec.downshiftRPM && this.gear > 1) this.shift(-1);
    }
    const ratio = spec.gearRatios[this.gear + 1] * spec.finalDrive;
    const shaft = Math.max(0, this.clutch.engineOmega);
    const frictionTorque = 12 + shaft * 0.04;
    // Powered idle governor prevents unintended restart/stabilization without
    // fuel. It supplies real shaft torque rather than clamping engine RPM.
    const idleTorque =
      this.fuel > 0 ? clamp(((spec.idleRPM * Math.PI) / 30 - shaft) * 3, 0, 180) : 0;
    let ice = this.fuel > 0 ? engineTorque(this.rpm, spec) * this.throttle + idleTorque : 0;
    if (this.shiftClock > 0 || this.rpm > spec.limiterRPM) ice = 0;
    const deploy =
      this.overtakeClock > 0
        ? OVERTAKE.deploy
        : this.input.ers === 2
          ? 1
          : this.input.ers === 1
            ? 0.55
            : 0;
    this.overtakeClock = Math.max(0, this.overtakeClock - dt);
    if (!this.definition.drs) this.drsOpen = false;
    this.drsFlap = clamp(this.drsFlap + (this.drsOpen ? dt : -dt) / DRS.travel, 0, 1);
    const motorPower =
      this.gear > 0 && this.brake < 0.05 && this.shiftClock === 0 && shaft > 100
        ? Math.min(spec.motorPowerW * deploy * this.throttle, (this.battery * 0.94) / dt)
        : 0;
    const motor = motorPower / Math.max(shaft, 100);
    const drag = Math.min(
      frictionTorque,
      (Math.max(0, this.clutch.engineOmega) * this.clutch.inertia) / dt,
    );
    this.engineOutputTorque = ice;
    // Automatic anti-stall releases the clutch while braking below idle's
    // wheel-coupled speed. Otherwise the idle governor drives through a light
    // brake pedal until a hard-coded 3 m/s threshold. Manual clutch stays manual.
    const automaticStop =
      !this.input.manualClutch &&
      this.throttle < 0.02 &&
      (this.speed < 3 ||
        (this.brake > 0.02 && signedRearOmega * ratio < ((spec.idleRPM * Math.PI) / 30) * 0.9));
    const wheelTorque = this.clutch.step(
      dt,
      ice + motor - drag,
      signedRearOmega,
      ratio,
      this.input.clutch,
      !this.input.manualClutch,
      this.shiftClock > 0 || automaticStop,
    );
    this.rpm = Math.max(0, (this.clutch.engineOmega * 30) / Math.PI);
    this.motorPower = motorPower;
    this.battery = Math.max(0, this.battery - (motorPower * dt) / 0.94);
    this.fuel = Math.max(
      0,
      this.fuel - ((ice * shaft) / (0.43 * 43e6) + (this.fuel > 0 ? 0.00045 : 0)) * dt,
    );
    const rearFriction = spec.brakeTorque * (1 - this.setup.brakeBias) * this.brake * 0.5,
      regenPower = Math.min(
        spec.regenPowerW * this.brake,
        (spec.maxBatteryJ - this.battery) / dt,
        rearFriction * 2 * rearOmega * 0.65,
      ),
      regenTorque = regenPower / Math.max(2 * rearOmega, 10),
      diff = this.input.throttle > 0.08 ? this.setup.diffPower : this.setup.diffCoast,
      locking = clamp(
        (this.tires[this.drivenRight].omega - this.tires[this.drivenLeft].omega) * diff * 55,
        -1050,
        1050,
      );
    for (let i = 0; i < 4; i++) {
      const pos = this.wheelPositions[i],
        t = this.tires[i],
        origin = this.origins[i],
        hub = this.hubs[i],
        s = this.contacts[i];
      b.orientation.rotate(this.localPoint.set(pos[0], pos[1], pos[2]), origin).add(b.position);
      this.down.copy(this.up).scale(-1);
      const distance = track.cast(origin, this.down, 1.5, s);
      if (!Number.isFinite(distance)) track.sample(origin.x, origin.z, s);
      const rest =
          spec.restLength + (i < 2 ? this.setup.frontRide - 0.065 : this.setup.rearRide - 0.075),
        length =
          distance -
          (t.radius - t.flatSpot * 0.002 * (1 + Math.cos(t.rotation))) /
            Math.max(0.15, this.up.dot(s.normal));
      t.length = Math.min(rest + 0.05, Math.max(0.06, length));
      t.compression = Number.isFinite(length) ? Math.max(0, rest - length) : 0;
      hub.copy(origin).addScaled(this.up, -t.length);
      const contact = this.contactPoints[i];
      if (Number.isFinite(distance)) contact.copy(origin).addScaled(this.down, distance);
      else contact.set(hub.x, s.height, hub.z);
      b.pointVelocity(contact, this.pointVelocities[i]);
      const vertical = this.pointVelocities[i].dot(s.normal),
        spring = i < 2 ? this.setup.frontSpring : this.setup.rearSpring,
        damping = vertical < 0 ? 4800 : 6200,
        bump = Math.max(0, t.compression - 0.13);
      this.normalLoads[i] =
        length > rest + 0.05 || this.up.y < 0.25
          ? 0
          : Math.max(0, spring * t.compression - damping * vertical + 1.8e6 * bump * bump);
    }
    for (let axle = 0; axle < 2; axle++) {
      const i = axle * 2,
        antiRoll =
          (this.tires[i].compression - this.tires[i + 1].compression) *
          (axle === 0 ? this.setup.frontARB : this.setup.rearARB);
      this.normalLoads[i] = Math.max(0, this.normalLoads[i] + antiRoll);
      this.normalLoads[i + 1] = Math.max(0, this.normalLoads[i + 1] - antiRoll);
    }
    this.updateWheelAlignment();
    let generatorWorkW = 0;
    for (let i = 0; i < 4; i++) {
      this.normalLoads[i] *= 1 - this.cornerDamage[i] * 0.5;
      const t = this.tires[i],
        s = this.contacts[i];
      const basis = this.contactFrames[i];
      if (!basis.set(b.orientation, this.wheelSteering[i], s.normal)) this.normalLoads[i] = 0;
      const long = this.pointVelocities[i].dot(basis.forward),
        lat = this.pointVelocities[i].dot(basis.lateral),
        total =
          spec.brakeTorque *
          (i < 2 ? this.setup.brakeBias : 1 - this.setup.brakeBias) *
          this.brake *
          0.5;
      // ABS must release *both* sources of wheel braking. Leaving generator
      // torque untouched can keep a rear wheel locked while friction is released.
      const release = this.assist === 'sport' ? 1 / (1 + Math.max(0, -t.slip - 0.14) * 9) : 1;
      const friction =
        Math.max(0, total - (i >= 2 ? regenTorque : 0)) * brakeEfficiency(t.discTemp) * release;
      const driven =
          i === this.drivenLeft
            ? wheelTorque * 0.5 + locking
            : i === this.drivenRight
              ? wheelTorque * 0.5 - locking
              : 0,
        regen = i >= 2 ? regenTorque * release : 0;
      const previousPickup = t.marblePickup;
      solveTire(
        t,
        long,
        lat,
        this.normalLoads[i],
        driven,
        friction + regen,
        s,
        this.wheelCamber[i],
        dt,
        regen,
      );
      generatorWorkW += regen * Math.abs(t.omega);
      const rolling = Math.tanh(long * 2) * (s.resistance + (t.punctured ? 0.13 : 0)) * t.load;
      // Wheel load acts at the patch. Tread forces reach the sprung mass through
      // the suspension links, i.e. at the roll/pitch centre above the patch;
      // applying them at ground level overstated the overturning moment so a
      // full-lock corner rolled the car over before the tyres could slide.
      this.force.copy(s.normal).scale(t.load);
      b.apply(this.force, this.contactPoints[i]);
      this.force
        .set(0, 0, 0)
        .addScaled(basis.forward, t.fx - rolling)
        .addScaled(basis.lateral, t.fy);
      this.point.copy(this.contactPoints[i]).addScaled(this.up, spec.linkCentreHeight);
      b.apply(this.force, this.point);
      track.interact(
        s.cell,
        t.load,
        t.energy,
        this.speed,
        dt,
        s.surface,
        t.marblePickup - previousPickup,
      );
    }
    // Actual generator work is limited by the requested power and battery
    // headroom, even if angular speed changed during the implicit wheel solve.
    const recovered = Math.min(
      spec.maxBatteryJ - this.battery,
      regenPower * 0.78 * dt,
      generatorWorkW * 0.78 * dt,
    );
    this.battery += recovered;
    this.regenerationPower = recovered / dt;
    this.relativeAir.copy(b.velocity);
    this.relativeAir.x -= track.windX;
    this.relativeAir.z -= track.windZ;
    const airspeed = this.relativeAir.length();
    // Clearance is measured at actual floor stations, including chassis pitch
    // and local road elevation/bank. CG height alone misses nose dive and rake.
    const bodyAero = this.definition.aero;
    const frontHeight = this.floorClearance(track, bodyAero.frontZ);
    const rearHeight = this.floorClearance(track, bodyAero.rearZ);
    this.frontRideHeight = frontHeight;
    this.rearRideHeight = rearHeight;
    aero(
      airspeed,
      this.setup,
      frontHeight,
      rearHeight,
      this.frontHealth,
      this.rearHealth,
      this.floorHealth,
      this.wake,
      Math.atan2(this.localVelocity.x, Math.abs(this.localVelocity.z) + 1),
      this.aero,
      this.drsFlap,
      this.definition === FORMULA_APX01 ? undefined : bodyAero,
      spec.wheelbase,
    );
    this.force.copy(this.up).scale(-this.aero.front);
    b.orientation.rotate(this.localPoint.set(0, 0, bodyAero.frontZ), this.point).add(b.position);
    b.apply(this.force, this.point);
    this.force.copy(this.up).scale(-this.aero.rear);
    b.orientation.rotate(this.localPoint.set(0, 0, bodyAero.rearZ), this.point).add(b.position);
    b.apply(this.force, this.point);
    this.force.copy(this.up).scale(-this.aero.floor);
    b.apply(this.force, b.position);
    if (airspeed > 0.01) b.force.addScaled(this.relativeAir, -this.aero.drag / airspeed);
    track.sample(b.position.x, b.position.z, this.surface);
    this.bottomEnergy = this.skid.apply(b, track, dt);
    // Abrasion cannot repair a floor already damaged below the wear limit.
    this.floorHealth = Math.max(
      Math.min(0.25, this.floorHealth),
      this.floorHealth - (this.bottomEnergy * dt) / SKID_CONTACT.wearWorkJ,
    );
    // Wheels are installed/tightened before phase 5. Lower during the existing
    // repair/clearance window, not after safePitRelease has enabled departure.
    // The 5.2-second service minimum and actual tyre replacement are unchanged.
    const jackTarget = this.pitPhase >= 3 && this.pitPhase <= 4 ? 0.19 : 0;
    this.jackHeight = approach(this.jackHeight, jackTarget, dt * 0.16);
    if (this.jackHeight > 0) {
      // Four feet provide a finite support polygon. Tangential Coulomb contact
      // stops the raised chassis sliding on sloped asphalt without fixing pose.
      const st = this.definition.stations;
      for (const z of st.jackZ)
        for (const x of [-st.jackX, st.jackX]) {
          b.orientation.rotate(this.localPoint.set(x, st.floorY, z), this.point).add(b.position);
          track.sample(this.point.x, this.point.z, this.surface);
          const penetration = this.surface.height + this.jackHeight - this.point.y;
          if (penetration > 0) {
            b.pointVelocity(this.point, this.force);
            const load = Math.max(0, 140000 * penetration - 4000 * this.force.y);
            this.axis
              .copy(this.force)
              .addScaled(this.surface.normal, -this.force.dot(this.surface.normal));
            const speed = this.axis.length();
            this.force.set(0, load, 0);
            if (speed > 1e-7) {
              const friction = Math.min(0.75 * load, (speed * b.mass) / (4 * dt));
              this.force.addScaled(this.axis, -friction / speed);
            }
            b.apply(this.force, this.point);
          }
        }
    }
    b.integrate(dt);
    b.orientation.inverseRotate(b.acceleration, this.localAccel);
    this.gLong = this.localAccel.z / G;
    this.gLat = this.localAccel.x / G;
    this.gVert = this.localAccel.y / G;
    this.impact = Math.max(0, this.impact - dt * 2);
    if (b.position.y < this.surface.height - 4) this.retired = true;
  }
  /** Marshal recovery: an overturned, almost stationary car cannot drive
   * itself out, so after a short hold it is righted on the nearest part of the
   * circuit, wheels down and at rest. Returns true when it was recovered. */
  recoverIfUpset(dt: number, track: Track) {
    if (this.retired || this.up.y > 0.35 || this.speed > 8) {
      this.upsetClock = 0;
      return false;
    }
    this.upsetClock += dt;
    if (this.upsetClock < 1.5) return false;
    const p = this.trackPosition;
    track.nearest(this.body.position.x, this.body.position.z, p);
    const half = Math.max(0, p.width - 1.2);
    this.place(track, p.s, clamp(this.lateral, -half, half));
    for (const t of this.tires) t.omega = 0;
    this.up.set(0, 1, 0);
    this.upsetClock = 0;
    return true;
  }
  floorClearance(track: Track, z: number) {
    this.body.orientation
      .rotate(this.localPoint.set(0, this.definition.stations.floorY, z), this.point)
      .add(this.body.position);
    track.sample(this.point.x, this.point.z, this.surface);
    return (this.point.y - this.surface.height) * this.surface.normal.y;
  }
  impactAt(energy: number, point: Vec3) {
    if (!Number.isFinite(energy) || energy < 0) throw new Error('Invalid impact energy');
    this.localPoint.copy(point).sub(this.body.position);
    this.body.orientation.inverseRotate(this.localPoint, this.localPoint);
    const local = this.localPoint;
    const loss = clamp(energy / 150000, 0, 1);
    const st = this.definition.stations;
    if (local.z > st.damageZ) this.frontHealth = Math.max(0, this.frontHealth - loss);
    else if (local.z < -st.damageZ) this.rearHealth = Math.max(0, this.rearHealth - loss * 0.7);
    else this.sidepodHealth = Math.max(0, this.sidepodHealth - loss * 0.8);
    if (local.y < -0.2) this.floorHealth = Math.max(0.1, this.floorHealth - loss * 0.5);
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheelPositions[i];
      if (Math.hypot(local.x - wheel[0], local.z - wheel[2]) < 0.85) {
        this.cornerDamage[i] = clamp(this.cornerDamage[i] + energy / 90000, 0, 1);
        if (energy > 45000) this.tires[i].punctured = true;
      }
    }
    this.suspensionDamage = Math.max(...this.cornerDamage);
    this.impact = Math.max(this.impact, Math.min(1, energy / 30000));
    // Wing detachment transfers its inherited momentum into a physical fragment.
    if (this.frontHealth < 0.08 && !this.frontDetached) this.detach(1, ...st.frontElement);
    if (this.rearHealth < 0.08 && !this.rearDetached) this.detach(2, ...st.rearElement);
  }
  repairFrontWing(dt: number) {
    this.frontHealth = Math.min(1, this.frontHealth + dt * 0.3);
    if (this.frontDetached && this.frontHealth > 0.08) {
      this.lostMass = Math.max(0, this.lostMass - this.definition.stations.frontElement[1]);
      this.frontDetached = false;
    }
  }
  private detach(kind: number, z: number, mass: number) {
    if (kind === 1) this.frontDetached = true;
    if (kind === 2) this.rearDetached = true;
    this.body.orientation
      .rotate(this.localPoint.set(0, 0.1, z), this.point)
      .add(this.body.position);
    this.body.pointVelocity(this.point, this.force);
    this.debris.emit(kind, this.point, this.force, mass, this.body.omega.x + this.body.omega.z);
    this.lostMass += mass;
  }
  damage(energy: number, front: boolean) {
    this.body.orientation
      .rotate(
        this.point.set(
          0,
          0,
          front
            ? this.definition.stations.frontElement[0]
            : this.definition.stations.rearElement[0],
        ),
        this.point,
      )
      .add(this.body.position);
    this.impactAt(energy, this.point);
  }
}
