import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, mod, Random } from '../../core/math.ts';
import { trackPoint, type TrackPoint } from '../../simulation/track.ts';
import { buildGarageBay, paddockMaterials } from '../paddock-detail.ts';
import { label } from '../geometry.ts';
import { terrainFor } from '../terrain.ts';
import { tracksideRigs } from '../trackside.ts';
import { inStandFootprint } from '../grandstand.ts';
import { kitMesh, type VenueKitContext } from './context.ts';
import { paddockSpan } from './plan.ts';
import { chunks, sweep, unwrap, venuePoint } from './sweep.ts';

/** Box with metre-scaled UVs (one facade tile = 14 m x 28 m) so window rows
 * stay the same size on every building. */
/** `street`: world height of the road beside the building, for the facade
 * street light's falloff (materials.ts FACADE_STREET_LIGHT). */
function facadeBox(w: number, h: number, d: number, tileW = 14, tileH = 28, street = 0) {
  const g = new T.BoxGeometry(w, h, d);
  g.setAttribute(
    'streetLevel',
    new T.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(street), 1),
  );
  const uv = g.getAttribute('uv'),
    normal = g.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i)),
      ny = Math.abs(normal.getY(i));
    const across = ny > 0.5 ? w : nx > 0.5 ? d : w;
    const vertical = ny > 0.5 ? d : h;
    uv.setXY(i, (uv.getX(i) * across) / tileW, (uv.getY(i) * vertical) / tileH);
  }
  return g;
}
const at = (track: VenueKitContext['track'], s: number, p: TrackPoint) =>
  track.at(mod(s, track.length), p);
function frame(track: VenueKitContext['track'], s: number, l: number, y: number, p = trackPoint()) {
  at(track, s, p);
  return {
    position: new T.Vector3(p.x + p.nx * l, y, p.z + p.nz * l),
    yaw: Math.atan2(p.tx, p.tz),
    p,
  };
}

/** Pit building on the venue's own pit side: twelve open garages (the shared
 * garage bay), a glazed hospitality floor, a race-control tower and a pit
 * wall with gantry between track and lane. Left-hand paddocks mirror it. */
export function buildPaddock(kit: VenueKitContext) {
  const track = kit.track,
    pit = track.pit,
    side = pit.side,
    span = paddockSpan(track),
    paddock = paddockMaterials(),
    m = kit.materials,
    root = new T.Group();
  root.name = `Venue kit paddock (${side > 0 ? 'right' : 'left'} side)`;
  const spacing = Math.max(9, pit.boxSpacing),
    centre = pit.firstBox + 5.5 * pit.boxSpacing,
    front = pit.offset + 6.5;
  for (let i = 0; i < 12; i++) {
    const s = centre + (i - 5.5) * spacing,
      f = frame(track, s, side * (front + 6.5), 0);
    f.position.y = f.p.y + f.p.bank * clamp(side * front, -12, 12) + 0.02;
    const bay = new T.Group();
    buildGarageBay(bay, paddock, i);
    bay.position.copy(f.position);
    // The bay's -X faces the lane: rotate half a turn on the left side.
    bay.rotation.y = f.yaw + (side > 0 ? 0 : Math.PI);
    root.add(bay);
    kit.occupy(f.position.x, f.position.z, 9);
  }
  // Hospitality floor and roof over the garage run, then race control.
  const length = 12 * spacing + 6,
    mid = frame(track, centre, side * (front + 6.5), 0);
  const base = mid.p.y + mid.p.bank * clamp(side * front, -12, 12);
  const block = new T.Mesh(facadeBox(length, 4.2, 14, 14, 9, base), m.facades[1]);
  block.position.set(mid.position.x, base + 8.4, mid.position.z);
  block.rotation.y = mid.yaw + Math.PI / 2;
  block.castShadow = block.receiveShadow = true;
  block.name = 'Paddock hospitality floor';
  root.add(block);
  const roof = new T.Mesh(new T.BoxGeometry(length + 4, 0.5, 18), paddock.cladding);
  roof.position.set(mid.position.x, base + 10.8, mid.position.z);
  roof.rotation.y = mid.yaw + Math.PI / 2;
  roof.castShadow = true;
  root.add(roof);
  const towerS = centre + length / 2 + 10,
    tower = frame(track, towerS, side * (front + 7), 0);
  const control = new T.Mesh(facadeBox(14, 18, 14, 14, 9, tower.p.y), m.facades[2]);
  control.position.set(tower.position.x, tower.p.y + 9.6, tower.position.z);
  control.rotation.y = tower.yaw;
  control.castShadow = control.receiveShadow = true;
  control.name = 'Race control tower';
  root.add(control);
  kit.occupy(tower.position.x, tower.position.z, 12);
  // Pit wall: concrete parapet with a mesh screen between track and lane.
  const wallFrom = track.length - pit.divergeEnd,
    wallTo = track.length + pit.mergeStart;
  const wall = sweep(
    track,
    wallFrom,
    wallTo,
    side,
    [
      [-0.3, -0.05],
      [-0.3, 1.05],
      [0.3, 1.05],
      [0.3, -0.05],
    ],
    { step: 4, base: () => pit.offset - 4.3, closed: true },
  );
  root.add(kitMesh(wall, m.concrete, 'Pit wall'));
  // Garage-front apron and kit spans for planting exclusion.
  for (let s = span.from; s <= span.to; s += 15) {
    const f = frame(track, s, side * (front + 10), 0);
    kit.occupy(f.position.x, f.position.z, 16);
  }
  kit.add(root);
}

