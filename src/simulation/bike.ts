import { clamp, G, lerp } from '../core/math.ts';

/** Reduced-order road-racing motorcycle model (WP33, masterplan §8). It began
 * as an isolated research model that settled the control contract and the
 * failure states; it is now the dynamics core of the session adapter
 * (`bike-vehicle.ts`, WP34), parameterized per definition (`BikeParameters`).
 * The defaults below (`BIKE`) are the original research bike and its tests.
 *
 * Explicit approximations (calibrated by scripts/vehicle-calibration.ts):
 * - planar chassis; lean φ is a single roll degree of freedom driven by
 *   gravity and centripetal torques about the contact line; the road surface
 *   enters through a friction multiplier and a gradient set each step;
 * - kinematic steering: path curvature κ = tan(δ)/wheelbase · cos(φ) is
 *   produced by the steer angle δ; the visual lean is never decorative, it is
 *   this state;
 * - front/rear normal loads from longitudinal load transfer (plus wing
 *   downforce), with wheelie and stoppie pitch bounded by those loads
 *   reaching zero;
 * - each tyre has a friction circle μ·Fz scaled by a camber term; exceeding
 *   the front circle is a lowside, a rear slide that suddenly regains grip
 *   is a highside;
 * - the rider is a lateral mass offset that reduces the lean needed for a
 *   corner (hang-off), entering the roll balance with its own height.
 *
 * Control contract (§8.2): the stick expresses an intended lean, not a raw
 * steer angle. The assist computes counter-steer within a steer-rate limit,
 * so riders state intent while the physics still decides whether it is
 * achievable. Expert mode passes the stick to the steer directly. Below
 * walking pace the stick steers the bars directly in both modes. */
