import { clamp, G } from '../core/math.ts';

/** Reduced-order road-racing motorcycle prototype (WP33, masterplan §8).
 * A research model, not a shipping discipline: it exists to settle the
 * control contract and the failure states before rider art is commissioned.
 *
 * Explicit approximations (calibrate before any vertical slice):
 * - planar chassis on flat ground; lean φ is a single roll degree of freedom
 *   driven by gravity and centripetal torques about the contact line;
 * - kinematic steering: path curvature κ = tan(δ)/wheelbase · cos(φ) is
 *   produced by the steer angle δ; the visual lean is never decorative, it is
 *   this state;
 * - front/rear normal loads from longitudinal load transfer, with wheelie and
 *   stoppie pitch bounded by those loads reaching zero;
 * - each tyre has a friction circle μ·Fz scaled by a camber term; exceeding
 *   the front circle is a lowside, a rear slide that suddenly regains grip
 *   is a highside;
 * - the rider is a lateral mass offset that reduces the lean needed for a
 *   corner (hang-off), entering the roll balance with its own height.
 *
 * Control contract (§8.2): the gamepad stick expresses an intended lean, not a
 * raw steer angle. The assist computes counter-steer within a steer-rate
 * limit, so novices state intent while the physics still decides whether it
 * is achievable. Expert mode passes the stick to the steer directly. */