/** City frontage beyond the barrier: blocks of varied height and set-back
 * with mullioned, night-lit windows; gaps leave side streets; nothing sits
 * on another section, a stand, a camera rig or the paddock. */
export function buildFacades(kit: VenueKitContext) {
  const track = kit.track,
    m = kit.materials,
    random = new Random(0x5eed + track.length),
    tall = !!kit.style.tallFacades,
    rigs = tracksideRigs(track),
    p = trackPoint();
  const spans = kit.meta.dressing.facades,
    paddock = paddockSpan(track);
  const byMaterial = m.facades.map(() => [] as T.BufferGeometry[]),
    roofs: T.BufferGeometry[] = [],
    signs = m.neon.map(() => [] as T.BufferGeometry[]);
  for (const span of spans) {
    const [a, b] = unwrap(span, track.length);
    let s = a + 4;
    while (s < b - 6) {
      const width = 14 + random.next() * 22,
        depth = 14 + random.next() * 16,
        storeys = tall ? 4 + Math.floor(random.next() * 14) : 3 + Math.floor(random.next() * 5);
      const height = storeys * 3.5,
        sc = s + width / 2;
      s += width + (random.next() < 0.2 ? 10 : 1.5);
      if (sc > b) break;
      if (span.side === paddock.side && sc > paddock.from - 80 && sc < paddock.to + 80) continue;
      at(track, sc, p);
      const setback = track.boundaryAt(p, span.side) + 3 + random.next() * 3,
        l = span.side * (setback + depth / 2);
      const x = p.x + p.nx * l,
        z = p.z + p.nz * l;
      let clear = true;
      for (const [u, v] of [
        [-depth / 2, -width / 2],
        [-depth / 2, width / 2],
        [depth / 2, -width / 2],
        [depth / 2, width / 2],
        [0, 0],
      ]) {
        const cx = x + p.nx * span.side * u + p.tx * v,
          cz = z + p.nz * span.side * u + p.tz * v;
        if (kit.overOtherSection(cx, cz, sc, 4) || inStandFootprint(track, cx, cz, 4))
          clear = false;
      }
      for (const rig of rigs)
        if (Math.hypot(rig.position.x - x, rig.position.z - z) < Math.max(width, depth) / 2 + 8)
          clear = false;
      if (!clear) continue;
      const ground = Math.min(p.y, terrainFor(track).height(x, z)) - 1.5;
      const g = facadeBox(width, height + 1.5, depth, 14, 28, p.y);
      g.rotateY(Math.atan2(p.tx, p.tz));
      g.translate(x, ground + (height + 1.5) / 2, z);
      byMaterial[Math.floor(random.next() * m.facades.length)].push(g);
      const roof = new T.BoxGeometry(width - 1, 0.6, depth - 1)
        .rotateY(Math.atan2(p.tx, p.tz))
        .translate(x, ground + height + 1.8, z);
      roofs.push(roof);
      kit.occupy(x, z, Math.hypot(width, depth) / 2 + 2);
      if (tall && random.next() < 0.6) {
        // Vertical neon blade on the street face.
        const blade = new T.BoxGeometry(0.4, Math.min(height - 4, 10 + random.next() * 8), 2.4);
        const face = span.side * (setback - 0.3);
        blade.rotateY(Math.atan2(p.tx, p.tz));
        blade.translate(
          p.x + p.nx * face + p.tx * (random.next() - 0.5) * width * 0.6,
          ground + 6 + random.next() * 4,
          p.z + p.nz * face + p.tz * (random.next() - 0.5) * width * 0.6,
        );
        signs[Math.floor(random.next() * signs.length)].push(blade);
      }
    }
  }
  const group = new T.Group();
  group.name = 'Venue kit city frontage';
  byMaterial.forEach((list, i) => {
    if (!list.length) return;
    group.add(kitMesh(mergeGeometries(list, false)!, m.facades[i], `Facades ${i + 1}`));
  });
  if (roofs.length) group.add(kitMesh(mergeGeometries(roofs, false)!, m.concrete, 'Facade roofs'));
  signs.forEach((list, i) => {
    if (list.length)
      group.add(kitMesh(mergeGeometries(list, false)!, m.neon[i], `Neon blades ${i + 1}`, false));
  });
  kit.add(group);
}

