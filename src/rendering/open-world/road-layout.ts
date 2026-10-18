import type { RoadEdge, RoadNetwork } from '../../simulation/open-world/road-network.ts';

/** Japanese road-furniture layout shared by the painted markings (roads.ts)
 * and the roadside furniture (road-furniture.ts), so a painted 止まれ, its
 * stop line and the inverted-triangle sign agree, and the red anti-skid
 * surfacing, the カーブ text, chevron boards and mirrors mark the same bends.
 * Pure functions of the network: deterministic and testable without WebGL. */

/** Bend sharp enough for red anti-skid surfacing and chevrons (radius, m). */
export const SHARP_BEND_RADIUS = Object.freeze({ mountain: 60, country: 90 });
/** Surfacing beyond the measured bend at each end (m). */
const BEND_RUN_IN = 18;

export interface BendZone {
  /** Edge-local stations of the surfaced zone [s0, s1] (m). */
  s0: number;
  s1: number;
  /** Station of the sharpest sample and its signed curvature (+: left turn
   * in the edge's forward direction, Track convention). */
  apex: number;
  curvature: number;
}

/** Sharp bends of an edge (mountain and country roads only): samples tighter
 * than SHARP_BEND_RADIUS, merged across short gaps, extended by a run-in.
 * Junction mouths are excluded (the junction pad is level and shared). */
export function bendZones(net: RoadNetwork, e: RoadEdge): BendZone[] {
  const limit =
    e.roadClass === 'mountain'
      ? SHARP_BEND_RADIUS.mountain
      : e.roadClass === 'country'
        ? SHARP_BEND_RADIUS.country
        : 0;
  if (!limit || e.spec.surface !== 'asphalt') return [];
  const zones: BendZone[] = [];
  let open: BendZone | null = null;
  for (let i = e.first; i <= e.last; i++) {
    const k = net.curvature[i],
      s = net.s[i] - e.offset;
    if (Math.abs(k) * limit < 1) continue;
    if (open && s - open.s1 < 24 && Math.sign(k) === Math.sign(open.curvature)) {
      open.s1 = s;
      if (Math.abs(k) > Math.abs(open.curvature)) {
        open.curvature = k;
        open.apex = s;
      }
    } else zones.push((open = { s0: s, s1: s, apex: s, curvature: k }));
  }
  const clear = junctionClearance(net, e);
  return zones
    .map((z) => ({
      ...z,
      s0: Math.max(clear[0], z.s0 - BEND_RUN_IN),
      s1: Math.min(e.length - clear[1], z.s1 + BEND_RUN_IN),
    }))
    .filter((z) => z.s1 - z.s0 > 8);
}

/** Distance (m) from each end of an edge to where its own markings resume
 * beyond a junction box: past the cross street's footway, a 4 m crosswalk
 * band and the stop line. Dead ends and plain joints return 0. */
export function junctionClearance(net: RoadNetwork, e: RoadEdge): [number, number] {
  return [e.from, e.to].map((node) => {
    const n = net.nodes[node];
    if (n.edges.length < 3) return 0;
    let reach = 0;
    for (const index of n.edges) {
      const o = net.edges[index];
      if (o !== e) reach = Math.max(reach, o.spec.halfWidth + o.spec.shoulder);
    }
    return Math.max(e.spec.halfWidth + 9, reach + 8);
  }) as [number, number];
}

export interface Approach {
  edge: RoadEdge;
  node: number;
  /** Travel direction along the edge toward the node (+1 forward). */
  dir: 1 | -1;
  /** Edge-local station where the junction box (cross street footway plus
   * 1 m) begins, measured from the node along the edge (m). */
  mouth: number;
  /** Minor approach: must stop (止まれ, stop line, inverted triangle). */
  minor: boolean;
  /** Town junction: zebra crosswalk across this arm. */
  crossing: boolean;
}

/** Every arm of every junction with the major road identified by class
 * priority, then by the road's total length (the through street). */
export function junctionApproaches(net: RoadNetwork): Approach[] {
  const roadLength = new Map<string, number>();
  for (const e of net.edges) roadLength.set(e.road.id, (roadLength.get(e.road.id) ?? 0) + e.length);
  const out: Approach[] = [];
  net.nodes.forEach((n, node) => {
    if (n.edges.length < 3) return;
    const arms = n.edges.map((i) => net.edges[i]);
    const rank = (e: RoadEdge) => e.spec.priority * 1e6 + (roadLength.get(e.road.id) ?? 0);
    const major = arms.reduce((a, b) => (rank(b) > rank(a) ? b : a)).road.id;
    const town = arms.some((e) => e.roadClass === 'town');
    for (const e of arms) {
      let reach = 0;
      for (const o of arms)
        if (o !== e) reach = Math.max(reach, o.spec.halfWidth + o.spec.shoulder);
      for (const dir of [1, -1] as const) {
        if ((dir > 0 ? e.to : e.from) !== node) continue;
        out.push({
          edge: e,
          node,
          dir,
          mouth: reach + 1,
          minor: e.road.id !== major && e.spec.markings === 'centre',
          crossing: town && e.roadClass === 'town',
        });
      }
    }
  });
  return out;
}

/** Edge-local station `along` metres back from the node an approach enters. */
export function approachStation(a: Approach, along: number) {
  return a.dir > 0 ? a.edge.length - along : along;
}

/** Japanese centre line of a country road: the orange no-overtaking line
 * wherever sight lines are limited by a bend within ±120 m (radius under
 * 1.2 km), white broken line on long open straights. */
export function noOvertaking(net: RoadNetwork, e: RoadEdge): (s: number) => boolean {
  if (e.roadClass === 'mountain' || e.roadClass === 'highway') return () => true;
  if (e.roadClass !== 'country') return () => false;
  const n = e.last - e.first + 1,
    flag = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    if (Math.abs(net.curvature[e.first + c]) * 1200 < 1) continue;
    const s = net.s[e.first + c];
    for (let j = c; j >= 0 && s - net.s[e.first + j] <= 120; j--) flag[j] = 1;
    for (let j = c; j < n && net.s[e.first + j] - s <= 120; j++) flag[j] = 1;
  }
  return (s: number) => {
    let lo = 0,
      hi = n - 1;
    const target = e.offset + s;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (net.s[e.first + mid] <= target) lo = mid;
      else hi = mid;
    }
    return flag[lo] === 1;
  };
}
