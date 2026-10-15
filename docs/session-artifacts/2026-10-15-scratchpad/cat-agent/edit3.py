import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')


def rep(p, old, new, count=1):
    s = open(p).read()
    assert s.count(old) == count, (p, old, s.count(old))
    s = s.replace(old, new)
    open(p, 'w').write(s)


rep('src/simulation/clutch.ts', """    private readonly wheelInertia: number = VEHICLE.wheelInertia,""",
    """    /** Driven-side inertia per wheel (kg m²) the clutch synchronizes. */
    public wheelInertia: number = VEHICLE.wheelInertia,""")
v = 'src/simulation/vehicle.ts'
rep(v, """    // A power unit may refer part of the road-coupled vehicle inertia to its
    // clutch (EngineSpec.clutchCoupling): a light, low-inertia engine driving
    // gripping tyres through a tall reduction otherwise slips a locked clutch.
    const drivenWheels = definition.drivetrain === 'awd' ? 4 : 2,
      coupledInertia =
        spec.wheelInertia +
        ((spec.engine?.clutchCoupling ?? 0) *
          (spec.dryMass + (definition.fuelLoad ?? 24)) *
          spec.wheelRadius ** 2) /
          drivenWheels;
    this.clutch = spec.engine
      ? new FrictionClutch(
          spec.idleRPM,
          coupledInertia * drivenInertiaFactor(this.frontShare),""",
    """    this.clutch = spec.engine
      ? new FrictionClutch(
          spec.idleRPM,
          spec.wheelInertia * drivenInertiaFactor(this.frontShare),""")
rep(v, """    const wheelTorque = this.clutch.step(""", """    if (spec.engine?.clutchCoupling) this.coupleClutch(spec.engine.clutchCoupling);
    const wheelTorque = this.clutch.step(""")
rep(v, """  /** Gearbox output speed: driven-axle mean, or the AWD centre carrier. */""",
    """  /** A gripping tyre ties its wheel to the vehicle: refer that share of the
   * vehicle's inertia to the clutch while the driven tyres grip, the wheel's
   * own while they spin (EngineSpec.clutchCoupling). Without it a light,
   * low-inertia engine through a tall reduction slips a locked clutch. */
  private coupleClutch(share: number) {
    const t = this.tires,
      slip =
        this.frontShare === null
          ? Math.max(Math.abs(t[this.drivenLeft].slip), Math.abs(t[this.drivenRight].slip))
          : Math.max(...t.map((x) => Math.abs(x.slip))),
      grip = clamp(1 - slip / 0.12, 0, 1),
      wheels = this.frontShare === null ? 2 : 4,
      vehicle = (this.body.mass * this.spec.wheelRadius ** 2) / wheels;
    this.clutch.wheelInertia =
      (this.spec.wheelInertia + share * grip * vehicle) * drivenInertiaFactor(this.frontShare);
  }
  /** Gearbox output speed: driven-axle mean, or the AWD centre carrier. */""")
rep('src/simulation/vehicles.ts', """  /** Share (0-1) of the road-coupled vehicle inertia the clutch synchronizes
   * against besides the wheels; absent: 0 (wheels only, as the Formula car). */""",
    """  /** Share (0-1) of the road-coupled vehicle inertia the clutch synchronizes
   * against while the driven tyres grip; absent: 0 (wheels only, as the
   * Formula car). */""")
