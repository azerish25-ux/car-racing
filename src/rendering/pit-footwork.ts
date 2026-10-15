import * as T from 'three';
import { clamp, smooth } from '../core/math.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';
import type { PitRole } from './pit-role-performance.ts';

export function pitWheelOffset(phase: number, clock: number, load: number) {
  if (![phase, clock, load].every(Number.isFinite)) throw new Error('Invalid pit presentation');
  if (load > 50) return 0;
  if (phase === 3) return smooth(1.35, 2.1, clock) * 0.48;
  if (phase === 4) return (1 - smooth(2.2, 3.25, clock)) * 0.48;
  return 0;
}
export const pitClearance = (phase: number, clock: number) =>
  phase === 5 ? smooth(3.7, 5.1, clock) * 0.44 : 0;
/** Withdraw only after the recorded jack has fully lowered. A held service
 * cannot carry a loaded saddle sideways. This is presentation-only travel. */
export const pitJackClearance = (phase: number, clock: number, height: number) =>
  phase === 5 && height <= 1e-6 ? smooth(4.72, 5.15, clock) * 1.55 : 0;
export const pitGunWithdrawal = (phase: number, clock: number) =>
  phase === 3
    ? smooth(1, 1.35, clock)
    : phase === 4
      ? 1 - smooth(3.05, 3.4, clock)
      : phase === 5
        ? smooth(3.5, 3.9, clock)
        : 0;

/** One route supplies the real carried wheel, actor root and planted foot
 * anchors. Derive positions from recorded service state; no accumulated paths. */
export class PitWheelTask {
  readonly center = new T.Vector3();
  readonly root = new T.Vector3();
  engagement = 0;
  hasSpare = false;
  yaw = 0;
  set(
    role: PitRole,
    wheel: number,
    phase: number,
    clock: number,
    load: number,
    hubY: number,
    floor: number,
  ) {
    const clear = pitClearance(phase, clock);
    if (role === 'release') {
      this.root.set(3.12 + clear, floor, 2.7);
      this.yaw = -Math.PI / 2;
      return this;
    }
    const [x, , z] = WHEEL_POSITIONS[wheel],
      side = Math.sign(x);
    if (role === 'gun') {
      this.root.set(x + side * (0.87 + 0.28 * pitGunWithdrawal(phase, clock) + clear), floor, z);
      this.yaw = (-side * Math.PI) / 2;
      return this;
    }
    const install = role === 'install',
      station = install ? 1 : -1;
    const engagement = install
      ? phase < 4
        ? smooth(1.35, 2.2, clock)
        : phase === 4
          ? 1
          : 1 - smooth(3.5, 4.15, clock)
      : phase < 3
        ? smooth(0.2, 0.8, clock)
        : phase === 3
          ? 1
          : 1 - smooth(2.2, 2.9, clock);
    const off = pitWheelOffset(phase, clock, load);
    const transfer = (install && phase < 4) || (!install && phase >= 4) ? 0.48 : off;
    this.center.set(x + side * (0.98 + clear), floor + 0.41, z + station * 0.8);
    this.center.x += (x + side * transfer - this.center.x) * engagement;
    this.center.y += (hubY - this.center.y) * engagement;
    this.center.z += (z - this.center.z) * engagement;
    this.root.set(
      this.center.x + side * (0.45 - 0.05 * engagement),
      floor,
      this.center.z + station * (0.3 + 0.5 * engagement),
    );
    this.yaw = Math.atan2(this.center.x - this.root.x, this.center.z - this.root.z);
    this.engagement = engagement;
    this.hasSpare = install ? phase < 4 : phase >= 4;
    return this;
  }
}

/** Alternating, fixed car-space support contacts. A swing only occurs when its
 * next landing actually differs. Stance feet do not inherit translating roots.
 * This is procedural endpoint correction over authored whole-body actions. */
/** An actor route with the PitWheelTask signature (root and yaw on the floor). */
export interface PitFootRoute {
  set(
    role: PitRole,
    wheel: number,
    phase: number,
    time: number,
    load: number,
    hubY: number,
    floor: number,
  ): { readonly root: T.Vector3; readonly yaw: number };
}
/** A lift device withdrawn along `axis` (unit, car-local) by `distance` once
 * its recorded `height` is down (motorcycle stands). */
