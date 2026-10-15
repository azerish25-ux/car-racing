import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { RouteGraph, RouteProgress, validateRoute } from '../src/simulation/route-graph.ts';
import { ROUTE_LAYER_GAP, SURFACE, Track, surfaceSample, trackPoint } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { resolveEvents } from '../src/simulation/open-world/festival-events.ts';
import { OpenWorldTrack, RUN_OUT, WORLD_SURFACE } from '../src/simulation/open-world/open-world-track.ts';
import { sharedPointErrors } from '../src/simulation/open-world/region-validation.ts';
import {
  regionStructures,
  StructureGrid,
  treesForTile,
  trunkRadius,
  TREE_STRIDE,
} from '../src/simulation/open-world/placement.ts';
import { buildTileData, TILE_TREE_STRIDE } from '../src/rendering/open-world/tile-data.ts';
import { TERRAIN_BUDGETS } from '../src/rendering/open-world/terrain.ts';
import { ROAD_CLASSES, SOLVANE, type RegionDefinition } from '../src/simulation/open-world/region-data.ts';
import { ROAD_FLAG, ROAD_LAYER_GAP, RoadNetwork, roadCandidates } from '../src/simulation/open-world/road-network.ts';
import { pathPoint, planRoute, RoutePath } from '../src/simulation/open-world/route-path.ts';
import { festivalDefaultVehicle, festivalVehicles } from '../src/simulation/open-world/session.ts';
import { TerrainField } from '../src/simulation/open-world/terrain-field.ts';
import { gridHeight, TerrainTileCache, TILE_RES, TILE_SIZE, TILE_STEP } from '../src/simulation/open-world/terrain-tiles.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { MATERIAL, surfaceMaterial } from '../src/simulation/surface-material.ts';

const world = openWorld();
const net = world.network;
/** First sample of an edge of `road` matching a predicate. */
function sampleOn(road: string, accept: (i: number) => boolean = () => true) {
  for (const e of net.edges)
    if (e.road.id === road)
      for (let i = e.first + 5; i < e.last - 5; i++) if (accept(i)) return i;
  throw new Error(`no sample on ${road}`);
}

describe('festival region terrain', () => {
  it('is at least 8 km square and deterministic from its seed', () => {
    expect(2 * SOLVANE.half).toBeGreaterThanOrEqual(8000);
    const a = new TerrainField(SOLVANE),
      b = new TerrainField(SOLVANE),
      other = new TerrainField({ ...SOLVANE, seed: SOLVANE.seed + 1 } as RegionDefinition);
    let differs = 0;
    for (let i = 0; i < 400; i++) {
      const x = -4000 + ((i * 7919) % 8000),
        z = -4000 + ((i * 104729) % 8000);
      expect(a.height(x, z)).toBe(b.height(x, z));
      if (Math.abs(a.height(x, z) - other.height(x, z)) > 0.5) differs++;
    }
    expect(differs).toBeGreaterThan(200);
    expect(a.flatHeights).toEqual(b.flatHeights);
  });
  it('has the authored features: sea, beach, mountain, valley, town and airfield flats', () => {
    const f = world.field;
    expect(f.height(0, -3800)).toBeLessThan(SOLVANE.seaLevel - 5);
    expect(f.height(-2900, 2450)).toBeGreaterThan(500);
    // The valley floor is well below the ground beside it.
    expect(f.height(-480, 520)).toBeLessThan(f.height(-480 + 600, 520 + 200) - 15);
    // Town and airfield are flat.
    const town = [f.height(800, -2500), f.height(1600, -2300), f.height(2000, -2600)];
    expect(Math.max(...town) - Math.min(...town)).toBeLessThan(8);
    const airfield = [f.height(1900, 1700), f.height(3400, 1800)];
    expect(Math.abs(airfield[0] - airfield[1])).toBeLessThan(1);
  });
});

