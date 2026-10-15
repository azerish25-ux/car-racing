import { F, H, carBase } from '../simulation/protocol.ts';

/** Contact energy absorbed by one car over a session, measured from the
 * snapshot's impact channel. `Vehicle.impactAt` publishes energy / 30 kJ
 * (capped at 1) and the channel decays by 2 per second (vehicle.ts), so any
 * rise above the decayed previous value is a new impact of that size. A
 * single blow above 30 kJ saturates, so the total is a lower bound. */
export const IMPACT_FULL_SCALE_J = 30000;
export const IMPACT_DECAY_PER_S = 2;
export class ContactMeter {
  energy = 0;
  impacts = 0;
  private previous = 0;
  private time = NaN;
  constructor(readonly car = 0) {}
  reset() {
    this.energy = 0;
    this.impacts = 0;
    this.previous = 0;
    this.time = NaN;
  }
  observe(frame: Float32Array) {
    const impact = frame[carBase(this.car) + F.IMPACT],
      time = frame[H.TIME];
    if (!Number.isFinite(impact) || !Number.isFinite(time)) return;
    const dt = Number.isFinite(this.time) ? Math.max(0, time - this.time) : 0;
    // A rewind (flashback, restart) starts a fresh baseline without inventing contact.
    if (Number.isFinite(this.time) && time < this.time) {
      this.previous = impact;
      this.time = time;
      return;
    }
    const expected = Math.max(0, this.previous - dt * IMPACT_DECAY_PER_S);
    const rise = impact - expected;
    if (rise > 0.002) {
      this.energy += rise * IMPACT_FULL_SCALE_J;
      this.impacts++;
    }
    this.previous = impact;
    this.time = time;
  }
}
