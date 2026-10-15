import sys
p = sys.argv[1]
s = open(p).read()

def rep(old, new):
    global s
    assert old in s, old[:120]
    s = s.replace(old, new)

rep("""import { aero, type AeroForces } from './aero.ts';""",
"""import { aero, floorCentre, lagHeight, plungeDamping, type AeroForces } from './aero.ts';
import { differentialOutput, differentialTorques, resolveDifferential } from './differential.ts';
import { combustionTorque, curveTorque, EngineState, frictionTorque } from './powertrain.ts';
import {
  geometricLoad,
  HubSolver,
  kinematicCamber,
  resolveSuspension,
  roadInclination,
} from './suspension.ts';
import { vehicleDynamics, type VehicleDynamics } from './vehicle-dynamics.ts';""")

old_et = s[s.index("export function engineTorque("):s.index("export class Vehicle {")]
s = s.replace(old_et, """export function engineTorque(rpm: number, spec: VehicleSpec = FORMULA_APX01.spec) {
  return curveTorque(rpm, spec);
}
/** Largest internal integration step (s): a longer step call is split into
 * equal substeps, so stiff contact, tyre and suspension modes see at most
 * this step whatever the caller's rate (60/120/240 Hz give the same physics). */
export const MAX_SUBSTEP = 1 / 240;
""")
rep("import { approach, clamp, G, lerp, Vec3 } from '../core/math.ts';",
    "import { approach, clamp, G, Vec3 } from '../core/math.ts';")

rep("""  readonly clutch: FrictionClutch;
  /** Driven wheel pair (rear for rwd, front for fwd). */""",
"""  readonly clutch: FrictionClutch;
  /** Tyre, suspension, powertrain, differential and aero-platform blocks. */
  readonly dynamics: VehicleDynamics;
  /** Massless-hub suspension state (hub travel per corner). */
  readonly hub: HubSolver;
  /** Intake and turbo state of the engine. */
  readonly engine = new EngineState();
  /** Geometric (link) load transfer per corner from the last tread forces (N). */
  readonly jacking = new Float64Array(4);
  /** Slipstream (tow) fraction behind another car this step (drag only). */
  slipstream = 0;
  private readonly diff;
  private readonly diffOut = differentialOutput();
  /** Lagged floor clearances seen by the underbody flow (m). */
  private aeroFront = NaN;
  private aeroRear = NaN;
  private lateralAxis = new Vec3(1, 0, 0);
  /** Driven wheel pair (rear for rwd, front for fwd). */""")

rep("""    this.battery = spec.maxBatteryJ * 0.8;
    this.rpm = spec.idleRPM;
    this.clutch = new FrictionClutch(spec.idleRPM, spec.wheelInertia);""",
"""    this.battery = spec.maxBatteryJ * 0.8;
    this.rpm = spec.idleRPM;
    const dynamics = (this.dynamics = vehicleDynamics(definition));
    this.clutch = new FrictionClutch(spec.idleRPM, spec.wheelInertia, dynamics.engine.inertia);
    this.diff = resolveDifferential(dynamics.differential, this.setup);
    this.hub = new HubSolver(
      resolveSuspension(
        dynamics.suspension,
        this.setup,
        dynamics.tyre.verticalStiffness,
        dynamics.tyre.verticalDamping,
        spec.travel,
      ),
    );""")

rep("""        spec.wheelRadius,
        spec.wheelInertia,
        definition.tireGrip,
      ),
    );
    this.compoundsUsed.add(compound);""",
"""        spec.wheelRadius,
        spec.wheelInertia,
        definition.tireGrip,
        dynamics.tyre,
      ),
    );
    this.compoundsUsed.add(compound);""")

rep("""        this.spec.wheelRadius,
        this.spec.wheelInertia,
        this.definition.tireGrip,
      );
  }""",
"""        this.spec.wheelRadius,
        this.spec.wheelInertia,
        this.definition.tireGrip,
        this.dynamics.tyre,
      );
  }""")

rep("""    this.s = s;
    this.pitLastS = s;
    this.lateral = offset;
  }""",
"""    this.s = s;
    this.pitLastS = s;
    this.lateral = offset;
    this.hub.reset();
    this.jacking.fill(0);
    this.aeroFront = this.aeroRear = NaN;
  }""")

rep("""    this.gear = next;
    this.shiftClock = 0.09;""",
"""    this.gear = next;
    this.shiftClock = this.dynamics.gearbox.shiftTime;""")