export const BIKE = Object.freeze({
  mass: 157 + 72,
  wheelbase: 1.45,
  cgHeight: 0.62,
  /** CG distance behind the front contact / ahead of the rear contact (m). */
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
export interface BikeInput {
  /** Stick: intended lean (assist) or steer demand (expert), -1..1, left +. */
  lean: number;
  throttle: number;
  frontBrake: number;
  rearBrake: number;
  /** Rider hang-off, -1..1 (left +). */
  rider: number;
}
export interface BikeAssists {
  lean: boolean;
  wheelie: boolean;
  traction: boolean;
  combinedBrakes: boolean;
}
export const NOVICE: BikeAssists = Object.freeze({
  lean: true,
  wheelie: true,
  traction: true,
  combinedBrakes: true,
});
export const EXPERT: BikeAssists = Object.freeze({
  lean: false,
  wheelie: false,
  traction: false,
  combinedBrakes: false,
});
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
  frontLoad = (BIKE.mass * G * BIKE.cgToRear) / BIKE.wheelbase;
  rearLoad = (BIKE.mass * G * BIKE.cgToFront) / BIKE.wheelbase;
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
  constructor(public assists: BikeAssists = NOVICE) {}
  get curvature() {
    return (Math.tan(this.steer) / BIKE.wheelbase) * Math.cos(this.lean);
  }
  step(input: BikeInput, dt: number) {
    if (!(dt > 0) || dt > 0.05) throw new Error('Invalid bike timestep');
    if (this.state !== 'riding') return this.recover(dt);
    const a = this.assists;
    // Rider hang-off moves toward its command at a bounded rate.
    this.riderOffset += clamp(
      clamp(input.rider, -1, 1) * BIKE.riderOffsetMax - this.riderOffset,
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
      const grip = Math.atan(BIKE.mu * 0.85);
      const target = clamp(input.lean, -1, 1) * Math.min(BIKE.maxLean, grip);
      // Never ask the tyres for more than 80% of the friction circle.
      const budget = 0.8 * BIKE.mu * G;
      const lateral = clamp(
        G * Math.tan(this.lean) - G * 2 * (target - this.lean) + G * 0.7 * this.leanRate,
        -budget,
        budget,
      );
      const kappa = lateral / (v * v);
      steerTarget = Math.atan((kappa * BIKE.wheelbase) / Math.max(0.2, Math.cos(this.lean)));
    } else {
      // Expert: the stick is a steer demand over the range usable at speed.
      const usable = Math.atan((BIKE.wheelbase * 1.4 * G) / (v * v));
      steerTarget = clamp(input.lean, -1, 1) * Math.min(BIKE.maxSteer, usable);
    }
    steerTarget = clamp(steerTarget, -BIKE.maxSteer, BIKE.maxSteer);
    this.steer += clamp(steerTarget - this.steer, -BIKE.steerRate * dt, BIKE.steerRate * dt);
    // --- Longitudinal forces and load transfer.
    let front = clamp(input.frontBrake, 0, 1),
      rear = clamp(input.rearBrake, 0, 1);
    if (a.combinedBrakes) {
      const total = Math.max(front, rear);
      front = total * 0.78;
      rear = total * 0.3;
    }
    const throttle = clamp(input.throttle, 0, 1);
    let drive = Math.min(BIKE.maxDrive, (BIKE.power * throttle) / Math.max(v, 3));
    const rearCapacity = BIKE.mu * this.rearLoad;
    if (a.traction) drive = Math.min(drive, rearCapacity * 0.92);
    // Stoppie assist (with the wheelie assist): like lift-mitigating ABS, cap
    // front force at the deceleration where the rear would leave the road.
    const liftLimit = a.wheelie
      ? 0.92 * BIKE.mass * G * (BIKE.cgToFront / BIKE.cgHeight)
      : Infinity;
    const brakeF = Math.min(liftLimit, BIKE.frontBrake * front) * (v > 0.2 ? 1 : 0),
      brakeR = BIKE.rearBrake * rear * (v > 0.2 ? 1 : 0);
    const rearForce = drive - brakeR;
    this.rearSlip = Math.max(0, Math.abs(rearForce) / Math.max(1, rearCapacity) - 1);
    const rearApplied = clamp(rearForce, -rearCapacity, rearCapacity);
    const frontApplied = -Math.min(brakeF, BIKE.mu * this.frontLoad);
    const dragForce = BIKE.drag * this.speed * this.speed;
    const ax = (rearApplied + frontApplied - dragForce) / BIKE.mass;
    this.longitudinal = ax;
    // Load transfer: ΔF = m·a·h/L, clamped so loads never become negative.
    const transfer = (BIKE.mass * ax * BIKE.cgHeight) / BIKE.wheelbase;
    const staticFront = (BIKE.mass * G * BIKE.cgToRear) / BIKE.wheelbase,
      staticRear = (BIKE.mass * G * BIKE.cgToFront) / BIKE.wheelbase;
    this.frontLoad = Math.max(0, staticFront - transfer);
    this.rearLoad = Math.max(0, staticRear + transfer);
    // Wheelie/stoppie: pitch grows only while a wheel load would be negative.
    const excess =
      staticFront - transfer < 0
        ? transfer - staticFront
        : staticRear + transfer < 0
          ? transfer + staticRear
          : 0;
    let pitchRate = excess !== 0 ? (excess / (BIKE.mass * G)) * 3 : -this.pitch * 4;
    if (a.wheelie && this.pitch > 0.12 && pitchRate > 0) pitchRate = -1.5; // cut drive, nose down
    this.pitch = clamp(this.pitch + pitchRate * dt, -0.5, 0.9);
    if (this.pitch > 0.75 || this.pitch < -0.4) return this.crash('highside');
    this.speed = Math.max(0, this.speed + ax * dt);
    // --- Roll balance: gravity vs centripetal torque, rider offset helps.
    const kappa = this.curvature;
    const lateralAccel = this.speed * this.speed * kappa;
    const h = BIKE.cgHeight;
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
    const lateralForce = BIKE.mass * Math.abs(lateralAccel);
    const frontLat = lateralForce * (BIKE.cgToRear / BIKE.wheelbase),
      rearLat = lateralForce * (BIKE.cgToFront / BIKE.wheelbase);
    const frontUse =
      Math.hypot(frontLat, -frontApplied) / Math.max(1, BIKE.mu * camber * this.frontLoad);
    // A lightly loaded rear under braking locks and slides; it is not a crash.
    const rearUse =
      this.rearLoad < 0.05 * BIKE.mass * G
        ? 0
        : Math.hypot(rearLat, Math.max(0, rearApplied)) / (BIKE.mu * camber * this.rearLoad);
    this.lateralUse = Math.max(frontUse, rearUse);
    if (frontUse > 1.08 && this.speed > 3) return this.crash('lowside');
    if (rearUse > 1.15 && this.speed > 3) {
      this.rearSlip += rearUse - 1;
      if (this.rearSlip > 0.6) return this.crash('highside');
    }
    if (Math.abs(this.lean) > 1.25) return this.crash('lowside');
    this.heading += this.speed * kappa * dt;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    return this.state;
  }
  private crash(kind: 'lowside' | 'highside') {
    this.state = kind;
    this.stateClock = 0;
    this.crashes++;
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
    // The bike slides to rest while the rider is separated.
    this.speed = Math.max(0, this.speed - (this.state === 'lowside' ? 6 : 9) * dt);
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    if (this.state === 'separated' && this.speed === 0 && this.stateClock > 2) {
      this.state = 'remount';
      this.stateClock = 0;
    }
    if (this.state === 'remount' && this.stateClock > 1.5) {
      this.state = 'riding';
      this.lean = this.leanRate = this.steer = this.pitch = this.rearSlip = 0;
      this.riderOffset = 0;
      this.stateClock = 0;
    }
    return this.state;
  }
}
