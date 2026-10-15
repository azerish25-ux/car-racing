import sys
p = sys.argv[1]
s = open(p).read()
END = '>>>>>>> claude/peaceful-einstein-dedc7t\n'

def resolve(head_start, text):
    global s
    i = s.index('<<<<<<< HEAD\n' + head_start)
    j = s.index(END, i) + len(END)
    s = s[:i] + text + s[j:]

resolve('    const dynamics = (this.dynamics', """    const dynamics = (this.physics = vehicleDynamics(definition));
    this.frontShare =
      definition.drivetrain === 'awd' ? (definition.driveline?.centre?.frontShare ?? 0.5) : null;
    // A catalogue power unit (spec.engine) carries its own clutch and inertia;
    // otherwise the engine block of the vehicle's dynamics (powertrain.ts).
    const engine = spec.engine;
    this.clutch = new FrictionClutch(
      spec.idleRPM,
      spec.wheelInertia * drivenInertiaFactor(this.frontShare),
      engine?.clutchCapacity ?? 760,
      engine?.inertia ?? dynamics.engine.inertia,
      engine?.engageRPM ?? spec.idleRPM,
    );
    this.diff = resolveDifferential(dynamics.differential, this.setup);
    this.hub = new HubSolver(
      resolveSuspension(
        dynamics.suspension,
        this.setup,
        dynamics.tyre.verticalStiffness,
        dynamics.tyre.verticalDamping,
        spec.travel,
      ),
    );
""")
resolve('        definition.tireGrip,\n        dynamics.tyre,\n', """        i < 2 ? definition.tireGrip : (definition.tireGripRear ?? definition.tireGrip),
        this.looseGrip,
        dynamics.tyre,
""")
resolve('        this.definition.tireGrip,\n        this.dynamics.tyre,\n', """        i < 2
          ? this.definition.tireGrip
          : (this.definition.tireGripRear ?? this.definition.tireGrip),
        this.looseGrip,
        this.physics.tyre,
""")
resolve('      // Traction control acts relative', """      // Traction control acts on the driven tyres (all four for AWD) relative
      // to their current peak slip (0.16 at the reference slick's 0.25), so it
      // holds the same margin on a wet or loose surface whose force peaks at a
      // smaller slip.
      const t = this.tires;
      let slip = 0,
        scale = 1.6;
      for (let i = 0; i < 4; i++) {
        if (this.frontShare === null && i !== this.drivenLeft && i !== this.drivenRight) continue;
        slip = Math.max(slip, t[i].slip);
        scale = Math.min(scale, slipScale(t[i]));
      }
      this.throttle /= 1 + Math.max(0, slip - 0.16 * scale) * 4.5;
""")
resolve('    const internalFriction = frictionTorque', """    // A catalogue power unit (spec.engine) carries its own friction and idle
    // governor ceiling; otherwise the dynamics engine block (powertrain.ts).
    const engine = spec.engine;
    const internalFriction = engine
      ? engine.frictionBase + shaft * engine.frictionPerRad
      : frictionTorque(engineDef, shaft);
    // Powered idle governor prevents unintended restart/stabilization without
    // fuel. It supplies real shaft torque rather than clamping engine RPM.
    const idleTorque =
      this.fuel > 0
        ? clamp(((spec.idleRPM * Math.PI) / 30 - shaft) * 3, 0, engine ? engine.idleTorque : 180)
        : 0;
    // Intake filling and turbo spool lag the pedal (powertrain.ts).
    this.engine.advance(engineDef, this.throttle, this.rpm, dt);
    let ice =
      this.fuel > 0
        ? combustionTorque(engineDef, spec, this.engine, this.rpm, shaft) + idleTorque
        : 0;
    const shifting = this.shiftClock > 0;
    if (shifting) ice *= 1 - dynamics.gearbox.shiftCut;
    if (this.rpm > spec.limiterRPM) ice = 0;
""")
resolve('      regenTorque = regenPower / Math.max(2 * rearOmega, 10);', """      regenTorque = regenPower / Math.max(2 * motorAxleOmega, 10);
    // A catalogue driveline (differential.ts: open/LSD/locked axles and an AWD
    // centre) distributes the drive; otherwise the driven-axle differential of
    // the vehicle's dynamics (the APX-01/TC-1 viscous axle, or an override).
    const driveline = this.definition.driveline;
    if (driveline) {
      for (let i = 0; i < 4; i++) this.wheelOmega[i] = this.tires[i].omega;
      distributeDrive(
        this.driveTorque,
        driveline,
        this.definition.drivetrain,
        wheelTorque,
        this.wheelOmega,
        spec.wheelInertia,
        dt,
        this.setup.diffPower,
        this.setup.diffCoast,
      );
      if (axleMotor) {
        this.driveTorque[0] += axleMotorTorque;
        this.driveTorque[1] += axleMotorTorque;
      }
    } else
      differentialTorques(
        this.diff,
        wheelTorque,
        this.input.throttle > 0.08,
        this.tires[this.drivenLeft].omega,
        this.tires[this.drivenRight].omega,
        this.tires[this.drivenLeft].inertia,
        this.tires[this.drivenRight].inertia,
        dt,
        this.diffOut,
        // Road reactions of the last step predict the tyres' share (−Fx·r).
        -this.tires[this.drivenLeft].fx * this.tires[this.drivenLeft].radius,
        -this.tires[this.drivenRight].fx * this.tires[this.drivenRight].radius,
      );
    const regenWheel = axleMotor ? 0 : 2;
    const hub = this.hub,
      tyreDef = dynamics.tyre;
""")
resolve('      const release =\n        this.assist', """      const release =
        this.assist === 'sport' ? 1 / (1 + Math.max(0, -t.slip - 0.14 * slipScale(t)) * 9) : 1;
      const regenerating = i >= regenWheel && i < regenWheel + 2;
      const friction =
        Math.max(0, total - (regenerating ? regenTorque : 0)) *
        brakeEfficiency(t.discTemp) *
        release;
      const driven = driveline
          ? this.driveTorque[i]
          : i === this.drivenLeft
            ? this.diffOut.first
            : i === this.drivenRight
              ? this.diffOut.second
              : 0,
        regen = regenerating ? regenTorque * release : 0;
""")
assert '<<<<<<<' not in s and '>>>>>>>' not in s and '\n=======\n' not in s
# Rename the dynamics field (BikeVehicle declares its own `dynamics`).
s = s.replace("""  /** Tyre, suspension, powertrain, differential and aero-platform blocks. */
  readonly dynamics: VehicleDynamics;""", """  /** Tyre, suspension, powertrain, differential and aero-platform blocks
   * (vehicle-dynamics.ts). Not `dynamics`: BikeVehicle uses that name. */
  readonly physics: VehicleDynamics;""")
s = s.replace('this.dynamics.', 'this.physics.').replace('dynamics = this.dynamics,', 'dynamics = this.physics,')
assert 'this.dynamics' not in s
open(p, 'w').write(s)
print('ok')
