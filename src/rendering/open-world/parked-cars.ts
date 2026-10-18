import * as T from 'three';
import type { FestivalEvent } from '../../simulation/open-world/festival-events.ts';
import { StructureGrid, type Structure } from '../../simulation/open-world/placement.ts';
import { ROAD_CLASSES } from '../../simulation/open-world/region-data.ts';
import { pathPoint } from '../../simulation/open-world/route-path.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import { trackPoint } from '../../simulation/track.ts';
import {
  trafficPaint,
  type ParkedSite,
  type ParkedSpot,
  type TrafficBody,
} from '../traffic-cars.ts';
import { LOT, type ArchitecturePlan } from './japan-architecture.ts';

type Height = (x: number, z: number, y?: number) => number;

/** Where the festival's parked cars stand (refs 012, 025, 076, 080-083):
 *
 * - the two stand-alone convenience stores: nose-in in their 2.5 x 5.0 m
 *   bays (about three in four taken, a quarter reversed in);
 * - the town coin parks (town-life.ts bays);
 * - the Kestrel hub meet: angled rows on the apron beyond the marquees,
 *   facing the strip, brighter paints, lamps on at night.
 *
 * Bodies are the ambient traffic's that fit a 5 m bay (no light truck). */
const BAY_BODIES: readonly (readonly [TrafficBody, number])[] = [
  ['kei', 28],
  ['hatch', 22],
  ['sedan', 22],
  ['minivan', 20],
  ['keiTruck', 8],
];
/** Meet paints: saturated enthusiast colours over the everyday neutrals. */
const MEET_PAINT = [
  0xc4141a, 0x1f4fa3, 0xe8e9e4, 0x111315, 0xd9c25a, 0xe05a12, 0x2f8a5a, 0x6a3fa0, 0x86aeb6,
  0x7d1a1e, 0x1a9bb0, 0xa7abaf, 0xf2d21b,
];
function hash(...values: number[]) {
  let h = 0x2545f491;
  for (const v of values) h = Math.imul(h ^ (Math.round(v * 8) | 0), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
function body(r: number): TrafficBody {
  const total = BAY_BODIES.reduce((a, b) => a + b[1], 0);
  let x = r * total;
  for (const [b, w] of BAY_BODIES) if ((x -= w) < 0) return b;
  return 'kei';
}

export function parkedSites(
  world: OpenWorld,
  structures: readonly Structure[],
  plan: ArchitecturePlan,
  events: readonly FestivalEvent[],
  coinBays: readonly { x: number; y: number; z: number; yaw: number; lot: number }[],
  height: Height,
): ParkedSite[] {
  const sites: ParkedSite[] = [];
  let id = 9000;
  // Convenience-store car parks (festival-signage.ts konbini bay layout).
  for (const [i, side] of plan.lotSide) {
    const s = structures[i],
      front = plan.front[i],
      c = Math.cos(s.heading),
      n = Math.sin(s.heading);
    const at = (x: number, z: number) =>
      [
        s.x + c * side * x - n * front * (s.hz + z),
        s.z + n * side * x + c * front * (s.hz + z),
      ] as const;
    const lot0 = s.hx + LOT.offset,
      deep = s.hz * 2,
      bays = Math.floor((LOT.length - 1) / 2.5),
      rows = [-2.9];
    if (deep >= 16.4) rows.push(-deep + 2.7);
    const spots: ParkedSpot[] = [];
    const back = Math.atan2(n * front, -c * front);
    for (const z of rows)
      for (let k = 0; k < bays; k++) {
        const r = hash(i, k, z);
        if (r > 0.74) continue;
        const [x, w] = at(lot0 + 0.5 + k * 2.5 + 1.25, z);
        spots.push({
          x,
          y: height(x, w) + 0.03,
          z: w,
          yaw: back + (hash(i, k, 7) < 0.25 ? Math.PI : 0) + (hash(i, k, 9) - 0.5) * 0.06,
          body: body(hash(i, k, 3)),
          paint: trafficPaint(id + k),
          plate: id + k * 7,
          lit: false,
        });
        id++;
      }
    const [cx, cz] = at(lot0 + LOT.length / 2, -deep / 2);
    sites.push({ name: `store ${i}`, centre: new T.Vector3(cx, height(cx, cz), cz), spots });
  }
  // Coin parks: about two in three bays taken.
  const lots = new Map<number, ParkedSpot[]>();
  for (const b of coinBays) {
    if (hash(b.x, b.z) > 0.68) continue;
    const list = lots.get(b.lot) ?? [];
    list.push({
      x: b.x,
      y: b.y,
      z: b.z,
      yaw: b.yaw + (hash(b.x, 5) < 0.2 ? Math.PI : 0),
      body: body(hash(b.z, 3)),
      paint: trafficPaint(++id),
      plate: id * 3,
      lit: false,
    });
    lots.set(b.lot, list);
  }
  for (const [lot, spots] of lots) {
    const centre = spots
      .reduce((a, s) => a.add(new T.Vector3(s.x, s.y, s.z)), new T.Vector3())
      .multiplyScalar(1 / spots.length);
    sites.push({ name: `coin park ${lot}`, centre, spots });
  }
  // The hub meet: two angled rows each side, beyond the marquees.
  const hub = events.find((e) => e.spec.id === 'runway-launch');
  if (hub) {
    const p = hub.path.at(0, pathPoint()),
      net = world.network,
      q = trackPoint(),
      grid = new StructureGrid(structures);
    const edge = net.edges[p.edge];
    const half = Math.min(23, p.halfWidth + ROAD_CLASSES[edge.roadClass].shoulder + 0.9) + 0.6;
    const l = Math.hypot(p.tx, p.tz) || 1,
      fx = p.tx / l,
      fz = p.tz / l,
      lx = fz,
      lz = -fx;
    const clear = (x: number, z: number) => {
      const lateral = net.nearest(x, z, q),
        e = net.edges[net.edgeOf[net.lastSegment]];
      return (
        Math.abs(lateral) > e.spec.halfWidth + e.spec.shoulder + 1.5 &&
        !grid.blocks(x, z, 3) &&
        height(x, z) > world.region.seaLevel + 0.5
      );
    };
    const spots: ParkedSpot[] = [];
    for (const side of [1, -1])
      for (const row of [0, 1])
        for (let k = 0; k < 14; k++) {
          const lateral = side * (half + 25 + row * 7),
            along = 2 + k * 3.4 + row * 1.7,
            x = p.x + lx * lateral + fx * along,
            z = p.z + lz * lateral + fz * along;
          if (!clear(x, z) || hash(side, row, k) > 0.86) continue;
          // Nose toward the strip, angled 55 deg to the row.
          const toStrip = Math.atan2(-lx * side, -lz * side);
          spots.push({
            x,
            y: height(x, z) + 0.02,
            z,
            yaw: toStrip + side * 0.6,
            body: (['sedan', 'hatch', 'kei', 'minivan', 'sedan', 'hatch'] as const)[
              Math.floor(hash(k, row, side, 2) * 6)
            ],
            paint: MEET_PAINT[Math.floor(hash(k, row, side, 4) * MEET_PAINT.length)],
            plate: ++id * 5,
            lit: hash(k, row, side, 6) < 0.6,
          });
        }
    if (spots.length)
      sites.push({
        name: 'Kestrel hub meet',
        centre: new T.Vector3(p.x + fx * 25, p.y, p.z + fz * 25),
        spots,
      });
  }
  return sites;
}
