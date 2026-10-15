p = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/bike-vehicle.ts'
s = open(p).read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b)


rep("""import { bikeParameters, chassisLean, isBike, type BikeSpec } from './bike-definitions.ts';""",
    """import {
  ENGINE_BRAKE_MAPS,
  bikeParameters,
  bikeSetupParameters,
  chassisLean,
  dampingFirmness,
  isBike,
  type BikeSpec,
} from './bike-definitions.ts';""")
rep("""    this.riderAids = bikeAssists(assist, id > 0);
    this.dynamics = new Bike(this.riderAids, bikeParameters(definition, this.body.mass));
    this.fitFrontRadius();
  }""", """    this.riderAids = bikeAssists(assist, id > 0);
    // The exposed setup (this.setup is setupFor the machine) shapes the core.
    this.dynamics = new Bike(
      this.riderAids,
      bikeSetupParameters(bikeParameters(definition, this.body.mass), definition, this.setup),
    );
    this.gearing = this.setup.gearing;
    this.engineBrake = ENGINE_BRAKE_MAPS[Math.min(3, Math.max(0, Math.round(this.setup.engineBrakeMap)))];
    this.forkFirmness = dampingFirmness(this.setup.frontDamping);
    this.shockFirmness = dampingFirmness(this.setup.rearDamping);
    this.fitFrontRadius();
  }
  /** Setup terms the adapter owns (bikeSetupParameters has the core's):
   * final-drive multiplier, closed-throttle engine braking share and the
   * fork/shock damping firmness (1 = calibrated). */
  readonly gearing: number;
  readonly engineBrake: number;
  protected readonly forkFirmness: number;
  protected readonly shockFirmness: number;""")
# shift prediction
rep("""      ((this.dynamics.speed / spec.wheelRadius) *
        spec.gearRatios[next + 1] *
        spec.finalDrive *
        30) /
      Math.PI;""", """      ((this.dynamics.speed / spec.wheelRadius) *
        spec.gearRatios[next + 1] *
        spec.finalDrive *
        this.gearing *
        30) /
      Math.PI;""")
rep("""    const ratio = spec.gearRatios[this.gear + 1] * spec.finalDrive,
      coupled = ((d.speed / spec.wheelRadius) * ratio * 30) / Math.PI;""", """    const ratio = spec.gearRatios[this.gear + 1] * spec.finalDrive * this.gearing,
      coupled = ((d.speed / spec.wheelRadius) * ratio * 30) / Math.PI;""")
rep("""    const current = spec.gearRatios[this.gear + 1] * spec.finalDrive,
      wheelRPM = ((d.speed / spec.wheelRadius) * current * 30) / Math.PI;""", """    const current = spec.gearRatios[this.gear + 1] * spec.finalDrive * this.gearing,
      wheelRPM = ((d.speed / spec.wheelRadius) * current * 30) / Math.PI;""")
# engine braking: closed throttle drag at the rear contact, after the core step (road bikes)
rep("""    if (was === 'riding' && d.state !== 'riding') this.separate();
    this.lastState = d.state;
    if (was === 'separated' && d.state === 'remount') this.planRemount(track);""", """    if (this.engineBrake > 0) this.applyEngineBraking(dt, throttle);
    if (was === 'riding' && d.state !== 'riding') this.separate();
    this.lastState = d.state;
    if (was === 'separated' && d.state === 'remount') this.planRemount(track);""")
# grip with damping over kerbs
rep("""    d.grip = Math.min(this.surfaceGrip(0), this.surfaceGrip(2));
    d.slope = Math.sin(this.roadPitch);
    // Rider: tuck on straights, hang off toward the corner.""", """    d.grip = Math.min(
      this.surfaceGrip(0) * this.bumpGrip(0, this.setup.frontDamping),
      this.surfaceGrip(2) * this.bumpGrip(2, this.setup.rearDamping),
    );
    d.slope = Math.sin(this.roadPitch);
    // Rider: tuck on straights, hang off toward the corner.""")
rep("""  /** Grip multiplier of a contact patch relative to a fresh dry slick. */""", """  /** Damping over kerbs: a firmer click skips over the strips (up to 6% less
   * grip on a kerb), a softer one follows them; exactly 1 at the calibrated
   * click and on every other surface. */
  protected bumpGrip(i: number, click: number) {
    return this.contacts[i].surface === SURFACE.KERB ? 1 - 0.06 * (click - 0.5) * 2 : 1;
  }
  /** Closed-throttle engine braking (engine-brake map > 0): drag torque at the
   * rear contact as a share of the wide-open torque at the current rpm,
   * through the engaged gear, held inside what the rear tyre can take. A
   * reduced-order term applied after the core step; map 0 free-wheels. */
  protected applyEngineBraking(dt: number, throttle: number) {
    const d = this.dynamics,
      spec = this.spec;
    if (!this.riding || throttle > 0.02 || d.speed < 3 || this.shiftClock > 0) return;
    const ratio = spec.gearRatios[this.gear + 1] * spec.finalDrive * this.gearing,
      torque = this.engineBrake * engineTorque(this.rpm, spec),
      force = Math.min(
        (torque * ratio) / spec.wheelRadius,
        0.5 * d.p.mu * d.grip * d.rearLoad,
      );
    d.speed = Math.max(0, d.speed - (force / d.mass) * dt);
  }
  /** Grip multiplier of a contact patch relative to a fresh dry slick. */""")
# suspension: preload and damping
rep("""    const forkTarget = riding
      ? clamp(d.frontLoad / spec.forkRate + kerb(0), 0, spec.forkTravel)
      : 0.02;
    const shockTarget = riding
      ? clamp(d.rearLoad / spec.shockRate + kerb(2), 0, spec.shockTravel)
      : 0.02;
    const k = 1 - Math.exp(-dt / 0.04);
    this.fork += (forkTarget - this.fork) * k;
    this.shock += (shockTarget - this.shock) * k;""", """    // Preload takes sag out of each end; damping sets how fast each follows
    // its load (firmer is slower, 40 ms at the calibrated click).
    const forkTarget = riding
      ? clamp(d.frontLoad / spec.forkRate + kerb(0) - this.setup.frontPreload, 0, spec.forkTravel)
      : 0.02;
    const shockTarget = riding
      ? clamp(d.rearLoad / spec.shockRate + kerb(2) - this.setup.rearPreload, 0, spec.shockTravel)
      : 0.02;
    this.fork += (forkTarget - this.fork) * (1 - Math.exp(-dt / (0.04 * this.forkFirmness)));
    this.shock += (shockTarget - this.shock) * (1 - Math.exp(-dt / (0.04 * this.shockFirmness)));""")
open(p, 'w').write(s)
print('ok')