export interface PitStandWithdrawal {
  readonly axis: T.Vector3;
  readonly distance: number;
  readonly height: number;
}
export class PitFootwork {
  readonly feet: [T.Vector3, T.Vector3] = [new T.Vector3(), new T.Vector3()];
  readonly planted: [boolean, boolean] = [true, true];
  private readonly route = new PitWheelTask();
  private custom: PitFootRoute | undefined;
  private readonly start = new T.Vector3();
  private readonly end = new T.Vector3();
  private readonly up = new T.Vector3(0, 1, 0);
  private anchor(
    time: number,
    role: PitRole,
    wheel: number,
    phase: number,
    load: number,
    floor: number,
    spread: number,
    foot: number,
    out: T.Vector3,
  ) {
    const scheduled = time < 0.8 ? 2 : time < 2.2 ? 3 : time < 3.5 ? 4 : 5;
    const route = (this.custom ?? this.route).set(
      role,
      wheel,
      Math.min(phase, scheduled),
      time,
      load,
      0,
      floor,
    );
    return out
      .set(foot === 0 ? -0.14 : 0.14, 0.055, spread + 0.035)
      .applyAxisAngle(this.up, route.yaw)
      .add(route.root);
  }
  set(
    role: PitRole,
    wheel: number,
    phase: number,
    clock: number,
    load: number,
    floor: number,
    spread: number,
    root: T.Matrix4,
    route?: PitFootRoute,
    stand?: PitStandWithdrawal,
  ) {
    this.custom = route;
    if (role === 'front-jack' || role === 'rear-jack') {
      const side = role === 'front-jack' ? 1 : -1;
      const clearance = pitJackClearance(phase, clock, stand ? stand.height : -floor - 0.43);
      const t = clearance > 0 ? clamp((clock - 4.72) / (5.15 - 4.72), 0, 1) : 0;
      const step = Math.min(3, Math.floor(t * 4)),
        u = clamp(t * 4 - step, 0, 1);
      for (const foot of [0, 1] as const) {
        const active = step % 2 === foot,
          previous = step - (active ? 2 : 1);
        const from = smooth(0, 1, Math.max(0, (previous + 1) / 4)) * 1.55;
        const to = smooth(0, 1, (step + 1) / 4) * 1.55;
        this.feet[foot].set(foot === 0 ? -0.14 : 0.14, 0.055, spread + 0.035).applyMatrix4(root);
        const travel = active ? from + (to - from) * smooth(0, 1, u) : from;
        // Car jacks are drawn out sideways; motorcycle stands along their own axis.
        if (stand) this.feet[foot].addScaledVector(stand.axis, (travel / 1.55) * stand.distance);
        else this.feet[foot].x += side * travel;
        if (active)
          this.feet[foot].y += Math.min(0.06, (to - from) * 0.3) * Math.sin(Math.PI * u) ** 2;
        this.planted[foot] = !active || u === 0 || u === 1;
      }
      return this;
    }
    const time = clamp(clock, 0, 5.2),
      period = 0.2;
    const index = Math.min(25, Math.floor(time / period)),
      u = clamp(time / period - index, 0, 1);
    for (const foot of [0, 1] as const) {
      const active = index % 2 === foot;
      const previous = index - (active ? 2 : 1);
      const from = Math.max(0, (previous + 1) * period);
      this.anchor(from, role, wheel, phase, load, floor, spread, foot, this.start);
      this.anchor((index + 1) * period, role, wheel, phase, load, floor, spread, foot, this.end);
      const distance = this.start.distanceTo(this.end);
      this.feet[foot].copy(this.start);
      if (active) {
        this.feet[foot].lerp(this.end, smooth(0, 1, u));
        this.feet[foot].y += Math.min(0.06, distance * 0.3) * Math.sin(Math.PI * u) ** 2;
      }
      this.planted[foot] = !active || distance < 1e-8 || u === 0 || u === 1;
    }
    return this;
  }
}