old_al = s[s.index("  private updateWheelAlignment() {"):s.index("  step(dt: number, track: Track) {")]
s = s.replace(old_al, """  /** Ackermann, toe, damage and kinematic camber (static + gain in bump),
   * relative to the chassis; the tyre adds the chassis roll to the road. */
  private updateWheelAlignment() {
    const suspension = this.dynamics.suspension;
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1,
        axle = i < 2 ? suspension.front : suspension.rear,
        travel = this.hub.travel[i],
        toe = ((i < 2 ? this.setup.frontToe : this.setup.rearToe) + axle.bumpSteer * travel) * side,
        ackermann =
          i < 2
            ? Math.atan(
                (this.spec.wheelbase * Math.tan(this.steer)) /
                  (this.spec.wheelbase - this.wheelPositions[i][0] * Math.tan(this.steer)),
              )
            : 0;
      this.wheelSteering[i] = ackermann + toe + this.cornerDamage[i] * 0.07 * side;
      this.wheelCamber[i] = kinematicCamber(
        i < 2 ? this.setup.frontCamber : this.setup.rearCamber,
        axle.camberGain,
        travel,
        side,
      );
    }
  }
""")

rep("""  step(dt: number, track: Track) {
    const b = this.body,
      spec = this.spec;""",
"""  step(dt: number, track: Track) {
    if (!Number.isFinite(dt) || dt <= 0) throw new Error('Invalid vehicle timestep');
    const count = dt <= MAX_SUBSTEP * (1 + 1e-9) ? 1 : Math.ceil(dt / MAX_SUBSTEP - 1e-9);
    for (let k = 0; k < count; k++) this.integrate(dt / count, track);
  }
  private integrate(dt: number, track: Track) {
    const b = this.body,
      spec = this.spec,
      dynamics = this.dynamics,
      engineDef = dynamics.engine;""")

rep("""    const ratio = spec.gearRatios[this.gear + 1] * spec.finalDrive;
    const shaft = Math.max(0, this.clutch.engineOmega);
    const frictionTorque = 12 + shaft * 0.04;
    // Powered idle governor prevents unintended restart/stabilization without
    // fuel. It supplies real shaft torque rather than clamping engine RPM.
    const idleTorque =
      this.fuel > 0 ? clamp(((spec.idleRPM * Math.PI) / 30 - shaft) * 3, 0, 180) : 0;
    let ice = this.fuel > 0 ? engineTorque(this.rpm, spec) * this.throttle + idleTorque : 0;
    if (this.shiftClock > 0 || this.rpm > spec.limiterRPM) ice = 0;""",
"""    const ratio = spec.gearRatios[this.gear + 1] * spec.finalDrive;
    const shaft = Math.max(0, this.clutch.engineOmega);
    const internalFriction = frictionTorque(engineDef, shaft);
    // Powered idle governor prevents unintended restart/stabilization without
    // fuel. It supplies real shaft torque rather than clamping engine RPM.
    const idleTorque =
      this.fuel > 0 ? clamp(((spec.idleRPM * Math.PI) / 30 - shaft) * 3, 0, 180) : 0;
    // Intake filling and turbo spool lag the pedal (powertrain.ts).
    this.engine.advance(engineDef, this.throttle, this.rpm, dt);
    let ice =
      this.fuel > 0
        ? combustionTorque(engineDef, spec, this.engine, this.rpm, shaft) + idleTorque
        : 0;
    const shifting = this.shiftClock > 0;
    if (shifting) ice *= 1 - dynamics.gearbox.shiftCut;
    if (this.rpm > spec.limiterRPM) ice = 0;""")

rep("""    const drag = Math.min(
      frictionTorque,
      (Math.max(0, this.clutch.engineOmega) * this.clutch.inertia) / dt,
    );""",
"""    const drag = Math.min(
      internalFriction,
      (Math.max(0, this.clutch.engineOmega) * this.clutch.inertia) / dt,
    );""")

rep("""      !this.input.manualClutch,
      this.shiftClock > 0 || automaticStop,
    );""",
"""      !this.input.manualClutch,
      (shifting && dynamics.gearbox.shiftCut > 0) || automaticStop,
    );""")

rep("""      this.fuel - ((ice * shaft) / (0.43 * 43e6) + (this.fuel > 0 ? 0.00045 : 0)) * dt,""",
"""      this.fuel - ((Math.max(0, ice) * shaft) / (0.43 * 43e6) + (this.fuel > 0 ? 0.00045 : 0)) * dt,""")