/** Tunnels: walls on the barrier lines, a roof slab, lit ceiling strips and
 * portal headers; city tunnels carry a plaza block above. */
export function buildTunnels(kit: VenueKitContext) {
  const track = kit.track,
    m = kit.materials,
    p = trackPoint();
  for (const span of kit.meta.dressing.tunnels) {
    const [a, b] = unwrap(span, track.length);
    const group = new T.Group();
    group.name = `Venue kit tunnel ${Math.round(a)}-${Math.round(b)} m`;
    const walls: T.BufferGeometry[] = [],
      lights: T.BufferGeometry[] = [];
    for (const side of [-1, 1] as const)
      walls.push(
        sweep(
          track,
          a - 6,
          b + 6,
          side,
          [
            [-0.1, -0.1],
            [-0.1, 6.6],
            [0.9, 6.6],
            [0.9, -0.1],
          ],
          { step: 3, closed: true },
        ),
      );
    // Roof slab spanning wall to wall, level across the road.
    const slab: T.BufferGeometry[] = [];
    for (const [c0, c1] of chunks(a - 6, b + 6, 6)) {
      const s = (c0 + c1) / 2;
      at(track, s, p);
      const left = track.boundaryAt(p, -1) + 0.9,
        right = track.boundaryAt(p, 1) + 0.9,
        width = left + right;
      const g = new T.BoxGeometry(width, 0.9, c1 - c0 + 0.4);
      g.rotateY(Math.atan2(p.tx, p.tz));
      const l = (right - left) / 2;
      g.translate(p.x + p.nx * l, p.y + 6.95, p.z + p.nz * l);
      slab.push(g);
      // Ceiling light strip every 6 m.
      const strip = new T.BoxGeometry(0.5, 0.06, 2.2);
      strip.rotateY(Math.atan2(p.tx, p.tz));
      strip.translate(p.x, p.y + 6.47, p.z);
      lights.push(strip);
    }
    group.add(kitMesh(mergeGeometries(walls, false)!, m.concrete, 'Tunnel walls'));
    group.add(kitMesh(mergeGeometries(slab, false)!, m.concrete, 'Tunnel roof'));
    const lamp = kitMesh(mergeGeometries(lights, false)!, tunnelLamp(), 'Tunnel lights', false);
    group.add(lamp);
    // City tunnels: a plaza building over the roof.
    if (kit.style.ground === 'pavement' || kit.style.ground === 'concrete')
      for (const [c0, c1] of chunks(a + 10, b - 10, 60)) {
        if (c1 - c0 < 20) continue;
        const s = (c0 + c1) / 2,
          f = frame(track, s, 0, 0, p);
        const width = track.boundaryAt(p, -1) + track.boundaryAt(p, 1) + 6,
          h = 10 + ((Math.floor(s) * 7) % 13);
        const g = facadeBox(width, h, c1 - c0 - 2, 14, 28, p.y + 7.4);
        g.rotateY(f.yaw);
        g.translate(f.position.x, p.y + 7.4 + h / 2, f.position.z);
        group.add(
          kitMesh(g, m.facades[(Math.floor(s / 60) % 3) as 0 | 1 | 2], 'Tunnel plaza block'),
        );
      }
    for (let s = a; s <= b; s += 10) {
      at(track, s, p);
      kit.occupy(p.x, p.z, p.width + 8);
    }
    kit.add(group);
  }
}
let lampShared: T.MeshStandardMaterial | null = null;
function tunnelLamp() {
  return (lampShared ??= new T.MeshStandardMaterial({
    color: 0x222222,
    emissive: 0xfff1d6,
    emissiveIntensity: 2.4,
    roughness: 0.4,
  }));
}

