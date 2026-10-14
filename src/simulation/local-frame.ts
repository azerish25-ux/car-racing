import { G } from '../core/math.ts';

/** Local-frame and magnetic-adhesion experiment (WP43, masterplan §16.2).
 * An explicit fantasy-physics family, never a patch inside the Formula
 * solver: magnetic attachment exists only inside authored zones, its force
 * is bounded and stated, detachment inherits velocity, and reattachment has
 * a defined capture rule. Frames are rotation-minimizing (double reflection),
 * so a loop never reverses its normal because of an arbitrary spline frame. */
export interface V3 {
  x: number;
  y: number;
  z: number;
}
export interface Frame {
  p: V3;
  t: V3;
  n: V3;
  s: number;
}
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3, k = 1): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V3) => Math.sqrt(dot(a, a));
const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const unit = (a: V3) => scale(a, 1 / (len(a) || 1));
/** Rotation-minimizing frames along a polyline (Wang et al. 2008). */
export function rotationMinimizingFrames(points: readonly V3[], initialNormal: V3): Frame[] {
  const frames: Frame[] = [];
  let s = 0;
  const tangent = (i: number) =>
    unit(sub(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]));
  let t = tangent(0),
    n = unit(add(initialNormal, t, -dot(initialNormal, t)));
  frames.push({ p: points[0], t, n, s });
  for (let i = 1; i < points.length; i++) {
    const v1 = sub(points[i], points[i - 1]),
      c1 = dot(v1, v1);
    s += Math.sqrt(c1);
    const rL = add(n, v1, (-2 * dot(v1, n)) / c1),
      tL = add(t, v1, (-2 * dot(v1, t)) / c1);
    const t2 = tangent(i),
      v2 = sub(t2, tL),
      c2 = dot(v2, v2) || 1e-12;
    n = unit(add(rL, v2, (-2 * dot(v2, rL)) / c2));
    t = t2;
    frames.push({ p: points[i], t, n, s });
  }
  return frames;
}
export interface MagneticZone {
  start: number;
  end: number;
  /** Maximum adhesion acceleration toward the surface (m/s²). */
  adhesion: number;
}
/** A vehicle on a single magnetic route: attached (moving along the frames)
 * or airborne (free flight with inherited velocity). */
export class MagneticRider {
  attached = true;
  s = 0;
  speed = 0;
  position: V3;
  velocity: V3 = { x: 0, y: 0, z: 0 };
  detachments = 0;
  /** Seconds since the last detachment (capture needs a real flight). */
  airborne = 0;
  constructor(
    readonly frames: readonly Frame[],
    readonly zones: readonly MagneticZone[],
    s = 0,
    speed = 0,
  ) {
    this.s = s;
    this.speed = speed;
    this.position = this.frameAt(s).p;
  }
  frameAt(s: number): Frame {
    const f = this.frames,
      total = f[f.length - 1].s;
    s = ((s % total) + total) % total;
    let lo = 0,
      hi = f.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const k = (s - f[lo].s) / (f[hi].s - f[lo].s || 1);
    return {
      p: add(f[lo].p, sub(f[hi].p, f[lo].p), k),
      t: unit(add(f[lo].t, sub(f[hi].t, f[lo].t), k)),
      n: unit(add(f[lo].n, sub(f[hi].n, f[lo].n), k)),
      s,
    };
  }
  adhesionAt(s: number) {
    for (const z of this.zones) if (s >= z.start && s <= z.end) return z.adhesion;
    return 0;
  }
  step(drive: number, dt: number) {
    if (this.attached) {
      const here = this.frameAt(this.s),
        ahead = this.frameAt(this.s + 0.5);
      // Curvature component along the surface normal (toward the surface side).
      const kn = dot(sub(ahead.t, here.t), here.n) / 0.5;
      const gravity: V3 = { x: 0, y: -G, z: 0 };
      // Normal acceleration the surface must supply to keep the vehicle on it.
      const required = this.speed * this.speed * kn + dot(gravity, here.n) * -1;
      const available = this.adhesionAt(this.s);
      // Positive `required` means the surface must push (ordinary contact).
      if (required < -available) {
        this.attached = false;
        this.airborne = 0;
        this.detachments++;
        this.velocity = scale(here.t, this.speed);
        this.position = here.p;
      } else {
        this.speed = Math.max(0, this.speed + (drive + dot(gravity, here.t)) * dt);
        this.s += this.speed * dt;
        const next = this.frameAt(this.s);
        this.position = next.p;
        this.velocity = scale(next.t, this.speed);
        return;
      }
    }
    // Airborne: inherited velocity under gravity; no snap to upright.
    this.airborne += dt;
    this.velocity = add(this.velocity, { x: 0, y: -G, z: 0 }, dt);
    this.position = add(this.position, this.velocity, dt);
    // Capture: after a real flight, close to an adhesive surface and closing
    // on it. Leaving the edge of a zone cannot be "recaptured" in place.
    if (this.airborne < 0.15) return;
    for (let i = 0; i < this.frames.length; i += 2) {
      const f = this.frames[i],
        gap = dot(sub(this.position, f.p), f.n);
      if (
        Math.abs(gap) < 0.4 &&
        len(sub(this.position, add(f.p, f.n, gap))) < 1 &&
        this.adhesionAt(f.s) > 0 &&
        dot(this.velocity, f.n) < -0.2
      ) {
        this.attached = true;
        this.s = f.s;
        this.speed = Math.max(0, dot(this.velocity, f.t));
        this.position = f.p;
        return;
      }
    }
  }
}
/** Vertical loop of radius r in the x-y plane, surface normal toward centre. */
export function loopPoints(radius: number, count = 360): V3[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: radius * Math.cos(a), y: radius + radius * Math.sin(a), z: (i / count) * 2 };
  });
}
