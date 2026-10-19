/** Geographic ground plans are open data. Unmeasured elevations and façade
 * treatments are explicitly estimates, not claims of photographic parity. */
export type SurveyPoint = readonly [number, number];
export interface SurveyBuilding {
  id: string;
  footprint: readonly SurveyPoint[];
  height: number;
  floors: number;
  heightSource: string;
  tags: Readonly<Record<string, string>>;
}
export interface SurveyArea {
  id: string;
  name: string;
  points: readonly SurveyPoint[];
  kind?: string;
}
export interface StreetSurvey {
  buildings: readonly SurveyBuilding[];
  greens: readonly SurveyArea[];
  parking: readonly SurveyArea[];
  footways: readonly { id: string; points: readonly SurveyPoint[]; width: number; kind: string }[];
  trees: readonly { id: string; x: number; z: number; height: number; heightSource: string }[];
  streetNodes: readonly { id: string; kind: string; x: number; z: number }[];
  route: readonly SurveyPoint[];
  stations: readonly { id: number; x: number; z: number }[];
}
/** Ray crossing on the original footprint (also handles concave buildings). */
export function polygonContains(points: readonly SurveyPoint[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}
export interface BoundaryContact {
  depth: number;
  nx: number;
  nz: number;
}
/** Closest boundary normal from an interior point. No allocation in physics. */
export function polygonContact(
  points: readonly SurveyPoint[],
  x: number,
  z: number,
  out: BoundaryContact,
) {
  let d2 = Infinity,
    ox = 0,
    oz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)),
    );
    const ex = a[0] + dx * t - x,
      ez = a[1] + dz * t - z;
    const q = ex * ex + ez * ez;
    if (q < d2) {
      d2 = q;
      ox = ex;
      oz = ez;
    }
  }
  out.depth = Math.sqrt(d2);
  out.nx = out.depth > 1e-8 ? ox / out.depth : 1;
  out.nz = out.depth > 1e-8 ? oz / out.depth : 0;
  return out;
}
