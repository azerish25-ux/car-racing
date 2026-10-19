import {
  polygonContains,
  polygonContact,
  type SurveyPoint,
} from '../../../simulation/open-world/survey.ts';

/** CityBatch.box rotates its local X axis in XZ. Zebra bars are narrow across
 * the street (normal) and long along it (tangent), including oblique streets. */
export function crosswalkHeading(normalX: number, normalZ: number) {
  return Math.atan2(normalZ, normalX);
}

/** Return an interior, supported roof attachment, or omit it when there is
 * no safe site. Original triangulation preserves concave yards. Insets use
 * boundary distance, not just four corner checks (which can bridge a notch). */
export function roofAttachment(
  polygon: readonly SurveyPoint[],
  triangles: readonly (readonly number[])[],
  height: (point: SurveyPoint) => number,
  width: number,
  heading: number,
): { x: number; z: number; bottom: number; top: number } | null {
  if (polygon.length < 3 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(heading))
    return null;
  const boundary = { depth: 0, nx: 0, nz: 0 };
  const clearance = width / Math.SQRT2 + 0.12;
  let best: SurveyPoint | null = null;
  let bestClearance = clearance;
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map((index) => polygon[index]);
    if (!a || !b || !c) continue;
    // The incenter maximizes distance to the triangle's three sides.
    const ab = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const bc = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const sum = ab + bc + ca;
    if (sum < 1e-8) continue;
    const x = (bc * a[0] + ca * b[0] + ab * c[0]) / sum;
    const z = (bc * a[1] + ca * b[1] + ab * c[1]) / sum;
    if (!Number.isFinite(x + z) || !polygonContains(polygon, x, z)) continue;
    polygonContact(polygon, x, z, boundary);
    if (boundary.depth > bestClearance) {
      bestClearance = boundary.depth;
      best = [x, z];
    }
  }
  if (!best) return null;
  const co = Math.cos(heading),
    si = Math.sin(heading),
    half = width / 2;
  const levels = [height(best)];
  for (const u of [-half, half])
    for (const v of [-half, half]) {
      levels.push(height([best[0] + co * u - si * v, best[1] + si * u + co * v]));
    }
  if (levels.some((y) => !Number.isFinite(y))) return null;
  return {
    x: best[0],
    z: best[1],
    bottom: Math.min(...levels) - 0.2,
    top: Math.max(...levels) + 0.85,
  };
}
