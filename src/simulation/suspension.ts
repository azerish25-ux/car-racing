import { clamp } from '../core/math.ts';
import type { Setup } from './config.ts';

/** Per-corner suspension (docs/production/PHYSICS_MODEL.md §2).
 *
 * Each corner is a massless hub between the chassis and the tyre: the
 * suspension (progressive spring, bump stop, bump/rebound damper with a
 * low/high-speed knee, anti-roll bar) acts on hub travel x, the tyre's radial
 * stiffness and damping on the deflection X − x, where X is the total
 * geometric compression from the contact query. Hub force balance
 *     k_t·(X − x) + c_t·(Ẋ − ẋ) = F_spring(x) + F_bump(x) + F_damper(ẋ) + k_arb·(x − x_other)
 * is solved with backward Euler (Newton per corner, Gauss-Seidel for the bar),
 * so the stiff tyre/damper mode is unconditionally stable at any timestep.
 *
 * Setup springs, bars and the definition's damper values are RIDE values at
 * the contact patch (wheel and tyre in series, as a seven-post rig measures
 * them); hub hardware rates are derived at the tyre's nominal stiffness, so
 * quasi-static ride heights, roll and pitch reproduce the former model. The
 * tyre's pressure-dependent stiffness then changes them physically.
 *
 * Geometry: camber gain and bump steer per metre of hub travel. Load
 * transfer: tread forces enter the chassis at the vehicle's link-centre
 * height above the patch (VehicleSpec.linkCentreHeight), the calibrated
 * correction between the rigid body's reference point and the effective
 * roll/pitch mass centre that keeps total load transfer at its calibrated
 * value. Roll-centre height and side-view anti geometry then split that
 * transfer into an elastic share (springs/bars: body roll and pitch) and a
 * geometric share that the links put straight into the tyre loads,
 *     ΔN = −(h_rc/y)·Fy − tanθ·Fx·sign(z),
 * without changing the total, and jack the body when outer and inner forces
 * differ. Zero heights reproduce the former, purely elastic transfer. */
export interface DamperCurve {
  /** Low-speed ride damping at the contact patch (N s/m), bump and rebound. */
  readonly bump: number;
  readonly rebound: number;
  /** Knee speeds (m/s at the contact patch) and high-speed slope ratios
   * (below 1 is digressive: kerbs are absorbed rather than transmitted). */
  readonly bumpKnee: number;
  readonly reboundKnee: number;
  readonly bumpHighRatio: number;
  readonly reboundHighRatio: number;
}
export interface AxleSuspension {
  /** Spring rate rises by this fraction of its base over the axle's travel. */
  readonly progression: number;
  /** Bump rubber engages at this total compression (m), quadratic rate N/m². */
  readonly bumpStopGap: number;
  readonly bumpStopRate: number;
  /** Extension limit below the static rest length (m). */
  readonly droop: number;
  readonly damper: DamperCurve;
  /** Negative camber gained per metre of hub bump travel (rad/m). */
  readonly camberGain: number;
  /** Toe-in gained per metre of hub bump travel (rad/m). */
  readonly bumpSteer: number;
  /** Roll-centre height (m) at static ride, and its change per metre of mean
   * axle travel (negative: the roll centre drops as the car squats). */
  readonly rollCentreHeight: number;
  readonly rollCentreGain: number;
  /** Side-view force-line slopes tanθ for braking and driving forces. */
  readonly antiBrake: number;
  readonly antiDrive: number;
}
export interface SuspensionDefinition {
  readonly front: AxleSuspension;
  readonly rear: AxleSuspension;
}
/** Ride damping and stops of the former model (4800 bump / 6200 rebound,
 * 1.8e6 N/m² stop at 0.13 m), now with a digressive high-speed knee. */
const RIDE_DAMPER: DamperCurve = Object.freeze({
  bump: 4800,
  rebound: 6200,
  bumpKnee: 0.2,
  reboundKnee: 0.25,
  bumpHighRatio: 0.55,
  reboundHighRatio: 0.7,
});
/** Default axles reproduce the former model (no camber gain, purely elastic
 * load transfer, linear springs) apart from the damper knee; overrides add
 * a vehicle's geometry. */
