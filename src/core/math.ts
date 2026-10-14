/** SI units. Right-handed body axes: +Z nose, +Y up, +X driver left. */
export const G = 9.80665,
  TAU = Math.PI * 2;
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** `values.every(Number.isFinite)` without boxing every element of a typed
 * array into a heap number: hot validation of frames and surface grids. */
export function allFinite(values: ArrayLike<number>) {
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return false;
  return true;
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mod = (x: number, n: number) => ((x % n) + n) % n;
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const approach = (a: number, b: number, step: number) => a + clamp(b - a, -step, step);
export const angleDifference = (a: number, b: number) => mod(a - b + Math.PI, TAU) - Math.PI;
export class Vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}
  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  distanceSq(v: Vec3) {
    return (this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2;
  }
  copy(v: Vec3) {
    return this.set(v.x, v.y, v.z);
  }
  add(v: Vec3) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  sub(v: Vec3) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  scale(s: number) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }
  addScaled(v: Vec3, s: number) {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  dot(v: Vec3) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  length() {
    return Math.hypot(this.x, this.y, this.z);
  }
  normalize() {
    const l = this.length();
    return l > 1e-12 ? this.scale(1 / l) : this.set(0, 1, 0);
  }
  cross(a: Vec3, b: Vec3) {
    return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  finite() {
    return Number.isFinite(this.x + this.y + this.z);
  }
}
export class Quat {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 1,
  ) {}
  yaw(a: number) {
    this.x = 0;
    this.y = Math.sin(a / 2);
    this.z = 0;
    this.w = Math.cos(a / 2);
    return this;
  }
  rotate(v: Vec3, out: Vec3) {
    const tx = 2 * (this.y * v.z - this.z * v.y),
      ty = 2 * (this.z * v.x - this.x * v.z),
      tz = 2 * (this.x * v.y - this.y * v.x);
    return out.set(
      v.x + this.w * tx + this.y * tz - this.z * ty,
      v.y + this.w * ty + this.z * tx - this.x * tz,
      v.z + this.w * tz + this.x * ty - this.y * tx,
    );
  }
  inverseRotate(v: Vec3, out: Vec3) {
    const tx = 2 * (-this.y * v.z + this.z * v.y),
      ty = 2 * (-this.z * v.x + this.x * v.z),
      tz = 2 * (-this.x * v.y + this.y * v.x);
    return out.set(
      v.x + this.w * tx - this.y * tz + this.z * ty,
      v.y + this.w * ty - this.z * tx + this.x * tz,
      v.z + this.w * tz - this.x * ty + this.y * tx,
    );
  }
  integrateWorld(w: Vec3, dt: number) {
    const h = dt * 0.5,
      x = this.x,
      y = this.y,
      z = this.z,
      s = this.w;
    this.x += h * (w.x * s + w.y * z - w.z * y);
    this.y += h * (-w.x * z + w.y * s + w.z * x);
    this.z += h * (w.x * y - w.y * x + w.z * s);
    this.w -= h * (w.x * x + w.y * y + w.z * z);
    const n = Math.hypot(this.x, this.y, this.z, this.w);
    this.x /= n;
    this.y /= n;
    this.z /= n;
    this.w /= n;
  }
}
/** Seeded generator; simulation never depends on Math.random. */
export class Random {
  constructor(private state = 18731) {}
  next() {
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x;
    return (x >>> 0) / 4294967296;
  }
}
export class FixedStepper {
  accumulator = 0;
  ticks = 0;
  droppedSeconds = 0;
  constructor(
    readonly dt = 1 / 120,
    readonly maxSteps = 24,
  ) {}
  advance(seconds: number, step: (dt: number) => void) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid clock delta');
    const admitted = Math.min(seconds, this.dt * this.maxSteps);
    this.droppedSeconds += seconds - admitted;
    this.accumulator += admitted;
    let n = 0;
    while (this.accumulator + 1e-10 >= this.dt && n < this.maxSteps) {
      step(this.dt);
      this.accumulator -= this.dt;
      this.ticks++;
      n++;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    return this.accumulator / this.dt;
  }
  reset() {
    this.accumulator = 0;
    this.ticks = 0;
    this.droppedSeconds = 0;
  }
}