rep("""      regenTorque = regenPower / Math.max(2 * rearOmega, 10),
      diff = this.input.throttle > 0.08 ? this.setup.diffPower : this.setup.diffCoast,
      locking = clamp(
        (this.tires[this.drivenRight].omega - this.tires[this.drivenLeft].omega) * diff * 55,
        -1050,
        1050,
      );""",
"""      regenTorque = regenPower / Math.max(2 * rearOmega, 10);
    // Driven-axle differential (differential.ts): open/locked/viscous/LSD.
    const split = differentialTorques(
      this.diff,
      wheelTorque,
      this.input.throttle > 0.08,
      this.tires[this.drivenLeft].omega,
      this.tires[this.drivenRight].omega,
      this.tires[this.drivenLeft].inertia,
      this.tires[this.drivenRight].inertia,
      dt,
      this.diffOut,
    );""")

old_s = s[s.index("    for (let i = 0; i < 4; i++) {\n      const pos = this.wheelPositions[i],"):s.index("    this.updateWheelAlignment();\n    let generatorWorkW = 0;")]
s = s.replace(old_s, """    const hub = this.hub,
      tyreDef = dynamics.tyre;
    for (let i = 0; i < 4; i++) {
      const pos = this.wheelPositions[i],
        t = this.tires[i],
        origin = this.origins[i],
        s = this.contacts[i];
      b.orientation.rotate(this.localPoint.set(pos[0], pos[1], pos[2]), origin).add(b.position);
      this.down.copy(this.up).scale(-1);
      const distance = track.cast(origin, this.down, 1.5, s);
      if (!Number.isFinite(distance)) track.sample(origin.x, origin.z, s, origin.y);
      const cosine = Math.max(0.15, this.up.dot(s.normal)),
        rest =
          spec.restLength + (i < 2 ? this.setup.frontRide - 0.065 : this.setup.rearRide - 0.075),
        // Deformable ground sits lower by the tyre's sinkage (surface-material.ts).
        length =
          distance +
          t.sinkage / cosine -
          (t.radius - t.flatSpot * 0.002 * (1 + Math.cos(t.rotation))) / cosine;
      const contact = this.contactPoints[i];
      if (Number.isFinite(distance)) contact.copy(origin).addScaled(this.down, distance);
      else contact.set(origin.x, s.height, origin.z);
      b.pointVelocity(contact, this.pointVelocities[i]);
      const compression = Number.isFinite(length) ? rest - length : -1;
      // Radial tyre stiffness rises with inflation pressure; a flat carcass is soft.
      const dp = (t.pressure - tyreDef.nominalPressure) / tyreDef.nominalPressure;
      hub.tyreRate[i] =
        tyreDef.verticalStiffness *
        clamp(1 + tyreDef.verticalPressureGain * dp, 0.5, 1.6) *
        (t.punctured ? 0.25 : 1);
      hub.compression[i] = compression;
      hub.rate[i] = -this.pointVelocities[i].dot(s.normal);
      hub.contact[i] = compression > 0 && this.up.y >= 0.25 ? 1 : 0;
      this.lengthScratch[i] = length;
      this.restScratch[i] = rest;
    }
    // Implicit massless-hub solve: springs, stops, dampers, bars, tyre radial.
    hub.solve(dt);
    for (let i = 0; i < 4; i++) {
      const t = this.tires[i],
        travel = hub.travel[i],
        rest = this.restScratch[i];
      t.compression = Math.max(0, travel);
      t.deflection = hub.contact[i] ? Math.max(0, hub.compression[i] - travel) : 0;
      t.length = hub.contact[i]
        ? rest - travel
        : Math.min(rest + 0.05, Math.max(0.06, this.lengthScratch[i]));
      this.hubs[i].copy(this.origins[i]).addScaled(this.up, -t.length);
      this.normalLoads[i] = hub.tyreForce[i];
    }
""")



rep("""    this.updateWheelAlignment();
    let generatorWorkW = 0;
    for (let i = 0; i < 4; i++) {
      this.normalLoads[i] *= 1 - this.cornerDamage[i] * 0.5;""",
"""    this.updateWheelAlignment();
    b.orientation.rotate(this.axis.set(1, 0, 0), this.lateralAxis);
    let generatorWorkW = 0;
    for (let i = 0; i < 4; i++) {
      // Spring share plus the geometric (link) share of load transfer.
      this.normalLoads[i] = hub.contact[i]
        ? Math.max(0, this.normalLoads[i] + this.jacking[i]) * (1 - this.cornerDamage[i] * 0.5)
        : 0;""")