/** Bridges where the lap crosses itself: a deck slab under the upper road,
 * abutments, and piers outside the lower road's barriers. */
export function buildBridges(kit: VenueKitContext) {
  const track = kit.track,
    m = kit.materials,
    p = trackPoint(),
    q = trackPoint(),
    terrain = terrainFor(track);
  for (const crossing of kit.meta.dressing.crossings) {
    const group = new T.Group();
    group.name = `Venue kit bridge at ${Math.round(crossing.upper)} m`;
    at(track, crossing.lower, q);
    const lowerReach = Math.max(track.boundaryAt(q, -1), track.boundaryAt(q, 1)) + 4;
    // Span along the upper road until both ends clear the lower corridor.
    let half = 10;
    for (; half < 90; half += 2) {
      const e1 = at(track, crossing.upper - half, p),
        e2 = trackPoint();
      at(track, crossing.upper + half, e2);
      const d1 = Math.abs(track.nearest(e1.x, e1.z, trackPoint(), q.y)),
        d2 = Math.abs(track.nearest(e2.x, e2.z, trackPoint(), q.y));
      if (d1 > lowerReach && d2 > lowerReach) break;
    }
    const slab: T.BufferGeometry[] = [];
    for (const [c0, c1] of chunks(crossing.upper - half - 6, crossing.upper + half + 6, 4)) {
      const s = (c0 + c1) / 2;
      at(track, s, p);
      const left = track.boundaryAt(p, -1) + 0.8,
        right = track.boundaryAt(p, 1) + 0.8;
      const g = new T.BoxGeometry(left + right, 1.3, c1 - c0 + 0.2);
      g.rotateZ(Math.atan(p.bank));
      g.rotateY(Math.atan2(p.tx, p.tz));
      const l = (right - left) / 2;
      g.translate(p.x + p.nx * l, p.y + p.bank * clamp(l, -12, 12) - 0.72, p.z + p.nz * l);
      slab.push(g);
    }
    group.add(kitMesh(mergeGeometries(slab, false)!, m.concrete, 'Bridge deck'));
    const piers: T.BufferGeometry[] = [];
    for (const end of [-1, 1]) {
      const s = crossing.upper + end * (half + 2);
      at(track, s, p);
      for (const l of [-p.width * 0.6, 0, p.width * 0.6]) {
        const x = p.x + p.nx * l,
          z = p.z + p.nz * l,
          ground = Math.min(terrain.height(x, z), q.y) - 1,
          top = p.y - 1.3,
          h = Math.max(1, top - ground);
        const g = new T.BoxGeometry(1.6, h, 1.6).rotateY(Math.atan2(p.tx, p.tz));
        g.translate(x, ground + h / 2, z);
        piers.push(g);
      }
    }
    group.add(kitMesh(mergeGeometries(piers, false)!, m.concrete, 'Bridge piers'));
    kit.add(group);
  }
}