describe('festival road network', () => {
  it('has at least 60 km of every road class with junctions and bridges', () => {
    const stats = net.stats();
    expect(stats.totalKm).toBeGreaterThanOrEqual(60);
    for (const cls of Object.keys(ROAD_CLASSES)) expect(stats.byClassKm[cls]).toBeGreaterThan(0.5);
    expect(stats.junctions).toBeGreaterThanOrEqual(20);
    expect(stats.bridges).toBeGreaterThanOrEqual(3);
    expect(stats.guardrailKm).toBeGreaterThan(1);
    expect(Object.keys(stats.bySpeedClassKm).length).toBeGreaterThanOrEqual(4);
  });
  it('is one connected directed RouteGraph (validateRoute) without U-turns at junctions', () => {
    const spec = net.routeSpec();
    expect(validateRoute(spec)).toEqual([]);
    const graph = new RouteGraph(spec);
    for (const e of spec.edges) {
      expect(graph.length(e.id)).toBeGreaterThan(0);
      const reverse = e.id.endsWith('+') ? e.id.replace(/\+$/, '-') : e.id.replace(/-$/, '+');
      const deadEnd = e.next.length === 1 && e.next[0] === reverse;
      if (!deadEnd) expect(e.next).not.toContain(reverse);
    }
  });
  it('keeps grades within each class (junction-forced spans excepted) and is deterministic', () => {
    let violations = 0,
      samples = 0;
    for (const e of net.edges)
      for (let i = e.first; i < e.last; i++) {
        samples++;
        const ds = net.s[i + 1] - net.s[i];
        if (ds > 0.5 && Math.abs(net.y[i + 1] - net.y[i]) / ds > e.spec.maxGrade * 1.5 + 0.01) violations++;
      }
    expect(violations / samples).toBeLessThan(0.01);
    const again = new RoadNetwork(SOLVANE, world.field);
    expect(Array.from(again.y)).toEqual(Array.from(net.y));
    expect(again.edges.map((e) => e.id)).toEqual(net.edges.map((e) => e.id));
    expect(ROAD_LAYER_GAP).toBe(ROUTE_LAYER_GAP);
  });
  it('answers nearest/at consistently in its global station space', () => {
    const p = trackPoint(),
      q = trackPoint();
    for (const e of net.edges.slice(0, 20)) {
      net.at(e.offset + e.length / 2, p);
      const lateral = net.nearest(p.x + p.nx * 1.5, p.z + p.nz * 1.5, q, p.y + 0.5);
      expect(lateral).toBeCloseTo(1.5, 1);
      expect(Math.abs(q.s - p.s)).toBeLessThan(1);
    }
  });
});