rep("""      const driven =
          i === this.drivenLeft
            ? wheelTorque * 0.5 + locking
            : i === this.drivenRight
              ? wheelTorque * 0.5 - locking
              : 0,
        regen = i >= 2 ? regenTorque * release : 0;""",
"""      const driven = i === this.drivenLeft ? split.first : i === this.drivenRight ? split.second : 0,
        regen = i >= 2 ? regenTorque * release : 0;""")

rep("""        s,
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
      b.apply(this.force, this.point);""",
"""        s,
        roadInclination(this.wheelCamber[i], this.lateralAxis.dot(s.normal)),
        dt,
        regen,
        track.ambient,
      );
      generatorWorkW += regen * Math.abs(t.omega);
      const rolling =
        Math.tanh(long * 2) *
        ((t.rolling + (t.punctured ? 0.13 : 0)) * t.load + t.groundDrag);
      // Wheel load and tread force act at the patch. The links carry the
      // geometric share of load transfer straight into the tyre (roll centre,
      // anti-dive/squat: suspension.ts), so the spring-borne overturning moment
      // matches the former link-centre application and a full-lock corner
      // still slides rather than rolling the car over.
      this.force.copy(s.normal).scale(t.load);
      b.apply(this.force, this.contactPoints[i]);
      this.force
        .set(0, 0, 0)
        .addScaled(basis.forward, t.fx - rolling)
        .addScaled(basis.lateral, t.fy);
      b.apply(this.force, this.contactPoints[i]);
      const axle = i < 2 ? dynamics.suspension.front : dynamics.suspension.rear;
      this.jacking[i] =
        t.load > 0
          ? geometricLoad(
              axle,
              this.wheelPositions[i][0],
              this.wheelPositions[i][2],
              t.fx,
              t.fy,
              (hub.travel[i & 2] + hub.travel[(i & 2) + 1]) * 0.5,
            )
          : 0;""")

rep("""    const bodyAero = this.definition.aero;
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
    b.apply(this.force, b.position);""",
"""    const bodyAero = this.definition.aero,
      platform = dynamics.aero;
    const frontHeight = this.floorClearance(track, bodyAero.frontZ);
    const rearHeight = this.floorClearance(track, bodyAero.rearZ);
    this.frontRideHeight = frontHeight;
    this.rearRideHeight = rearHeight;
    // The underbody flow adapts over a convective time length/V.
    this.aeroFront = Number.isFinite(this.aeroFront)
      ? lagHeight(this.aeroFront, frontHeight, airspeed, platform.lagLength, dt)
      : frontHeight;
    this.aeroRear = Number.isFinite(this.aeroRear)
      ? lagHeight(this.aeroRear, rearHeight, airspeed, platform.lagLength, dt)
      : rearHeight;
    aero(
      airspeed,
      this.setup,
      this.aeroFront,
      this.aeroRear,
      this.frontHealth,
      this.rearHealth,
      this.floorHealth,
      this.wake,
      Math.atan2(this.localVelocity.x, Math.abs(this.localVelocity.z) + 1),
      this.aero,
      this.drsFlap,
      this.definition === FORMULA_APX01 ? undefined : bodyAero,
      spec.wheelbase,
      this.slipstream,
    );
    for (let axle = 0; axle < 2; axle++) {
      const z = axle === 0 ? bodyAero.frontZ : bodyAero.rearZ;
      b.orientation.rotate(this.localPoint.set(0, 0, z), this.point).add(b.position);
      // Quasi-steady plunge damping of the heaving wing/floor at this station.
      b.pointVelocity(this.point, this.force);
      const damping = plungeDamping(airspeed, this.force.dot(this.up), platform.plungeArea);
      this.force.copy(this.up).scale(-(axle === 0 ? this.aero.front : this.aero.rear) + damping);
      b.apply(this.force, this.point);
    }
    // Floor load acts at its attitude-dependent centre of pressure.
    const pitch = Math.atan2(this.aeroFront - this.aeroRear, bodyAero.frontZ - bodyAero.rearZ);
    this.force.copy(this.up).scale(-this.aero.floor);
    b.orientation
      .rotate(
        this.localPoint.set(
          0,
          0,
          floorCentre(platform, pitch, (this.aeroFront + this.aeroRear) * 0.5),
        ),
        this.point,
      )
      .add(b.position);
    b.apply(this.force, this.point);""")

rep("""  private force = new Vec3();
  private point = new Vec3();""",
"""  private force = new Vec3();
  private point = new Vec3();
  private lengthScratch = new Float64Array(4);
  private restScratch = new Float64Array(4);""")
open(p, 'w').write(s)
print("ok")