/** Rock cuttings rising behind the barrier and cliffs/quay walls falling
 * away beside drops (coast and dock venues). */
export function buildRockAndDrops(kit: VenueKitContext) {
  const track = kit.track,
    m = kit.materials,
    terrain = terrainFor(track),
    random = new Random(0x0c1f);
  const jitter = Array.from({ length: 64 }, () => random.next());
  const rock: T.BufferGeometry[] = [],
    quay: T.BufferGeometry[] = [];
  for (const span of kit.meta.dressing.rock) {
    const [a, b] = unwrap(span, track.length);
    for (const [c0, c1] of chunks(a, b, 40)) {
      const k = Math.floor(c0) % 64,
        h = 7 + 9 * jitter[k];
      rock.push(
        sweep(
          track,
          c0,
          c1,
          span.side,
          [
            [1.4, -0.4],
            [2.2, h * 0.35],
            [3.4 + jitter[(k + 1) % 64], h * 0.7],
            [5 + 2 * jitter[(k + 2) % 64], h],
            [9, h + 2],
          ],
          {
            step: 3,
            include: (s) => !kit.overOtherSection(...posAt(kit, s, span.side, 4), s, 0),
          },
        ),
      );
    }
  }
  for (const span of kit.meta.dressing.drops) {
    const [a, b] = unwrap(span, track.length);
    const sea = kit.meta.seaLevel;
    for (const [c0, c1] of chunks(a, b, 40)) {
      const g = sweep(
        track,
        c0,
        c1,
        span.side,
        [
          [1.2, -0.05],
          [1.6, -0.05],
          [2.1, -8],
          [3.5, -60],
        ],
        {
          step: 3,
          heightAt: (x, z, index, road, v) => {
            const ground = terrain.height(x, z);
            if (index < 2) return road + v;
            const floor = sea !== null ? Math.min(ground, sea - 6) : ground;
            return Math.max(floor, road + v) - (index === 3 ? 2 : 0);
          },
          include: (s) => !kit.overOtherSection(...posAt(kit, s, span.side, 3), s, 0),
        },
      );
      (sea !== null && !kit.style.cliffs ? quay : rock).push(g);
    }
  }
  const group = new T.Group();
  group.name = 'Venue kit cuttings, cliffs and quays';
  if (rock.length) group.add(kitMesh(mergeGeometries(rock, false)!, m.rock, 'Rock faces'));
  if (quay.length) group.add(kitMesh(mergeGeometries(quay, false)!, m.concrete, 'Quay walls'));
  kit.add(group);
}
function posAt(kit: VenueKitContext, s: number, side: 1 | -1, extra: number): [number, number] {
  const p = trackPoint();
  kit.track.at(mod(s, kit.track.length), p);
  const l = side * (kit.track.boundaryAt(p, side) + extra);
  return [p.x + p.nx * l, p.z + p.nz * l];
}

/** Floodlight towers (ovals, docks) or street lamps (city), instanced; their
 * heads glow at night. */