export function defaultSuspension(
  overrides: { front?: Partial<AxleSuspension>; rear?: Partial<AxleSuspension> } = {},
): SuspensionDefinition {
  const axle = (camberGain: number): AxleSuspension => ({
    progression: 0,
    bumpStopGap: 0.13,
    bumpStopRate: 1.8e6,
    droop: 0.05,
    damper: RIDE_DAMPER,
    camberGain,
    bumpSteer: 0,
    rollCentreHeight: 0,
    rollCentreGain: 0,
    antiBrake: 0,
    antiDrive: 0,
  });
  return Object.freeze({
    front: Object.freeze({ ...axle(0), ...overrides.front }),
    rear: Object.freeze({ ...axle(0), ...overrides.rear }),
  });
}
/** Hub hardware for one corner, derived from ride values and the tyre. */
export interface CornerHardware {
  wheelRate: number;
  barRate: number;
  progression: number;
  travel: number;
  stopGap: number;
  stopRate: number;
  droop: number;
  bump: number;
  rebound: number;
  bumpKnee: number;
  reboundKnee: number;
  bumpHigh: number;
  reboundHigh: number;
  tyreRate: number;
  tyreDamping: number;
  camberGain: number;
  bumpSteer: number;
}
/** Series inversion: hub rate that, in series with the tyre, gives `ride`. */
export function hubRate(ride: number, tyre: number) {
  return (ride * tyre) / Math.max(tyre - ride, 0.2 * tyre);
}
export function resolveCorner(
  axle: AxleSuspension,
  spring: number,
  bar: number,
  tyreRate: number,
  tyreDamping: number,
  travel: number,
): CornerHardware {
  const wheelRate = hubRate(spring, tyreRate),
    // Roll rate per wheel (spring + two bar halves) is matched the same way.
    rollRate = hubRate(spring + 2 * bar, tyreRate),
    barRate = Math.max(0, (rollRate - wheelRate) / 2),
    // Low-frequency share of contact motion taken by the hub.
    share = tyreRate / (tyreRate + wheelRate),
    damping = 1 / (share * share);
  return {
    wheelRate,
    barRate,
    progression: axle.progression,
    travel,
    stopGap: axle.bumpStopGap * share,
    stopRate: axle.bumpStopRate * damping,
    droop: axle.droop,
    bump: axle.damper.bump * damping,
    rebound: axle.damper.rebound * damping,
    bumpKnee: axle.damper.bumpKnee * share,
    reboundKnee: axle.damper.reboundKnee * share,
    bumpHigh: axle.damper.bump * damping * axle.damper.bumpHighRatio,
    reboundHigh: axle.damper.rebound * damping * axle.damper.reboundHighRatio,
    tyreRate,
    tyreDamping,
    camberGain: axle.camberGain,
    bumpSteer: axle.bumpSteer,
  };
}
/** Hardware for the four corners (FR, FL, RR, RL) from a setup. */
export function resolveSuspension(
  def: SuspensionDefinition,
  setup: Setup,
  tyreRate: number,
  tyreDamping: number,
  travel: number,
): CornerHardware[] {
  const front = resolveCorner(
      def.front,
      setup.frontSpring,
      setup.frontARB,
      tyreRate,
      tyreDamping,
      travel,
    ),
    rear = resolveCorner(def.rear, setup.rearSpring, setup.rearARB, tyreRate, tyreDamping, travel);
  return [front, { ...front }, rear, { ...rear }];
}
/** Damper force (N, + resisting bump) at hub velocity v (+ bump). */
export function damperForce(h: CornerHardware, v: number) {
  if (v >= 0)
    return v <= h.bumpKnee ? h.bump * v : h.bump * h.bumpKnee + h.bumpHigh * (v - h.bumpKnee);
  const u = -v;
  return -(u <= h.reboundKnee
    ? h.rebound * u
    : h.rebound * h.reboundKnee + h.reboundHigh * (u - h.reboundKnee));
}
function damperSlope(h: CornerHardware, v: number) {
  return v >= 0
    ? v <= h.bumpKnee
      ? h.bump
      : h.bumpHigh
    : -v <= h.reboundKnee
      ? h.rebound
      : h.reboundHigh;
}
/** Spring + bump-stop force (N) and its slope at hub travel x. */
export function springForce(h: CornerHardware, x: number) {
  const stop = Math.max(0, x - h.stopGap);
  return (
    h.wheelRate * x * (1 + (0.5 * h.progression * Math.max(0, x)) / h.travel) +
    h.stopRate * stop * stop
  );
}
function springSlope(h: CornerHardware, x: number) {
  return (
    h.wheelRate * (1 + (h.progression * Math.max(0, x)) / h.travel) +
    2 * h.stopRate * Math.max(0, x - h.stopGap)
  );
}
/** Inputs and outputs of one hub solve (allocation-free, per vehicle). */
export class HubSolver {
  /** Hub travel (m, + bump) per corner: the integrated state. */
  readonly travel = new Float64Array(4);
  /** Tyre radial force (N) per corner after the solve. */
  readonly tyreForce = new Float64Array(4);
  /** Total compression X (m) and its rate Ẋ (m/s); contact flags. */
  readonly compression = new Float64Array(4);
  readonly rate = new Float64Array(4);
  readonly contact = new Uint8Array(4);
  /** Per-corner tyre radial stiffness this step (pressure dependent). */
  readonly tyreRate = new Float64Array(4);
  private readonly previous = new Float64Array(4);
  constructor(readonly hardware: CornerHardware[]) {}
  reset() {
    this.travel.fill(0);
    this.tyreForce.fill(0);
  }
  private r = 0;
  private slope = 0;
  /** Hub force residual (tyre − suspension) and its slope at trial travel x. */
  private residual(i: number, x: number, dt: number, other: number) {
    const h = this.hardware[i],
      v = (x - this.previous[i]) / dt,
      suspension = springForce(h, x) + damperForce(h, v) + h.barRate * (x - other),
      stiffness = springSlope(h, x) + damperSlope(h, v) / dt + h.barRate;
    if (!this.contact[i]) {
      this.r = -suspension;
      this.slope = -stiffness;
      return;
    }
    const kt = this.tyreRate[i];
    this.r = kt * (this.compression[i] - x) + h.tyreDamping * (this.rate[i] - v) - suspension;
    this.slope = -(kt + h.tyreDamping / dt + stiffness);
  }
  /** Backward-Euler hub travel and tyre force for all four corners. */
  solve(dt: number) {
    if (!(dt > 0)) throw new Error('Invalid suspension timestep');
    this.previous.set(this.travel);
    for (let sweep = 0; sweep < 2; sweep++)
      for (let i = 0; i < 4; i++) {
        const h = this.hardware[i],
          other = this.travel[i ^ 1];
        let x = this.travel[i];
        for (let n = 0; n < 6; n++) {
          this.residual(i, x, dt, other);
          const next = x - this.r / this.slope;
          const done = Math.abs(next - x) < 1e-9;
          x = next;
          if (done) break;
        }
        x = Math.max(-h.droop, x);
        // A tyre cannot pull: re-solve the free hub if the patch would.
        if (this.contact[i]) {
          const v = (x - this.previous[i]) / dt;
          if (
            this.tyreRate[i] * (this.compression[i] - x) + h.tyreDamping * (this.rate[i] - v) <
            0
          ) {
            this.contact[i] = 0;
            for (let n = 0; n < 6; n++) {
              this.residual(i, x, dt, other);
              const next = x - this.r / this.slope;
              const done = Math.abs(next - x) < 1e-9;
              x = next;
              if (done) break;
            }
            x = Math.max(-h.droop, x);
          }
        }
        this.travel[i] = x;
      }
    for (let i = 0; i < 4; i++) {
      const h = this.hardware[i],
        v = (this.travel[i] - this.previous[i]) / dt;
      this.tyreForce[i] = this.contact[i]
        ? Math.max(
            0,
            this.tyreRate[i] * (this.compression[i] - this.travel[i]) +
              h.tyreDamping * (this.rate[i] - v),
          )
        : 0;
    }
  }
}
/** Kinematic camber (rad, signed toward +lateral) relative to the chassis:
 * static camber plus negative-camber gain in bump. `side` is -1 right, +1 left. */
export function kinematicCamber(staticCamber: number, gain: number, travel: number, side: number) {
  return (staticCamber - gain * travel) * side;
}
/** Geometric (link) load transfer at one contact (N, + into the ground):
 * lateral jacking through the roll centre at `y` (car-local lateral position
 * of the patch) and side-view anti geometry at `z` for force Fx. */
export function geometricLoad(
  axle: AxleSuspension,
  y: number,
  z: number,
  fx: number,
  fy: number,
  meanTravel: number,
) {
  const rc = Math.max(-0.2, axle.rollCentreHeight + axle.rollCentreGain * meanTravel),
    slope = fx < 0 ? axle.antiBrake : axle.antiDrive;
  return (
    -(rc / (Math.abs(y) < 0.05 ? 0.05 * Math.sign(y || 1) : y)) * fy - slope * fx * Math.sign(z)
  );
}
/** Road-relative inclination: chassis-relative camber minus the chassis roll
 * relative to the road plane (sin of its lateral axis along the normal). */
export function roadInclination(chassisCamber: number, lateralDotNormal: number) {
  return chassisCamber - Math.asin(clamp(lateralDotNormal, -1, 1));
}
