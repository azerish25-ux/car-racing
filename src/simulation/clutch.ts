import { VEHICLE } from './config.ts';
import { clamp } from '../core/math.ts';

/** Finite engine and referred rear-wheel inertias exchange an equal/opposite
 * angular impulse. Limiting that impulse by friction capacity dissipates slip;
 * no synthetic vehicle acceleration or wheel-speed overwrite is applied. */
export class FrictionClutch {
  engineOmega: number;
  transmittedTorque = 0;
  slipPower = 0;
  engagement = 0;
  readonly capacity = 760; // shaft friction capacity, N m
  constructor(
    private readonly idleRPM: number = VEHICLE.idleRPM,
    private readonly wheelInertia: number = VEHICLE.wheelInertia,
    /** Crankshaft + motor reflected rotational inertia, kg m² (powertrain.ts). */
    readonly inertia: number = 0.34,
  ) {
    this.engineOmega = (idleRPM * Math.PI) / 30;
  }
  step(
    dt: number,
    sourceTorque: number,
    wheelOmega: number,
    ratio: number,
    pedal: number,
    automatic: boolean,
    shifting: boolean,
  ) {
    if (
      ![dt, sourceTorque, wheelOmega, ratio, pedal, this.engineOmega].every(Number.isFinite) ||
      dt <= 0
    )
      throw new Error('Invalid clutch state');
    const free = this.engineOmega + (sourceTorque * dt) / this.inertia;
    const idle = (this.idleRPM * Math.PI) / 30;
    this.engagement =
      ratio === 0 || shifting
        ? 0
        : automatic
          ? clamp((free - idle * 0.55) / (idle * 0.55), 0, 1)
          : 1 - clamp(pedal, 0, 1);
    // The rear axle has two rotating wheels. Tire forces are solved afterward;
    // their reactions enter wheelOmega on the next substep (operator split).
    const inverseInertia = 1 / this.inertia + (ratio * ratio) / (2 * this.wheelInertia);
    const slip = free - ratio * wheelOmega;
    const capacityImpulse = this.capacity * this.engagement * dt;
    const impulse = clamp(slip / inverseInertia, -capacityImpulse, capacityImpulse);
    const finalSlip = slip - impulse * inverseInertia;
    this.engineOmega = free - impulse / this.inertia;
    this.transmittedTorque = impulse / dt;
    // Work removed by the internal impulse. Nonnegative up to roundoff.
    this.slipPower = Math.max(0, (impulse * (slip + finalSlip)) / (2 * dt));
    return this.transmittedTorque * ratio;
  }
}
