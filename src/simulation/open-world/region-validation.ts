import { validateRoute } from '../route-graph.ts';
import { resolveEvents } from './festival-events.ts';
import { ROAD_CLASSES, SOLVANE, type RegionDefinition } from './region-data.ts';
import type { RoadNetwork } from './road-network.ts';
import { OpenWorld } from './world.ts';

/** Minimum drivable extent (m) and road length (km) of a festival region. */
export const REGION_MIN_SIZE = 8000;
export const REGION_MIN_ROAD_KM = 60;
const RACES = new Set(['road-race', 'circuit', 'sprint', 'showcase']);

/** Field-level checks of a region definition, without building it. */
export function validateRegionDefinition(region: RegionDefinition): string[] {
  const errors: string[] = [],
    at = `region ${region.id || '?'}`;
  if (!region.id) errors.push('region: missing id');
  if (!(region.half * 2 >= REGION_MIN_SIZE)) errors.push(`${at}: ${region.half * 2} m is below ${REGION_MIN_SIZE} m`);
  if (!Number.isInteger(region.seed)) errors.push(`${at}: seed must be an integer`);
  const inside = ([x, z]: readonly [number, number]) =>
    Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) <= region.half && Math.abs(z) <= region.half;
  for (let i = 1; i < region.coast.length; i++)
    if (!(region.coast[i][0] > region.coast[i - 1][0])) errors.push(`${at}: coast x must increase (point ${i})`);
  const roads = new Set<string>();
  for (const road of region.roads) {
    const r = `${at} road ${road.id}`;
    if (roads.has(road.id)) errors.push(`${r}: duplicate id`);
    roads.add(road.id);
    if (!ROAD_CLASSES[road.roadClass]) errors.push(`${r}: unknown class ${road.roadClass}`);
    if (road.points.length < (road.closed ? 3 : 2)) errors.push(`${r}: too few points`);
    road.points.forEach((p, i) => {
      if (!inside(p)) errors.push(`${r}: point ${i} outside the region`);
    });
  }
  for (const o of region.overpasses) {
    if (!roads.has(o.over) || !roads.has(o.under)) errors.push(`${at} overpass ${o.over}/${o.under}: unknown road`);
    if (o.over === o.under) errors.push(`${at} overpass ${o.over}: a road cannot cross itself`);
  }
  const events = new Set<string>();
  for (const e of region.events) {
    const r = `${at} event ${e.id}`;
    if (events.has(e.id)) errors.push(`${r}: duplicate id`);
    events.add(e.id);
    if (e.waypoints.length < 2) errors.push(`${r}: needs at least two waypoints`);
    e.waypoints.forEach((p, i) => {
      if (!inside(p)) errors.push(`${r}: waypoint ${i} outside the region`);
    });
    if (e.laps !== undefined && (e.kind !== 'circuit' || !Number.isInteger(e.laps) || e.laps < 1))
      errors.push(`${r}: laps are whole numbers on circuits only`);
    if (e.rivals !== undefined && (!RACES.has(e.kind) || !Number.isInteger(e.rivals) || e.rivals < 0 || e.rivals > 11))
      errors.push(`${r}: rivals (0..11) belong to races only`);
    if (e.stars) {
      // Showcase stars are times (lower is better); the others are scores.
      const ok = e.kind === 'showcase' ? e.stars[0] > e.stars[1] && e.stars[1] > e.stars[2] : e.stars[0] < e.stars[1] && e.stars[1] < e.stars[2];
      if (!ok) errors.push(`${r}: star targets must get harder from one to three stars`);
    } else if (!RACES.has(e.kind) || e.kind === 'showcase') errors.push(`${r}: skill challenge without star targets`);
  }
  return errors;
}

/** Control points shared by two or more roads are junctions: the built
 * network must join every road branch there (an end is one branch, a
 * through road two). Catches a crossroads authored as two road ends on a
 * third road's control point that the snapping leaves unconnected. */
export function sharedPointErrors(region: RegionDefinition, network: RoadNetwork): string[] {
  const errors: string[] = [],
    shared = new Map<string, { x: number; z: number; roads: string[]; branches: number }>();
  for (const road of region.roads)
    road.points.forEach(([x, z], i) => {
      const key = `${x},${z}`,
        end = !road.closed && (i === 0 || i === road.points.length - 1),
        entry = shared.get(key) ?? { x, z, roads: [], branches: 0 };
      if (entry.roads.includes(road.id)) return;
      entry.roads.push(road.id);
      entry.branches += end ? 1 : 2;
      shared.set(key, entry);
    });
  for (const point of shared.values()) {
    if (point.roads.length < 2) continue;
    // Authored grade separations share no junction.
    const overpass = region.overpasses.some((o) => point.roads.includes(o.over) && point.roads.includes(o.under));
    if (overpass) continue;
    let node: RoadNetwork['nodes'][number] | null = null,
      best = 8;
    for (const n of network.nodes) {
      const d = Math.hypot(n.x - point.x, n.z - point.z);
      if (n.edges.length && d < best) {
        best = d;
        node = n;
      }
    }
    // A loop edge (from and to the same node) is two branches.
    const branches = node
      ? node.edges.reduce((sum, e) => sum + (network.edges[e].from === network.edges[e].to ? 2 : 1), 0)
      : 0;
    if (branches !== point.branches)
      errors.push(
        `roads ${point.roads.join(', ')} share (${point.x}, ${point.z}) but the junction there joins ${branches} of ${point.branches} road branches`,
      );
  }
  return errors;
}
/** Full check: the definition, then the built network as one valid
 * RouteGraph of at least REGION_MIN_ROAD_KM, and every event route. */
export function validateRegion(region: RegionDefinition = SOLVANE): string[] {
  const errors = validateRegionDefinition(region);
  if (errors.length) return errors;
  const at = `region ${region.id}`;
  try {
    const world = new OpenWorld(region),
      stats = world.network.stats();
    if (stats.totalKm < REGION_MIN_ROAD_KM) errors.push(`${at}: ${stats.totalKm} km of road is below ${REGION_MIN_ROAD_KM} km`);
    for (const error of validateRoute(world.network.routeSpec())) errors.push(`${at} network: ${error}`);
    for (const error of sharedPointErrors(region, world.network)) errors.push(`${at} network: ${error}`);
    resolveEvents(world);
  } catch (error) {
    errors.push(`${at}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return errors;
}
