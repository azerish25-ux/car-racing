import { approach, clamp, G, lerp, mod, Quat, Vec3 } from '../core/math.ts';
import { BIKE_STATES, Bike, EXPERT, NOVICE, type BikeAssists } from './bike.ts';
import {
  ENGINE_BRAKE_MAPS,
  bikeParameters,
  bikeSetupParameters,
  chassisLean,
  dampingFirmness,
  isBike,
  type BikeSpec,
} from './bike-definitions.ts';
import { COMPOUNDS, DEFAULT_SETUP, type Assist, type Compound, type Setup } from './config.ts';
import { MARSHAL } from './marshal.ts';
import { bikeStandLift } from './pit-service.ts';
import { B, BIKE_STRIDE } from './protocol.ts';
import { peakGrip } from './tire.ts';
import { SURFACE, surfaceSample, trackPoint, type Track } from './track.ts';
import { Vehicle, engineTorque } from './vehicle.ts';
import { FORMULA_APX01, type VehicleDefinition } from './vehicles.ts';

/** Rider aids from the session assist setting: 'sport' (the ABS/TC setting
 * for cars) enables traction control, wheelie and stoppie control, combined
 * brakes and cornering ABS; 'raw' removes them. The lean-intent controller
 * (counter-steer) is the control contract itself and is always on. AI riders
 * always ride with the aids. */
export function bikeAssists(assist: Assist, ai = false): BikeAssists {
  return assist === 'sport' || ai ? NOVICE : Object.freeze({ ...EXPERT, lean: true });
}
const TAU = Math.PI * 2;
/** Recovery bounds (s, m/s): every crash returns control within a bounded time. */
export const BIKE_RECOVERY = Object.freeze({
  jogSpeed: 4,
  maxJog: 6,
  pushSpeed: 3,
  maxPush: 5,
  /** Remount on the racing surface this far inside its edge (m). */
  edgeInset: 0.9,
  /** A riding bike that cannot move under throttle this long is helped back. */
  stuckSeconds: 6,
});
/** q = yaw(heading) · pitch(nose-up) · roll(lean + left), body-first order. */
export function bikeOrientation(q: Quat, heading: number, pitch: number, lean: number) {
  const hy = heading / 2,
    hx = -pitch / 2,
    hz = -lean / 2;
  const sy = Math.sin(hy),
    cy = Math.cos(hy),
    sx = Math.sin(hx),
    cx = Math.cos(hx),
    sz = Math.sin(hz),
    cz = Math.cos(hz);
  // qy * qx
  const ax = cy * sx,
    ay = sy * cx,
    az = -sy * sx,
    aw = cy * cx;
  // (qy*qx) * qz
  q.x = ax * cz + ay * sz;
  q.y = ay * cz - ax * sz;
  q.z = aw * sz + az * cz;
  q.w = aw * cz - az * sz;
  return q;
}
/** Session adapter for a motorcycle definition (WP34, D13): the reduced-order
 * `Bike` core decides lean, steer, loads and failures; this class presents
 * the result through the shared entrant interface (rigid-body pose for
 * collisions, snapshots and cameras; track progress; pit, penalties and the
 * race director), so the rest of the pipeline is family-agnostic. External
 * impulses (contacts, barriers) are read back from the rigid body each step. */
