import { trackPoint } from '../../../simulation/track.ts';
import { roadCandidates, type RoadNetwork } from '../../../simulation/open-world/road-network.ts';
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

/** A bounded four-sided roof profile. Its eaves follow every original edge,
 * including re-entrant corners; no convex hull bridges a mapped courtyard.
 * Pitch/run are authored estimates when the source only says "mansard". */
export function mansardHeight(
  polygon: readonly SurveyPoint[],
  eave: number,
  rise: number,
  run: number,
) {
  const contact = { depth: 0, nx: 0, nz: 0 };
  return (point: SurveyPoint): number => {
    polygonContact(polygon, point[0], point[1], contact);
    return eave + Math.max(0, rise) * Math.min(1, contact.depth / Math.max(0.1, run));
  };
}

/** Uniform subdivision of an existing polygon triangulation. All triangles
 * use the same depth so shared edges have identical samples (no T-junctions).
 * The cap bounds work on large or unexpectedly detailed source footprints. */
export function subdivideRoof(
  polygon: readonly SurveyPoint[],
  triangles: readonly (readonly number[])[],
  targetEdge = 3,
  maxDepth = 4,
): [SurveyPoint, SurveyPoint, SurveyPoint][] {
  if (!(targetEdge > 0) || !Number.isFinite(targetEdge)) throw new Error('Invalid roof edge size');
  const source = triangles.map((indices) => indices.map((i) => polygon[i]));
  if (source.some((t) => t.length !== 3 || t.some((p) => !p || !Number.isFinite(p[0] + p[1]))))
    throw new Error('Invalid roof triangulation');
  let longest = 0;
  for (const t of source)
    for (let i = 0; i < 3; i++)
      longest = Math.max(
        longest,
        Math.hypot(t[i][0] - t[(i + 1) % 3][0], t[i][1] - t[(i + 1) % 3][1]),
      );
  const depth = Math.min(
    Math.max(0, Math.min(5, Math.floor(maxDepth))),
    Math.max(0, Math.ceil(Math.log2(longest / targetEdge))),
  );
  let parts = source as [SurveyPoint, SurveyPoint, SurveyPoint][];
  const mid = (a: SurveyPoint, b: SurveyPoint): SurveyPoint => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  for (let level = 0; level < depth; level++) {
    const next: typeof parts = [];
    for (const [a, b, c] of parts) {
      const ab = mid(a, b),
        bc = mid(b, c),
        ca = mid(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    parts = next;
  }
  return parts;
}

type GroundVertex = readonly [number, number, number];
export type CrosswalkPanel = readonly [GroundVertex, GroundVertex, GroundVertex, GroundVertex];
/** Render-only zebra paint over the same sampled ribbon as the road mesh.
 * Split at road samples and the crown so a stripe cannot bridge either as a
 * floating flat box. Clamp to this edge: station gaps are not adjoining roads.
 * Crossing locations come from the survey; widths/style remain estimates. */
export function crosswalkPanels(network: RoadNetwork, station: number): CrosswalkPanel[] {
  if (!Number.isFinite(station) || !network.edges.length) return [];
  const edge = network.edgeAt(station),
    { halfWidth, crown } = edge.spec;
  const start = Math.max(edge.offset, station - 1.35);
  const end = Math.min(edge.offset + edge.length, station + 1.35);
  if (end - start < 0.01) return [];
  const stations = [start];
  for (let i = edge.first; i <= edge.last; i++)
    if (network.s[i] > start + 1e-6 && network.s[i] < end - 1e-6) stations.push(network.s[i]);
  // Junction surfaces can overlap at different crown heights. Short panels
  // keep the paint close to that visible envelope without editing the roads.
  for (let s = start + 0.45; s < end - 1e-6; s += 0.45) stations.push(s);
  stations.push(end);
  stations.sort((a, b) => a - b);
  const candidates = roadCandidates(),
    probe = trackPoint();
  const ground = (x: number, z: number, base: number) => {
    let y = base;
    network.covering(x, z, base, 0, candidates);
    for (let i = 0; i < candidates.count; i++) {
      const segment = candidates.segment[i],
        road = network.edges[network.edgeOf[segment]];
      network.pointOnSegment(segment, candidates.t[i], probe);
      const lateral = (x - probe.x) * probe.nx + (z - probe.z) * probe.nz;
      if (candidates.distance[i] > road.spec.halfWidth + 0.001) continue;
      y = Math.max(y, network.surfaceHeight(probe, lateral, road.spec.halfWidth, road.spec.crown));
    }
    return y;
  };
  const panels: CrosswalkPanel[] = [],
    a = trackPoint(),
    b = trackPoint();
  for (let i = 1; i < stations.length; i++) {
    if (stations[i] - stations[i - 1] < 1e-6) continue;
    network.at(stations[i - 1], a);
    network.at(stations[i], b);
    for (let centre = -halfWidth + 0.6; centre + 0.24 < halfWidth - 0.3; centre += 1.1) {
      const left = centre - 0.24,
        right = centre + 0.24;
      const cuts = [
        left,
        ...[-halfWidth * 0.5, 0, halfWidth * 0.5].filter((n) => n > left && n < right),
        right,
      ];
      const vertex = (p: typeof a, lateral: number): GroundVertex => {
        const x = p.x + p.nx * lateral,
          z = p.z + p.nz * lateral;
        return [x, ground(x, z, network.surfaceHeight(p, lateral, halfWidth, crown)) + 0.008, z];
      };
      for (let j = 1; j < cuts.length; j++)
        panels.push([
          vertex(a, cuts[j - 1]),
          vertex(a, cuts[j]),
          vertex(b, cuts[j]),
          vertex(b, cuts[j - 1]),
        ]);
    }
  }
  return panels;
}