describe('festival world surface (physics adapter)', () => {
  const track = new OpenWorldTrack(world);
  const s = surfaceSample();
  it('answers every public Track member (no missing method on the adapter)', () => {
    const missing = Object.getOwnPropertyNames(Track.prototype).filter(
      (name) => name !== 'constructor' && typeof (track as unknown as Record<string, unknown>)[name] !== 'function',
    );
    expect(missing).toEqual([]);
    const circuit = new Track('clear', true);
    const fields = Object.keys(circuit).filter((k) => !k.startsWith('contact') && k !== 'queryPoint');
    const absent = fields.filter((k) => !(k in track));
    expect(absent).toEqual([]);
  });
  it('reads the cambered road: asphalt and markings on highways, gravel on dirt tracks', () => {
    const i = sampleOn('h1', (k) => !(net.flags[k] & ROAD_FLAG.BRIDGE));
    const p = trackPoint();
    net.pointOnSegment(i, 0, p);
    track.sample(p.x + p.nx * 2, p.z + p.nz * 2, s, p.y + 0.5);
    expect(track.query.onRoad).toBe(true);
    expect(s.surface).toBe(SURFACE.ASPHALT);
    expect(s.grip).toBeGreaterThan(0.85);
    expect(Math.abs(s.height - net.surfaceHeight(p, 2, 7.6, 0.022))).toBeLessThan(0.02);
    track.sample(p.x, p.z, s, p.y + 0.5);
    expect(track.query.surface).toBe(WORLD_SURFACE.MARKING);
    const d = sampleOn('thornwood');
    net.pointOnSegment(d, 0, p);
    track.sample(p.x, p.z, s, p.y + 0.5);
    expect(track.query.surface).toBe(WORLD_SURFACE.DIRT_ROAD);
    // A compacted dirt road is the dirt ground material, not a gravel trap.
    expect(s.surface).toBe(MATERIAL.DIRT);
    expect(surfaceMaterial(s.surface).loose).toBe(true);
    expect(s.grip).toBeLessThan(0.75);
  });
  it('reads natural ground off the road: grass, sea water, town paving', () => {
    track.sample(2600, 600, s);
    expect(track.query.onRoad).toBe(false);
    expect([MATERIAL.GRASS, MATERIAL.DIRT]).toContain(s.surface);
    expect(s.grip).toBeLessThan(0.7);
    expect(s.resistance).toBeGreaterThan(0.04);
    track.sample(0, -3600, s);
    expect(track.query.surface).toBe(WORLD_SURFACE.WATER);
    expect(track.query.waterDepth).toBeGreaterThan(1);
    track.sample(1480, -2310, s);
    expect(track.query.surface).toBe(WORLD_SURFACE.PAVEMENT);
  });
  it('is layer aware on bridges: the deck from above, the ground beneath', () => {
    const i = sampleOn('h2', (k) => (net.flags[k] & ROAD_FLAG.BRIDGE) !== 0 && net.y[k] - net.ground[k] > 8);
    const x = net.x[i],
      z = net.z[i],
      deck = net.y[i];
    track.sample(x, z, s, deck + 0.5);
    expect(track.query.bridge).toBe(true);
    expect(Math.abs(s.height - deck)).toBeLessThan(0.5);
    track.sample(x, z, s, net.ground[i] + 0.5);
    expect(track.query.onRoad).toBe(false);
    expect(s.height).toBeLessThan(deck - 6);
  });
  it('casts suspension rays onto the same surface and keeps rails one-sided', () => {
    const i = sampleOn('pass', (k) => (net.flags[k] & ROAD_FLAG.BARRIER_RIGHT) !== 0 && !(net.flags[k] & ROAD_FLAG.BRIDGE));
    const p = trackPoint();
    net.pointOnSegment(i, 0.5, p);
    const origin = new Vec3(p.x, p.y + 0.8, p.z),
      down = new Vec3(0, -1, 0);
    const distance = track.cast(origin, down, 1.5, s);
    expect(distance).toBeGreaterThan(0.7);
    expect(distance).toBeLessThan(0.95);
    expect(track.cast(new Vec3(p.x, p.y + 30, p.z), down, 1.5, s)).toBe(Infinity);
    const spec = net.edges[net.edgeOf[i]].spec,
      face = spec.halfWidth + spec.shoulder + 0.35;
    // Near the rail on the road side: a boundary; far beyond it: none.
    track.nearest(p.x + p.nx * (face - 0.2), p.z + p.nz * (face - 0.2), trackPoint(), p.y + 0.5);
    expect(track.boundaryAt(p, 1)).toBeCloseTo(face, 5);
    track.nearest(p.x + p.nx * (face + 12), p.z + p.nz * (face + 12), trackPoint(), p.y + 0.5);
    expect(track.boundaryAt(p, 1)).toBeGreaterThan(1000);
    expect(track.pitSpeedZone()).toBe(false);
  });
});