export class BikeVehicle extends Vehicle {
  readonly bikeSpec: BikeSpec;
  readonly dynamics: Bike;
  /** Lateral slide after a contact (m/s, + left); decays with tyre grip. */
  slide = 0;
  fork = 0;
  shock = 0;
  tuck = 0;
  rearBrake = 0;
  /** Rider world position while separated (else the seat), heading and tumble. */
  readonly rider = new Vec3();
  riderHeading = 0;
  riderTumble = 0;
  protected readonly riderVelocity = new Vec3();
  protected incident: string | null = null;
  protected contactCrash = false;
  protected aiSteps = 0;
  protected readonly riderAids: BikeAssists;
  protected stuckClock = 0;
  /** Dynamics state at the end of the last step: transitions are detected
   * against it, so a fall started outside step() still separates the rider. */
  protected lastState: Bike['state'] = 'riding';
  protected yawKick = 0;
  protected roadPitch = 0;
  protected groundY = 0;
  protected readonly remount = { x: 0, z: 0, heading: 0, active: false };
  protected readonly written = { position: new Vec3(), velocity: new Vec3(), omega: new Vec3() };
  protected readonly pivot = new Vec3();
  protected readonly offset = new Vec3();
  protected readonly scratch = new Vec3();
  protected readonly riderSurface = surfaceSample();
  protected readonly remountPoint = trackPoint();
  constructor(
    id: number,
    compound: Compound = 'medium',
    setup: Setup = DEFAULT_SETUP,
    assist: Assist = 'sport',
    definition: VehicleDefinition,
  ) {
    super(id, compound, setup, assist, definition);
    if (!definition.bike) throw new Error(`${definition.id} has no motorcycle block`);
    this.bikeSpec = definition.bike;
    this.fuel = this.bikeSpec.fuel;
    this.battery = 0;
    this.body.mass = definition.spec.dryMass + this.fuel;
    this.riderAids = bikeAssists(assist, id > 0);
    // The exposed setup (this.setup is setupFor the machine) shapes the core.
    this.dynamics = new Bike(
      this.riderAids,
      bikeSetupParameters(bikeParameters(definition, this.body.mass), definition, this.setup),
    );
    this.gearing = this.setup.gearing;
    this.engineBrake =
      ENGINE_BRAKE_MAPS[Math.min(3, Math.max(0, Math.round(this.setup.engineBrakeMap)))];
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
  protected readonly shockFirmness: number;
  get heading() {
    return this.dynamics.heading;
  }
  get riding() {
    return this.dynamics.state === 'riding';
  }
  /** The AI rides with the aids whatever the player's assist setting; the
   * mark lasts the physics substeps of the tick it was given in. */
  aiControlled(substeps = 2) {
    this.aiSteps = substeps;
  }
  protected fitFrontRadius() {
    for (const t of [this.tires[0], this.tires[1]]) {
      t.radius = t.nominalRadius = this.bikeSpec.frontWheelRadius;
      t.inertia = 0.6;
    }
  }
  override replaceTires(compound: Compound) {
    super.replaceTires(compound);
    this.fitFrontRadius();
  }
  override place(track: Track, s: number, offset = 0) {
    super.place(track, s, offset);
    const p = this.trackPosition,
      d = this.dynamics;
    d.x = p.x + p.nx * offset;
    d.z = p.z + p.nz * offset;
    d.heading = Math.atan2(p.tx, p.tz);
    d.speed = d.lean = d.leanRate = d.steer = d.pitch = 0;
    this.slide = this.yawKick = 0;
    this.groundY = p.y;
    this.writeBody(track, 0);
  }
  /** At rest at a world point (x, z) facing `heading` (rad from +z), on the
   * ground of height `groundY` (the layer to sample: a bridge deck or the
   * road below it). For surfaces without lap distance (the festival region);
   * circuit sessions use `place`. */
  placeFree(track: Track, x: number, z: number, heading: number, groundY: number) {
    const d = this.dynamics;
    d.x = x;
    d.z = z;
    d.heading = heading;
    d.speed = d.lean = d.leanRate = d.steer = d.pitch = 0;
    this.slide = this.yawKick = 0;
    this.stuckClock = 0;
    this.groundY = groundY;
    this.writeBody(track, 0);
  }
  /** Seamless (or quickshifted) sequential gearbox; no reverse or neutral in a session. */
  override shift(direction: number) {
    if (this.shiftClock > 0) return;
    const spec = this.spec,
      next = clamp(this.gear + Math.sign(direction), 1, spec.gearRatios.length - 2);
    if (next === this.gear) return;
    const predicted =
      ((this.dynamics.speed / spec.wheelRadius) *
        spec.gearRatios[next + 1] *
        spec.finalDrive *
        this.gearing *
        30) /
      Math.PI;
    if (predicted > spec.limiterRPM) return;
    this.gear = next;
    this.shiftClock =
      this.bikeSpec.gearbox === 'seamless' ? 0.02 : Math.max(0.02, this.bikeSpec.shiftCut);
  }
  /** Crash code for the race director, consumed once (see bikeIncident). */
  takeIncident() {
    const code = this.incident;
    this.incident = null;
    return code;
  }
  override impactAt(energy: number, point: Vec3) {
    if (!Number.isFinite(energy) || energy < 0) throw new Error('Invalid impact energy');
    void point;
    this.impact = Math.max(this.impact, Math.min(1, energy / 30000));
    // Fairing/wing scrapes are cosmetic here; a hard contact unseats the rider.
    this.frontHealth = Math.max(0.3, this.frontHealth - energy / 400000);
    if (energy > this.bikeSpec.crashEnergy && this.riding) this.contactCrash = true;
  }
  override repairFrontWing(dt: number) {
    this.frontHealth = Math.min(1, this.frontHealth + dt * 0.3);
  }
  /** Damping over kerbs: a firmer click skips over the strips (up to 6% less
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
      force = Math.min((torque * ratio) / spec.wheelRadius, 0.5 * d.p.mu * d.grip * d.rearLoad);
    d.speed = Math.max(0, d.speed - (force / d.mass) * dt);
  }
  /** Grip multiplier of a contact patch relative to a fresh dry slick. */
  protected surfaceGrip(i: number) {
    const t = this.tires[i];
    return (
      peakGrip(t, 2200, this.contacts[i], Math.max(this.dynamics.speed, 20)) / COMPOUNDS.medium.mu
    );
  }
  protected drive(dt: number, throttle: number) {
    const spec = this.spec,
      d = this.dynamics,
      b = this.bikeSpec;
    if (this.input.shift) {
      this.shift(this.input.shift);
      this.input.shift = 0;
      this.autoShift = false;
    }
    this.shiftClock = Math.max(0, this.shiftClock - dt);
    const ratio = spec.gearRatios[this.gear + 1] * spec.finalDrive * this.gearing,
      coupled = ((d.speed / spec.wheelRadius) * ratio * 30) / Math.PI;
    if (this.autoShift) {
      if (coupled > spec.shiftRPM && this.gear < spec.gearRatios.length - 2) this.shift(1);
      else if (coupled < spec.downshiftRPM && this.gear > 1) this.shift(-1);
    }
    const current = spec.gearRatios[this.gear + 1] * spec.finalDrive * this.gearing,
      wheelRPM = ((d.speed / spec.wheelRadius) * current * 30) / Math.PI;
    // First-gear launch: the clutch slips at the launch speed under throttle.
    const slip = this.gear === 1 ? lerp(spec.idleRPM, b.launchRPM, throttle) : spec.idleRPM;
    const target = this.riding ? Math.max(wheelRPM, slip) : spec.idleRPM;
    this.rpm = approach(this.rpm, Math.min(target, spec.limiterRPM + 150), 40000 * dt);
    let torque =
      this.riding && this.fuel > 0 && this.rpm <= spec.limiterRPM
        ? engineTorque(this.rpm, spec) * throttle
        : 0;
    if (this.shiftClock > 0 && b.gearbox !== 'seamless') torque = 0;
    this.engineOutputTorque = torque;
    this.clutch.engineOmega = (this.rpm * Math.PI) / 30;
    return (torque * current * b.drivelineEfficiency) / spec.wheelRadius;
  }
  override step(dt: number, track: Track) {
    const d = this.dynamics,
      b = this.body,
      spec = this.bikeSpec;
    this.debris.step(dt, track);
    this.absorbExternal(dt);
    d.assists = this.aiSteps > 0 ? NOVICE : this.riderAids;
    if (this.aiSteps > 0) this.aiSteps--;
    b.mass = this.definition.spec.dryMass + this.fuel - this.lostMass;
    d.mass = b.mass;
    let throttle = clamp(this.input.throttle, 0, 1);
    let brake = clamp(this.input.brake, 0, 1);
    // Rear brake: the secondary (clutch) input — a bike session has no clutch pedal.
    const rear = clamp(this.input.clutch, 0, 1);
    if (this.inPit && track.pitSpeedZone(this.s))
      throttle *= clamp((MARSHAL.pitSpeed - this.speed) / 0.8, 0, 1);
    if (this.retired) {
      throttle = 0;
      brake = 1;
    }
    this.throttle = throttle;
    this.brake = brake;
    this.rearBrake = rear;
    d.grip = Math.min(
      this.surfaceGrip(0) * this.bumpGrip(0, this.setup.frontDamping),
      this.surfaceGrip(2) * this.bumpGrip(2, this.setup.rearDamping),
    );
    d.slope = Math.sin(this.roadPitch);
    // Rider: tuck on straights, hang off toward the corner.
    const fast = d.speed > 25 && Math.abs(d.lean) < 0.2 && throttle > 0.6 && brake < 0.05;
    this.tuck = approach(this.tuck, fast && this.riding ? 1 : 0, dt * 2.5);
    d.dragScale = 1 - spec.tuckDrag * this.tuck;
    const hang =
      d.speed > 10 ? clamp(1.3 * this.input.steer + 1.1 * d.lean, -1, 1) * (1 - this.tuck) : 0;
    const force = this.drive(dt, throttle);
    const was = this.lastState;
    d.riderReady = this.riderReady();
    if (this.contactCrash) {
      this.contactCrash = false;
      d.fall(Math.abs(this.slide) > 6 || d.speed > 45 ? 'highside' : 'lowside');
    }
    d.step(
      {
        lean: this.input.steer,
        throttle,
        frontBrake: brake,
        rearBrake: rear,
        rider: hang,
        drive: force,
      },
      dt,
    );
    if (this.engineBrake > 0) this.applyEngineBraking(dt, throttle);
    if (was === 'riding' && d.state !== 'riding') this.separate();
    this.lastState = d.state;
    if (was === 'separated' && d.state === 'remount') this.planRemount(track);
    if (d.state === 'remount') this.pushToRemount(dt);
    if (was === 'remount' && d.state === 'riding') {
      this.remount.active = false;
      this.slide = 0;
    }
    // Contact slide decays with available lateral grip; a large one unseats the rider.
    if (this.slide !== 0) {
      const decel = Math.max(1, 0.7 * d.p.mu * d.grip * G) * dt;
      this.slide = Math.abs(this.slide) <= decel ? 0 : this.slide - Math.sign(this.slide) * decel;
      if (Math.abs(this.slide) > 5.5 && this.riding) {
        d.fall('lowside');
        this.separate();
        this.lastState = d.state;
      }
    }
    const h = d.heading;
    d.x += Math.cos(h) * this.slide * dt;
    d.z -= Math.sin(h) * this.slide * dt;
    if (this.yawKick !== 0) {
      d.heading += this.yawKick * dt;
      this.yawKick *= Math.exp(-8 * dt);
      if (Math.abs(this.yawKick) < 1e-4) this.yawKick = 0;
    }
    this.updateRider(dt, track);
    // Fuel: ~0.3 overall efficiency against 43 MJ/kg, plus idle.
    const power = Math.max(0, this.engineOutputTorque * this.clutch.engineOmega);
    this.fuel = Math.max(0, this.fuel - (power / (0.3 * 43e6) + 0.0002) * dt);
    this.updateSuspensionAndTyres(dt);
    this.updateSkid(dt);
    this.writeBody(track, dt);
    this.impact = Math.max(0, this.impact - dt * 2);
    // Paddock-stand lift for the crew presentation, from the service clock;
    // recorded in the snapshot (F.JACK_HEIGHT) and never fed to the dynamics.
    this.jackHeight = this.inPit ? bikeStandLift(this.pitPhase, this.pitClock) : 0;
    if (b.position.y < this.groundY - 4) this.retired = true;
  }
  /** Fold collision-solver impulses and position corrections into the bike state. */
  protected absorbExternal(dt: number) {
    const b = this.body,
      w = this.written,
      d = this.dynamics,
      h = d.heading,
      sh = Math.sin(h),
      ch = Math.cos(h);
    const dx = b.position.x - w.position.x,
      dz = b.position.z - w.position.z;
    if (dx * dx + dz * dz > 1e-12 && dx * dx + dz * dz < 25) {
      d.x += dx;
      d.z += dz;
    }
    const vx = b.velocity.x - w.velocity.x,
      vz = b.velocity.z - w.velocity.z;
    if (vx * vx + vz * vz > 1e-10) {
      const along = vx * sh + vz * ch,
        across = vx * ch - vz * sh;
      d.speed = Math.max(0, d.speed + along);
      this.slide += across;
    }
    const yaw = b.omega.y - w.omega.y;
    if (Math.abs(yaw) > 1e-6) this.yawKick = clamp(this.yawKick + yaw, -3, 3);
    // Roll impulse about the forward axis (+ rolls toward the right).
    const roll = (b.omega.x - w.omega.x) * sh + (b.omega.z - w.omega.z) * ch;
    if (Math.abs(roll) > 1e-6 && this.riding) d.leanRate -= clamp(roll, -2, 2);
    void dt;
  }
  protected separate() {
    const d = this.dynamics,
      h = d.heading;
    this.incident = d.state === 'highside' ? 'RIDER_DOWN_HIGHSIDE' : 'RIDER_DOWN_LOWSIDE';
    this.impact = 1;
    this.rider.copy(this.body.position);
    // Lowside: the rider slides out of the corner; highside: thrown up and over.
    const outward = -Math.sign(d.lean || 1) * (d.state === 'highside' ? 0.5 : 1.6);
    this.riderVelocity.set(
      Math.sin(h) * d.speed * 0.92 + Math.cos(h) * (this.slide + outward),
      d.state === 'highside' ? 3.6 : 0.4,
      Math.cos(h) * d.speed * 0.92 - Math.sin(h) * (this.slide + outward),
    );
    this.riderHeading = h;
    this.riderTumble = 0;
    this.remount.active = false;
  }
  protected riderReady() {
    const d = this.dynamics;
    if (d.state === 'separated') {
      if (d.stateClock > BIKE_RECOVERY.maxJog + 2) return true;
      const dx = this.rider.x - this.body.position.x,
        dz = this.rider.z - this.body.position.z;
      return dx * dx + dz * dz < 1.2 * 1.2;
    }
    if (d.state === 'remount') return !this.remount.active || d.stateClock > BIKE_RECOVERY.maxPush;
    return true;
  }
  /** Remount on the racing surface, inside its edge, facing the direction of travel. */
  protected planRemount(track: Track) {
    const d = this.dynamics,
      p = this.remountPoint;
    const lateral = track.nearest(d.x, d.z, p, this.groundY);
    const edge = Math.max(0, p.width - BIKE_RECOVERY.edgeInset),
      side = this.inPit ? lateral : clamp(lateral, -edge, edge);
    this.remount.x = p.x + p.nx * side;
    this.remount.z = p.z + p.nz * side;
    this.remount.heading = Math.atan2(p.tx, p.tz);
    this.remount.active = true;
  }
  protected pushToRemount(dt: number) {
    const d = this.dynamics,
      r = this.remount;
    d.speed = 0;
    if (!r.active) return;
    const dx = r.x - d.x,
      dz = r.z - d.z,
      distance = Math.hypot(dx, dz),
      step = BIKE_RECOVERY.pushSpeed * dt;
    const turn = mod(r.heading - d.heading + Math.PI, TAU) - Math.PI;
    if (distance <= step && Math.abs(turn) < 0.02) {
      d.x = r.x;
      d.z = r.z;
      d.heading = r.heading;
      r.active = false;
      return;
    }
    if (distance > step) {
      d.x += (dx / distance) * step;
      d.z += (dz / distance) * step;
    } else {
      d.x = r.x;
      d.z = r.z;
    }
    d.heading += clamp(turn, -1.6 * dt, 1.6 * dt);
    // Bounded: a long push completes when the remount state times out.
    if (d.stateClock > BIKE_RECOVERY.maxPush) {
      d.x = r.x;
      d.z = r.z;
      d.heading = r.heading;
      r.active = false;
    }
  }
  protected updateRider(dt: number, track: Track) {
    const d = this.dynamics;
    if (d.state === 'riding') {
      this.rider.copy(this.body.position);
      this.riderVelocity.set(0, 0, 0);
      this.riderHeading = d.heading;
      this.riderTumble = 0;
      return;
    }
    const r = this.rider,
      v = this.riderVelocity,
      s = this.riderSurface;
    if (d.state === 'remount') {
      // Beside the bike while it is pushed and picked up.
      const h = d.heading;
      this.scratch.set(
        this.body.position.x + Math.cos(h) * 0.55,
        0,
        this.body.position.z - Math.sin(h) * 0.55,
      );
      r.x = approach(r.x, this.scratch.x, BIKE_RECOVERY.jogSpeed * dt);
      r.z = approach(r.z, this.scratch.z, BIKE_RECOVERY.jogSpeed * dt);
      track.sample(r.x, r.z, s, r.y);
      r.y = s.height + 0.95;
      this.riderHeading = h;
      this.riderTumble = approach(this.riderTumble, 0, dt * 6);
      return;
    }
    v.y -= G * dt;
    r.addScaled(v, dt);
    track.sample(r.x, r.z, s, r.y);
    const lying = s.height + 0.14;
    const horizontal = Math.hypot(v.x, v.z);
    if (r.y <= lying) {
      r.y = lying;
      v.y = Math.max(0, -v.y * 0.2);
      // Leathers on asphalt slide; gravel and grass stop a rider sooner.
      const mu = s.surface === SURFACE.GRAVEL ? 1.1 : s.surface === SURFACE.GRASS ? 0.8 : 0.55;
      const loss = mu * G * dt;
      const scale = horizontal > loss ? (horizontal - loss) / horizontal : 0;
      v.x *= scale;
      v.z *= scale;
    }
    // Barriers stop the rider too.
    const lateral = track.nearest(r.x, r.z, this.remountPoint, r.y);
    const limit = track.boundaryAt(this.remountPoint, Math.sign(lateral)) - 0.6;
    if (Math.abs(lateral) > limit) {
      const back = Math.abs(lateral) - limit;
      r.x -= this.remountPoint.nx * Math.sign(lateral) * back;
      r.z -= this.remountPoint.nz * Math.sign(lateral) * back;
      v.x *= 0.2;
      v.z *= 0.2;
    }
    this.riderTumble += horizontal * dt * 1.4;
    // Once rider and bike are at rest, the rider jogs back to the bike.
    if (d.state === 'separated' && horizontal < 0.3 && r.y <= lying + 0.01 && d.stateClock > 1.2) {
      const dx = this.body.position.x - r.x,
        dz = this.body.position.z - r.z,
        distance = Math.hypot(dx, dz);
      const step = Math.min(distance, BIKE_RECOVERY.jogSpeed * dt);
      if (distance > 1e-6) {
        r.x += (dx / distance) * step;
        r.z += (dz / distance) * step;
        this.riderHeading = Math.atan2(dx, dz);
      }
      r.y = s.height + 0.95;
      v.set(0, 0, 0);
      this.riderTumble = approach(
        this.riderTumble,
        Math.round(this.riderTumble / TAU) * TAU,
        dt * 8,
      );
    }
  }
  protected updateSuspensionAndTyres(dt: number) {
    const d = this.dynamics,
      spec = this.bikeSpec,
      riding = this.riding;
    const kerb = (i: number) =>
      this.contacts[i].surface === SURFACE.KERB ? 0.012 * (1 + Math.sin(this.s * 9)) : 0;
    // Preload takes sag out of each end; damping sets how fast each follows
    // its load (firmer is slower, 40 ms at the calibrated click).
    const forkTarget = riding
      ? clamp(d.frontLoad / spec.forkRate + kerb(0) - this.setup.frontPreload, 0, spec.forkTravel)
      : 0.02;
    const shockTarget = riding
      ? clamp(d.rearLoad / spec.shockRate + kerb(2) - this.setup.rearPreload, 0, spec.shockTravel)
      : 0.02;
    this.fork += (forkTarget - this.fork) * (1 - Math.exp(-dt / (0.04 * this.forkFirmness)));
    this.shock += (shockTarget - this.shock) * (1 - Math.exp(-dt / (0.04 * this.shockFirmness)));
    const m = d.mass,
      lateral = d.speed * d.speed * d.curvature,
      L = this.spec.wheelbase;
    for (let i = 0; i < 4; i++) {
      const t = this.tires[i],
        front = i < 2,
        c = this.contacts[i],
        ideal = COMPOUNDS[t.compound].ideal;
      const rolling = riding || d.state === 'remount';
      t.omega = rolling ? d.speed / t.radius : t.omega * Math.exp(-1.5 * dt);
      t.rotation = mod(t.rotation + t.omega * dt, TAU);
      t.load = riding ? (front ? d.frontLoad : d.rearLoad) : 0;
      t.fx = riding ? (front ? -d.frontBrakeForce : d.driveForce - d.rearBrakeForce) : 0;
      t.fy = riding ? (m * lateral * (front ? spec.cgToRear : spec.cgToFront)) / L : 0;
      t.slip = front ? 0 : Math.min(0.3, d.rearSlip);
      t.angle = front ? d.steer : 0;
      t.compression = front ? this.fork : this.shock;
      t.length = (front ? spec.forkTravel : spec.shockTravel) - t.compression + 0.2;
      t.water = c.water;
      t.surface = c.surface;
      const use = front ? d.frontUse : d.rearUse;
      const work = Math.hypot(t.fx, t.fy) * d.speed;
      t.energy = work * 0.02;
      t.wear = Math.min(1, t.wear + (work * dt) / (COMPOUNDS[t.compound].lifeJ * 10));
      const carcass = ideal - 4 + 10 * use - 6 * clamp(c.water, 0, 1);
      t.carcassTemp += (carcass - t.carcassTemp) * (1 - Math.exp(-dt / 30));
      t.surfaceTemp += (t.carcassTemp + 8 * use - t.surfaceTemp) * (1 - Math.exp(-dt / 3));
      const brakePower = (front ? d.frontBrakeForce : d.rearBrakeForce) * d.speed * 0.5;
      t.discTemp +=
        (brakePower / (front ? 1600 : 900) - (t.discTemp - 40) * (0.015 + 0.003 * d.speed)) * dt;
      this.wheelSteering[i] = front ? d.steer : 0;
      this.wheelCamber[i] = d.lean;
    }
  }
  /** Sliding fairing and pegs on asphalt: the shared skid/spark channel. */
  protected updateSkid(dt: number) {
    const k = this.skid,
      d = this.dynamics,
      sliding =
        (d.state === 'lowside' || d.state === 'highside' || d.state === 'separated') &&
        d.speed > 1.5;
    k.contacts = sliding ? 1 : 0;
    k.normalLoad = sliding ? d.mass * G : 0;
    k.slidingPower = sliding ? d.mass * G * 0.6 * d.speed : 0;
    k.dampingPower = 0;
    k.sparkPower = sliding ? 400 + 60 * d.speed : 0;
    k.surface = this.contacts[0].surface;
    if (sliding) {
      k.point.set(this.body.position.x, this.groundY + 0.02, this.body.position.z);
      k.normal.set(0, 1, 0);
      k.velocity.copy(this.body.velocity);
      k.slidingWorkJ += k.slidingPower * dt;
      k.sparkWorkJ += k.sparkPower * dt;
      k.totalWorkJ += k.slidingPower * dt;
    }
  }
  /** Rigid-body pose from the bike state: the bike rolls on its tyre crowns
   * and pitches about the contact that stays on the road. */
  protected writeBody(track: Track, dt: number) {
    const d = this.dynamics,
      b = this.body,
      spec = this.bikeSpec,
      L = this.spec.wheelbase,
      h = d.heading,
      sh = Math.sin(h),
      ch = Math.cos(h);
    const front = this.contactPoints[0],
      rear = this.contactPoints[2];
    front.set(d.x + sh * spec.cgToFront, 0, d.z + ch * spec.cgToFront);
    rear.set(d.x - sh * spec.cgToRear, 0, d.z - ch * spec.cgToRear);
    const y = this.groundY;
    track.sample(front.x, front.z, this.contacts[0], y);
    track.sample(rear.x, rear.z, this.contacts[2], y);
    this.copySample(this.contacts[0], this.contacts[1]);
    this.copySample(this.contacts[2], this.contacts[3]);
    front.y = this.contacts[0].height;
    rear.y = this.contacts[2].height;
    this.contactPoints[1].copy(front);
    this.contactPoints[3].copy(rear);
    this.roadPitch = Math.asin(clamp((front.y - rear.y) / L, -0.5, 0.5));
    const previousY = b.position.y;
    const fallen = Math.abs(d.lean) > 1.2;
    const pitch = this.roadPitch + (fallen ? 0 : d.pitch);
    // The chassis rolls on its tyre crowns: its lean exceeds the contact-to-CG lean.
    bikeOrientation(b.orientation, h, pitch, fallen ? d.lean : chassisLean(d.lean, spec));
    // Pivot: the rear contact for a wheelie, the front for a stoppie.
    const wheelie = d.pitch >= 0;
    this.pivot.copy(wheelie ? rear : front);
    this.pivot.y += spec.crownRadius;
    const lift = fallen ? 0.18 - spec.crownRadius : spec.cgHeight - spec.crownRadius;
    this.offset.set(0, lift, fallen ? 0 : wheelie ? spec.cgToRear : -spec.cgToFront);
    if (fallen) {
      this.pivot.set(d.x, (front.y + rear.y) / 2 + spec.crownRadius, d.z);
    }
    b.orientation.rotate(this.offset, this.scratch);
    b.position.copy(this.pivot).add(this.scratch);
    this.groundY = lerp(rear.y, front.y, spec.cgToRear / L);
    const v = Math.hypot(d.speed, this.slide);
    b.velocity.set(
      sh * d.speed + ch * this.slide,
      dt > 0 && Math.abs(b.position.y - previousY) < 0.5 ? (b.position.y - previousY) / dt : 0,
      ch * d.speed - sh * this.slide,
    );
    const yawRate = (this.riding ? d.speed * d.curvature : 0) + this.yawKick;
    b.omega.set(-sh * d.leanRate, yawRate, -ch * d.leanRate);
    b.orientation.rotate(this.scratch.set(0, 0, 1), this.forward);
    b.orientation.rotate(this.scratch.set(0, 1, 0), this.up);
    b.orientation.inverseRotate(b.velocity, this.localVelocity);
    this.speed = v;
    this.steer = d.steer;
    this.lateral = track.nearest(d.x, d.z, this.trackPosition, this.groundY);
    this.s = this.trackPosition.s;
    const lateralAccel = this.riding ? d.speed * d.speed * d.curvature : 0;
    this.gLong = d.longitudinal / G;
    this.gLat = lateralAccel / G;
    this.gVert = Math.hypot(1, this.gLat);
    const downforce = spec.downforce * d.speed * d.speed;
    this.aero.front = downforce * spec.downforceFront;
    this.aero.rear = downforce - this.aero.front;
    this.aero.floor = 0;
    this.aero.drag = spec.drag * d.dragScale * d.speed * d.speed;
    this.frontRideHeight = this.rearRideHeight = 0.12;
    b.acceleration.set(0, 0, 0);
    this.written.position.copy(b.position);
    this.written.velocity.copy(b.velocity);
    this.written.omega.copy(b.omega);
  }
  protected copySample(from: Vehicle['contacts'][number], to: Vehicle['contacts'][number]) {
    to.s = from.s;
    to.width = from.width;
    to.lateral = from.lateral;
    to.height = from.height;
    to.normal.copy(from.normal);
    to.surface = from.surface;
    to.water = from.water;
    to.rubber = from.rubber;
    to.marbles = from.marbles;
    to.temp = from.temp;
    to.grip = from.grip;
    to.resistance = from.resistance;
    to.cell = from.cell;
    to.pit = from.pit;
    if (from.terrain !== undefined) to.terrain = from.terrain;
  }
  /** Marshal help for a riding bike that cannot move (e.g. nosed into a
   * barrier): after a hold it is placed at the track edge, facing the course. */
  override recoverIfUpset(dt: number, track: Track) {
    const d = this.dynamics;
    if (this.retired || !this.riding || d.speed > 0.5 || this.throttle < 0.3 || this.inPit) {
      this.stuckClock = 0;
      return false;
    }
    this.stuckClock += dt;
    if (this.stuckClock < BIKE_RECOVERY.stuckSeconds) return false;
    this.planRemount(track);
    d.x = this.remount.x;
    d.z = this.remount.z;
    d.heading = this.remount.heading;
    d.lean = d.leanRate = d.steer = d.pitch = 0;
    this.remount.active = false;
    this.slide = this.yawKick = 0;
    this.stuckClock = 0;
    this.writeBody(track, 0);
    return true;
  }
}
/** The dynamics adapter for a definition's family (§6.3 / D13). */
export function createVehicle(
  id: number,
  compound: Compound,
  setup: Setup,
  assist: Assist,
  definition: VehicleDefinition = FORMULA_APX01,
): Vehicle {
  return isBike(definition)
    ? new BikeVehicle(id, compound, setup, assist, definition)
    : new Vehicle(id, compound, setup, assist, definition);
}
/** A rider-down code for the race director, consumed once; null for cars. */
export function bikeIncident(car: Vehicle): string | null {
  return car instanceof BikeVehicle ? car.takeIncident() : null;
}
/** Snapshot motorcycle block (protocol B); zeros for four-wheel entrants. */
export function writeBikeBlock(out: Float32Array, base: number, car: Vehicle) {
  if (!(car instanceof BikeVehicle)) {
    out.fill(0, base, base + BIKE_STRIDE);
    return;
  }
  const d = car.dynamics;
  out[base + B.LEAN] = d.lean;
  out[base + B.LEAN_RATE] = d.leanRate;
  out[base + B.STEER] = d.steer;
  out[base + B.RIDER_OFFSET] = d.riderOffset;
  out[base + B.STATE] = BIKE_STATES.indexOf(d.state);
  out[base + B.STATE_CLOCK] = d.stateClock;
  out[base + B.FRONT_LOAD] = d.frontLoad;
  out[base + B.REAR_LOAD] = d.rearLoad;
  out[base + B.PITCH] = d.pitch;
  out[base + B.FORK] = car.fork;
  out[base + B.SHOCK] = car.shock;
  out[base + B.RIDER_X] = car.rider.x;
  out[base + B.RIDER_Y] = car.rider.y;
  out[base + B.RIDER_Z] = car.rider.z;
  out[base + B.TUCK] = car.tuck;
  out[base + B.REAR_BRAKE] = car.rearBrake;
  out[base + B.CRASHES] = d.crashes;
  out[base + B.INTERVENTION] = d.intervention;
  out[base + B.RIDER_HEADING] = car.riderHeading;
  out[base + B.RIDER_TUMBLE] = car.riderTumble;
}