export function buildLightTowers(kit: VenueKitContext) {
  const track = kit.track,
    m = kit.materials,
    p = trackPoint(),
    city = !!kit.style.streetLamps;
  const spacing = city ? 36 : 140,
    height = city ? 9 : 34;
  const poles: T.Matrix4[] = [],
    heads: T.Matrix4[] = [];
  const mat = new T.Matrix4(),
    q = new T.Quaternion();
  let k = 0;
  for (let s = 20; s < track.length; s += spacing, k++)
    for (const side of city ? ([-1, 1] as const) : ([k % 2 ? -1 : 1] as const)) {
      at(track, s, p);
      if (track.isCovered(s)) continue;
      const l = side * (track.boundaryAt(p, side) + (city ? 1.6 : 6)),
        x = p.x + p.nx * l,
        z = p.z + p.nz * l;
      if (kit.overOtherSection(x, z, s, 2) || inStandFootprint(track, x, z, 3)) continue;
      const base = p.y + p.bank * clamp(l, -12, 12) - 0.2;
      // Arms and lamp heads face the road.
      q.setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(-side * p.nx, -side * p.nz));
      poles.push(
        mat.compose(new T.Vector3(x, base + height / 2, z), q, new T.Vector3(1, height, 1)).clone(),
      );
      heads.push(
        mat.compose(new T.Vector3(x, base + height, z), q, new T.Vector3(1, 1, 1)).clone(),
      );
      kit.occupy(x, z, 2);
    }
  if (!poles.length) return;
  const group = new T.Group();
  group.name = city ? 'Venue kit street lamps' : 'Venue kit floodlight towers';
  const pole = new T.InstancedMesh(
    new T.CylinderGeometry(city ? 0.09 : 0.35, city ? 0.13 : 0.6, 1, 8).translate(0, 0, 0),
    m.darkSteel,
    poles.length,
  );
  poles.forEach((x, i) => pole.setMatrixAt(i, x));
  pole.castShadow = true;
  const head = new T.InstancedMesh(
    city ? new T.BoxGeometry(0.4, 0.18, 1.6).translate(0, 0, 0.7) : new T.BoxGeometry(5, 3, 0.6),
    m.lamp,
    heads.length,
  );
  heads.forEach((x, i) => head.setMatrixAt(i, x));
  for (const im of [pole, head]) im.computeBoundingSphere();
  group.add(pole, head);
  kit.detail(group, city ? 700 : 2400);
}

/** Braking boards (150/100/50 m) on the outside before every named corner
 * reached from a straight, and a venue sign on the main straight. */
export function buildBoards(kit: VenueKitContext) {
  const track = kit.track,
    p = trackPoint(),
    group = new T.Group();
  group.name = 'Venue kit braking boards';
  const boards = [150, 100, 50].map((d) => ({
    d,
    material: new T.MeshStandardMaterial({
      map: label(String(d), '#f2f0e8', '#1a1d1f', 256, 256),
      roughness: 0.6,
    }),
  }));
  const geometry = new T.BoxGeometry(1.2, 1.2, 0.08);
  for (const corner of track.circuit.corners) {
    at(track, corner.s - 40, p);
    const outside: 1 | -1 = p.curvature < 0 ? 1 : -1;
    // Boards only where the approach is a straight.
    at(track, corner.s - 220, p);
    if (Math.abs(p.curvature) > 1 / 400) continue;
    for (const b of boards) {
      const s = corner.s - 40 - b.d;
      at(track, s, p);
      const l = outside * (track.boundaryAt(p, outside) + 1.4);
      const pos = venuePoint(track, s, l, 1.6, p);
      const board = new T.Mesh(geometry, b.material);
      board.position.copy(pos);
      board.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI;
      board.castShadow = true;
      group.add(board);
    }
  }
  if (group.children.length) kit.detail(group, 600);
}

let craneShared: T.MeshStandardMaterial | null = null;
const containerShared: T.MeshStandardMaterial[] = [];
/** Container-terminal dressing along `gantries` spans: portal cranes that
 * straddle the road (legs beyond both barriers, girder 16 m above the road,
 * lit at night) and stacked shipping containers behind the barrier. Visual
 * only; nothing stands on another section or within reach of a crossing. */