describe('festival road surface continuity', () => {
  const track = new OpenWorldTrack(world, 'clear', undefined, 256);
  const s = surfaceSample(),
    p = trackPoint();
  /** Ground height at (x, z) read as a car on it would (layer from the ground). */
  const ground = (x: number, z: number) => track.sample(x, z, s, track.groundHeight(x, z) + 0.6).height;
  /** Samples of an edge within `radius` of one of its end nodes. */
  const mouth = (edge: number, node: number, radius: number) => {
    const e = net.edges[edge],
      n = net.nodes[node],
      out: number[] = [];
    for (let i = e.first; i < e.last; i++)
      if (Math.hypot(net.x[i] - n.x, net.z[i] - n.z) < radius && !(net.flags[i] & ROAD_FLAG.BRIDGE)) out.push(i);
    return out;
  };
  it('reads every junction mouth as the road: the carriageway of each road meeting there is road surface', () => {
    const paved: number[] = [WORLD_SURFACE.ASPHALT, WORLD_SURFACE.MARKING];
    let points = 0,
      off: string[] = [],
      loose: string[] = [];
    for (const node of net.nodes) {
      if (node.edges.length < 2) continue;
      for (const edge of node.edges) {
        const e = net.edges[edge],
          hw = e.spec.halfWidth;
        for (const i of mouth(edge, node.index, 30))
          for (let f = 0; f < 1; f += 0.25) {
            net.pointOnSegment(i, f, p);
            for (let l = -hw + 0.1; l <= hw - 0.1; l += 0.5) {
              track.sample(p.x + p.nx * l, p.z + p.nz * l, s, p.y + 0.6);
              points++;
              if (!track.query.onRoad) off.push(`${e.id} at node ${node.index}`);
              else if (e.spec.surface !== 'dirt' && !paved.includes(track.query.surface))
                loose.push(`${e.id} at node ${node.index}: ${track.query.surface}`);
            }
          }
      }
    }
    off = [...new Set(off)];
    loose = [...new Set(loose)];
    expect(points).toBeGreaterThan(5000);
    expect(off).toEqual([]);
    // A paved carriageway is paved there, not a side road's dirt or verge.
    expect(loose).toEqual([]);
  });
  it('has no steps in junction mouths where road surfaces overlap', () => {
    let worst = 0,
      at = '';
    const step = 0.5;
    for (const node of net.nodes) {
      if (node.edges.length < 2) continue;
      const n = Math.round(60 / step),
        h = new Float64Array((n + 1) * (n + 1)).fill(NaN);
      for (let j = 0; j <= n; j++)
        for (let i = 0; i <= n; i++) {
          const x = node.x - 30 + i * step,
            z = node.z - 30 + j * step,
            y = ground(x, z);
          if (track.query.onRoad && !track.query.bridge) h[j * (n + 1) + i] = y;
        }
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = h[j * (n + 1) + i];
          for (const b of [h[j * (n + 1) + i + 1], h[(j + 1) * (n + 1) + i]])
            if (Math.abs(b - a) > worst) {
              worst = Math.abs(b - a);
              at = `node ${node.index}`;
            }
        }
    }
    // Overlapping roads meet on a level junction pad; what remains is the
    // crown of a highway under a side road's shoulder (no kerb-like step).
    expect(worst, at).toBeLessThan(0.3);
  });
  it('meets the terrain beyond the shoulder without a step', () => {
    const near = roadCandidates();
    let worst = 0,
      at = '',
      checked = 0;
    for (const e of net.edges) {
      const edge = e.spec.halfWidth + e.spec.shoulder;
      for (let i = e.first; i <= e.last; i += 2) {
        if (net.flags[i] & (ROAD_FLAG.BRIDGE | ROAD_FLAG.JUNCTION)) continue;
        const nx = net.tz[i],
          nz = -net.tx[i];
        for (const side of [-1, 1]) {
          const x = net.x[i] + nx * side * edge,
            z = net.z[i] + nz * side * edge;
          // Where another road's footprint touches this one, the two roads
          // meet there (a content question, not the terrain).
          const count = net.covering(x, z, net.y[i] + 0.6, 0.5, near);
          let alone = true;
          for (let k = 0; k < count; k++) if (net.edgeOf[near.segment[k]] !== e.index) alone = false;
          if (!alone) continue;
          checked++;
          track.sample(net.x[i] + nx * side * (edge - 0.05), net.z[i] + nz * side * (edge - 0.05), s, net.y[i] + 0.6);
          const inside = s.height;
          track.sample(net.x[i] + nx * side * (edge + 0.05), net.z[i] + nz * side * (edge + 0.05), s, net.y[i] + 0.6);
          if (Math.abs(s.height - inside) > worst) {
            worst = Math.abs(s.height - inside);
            at = `${e.id} (${net.x[i].toFixed(0)}, ${net.z[i].toFixed(0)})`;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(15000);
    expect(worst, at).toBeLessThan(0.05);
  });
  it('ends a dead end at its end line: beyond it is the terrain, not a road plane', () => {
    const candidates = roadCandidates();
    let checked = 0;
    for (const node of net.nodes) {
      if (node.edges.length !== 1) continue;
      const e = net.edges[node.edges[0]],
        i = e.from === node.index ? e.first : e.last,
        dir = e.from === node.index ? -1 : 1;
      for (const beyond of [20, 60, 100]) {
        const x = node.x + net.tx[i] * dir * beyond,
          z = node.z + net.tz[i] * dir * beyond;
        track.sample(x, z, s, net.y[i] + 0.6);
        // Never the dead-end road itself past its end.
        expect(track.query.onRoad && track.query.edge === e.index).toBe(false);
        if (net.covering(x, z, net.y[i] + 0.6, RUN_OUT, candidates) === 0) {
          expect(s.height).toBeCloseTo(track.tiles.height(x, z), 3);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });
  it('joins every road at a shared control point (the valley crossroads at Saltmarsh)', () => {
    expect(sharedPointErrors(SOLVANE, net)).toEqual([]);
    const node = net.nodes.find((n) => Math.hypot(n.x - 210, n.z + 430) < 3)!;
    expect(node.edges.map((e) => net.edges[e].road.id).sort()).toEqual(['farm', 'orchard', 'valley', 'valley']);
    // A route can turn there from the valley road onto the farm road.
    const legs = planRoute(net, [[560, -930], [-2280, -900]], false);
    expect(legs.some((l) => net.edges[l.edge].road.id === 'valley')).toBe(true);
    expect(legs.some((l) => net.edges[l.edge].road.id === 'farm')).toBe(true);
    // One surface across the crossroads: crowned, without the 35 cm step
    // between the unconnected roads it used to have.
    let step = 0,
      low = Infinity,
      high = -Infinity;
    for (let dx = -4; dx <= 4; dx += 0.25)
      for (let dz = -4; dz <= 4; dz += 0.25) {
        const h = ground(210 + dx, -430 + dz);
        low = Math.min(low, h);
        high = Math.max(high, h);
        step = Math.max(step, Math.abs(ground(210 + dx + 0.25, -430 + dz) - h), Math.abs(ground(210 + dx, -430 + dz + 0.25) - h));
      }
    expect(step).toBeLessThan(0.08);
    expect(high - low).toBeLessThan(0.25);
  });
});

describe('festival terrain streaming', () => {
  it('keeps resident physics tiles within budget while driving across the region', () => {
    const cache = new TerrainTileCache(world.carver, 12);
    const heights: number[] = [];
    for (let k = 0; k <= 40; k++) {
      const x = -3000 + k * 150,
        z = -1800 + Math.sin(k / 5) * 400;
      cache.want(x, z, 40, 0, 2);
      cache.prefetch(50);
      heights.push(cache.height(x, z));
      expect(cache.stats.resident).toBeLessThanOrEqual(12);
    }
    expect(cache.stats.evicted).toBeGreaterThan(0);
    expect(cache.stats.peakResident).toBeLessThanOrEqual(12);
    expect(cache.stats.stalls).toBeLessThan(cache.stats.generated);
    // An evicted tile rebuilds to identical heights.
    const fresh = new TerrainTileCache(world.carver, 12);
    expect(fresh.height(-3000, -1800)).toBe(heights[0]);
  });
  it('interpolates exactly through the carved vertices (render and physics agree)', () => {
    const { heights } = world.carver.build(0, 0, TILE_STEP, TILE_RES);
    const side = TILE_RES + 1;
    for (const [i, j] of [
      [0, 0],
      [10, 33],
      [64, 64],
      [40, 7],
    ])
      expect(gridHeight(heights, side, i, j, TILE_STEP)).toBeCloseTo(heights[j * side + i], 5);
    const cache = new TerrainTileCache(world.carver, 4);
    expect(cache.height(10 * TILE_STEP, 33 * TILE_STEP)).toBeCloseTo(heights[33 * side + 10], 5);
    expect(TILE_SIZE).toBe(256);
  });
});

describe('festival events and legal route progress', () => {
  const events = resolveEvents(world);
  it('plans every authored event through the road network as a valid route', () => {
    expect(events.length).toBe(SOLVANE.events.length);
    const kinds = new Set(events.map((e) => e.spec.kind));
    for (const k of ['road-race', 'circuit', 'sprint', 'speed-trap', 'speed-zone', 'drift-zone', 'showcase'])
      expect(kinds.has(k as never)).toBe(true);
    for (const e of events) {
      expect(validateRoute(e.graph.spec)).toEqual([]);
      expect(e.path.length).toBeGreaterThan(200);
      expect(e.graph.spec.closed).toBe(e.spec.kind === 'circuit');
    }
    expect(events.some((e) => e.path.length >= 10000)).toBe(true);
  });
  it('credits a driven route and refuses a shortcut across switchbacks', () => {
    const drift = events.find((e) => e.spec.id === 'hairpin-drift')!,
      path = drift.path,
      p = pathPoint();
    const legal = new RouteProgress(drift.graph, path.maxHalfWidth() + 8);
    for (let d = 0; d <= path.length; d += 4) {
      path.at(d, p);
      legal.update({ x: p.x, y: p.y, z: p.z });
    }
    expect(legal.finished).toBe(true);
    expect(legal.distance).toBeGreaterThan(path.finishDistance - 20);
    // Cutting from one hairpin leg straight up the slope to a later one:
    // find two stations far apart along the route but close in the world.
    let from = -1,
      target = -1;
    const q = pathPoint();
    search: for (let d1 = 100; d1 < 1500; d1 += 50)
      for (let d2 = d1 + 500; d2 < path.length - 100; d2 += 10) {
        path.at(d1, q);
        path.at(d2, p);
        if (Math.hypot(p.x - q.x, p.z - q.z) < 160) {
          from = d1;
          target = d2;
          break search;
        }
      }
    expect(target).toBeGreaterThan(0);
    const cheat = new RouteProgress(drift.graph, path.maxHalfWidth() + 8);
    for (let d = 0; d <= from; d += 4) {
      path.at(d, p);
      cheat.update({ x: p.x, y: p.y, z: p.z });
    }
    const before = cheat.distance;
    path.at(target, p);
    cheat.update({ x: p.x, y: p.y, z: p.z });
    expect(cheat.offRoute).toBe(true);
    expect(cheat.distance).toBe(before);
    expect(cheat.finished).toBe(false);
  });
  it('counts circuit laps only through every checkpoint', () => {
    const loop = events.find((e) => e.spec.id === 'port-ilse-loop')!,
      path = loop.path,
      p = pathPoint();
    const progress = new RouteProgress(loop.graph, path.maxHalfWidth() + 8);
    for (let lap = 0; lap < 2; lap++)
      for (let d = 0; d < path.length; d += 4) {
        path.at(d, p);
        progress.update({ x: p.x, y: p.y, z: p.z });
      }
    path.at(2, p);
    progress.update({ x: p.x, y: p.y, z: p.z });
    expect(progress.laps).toBe(2);
  });
  it('plans routes deterministically', () => {
    const a = planRoute(net, SOLVANE.events[0].waypoints, false),
      b = planRoute(net, SOLVANE.events[0].waypoints, false);
    expect(a).toEqual(b);
    expect(new RoutePath(net, a, false).length).toBeCloseTo(new RoutePath(net, b, false).length, 6);
  });
});

describe('festival placement and machines', () => {
  it('places buildings off the roads and trees deterministically', () => {
    const structures = regionStructures(world);
    expect(structures.length).toBeGreaterThan(200);
    const p = trackPoint();
    for (const s of structures.filter((x) => x.kind === 'house' || x.kind === 'shop' || x.kind === 'block').slice(0, 300)) {
      const lateral = net.nearest(s.x, s.z, p),
        e = net.edges[net.edgeOf[net.lastSegment]];
      expect(Math.abs(lateral)).toBeGreaterThan(e.spec.halfWidth + e.spec.shoulder);
    }
    const a = treesForTile(world, 6, 12, null),
      b = treesForTile(world, 6, 12, null);
    expect(a.length).toBeGreaterThan(TREE_STRIDE * 50);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it('draws every tree the physics collides with, at every quality tier and vegetation density', () => {
    const grid = new StructureGrid(regionStructures(world));
    // Forest tiles (the most trunks) and open ground with shrubs.
    const tiles: [number, number][] = [];
    for (let ix = -16; ix < 16 && tiles.length < 6; ix += 3)
      for (let iz = -16; iz < 16 && tiles.length < 6; iz += 3) {
        const trees = treesForTile(world, ix, iz, grid, 1);
        let trunks = 0;
        for (let i = 0; i < trees.length; i += TREE_STRIDE) if (trunkRadius(trees[i + 3], trees[i + 2]) > 0) trunks++;
        if (trunks > 150) tiles.push([ix, iz]);
      }
    expect(tiles.length).toBe(6);
    let thinned = 0;
    for (const [ix, iz] of tiles) {
      const colliders = treesForTile(world, ix, iz, grid, 1),
        full = colliders.length / TREE_STRIDE;
      for (const tier of ['low', 'medium', 'high'] as const)
        for (const vegetation of [0, 0.5, 1]) {
          const data = buildTileData(world, grid, {
            type: 'tile',
            id: 1,
            x0: ix * TILE_SIZE,
            z0: iz * TILE_SIZE,
            size: TILE_SIZE,
            res: 16,
            trees: TERRAIN_BUDGETS[tier].trees * vegetation,
            colliders: true,
          });
          const drawn = new Set<string>();
          for (let i = 0; i < data.trees.length; i += TILE_TREE_STRIDE) drawn.add(`${data.trees[i]},${data.trees[i + 1]}`);
          for (let i = 0; i < colliders.length; i += TREE_STRIDE)
            if (trunkRadius(colliders[i + 3], colliders[i + 2]) > 0)
              expect(drawn.has(`${colliders[i]},${colliders[i + 1]}`)).toBe(true);
          if (drawn.size < full) thinned++;
        }
    }
    // Lower densities still thin what has no collider (shrubs).
    expect(thinned).toBeGreaterThan(0);
  });
  it('offers every four-wheel registry vehicle except karts, road cars first (data-driven)', () => {
    const list = festivalVehicles(),
      ids = list.map((v) => v.id);
    for (const def of Object.values(VEHICLES))
      if (def.dynamicsKind === 'four-wheel' && def.classId !== 'kart') expect(ids).toContain(def.id);
      else expect(ids).not.toContain(def.id);
    // A road-class car (when the registry has one) leads and is the default.
    const road = list.findIndex((v) => v.classId === 'road');
    if (road >= 0) {
      expect(road).toBe(0);
      expect(festivalDefaultVehicle()).toBe(list[0].id);
    }
  });
});
