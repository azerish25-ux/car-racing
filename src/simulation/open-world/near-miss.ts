import type { Vehicle } from '../vehicle.ts';
import type { TrafficCar } from './ambient-traffic.ts';

export interface PassDriver {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  speed: number;
  halfWidth: number;
  halfLength: number;
}
export interface PassTraffic {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  halfWidth: number;
  halfLength: number;
  stunned: boolean;
}
interface Encounter {
  id: number;
  ahead: number;
  armed: boolean;
  clear: boolean;
  invalid: boolean;
  awarded: boolean;
  seen: number;
  x: number;
  z: number;
}

/** A genuine front-to-back, non-contact pass. Capacity and encounter state
 * are bounded; spawning alongside, bridge crossings, reversing, teleporting,
 * stationary wheelspin and repeated hovering cannot manufacture bonuses. */
export class NearMissDetector {
  private readonly encounters = new Map<number, Encounter>();
  private clock = 0;
  private x = NaN;
  private z = NaN;
  private readonly driver: PassDriver = {
    x: 0,
    y: 0,
    z: 0,
    fx: 0,
    fz: 1,
    speed: 0,
    halfWidth: 1,
    halfLength: 2,
  };
  private readonly other: PassTraffic = {
    id: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    speed: 0,
    halfWidth: 1,
    halfLength: 2,
    stunned: false,
  };
  reset() {
    this.encounters.clear();
    this.x = this.z = NaN;
  }
  get size() {
    return this.encounters.size;
  }

  begin(driver: PassDriver, dt: number, valid: boolean): boolean {
    if (
      !valid ||
      !Number.isFinite(dt) ||
      dt <= 0 ||
      dt > 0.25 ||
      !Number.isFinite(driver.x + driver.y + driver.z + driver.speed + driver.fx + driver.fz) ||
      driver.speed < 14 ||
      Math.abs(Math.hypot(driver.fx, driver.fz) - 1) > 0.04
    ) {
      this.reset();
      return false;
    }
    if (
      Number.isFinite(this.x) &&
      Math.hypot(driver.x - this.x, driver.z - this.z) > Math.max(4, driver.speed * dt * 2 + 1)
    )
      this.reset();
    this.clock += dt;
    this.x = driver.x;
    this.z = driver.z;
    for (const [id, e] of this.encounters) if (this.clock - e.seen > 2) this.encounters.delete(id);
    return true;
  }

  observe(p: PassDriver, t: PassTraffic, dt: number): boolean {
    if (!Number.isFinite(t.x + t.y + t.z + t.yaw + t.speed)) return false;
    const dx = t.x - p.x,
      dz = t.z - p.z;
    const ahead = dx * p.fx + dz * p.fz;
    const side = Math.abs(dx * p.fz - dz * p.fx);
    const alignment = Math.cos(t.yaw) * p.fz + Math.sin(t.yaw) * p.fx;
    const crossing = Math.sqrt(Math.max(0, 1 - alignment * alignment));
    const clearance =
      side - p.halfWidth - (Math.abs(alignment) * t.halfWidth + crossing * t.halfLength);
    const length = p.halfLength + Math.abs(alignment) * t.halfLength + crossing * t.halfWidth;
    let e = this.encounters.get(t.id);
    if (!e) {
      if (this.encounters.size >= 24 || Math.abs(ahead) > 70 || side > 9) return false;
      e = {
        id: t.id,
        ahead,
        armed: ahead > length + 2,
        clear: false,
        invalid: false,
        awarded: false,
        seen: this.clock,
        x: t.x,
        z: t.z,
      };
      this.encounters.set(t.id, e);
    }
    const closing = (e.ahead - ahead) / Math.max(dt, 1e-4);
    const jump = Math.hypot(t.x - e.x, t.z - e.z) > Math.max(5, Math.abs(t.speed) * dt * 2 + 1);
    e.seen = this.clock;
    e.x = t.x;
    e.z = t.z;
    if (
      t.stunned ||
      Math.abs(t.y - p.y) > 1.65 ||
      Math.abs(alignment) < 0.82 ||
      jump ||
      closing < -2
    )
      e.invalid = true;
    if (Math.abs(ahead) < length + 0.6) {
      if (clearance < 0.2 || clearance > 1.35) e.invalid = true;
      else if (closing > 3) e.clear = true;
    }
    const passed = e.ahead >= -length - 2 && ahead < -length - 2;
    e.ahead = ahead;
    if (passed && e.armed && e.clear && !e.invalid && !e.awarded && closing > 3) {
      e.awarded = true;
      return true;
    }
    return false;
  }

  /** Adapter keeps the detector's geometry test independent of the physics
   * engine while consuming its actual post-contact poses in production. */
  update(player: Vehicle, traffic: readonly TrafficCar[], dt: number, valid: boolean): number {
    const p = this.driver,
      body = player.body;
    p.x = body.position.x;
    p.y = body.position.y;
    p.z = body.position.z;
    const length = Math.hypot(player.forward.x, player.forward.z);
    p.fx = player.forward.x / Math.max(length, 1e-6);
    p.fz = player.forward.z / Math.max(length, 1e-6);
    p.speed = player.localVelocity.z;
    p.halfWidth = player.definition.halfExtents[0];
    p.halfLength = player.definition.halfExtents[2];
    if (!this.begin(p, dt, valid)) return 0;
    let count = 0;
    for (const car of traffic) {
      const t = this.other;
      t.id = car.id;
      t.x = car.position.x;
      t.y = car.position.y;
      t.z = car.position.z;
      t.speed = car.speed;
      t.yaw = car.yaw;
      t.halfWidth = car.half[0];
      t.halfLength = car.half[2];
      t.stunned = car.stunned > 0;
      if (this.observe(p, t, dt)) count++;
    }
    return Math.min(1, count);
  }
}