export function buildGantries(kit: VenueKitContext) {
  const track = kit.track,
    m = kit.materials,
    p = trackPoint(),
    random = new Random(0x9a7e + Math.round(track.length));
  const crane = (craneShared ??= new T.MeshStandardMaterial({
    color: 0xd9822b,
    metalness: 0.5,
    roughness: 0.5,
  }));
  if (!containerShared.length)
    for (const c of [0x9c3b2e, 0x2f5f8a, 0x3c7a4a, 0xc9a23a, 0x7a7f84])
      containerShared.push(
        new T.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.3 }),
      );
  const nearCrossing = (s: number) =>
    kit.meta.dressing.crossings.some((c) =>
      [c.lower, c.upper].some(
        (x) => Math.abs(mod(x - s + track.length / 2, track.length) - track.length / 2) < 110,
      ),
    );
  const steel: T.BufferGeometry[] = [],
    lamps: T.BufferGeometry[] = [],
    boxes = containerShared.map(() => [] as T.BufferGeometry[]);
  for (const span of kit.meta.dressing.gantries) {
    const [a, b] = unwrap(span, track.length);
    for (let s = a + 30; s < b - 20; s += 75) {
      if (nearCrossing(s) || track.isCovered(s)) continue;
      at(track, s, p);
      const yaw = Math.atan2(p.tx, p.tz),
        left = track.boundaryAt(p, -1) + 3,
        right = track.boundaryAt(p, 1) + 3,
        legs: [number, number][] = [];
      let clear = true;
      for (const l of [-left, right])
        for (const v of [-6, 6]) {
          const x = p.x + p.nx * l + p.tx * v,
            z = p.z + p.nz * l + p.tz * v;
          if (kit.overOtherSection(x, z, s, 3) || inStandFootprint(track, x, z, 3)) clear = false;
          legs.push([x, z]);
        }
      if (!clear) continue;
      const top = p.y + 16,
        span2 = left + right,
        mid = (right - left) / 2;
      for (const [x, z] of legs) {
        const g = new T.BoxGeometry(1.2, top - p.y + 2, 1.2);
        g.translate(x, p.y - 1 + (top - p.y + 2) / 2, z);
        steel.push(g);
        kit.occupy(x, z, 2.5);
      }
      for (const v of [-6, 6]) {
        const girder = new T.BoxGeometry(span2 + 2, 1.8, 1.4).rotateY(yaw);
        girder.translate(p.x + p.nx * mid + p.tx * v, top + 1, p.z + p.nz * mid + p.tz * v);
        steel.push(girder);
      }
      // Trolley house and a hanging spreader over a random lane.
      const t = (random.next() - 0.5) * span2 * 0.6 + mid;
      const house = new T.BoxGeometry(6, 3, 13).rotateY(yaw);
      house.translate(p.x + p.nx * t, top + 3.4, p.z + p.nz * t);
      steel.push(house);
      const spreader = new T.BoxGeometry(2.4, 0.6, 12).rotateY(yaw);
      spreader.translate(p.x + p.nx * t, top - 3.5, p.z + p.nz * t);
      steel.push(spreader);
      const lamp = new T.BoxGeometry(span2 * 0.8, 0.3, 0.6).rotateY(yaw);
      lamp.translate(p.x + p.nx * mid, top - 0.2, p.z + p.nz * mid);
      lamps.push(lamp);
    }
    // Container stacks behind the barrier on both sides.
    for (let s = a + 10; s < b - 10; s += 14)
      for (const side of [-1, 1] as const) {
        if (random.next() < 0.35 || nearCrossing(s)) continue;
        at(track, s, p);
        const l = side * (track.boundaryAt(p, side) + 9 + random.next() * 14),
          x = p.x + p.nx * l,
          z = p.z + p.nz * l;
        if (
          kit.overOtherSection(x, z, s, 8) ||
          inStandFootprint(track, x, z, 8) ||
          kit.blocks(x, z, 3)
        )
          continue;
        const tiers = 1 + Math.floor(random.next() * 4),
          ground = Math.min(p.y, terrainFor(track).height(x, z)) - 0.1;
        for (let k = 0; k < tiers; k++) {
          const g = new T.BoxGeometry(2.44, 2.6, 12.2).rotateY(Math.atan2(p.tx, p.tz));
          g.translate(x, ground + 1.3 + k * 2.6, z);
          boxes[Math.floor(random.next() * boxes.length)].push(g);
        }
        kit.occupy(x, z, 7);
      }
  }
  const group = new T.Group();
  group.name = 'Venue kit crane gantries';
  if (steel.length) group.add(kitMesh(mergeGeometries(steel, false)!, crane, 'Portal cranes'));
  if (lamps.length)
    group.add(kitMesh(mergeGeometries(lamps, false)!, m.lamp, 'Crane floodlights', false));
  boxes.forEach((list, i) => {
    if (list.length)
      group.add(kitMesh(mergeGeometries(list, false)!, containerShared[i], `Containers ${i + 1}`));
  });
  if (group.children.length) kit.add(group);
}
