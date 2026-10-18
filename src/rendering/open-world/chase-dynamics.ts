import { clamp } from '../../core/math.ts';

export interface ChaseMotion {
  speed: number;
  forward: number;
  lateral: number;
  yawRate: number;
  longitudinalG: number;
}
export interface ChaseCues {
  yaw: number;
  lookYaw: number;
  distance: number;
  height: number;
  fov: number;
  lookAhead: number;
}
const finite = (n: number) => (Number.isFinite(n) ? n : 0);
/** Presentation only. Actual velocity/load supply the cues; steering inputs,
 * frame count and random camera shake do not change the rig or the physics. */
export class FestivalChaseDynamics {
  readonly cues: ChaseCues = { yaw: 0, lookYaw: 0, distance: 0, height: 0, fov: 0, lookAhead: 0 };
  private initialized = false;
  update(sample: ChaseMotion, dt: number, cut = false): Readonly<ChaseCues> {
    if (!Number.isFinite(dt) || dt < 0) return this.cues;
    const speed = clamp(Math.abs(finite(sample.speed)), 0, 140);
    const moving = clamp((speed - 4) / 24, 0, 1);
    const forward = finite(sample.forward),
      lateral = finite(sample.lateral);
    // Reverse travel has no forward drift cue; atan2 near the pi boundary must
    // never spin the camera 180 degrees when the car rolls backwards.
    const slip = forward > 3 ? clamp(Math.atan2(lateral, forward), -0.9, 0.9) : 0;
    const acceleration = clamp(finite(sample.longitudinalG), -1.5, 1.5);
    const rate = clamp(finite(sample.yawRate), -1.5, 1.5);
    const targets: ChaseCues = {
      yaw: slip * 0.32 * moving,
      lookYaw: (rate * 0.11 + slip * 0.1) * moving,
      distance: acceleration * 0.23 * moving,
      height: -acceleration * 0.075 * moving,
      fov: 11 * Math.pow(clamp(speed / 75, 0, 1), 0.8),
      lookAhead: Math.min(5, speed * 0.075),
    };
    const response = cut || !this.initialized ? 1 : 1 - Math.exp(-Math.min(dt, 0.25) * 5.5);
    for (const key of Object.keys(this.cues) as (keyof ChaseCues)[])
      this.cues[key] += (targets[key] - this.cues[key]) * response;
    this.initialized = true;
    return this.cues;
  }
  reset() {
    this.initialized = false;
    for (const key of Object.keys(this.cues) as (keyof ChaseCues)[]) this.cues[key] = 0;
  }
}
interface VectorLike {
  x: number;
  y: number;
  z: number;
}
/** Exact critically damped spring for a held target. Unlike the former Euler
 * substeps this gives the same pose at 30/60/144 Hz and cannot overshoot after
 * a slow frame solely because the integrator changed step count. */
export function advanceChaseSpring(
  position: VectorLike,
  velocity: VectorLike,
  target: VectorLike,
  omega: number,
  dt: number,
) {
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(omega) || omega <= 0) return;
  const t = Math.min(dt, 0.25),
    e = Math.exp(-omega * t);
  for (const key of ['x', 'y', 'z'] as const) {
    const delta = position[key] - target[key],
      j = velocity[key] + omega * delta;
    position[key] = target[key] + (delta + j * t) * e;
    velocity[key] = (velocity[key] - omega * j * t) * e;
  }
}
