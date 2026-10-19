import { polygonContains, polygonContact } from '../../simulation/open-world/survey.ts';
import type { Structure } from '../../simulation/open-world/placement.ts';

export interface CameraPoint {
  x: number;
  y: number;
  z: number;
}

/** Shorten a camera boom against the same oriented footprints as driving.
 * Three-dimensional slabs deliberately ignore roofs below/above the boom.
 * The output may alias `end`. No raycaster, render mesh or per-frame array. */
export function clearCameraBoom(
  start: CameraPoint,
  end: CameraPoint,
  structures: readonly Structure[],
  out: CameraPoint,
  padding = 0.38,
): boolean {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    dz = end.z - start.z;
  const length = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(length) || length < 1e-6) {
    out.x = end.x;
    out.y = end.y;
    out.z = end.z;
    return false;
  }
  let fraction = 1;
  const boundary = { depth: 0, nx: 0, nz: 0 };
  for (const s of structures) {
    if (Math.hypot(s.x - start.x, s.z - start.z) > length + Math.hypot(s.hx, s.hz) + padding)
      continue;
    if (s.footprint) {
      const footprint = s.footprint;
      const blocked = (t: number) => {
        const y = start.y + dy * t;
        if (y < s.base - padding || y > s.base + s.height + padding) return false;
        const x = start.x + dx * t,
          z = start.z + dz * t;
        return (
          polygonContains(footprint, x, z) ||
          polygonContact(footprint, x, z, boundary).depth <= padding
        );
      };
      if (blocked(0)) continue;
      // Sampling only the short camera boom, followed by binary refinement.
      // Padding exceeds the sample interval, so thin walls cannot be skipped.
      const steps = Math.max(1, Math.ceil((length * fraction) / Math.max(0.025, padding * 0.45)));
      for (let i = 1; i <= steps; i++) {
        const t = (fraction * i) / steps;
        if (!blocked(t)) continue;
        let lo = (fraction * (i - 1)) / steps,
          hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          if (blocked(mid)) hi = mid;
          else lo = mid;
        }
        fraction = Math.max(0, lo - 0.04 / length);
        break;
      }
      continue;
    }
    const c = Math.cos(s.heading),
      n = Math.sin(s.heading);
    const x = (start.x - s.x) * c + (start.z - s.z) * n;
    const z = -(start.x - s.x) * n + (start.z - s.z) * c;
    const vx = dx * c + dz * n,
      vz = -dx * n + dz * c;
    const hx = s.hx + padding,
      hz = s.hz + padding;
    const low = s.base - padding,
      high = s.base + s.height + padding;
    // Recovery from an already penetrated structure cannot be solved by a
    // zero-length boom; do not pin the camera to the centre of the car.
    if (Math.abs(x) <= hx && Math.abs(z) <= hz && start.y >= low && start.y <= high) continue;
    let enter = 0,
      leave = fraction;
    for (let axis = 0; axis < 3; axis++) {
      const p = axis === 0 ? x : axis === 1 ? start.y : z;
      const v = axis === 0 ? vx : axis === 1 ? dy : vz;
      const min = axis === 0 ? -hx : axis === 1 ? low : -hz;
      const max = axis === 0 ? hx : axis === 1 ? high : hz;
      if (Math.abs(v) < 1e-9) {
        if (p < min || p > max) {
          enter = 2;
          break;
        }
      } else {
        const a = (min - p) / v,
          b = (max - p) / v;
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
        if (enter > leave) break;
      }
    }
    if (enter <= leave && enter < fraction) fraction = Math.max(0, enter - 0.04 / length);
  }
  out.x = start.x + dx * fraction;
  out.y = start.y + dy * fraction;
  out.z = start.z + dz * fraction;
  return fraction < 1;
}
