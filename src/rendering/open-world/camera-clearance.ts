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
  for (const s of structures) {
    if (Math.hypot(s.x - start.x, s.z - start.z) > length + Math.hypot(s.hx, s.hz) + padding)
      continue;
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