export interface BikeParameters {
  /** Bike plus rider (kg). */
  mass: number;
  wheelbase: number;
  cgHeight: number;
  /** CG distance behind the front contact / ahead of the rear contact (m). */
  cgToFront: number;
  cgToRear: number;
  maxSteer: number;
  steerRate: number;
  /** Chassis lean limit (rad). */
  maxLean: number;
  /** Peak tyre friction on dry asphalt. */
  mu: number;
  /** Constant-power drive used when the adapter does not supply a drive force (W). */
  power: number;
  maxDrive: number;
  /** Full-lever brake forces at the contact (N). */
  frontBrake: number;
  rearBrake: number;
  /** ½ρCdA (N per (m/s)²). */
  drag: number;
  riderOffsetMax: number;
  /** Wing downforce (N per (m/s)²) and the share carried by the front tyre. */
  downforce?: number;
  downforceFront?: number;
  /** Rolling-resistance coefficient. */
  rolling?: number;
  /** Wheelie-control pitch threshold (rad). */
  wheelieLimit?: number;
  /** Stoppie assist: fraction of the rear-lift deceleration it permits. */
  stoppieMargin?: number;
}
export const BIKE: BikeParameters = Object.freeze({
  mass: 157 + 72,
  wheelbase: 1.45,
  cgHeight: 0.62,
  cgToFront: 0.73,
  cgToRear: 0.72,
  maxSteer: 0.6,
  steerRate: 2.2,
  maxLean: 1.0,
  mu: 1.55,
  power: 180000,
  maxDrive: 4200,
  frontBrake: 9500,
  rearBrake: 2400,
  drag: 0.38,
  riderOffsetMax: 0.28,
});
export type BikeState = 'riding' | 'lowside' | 'highside' | 'separated' | 'remount';
/** Snapshot code of each state (protocol B.STATE). */
export const BIKE_STATES: readonly BikeState[] = Object.freeze([
  'riding',
  'lowside',
  'highside',
  'separated',
  'remount',
]);
export interface BikeInput {
  /** Stick: intended lean (assist) or steer demand (expert), -1..1, left +. */
  lean: number;
  throttle: number;
  frontBrake: number;
  rearBrake: number;
  /** Rider hang-off, -1..1 (left +). */
  rider: number;
  /** Drive force at the rear contact before traction limits (N). When absent
   * the constant-power research drive is used. */
  drive?: number;
}
export interface BikeAssists {
  lean: boolean;
  wheelie: boolean;
  traction: boolean;
  combinedBrakes: boolean;
  /** Cornering ABS: front brake force kept inside the friction circle. */
  abs: boolean;
}
export const NOVICE: BikeAssists = Object.freeze({
  lean: true,
  wheelie: true,
  traction: true,
  combinedBrakes: true,
  abs: true,
});
export const EXPERT: BikeAssists = Object.freeze({
  lean: false,
  wheelie: false,
  traction: false,
  combinedBrakes: false,
  abs: false,
});
/** Steering blend: 0 at walking pace (direct bars), 1 from 5 m/s (lean intent). */
export function leanAuthority(speed: number) {
  return clamp((speed - 2) / 3, 0, 1);
}
export class Bike {
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  lean = 0;
  leanRate = 0;
  steer = 0;
  /** Nose-up pitch from wheelie (+) / stoppie (-), radians. */
  pitch = 0;
  /** Current bike + rider mass (fuel burn is applied by the adapter). */
  mass: number;
  frontLoad: number;
  rearLoad: number;
  riderOffset = 0;
  rearSlip = 0;
  state: BikeState = 'riding';
  /** Seconds in the current crash/recovery state. */
  stateClock = 0;
  crashes = 0;
  /** Accumulated recovery time loss, for classification. */
  penaltySeconds = 0;
  /** Last decelerations, for diagnostics (m/s²). */
  longitudinal = 0;
  lateralUse = 0;
  /** Front/rear friction-circle use of the last step. */
  frontUse = 0;
  rearUse = 0;
  /** Environment set by the session adapter before each step: road friction
   * multiplier, sine of the uphill gradient along the heading, drag scale
   * (rider tuck) and whether the separated rider is back at the bike. */
  grip = 1;
  slope = 0;
  dragScale = 1;
  riderReady = true;
  /** Forces actually applied last step (N), and assist interventions 0..1. */
  driveForce = 0;
  frontBrakeForce = 0;
  rearBrakeForce = 0;
  intervention = 0;
  constructor(
    public assists: BikeAssists = NOVICE,
    readonly p: BikeParameters = BIKE,
  ) {
    this.mass = p.mass;
    this.frontLoad = (p.mass * G * p.cgToRear) / p.wheelbase;
    this.rearLoad = (p.mass * G * p.cgToFront) / p.wheelbase;
  }
  get curvature() {
    return (Math.tan(this.steer) / this.p.wheelbase) * Math.cos(this.lean);
  }
  /** Lateral acceleration the rider's hang-off adds at a lean, in units of g. */
  riderGain(offset = this.riderOffset, lean = this.lean) {
    return (offset * 0.25) / (this.p.cgHeight * Math.max(0.2, Math.cos(lean)));
  }
  /** Lean the assist will request at full stick on the current surface (rad):
   * the lean whose cornering force, with full hang-off, stays inside 90% of
   * the assist's friction budget, so a held target is always recoverable. */
  get leanLimit() {
    const p = this.p,
      gain = (p.riderOffsetMax * 0.25) / p.cgHeight;
    return Math.min(p.maxLean, Math.atan(Math.max(0.2, 0.72 * p.mu * this.grip - gain)));
  }
  step(input: BikeInput, dt: number) {
    if (!(dt > 0) || dt > 0.05) throw new Error('Invalid bike timestep');
    if (this.state !== 'riding') return this.recover(dt);
    const a = this.assists,
      p = this.p,
      m = this.mass,
      mu = p.mu * this.grip;
    // Rider hang-off moves toward its command at a bounded rate.
    this.riderOffset += clamp(
      clamp(input.rider, -1, 1) * p.riderOffsetMax - this.riderOffset,
      -0.6 * dt,
      0.6 * dt,
    );
    // --- Steering: assisted intention or direct steer.
    const v = Math.max(this.speed, 0.1);
    let steerTarget: number;
    if (a.lean) {
      // Stable intention: the requested lean is capped by what grip allows.
      // The assist commands the lateral acceleration that makes the lean
      // converge (less than g·tanφ to fall in, more to stand up): this is
      // counter-steering expressed as curvature, then converted to steer.
      const target = clamp(input.lean, -1, 1) * this.leanLimit;
      // Never ask the tyres for more than 80% of the friction circle.
      const budget = 0.8 * mu * G;
      const lateral = clamp(
        G * Math.tan(this.lean) +
          G * this.riderGain() -
          G * 2 * (target - this.lean) +
          G * 0.7 * this.leanRate,
        -budget,
        budget,
      );
      const kappa = lateral / (v * v);
      steerTarget = Math.atan((kappa * p.wheelbase) / Math.max(0.2, Math.cos(this.lean)));
    } else {
      // Expert: the stick is a steer demand over the range usable at speed.
      const usable = Math.atan((p.wheelbase * 1.4 * G) / (v * v));
      steerTarget = clamp(input.lean, -1, 1) * Math.min(p.maxSteer, usable);
    }
    // At walking pace the rider steers the bars directly (pit box, remount).
    const authority = leanAuthority(this.speed);
    if (authority < 1)
      steerTarget = lerp(clamp(input.lean, -1, 1) * p.maxSteer * 0.5, steerTarget, authority);
    steerTarget = clamp(steerTarget, -p.maxSteer, p.maxSteer);
    this.steer += clamp(steerTarget - this.steer, -p.steerRate * dt, p.steerRate * dt);
    // --- Longitudinal forces and load transfer.
    let front = clamp(input.frontBrake, 0, 1),
      rear = clamp(input.rearBrake, 0, 1);
    if (a.combinedBrakes) {
      const total = Math.max(front, rear);
      front = total * 0.78;
      rear = Math.max(rear, total * 0.3);
    }
    const throttle = clamp(input.throttle, 0, 1);
    const downforce = (p.downforce ?? 0) * this.speed * this.speed,
      downFront = downforce * (p.downforceFront ?? 0.6),
      downRear = downforce - downFront;
    const staticFront = (m * G * p.cgToRear) / p.wheelbase + downFront,
      staticRear = (m * G * p.cgToFront) / p.wheelbase + downRear;
    let drive =
      input.drive !== undefined
        ? Math.max(0, input.drive)
        : Math.min(p.maxDrive, (p.power * throttle) / Math.max(v, 3));
    const requested = drive;
    const rearCapacity = mu * this.rearLoad;
    // Lean-sensitive traction control: drive is kept inside what the rear
    // friction circle leaves after the cornering force it carries.
    const lateralNow = Math.abs(this.speed * this.speed * this.curvature),
      rearLatNow = m * lateralNow * (p.cgToFront / p.wheelbase);
    if (a.traction)
      drive = Math.min(drive, Math.sqrt(Math.max(0, rearCapacity ** 2 - rearLatNow ** 2)) * 0.92);
    // Wheelie control cuts drive before the acceleration that unloads the
    // front: it keeps a fifth of the static load, and in a corner the load
    // the front tyre needs for its share of the cornering force.
    const frontLatNow = m * lateralNow * (p.cgToRear / p.wheelbase);
    if (a.wheelie) {
      const keep = Math.min(staticFront, Math.max(0.2 * staticFront, frontLatNow / (0.8 * mu)));
      drive = Math.min(drive, ((staticFront - keep) * p.wheelbase) / p.cgHeight);
    }
    this.intervention = requested > 1 ? clamp(1 - drive / requested, 0, 1) : 0;
    // Stoppie assist (with the wheelie assist): like lift-mitigating ABS, cap
    // front force at the deceleration where the rear would leave the road.
    const brakeR = p.rearBrake * rear * (v > 0.2 ? 1 : 0);
    // What the rear can actually take (a light rear locks and slides).
    const rearHeld = Math.min(brakeR, mu * this.rearLoad);
    const liftLimit = a.wheelie
      ? Math.max(0, ((p.stoppieMargin ?? 0.92) * staticRear * p.wheelbase) / p.cgHeight - rearHeld)
      : Infinity;
    let brakeF = Math.min(liftLimit, p.frontBrake * front) * (v > 0.2 ? 1 : 0);
    if (a.abs) {
      // Cornering ABS: the front stays inside its friction circle, and the
      // weight it takes off the rear leaves the rear its cornering load.
      const rearLatKeep = rearLatNow / (0.85 * mu);
      brakeF = Math.min(
        brakeF,
        0.95 * Math.sqrt(Math.max(0, (mu * this.frontLoad) ** 2 - frontLatNow ** 2)),
        Math.max(0, ((staticRear - rearLatKeep) * p.wheelbase) / p.cgHeight - rearHeld),
      );
    }
    const rearForce = drive - brakeR;
    this.rearSlip = Math.max(0, Math.abs(rearForce) / Math.max(1, rearCapacity) - 1);
    const rearApplied = clamp(rearForce, -rearCapacity, rearCapacity);
    const frontApplied = -Math.min(brakeF, mu * this.frontLoad);
    this.driveForce = Math.max(0, rearApplied);
    this.frontBrakeForce = -frontApplied;
    this.rearBrakeForce = Math.max(0, -rearApplied);
    const dragForce = p.drag * this.dragScale * this.speed * this.speed,
      rolling = this.speed > 0.05 ? (p.rolling ?? 0) * m * G : 0;
    const ax = (rearApplied + frontApplied - dragForce - rolling) / m - G * this.slope;
    this.longitudinal = ax;
    // Load transfer from the tyres' longitudinal forces (they act at the road,
    // h below the CG; drag and gravity act near the CG): ΔF = Fx·h/L, with
    // loads clamped so they never become negative.
    const transfer = ((rearApplied + frontApplied) * p.cgHeight) / p.wheelbase;
    this.frontLoad = Math.max(0, staticFront - transfer);
    this.rearLoad = Math.max(0, staticRear + transfer);
    // Wheelie/stoppie: pitch grows only while a wheel load would be negative.
    const excess =
      staticFront - transfer < 0
        ? transfer - staticFront
        : staticRear + transfer < 0
          ? transfer + staticRear
          : 0;
    let pitchRate = excess !== 0 ? (excess / (m * G)) * 3 : -this.pitch * 4;
    if (a.wheelie && this.pitch > (p.wheelieLimit ?? 0.12) && pitchRate > 0) pitchRate = -1.5;
    this.pitch = clamp(this.pitch + pitchRate * dt, -0.5, 0.9);
    if (this.pitch > 0.75 || this.pitch < -0.4) return this.fall('highside');
    this.speed = Math.max(0, this.speed + ax * dt);
    // --- Roll balance: gravity vs centripetal torque, rider offset helps.
    const kappa = this.curvature;
    const lateralAccel = this.speed * this.speed * kappa;
    const h = p.cgHeight;
    const rollAccel =
      (G * Math.sin(this.lean) - lateralAccel * Math.cos(this.lean)) / h +
      ((G * this.riderOffset) / (h * h)) * 0.25;
    // Low-speed balance assist (explicit, §8.3): below walking pace the rider
    // supports the bike, so lean is held near upright instead of toppling.
    const support = a.lean ? 1 - clamp((this.speed - 1) / 4, 0, 1) : 0;
    this.leanRate += (rollAccel - support * (this.lean * 40 + this.leanRate * 10)) * dt;
    this.leanRate *= Math.exp(-1.2 * dt);
    this.lean += this.leanRate * dt;
    // --- Grip limits: lateral demand against each friction circle.
    const camber = 1 - 0.18 * Math.max(0, Math.abs(this.lean) - 0.8);
    const lateralForce = m * Math.abs(lateralAccel);
    const frontLat = lateralForce * (p.cgToRear / p.wheelbase),
      rearLat = lateralForce * (p.cgToFront / p.wheelbase);
    // A front skimming the road in a wheelie steers nothing; it is not a lowside.
    const frontUse =
      this.frontLoad < 0.05 * m * G
        ? 0
        : Math.hypot(frontLat, -frontApplied) / Math.max(1, mu * camber * this.frontLoad);
    // A lightly loaded rear under braking locks and slides; it is not a crash.
    const rearUse =
      this.rearLoad < 0.05 * m * G
        ? 0
        : Math.hypot(rearLat, Math.max(0, rearApplied)) / (mu * camber * this.rearLoad);
    this.frontUse = frontUse;
    this.rearUse = rearUse;
    this.lateralUse = Math.max(frontUse, rearUse);
    if (frontUse > 1.08 && this.speed > 3) return this.fall('lowside');
    if (rearUse > 1.15 && this.speed > 3) {
      this.rearSlip += rearUse - 1;
      // Under power a sliding rear that bites throws the rider (highside);
      // a rear sliding on the brakes steps out, and only a gross slide falls.
      if (rearApplied > 0 && this.rearSlip > 0.6) return this.fall('highside');
      if (rearApplied <= 0 && rearUse > 1.45) return this.fall('lowside');
    }
    if (Math.abs(this.lean) > 1.25) return this.fall('lowside');
    this.heading += this.speed * kappa * dt;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    return this.state;
  }
  /** Start a crash (grip exceeded here, or a contact reported by the adapter). */
  fall(kind: 'lowside' | 'highside') {
    if (this.state !== 'riding') return this.state;
    this.state = kind;
    this.stateClock = 0;
    this.crashes++;
    this.driveForce = this.frontBrakeForce = this.rearBrakeForce = this.intervention = 0;
    return this.state;
  }
  /** Crash → rider separation → remount: a single rider identity throughout,
   * a fixed time cost, and control returns only after the remount ends. */
  private recover(dt: number) {
    this.stateClock += dt;
    this.penaltySeconds += dt;
    if ((this.state === 'lowside' || this.state === 'highside') && this.stateClock > 0.6) {
      this.state = 'separated';
      this.stateClock = 0;
    }
    // The bike slides to rest on its side while the rider is separated;
    // loose surfaces stop it sooner.
    const decel = (this.state === 'lowside' ? 6 : 9) * (this.grip < 0.6 ? 1.4 : 1);
    this.speed = Math.max(0, this.speed - decel * dt);
    if (this.state !== 'remount') {
      const side = this.lean < 0 ? -1 : 1;
      this.lean += clamp(side * 1.45 - this.lean, -4 * dt, 4 * dt);
    } else this.lean += clamp(-this.lean, -1.5 * dt, 1.5 * dt);
    this.leanRate = 0;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    if (this.state === 'separated' && this.speed === 0 && this.stateClock > 2 && this.riderReady) {
      this.state = 'remount';
      this.stateClock = 0;
    }
    if (this.state === 'remount' && this.stateClock > 1.5 && this.riderReady) {
      this.state = 'riding';
      this.lean = this.leanRate = this.steer = this.pitch = this.rearSlip = 0;
      this.riderOffset = 0;
      this.stateClock = 0;
    }
    return this.state;
  }
}
