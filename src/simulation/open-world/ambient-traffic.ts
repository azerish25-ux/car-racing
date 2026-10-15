import { clamp, mod, Vec3 } from '../../core/math.ts';
import { bikeOrientation } from '../bike-vehicle.ts';
import { BoxContact, ChassisBox } from '../obb.ts';
import { RigidBody } from '../rigid.ts';
import type { TrackPoint } from '../track.ts';
import type { Vehicle } from '../vehicle.ts';
import { vehicleIndex, type VehicleDefinition } from '../vehicles.ts';
import { festivalCars } from './festival-machines.ts';
import { SPEED_CLASS_KMH, type RoadClass } from './region-data.ts';
import type { RoadEdge, RoadNetwork } from './road-network.ts';
import { TILE_SIZE } from './terrain-tiles.ts';

/** Ambient traffic tuning (festival free roam). */
export const TRAFFIC = Object.freeze({
  /** Road classes traffic is spawned on (no dirt, runway or mountain pass). */
  spawnClasses: Object.freeze(['highway', 'country', 'town'] as RoadClass[]),
  /** Classes a car may continue onto at a junction (asphalt public roads). */
  driveClasses: Object.freeze(['highway', 'country', 'town', 'mountain'] as RoadClass[]),
  /** Machine classes the traffic is drawn from (data-driven from the registry). */
  vehicleClasses: Object.freeze(['road', 'street']),
  /** Cars alive at once, and per 256 m physics tile. */
  maxCars: 24,
  perTile: 3,
  /** Road length (m) per car a tile is sized for (cap = min(perTile, length / this)). */
  metresPerCar: 220,
  /** Spawn ring around the player (m) and the despawn radius. */
  spawnMin: 180,
  spawnMax: 440,
  despawn: 620,
  /** No spawn in the player's forward view closer than this (m). */
  viewClear: 340,
  /** Seconds between spawn/despawn passes and most spawns per pass. */
  passInterval: 0.5,
  spawnsPerPass: 2,
  /** Car-following (intelligent driver model). */
  accel: 1.6,
  comfortBrake: 2.6,
  maxBrake: 8,
  headway: 1.4,
  standstill: 3.2,
  /** Planner rate (Hz) and look-ahead along the road (m). */
  planHz: 20,
  lookahead: 90,
  /** Spawn-point spacing along eligible roads (m). */
  spawnSpacing: 50,
  /** A junction is claimed this far before the node (s) at the approach speed. */
  claimSeconds: 3.2,
  claimMetres: 24,
  /** A claim that is not released (despawned car) expires (s). */
  claimTimeout: 8,
});
/** Snapshot layout of the traffic block sent with each festival frame. */
export const TRAFFIC_HEADER = 2;
export const TRAFFIC_STRIDE = 12;
export const TF = Object.freeze({
  ID: 0,
  VEHICLE: 1,
  X: 2,
  Y: 3,
  Z: 4,
  QX: 5,
  QY: 6,
  QZ: 7,
  QW: 8,
  SPEED: 9,
  BRAKE: 10,
  /** 1 hazard lights (after a collision), 2 waiting at a junction. */
  FLAGS: 11,
});
export const TRAFFIC_FLAG = Object.freeze({ HAZARD: 1, WAITING: 2 });

/** Deterministic hash of integers to [0, 1). */
function hash01(...values: number[]) {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return (h >>> 0) / 4294967296;
}
const tileKey = (ix: number, iz: number) => (ix + 512) * 1024 + (iz + 512);

/** One kinematic ambient car: it follows its lane of a road-network edge,
 * picks its next edge at each junction, keeps its distance with a simple
 * car-following law and yields at junctions. It has a rigid-body pose (for
 * the simplified collision with the player and for the snapshot) but no tyre
 * or suspension model. */
export class TrafficCar {
  readonly body = new RigidBody();
  readonly box = new ChassisBox();
  speed = 0;
  /** Distance travelled along the current edge in the travel direction (m). */
  s = 0;
  /** Lateral offset in the travel frame (m, positive left: right-hand lanes are negative). */
  lateral = 0;
  /** Lane index from the centre (0 inner) and its target offset. */
  lane = 0;
  yaw = 0;
  brake = 0;
  /** Seconds of hazard stop after a collision; lateral shove (m/s, + left). */
  stunned = 0;
  shove = 0;
  waiting = false;
  /** Next edge at the end node (planned on entering an edge). */
  next: { edge: number; dir: 1 | -1 } | null = null;
  /** Junction node this car holds the claim on (-1 none). */
  claim = -1;
  /** A dead end ahead: the car stops at the end and is removed once out of sight. */
  ending = false;
  stopped = 0;
  accel = 0;
  /** Network sample cache (incremental station search). */
  sample: number;
  /** Desired-speed factor (driver personality). */
  temper: number;
  readonly half: readonly [number, number, number];
  readonly vehicleIndex: number;
  edge: number;
  dir: 1 | -1;
  constructor(
    readonly id: number,
    readonly definition: VehicleDefinition,
    edge: RoadEdge,
    dir: 1 | -1,
    s: number,
    seed: number,
  ) {
    this.edge = edge.index;
    this.dir = dir;
    this.s = s;
    this.sample = edge.first;
    this.temper = 0.84 + hash01(seed, id, 3) * 0.2;
    const [hx, hy, hz] = definition.halfExtents;
    this.half = [hx, Math.max(0.5, hy), hz];
    this.box.half = this.half;
    this.body.mass = definition.spec.dryMass + 60;
    this.vehicleIndex = vehicleIndex(definition.id);
  }
  get position() {
    return this.body.position;
  }
}
interface SpawnPoint {
  edge: number;
  s: number;
  x: number;
  z: number;
}
interface JunctionClaim {
  car: number;
  since: number;
}

/**
 * Deterministic, cheap ambient traffic for the festival region: kinematic
 * cars on the lanes of highways, country roads and town streets. Every
 * decision is a function of the seed, the step sequence and the player's
 * position (no wall clock, no Math.random), so two sessions with the same
 * inputs produce the same traffic. Cars spawn in a ring around the player
 * (never close or in the forward view) within a per-tile and a total cap,
 * and are removed beyond the despawn radius, which follows the physics
 * streaming radius; the session turns traffic off during events. The player
 * collides with them through a box contact and an impulse with the car's
 * mass (the traffic car loses the speed the impulse takes, slides and stops
 * with its hazards on); traffic follows the player when it is in their lane.
 */
export class AmbientTraffic {
  readonly cars: TrafficCar[] = [];
  /** Spawn points per tile key and the tile's car cap. */
  private readonly points = new Map<number, SpawnPoint[]>();
  private readonly caps = new Map<number, number>();
  private readonly pool: VehicleDefinition[];
  private readonly claims = new Map<number, JunctionClaim>();
  private readonly junctions: Set<number>;
  private serial = 0;
  private passes = 0;
  private passClock = 0;
  private planClock = 0;
  time = 0;
  /** Removed since the session started (tests and the acceptance report). */
  spawned = 0;
  despawned = 0;
  collisions = 0;
  private readonly point: TrackPoint = { s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, curvature: 0, width: 0, bank: 0, gradient: 0 };
  private readonly playerBox = new ChassisBox();
  private readonly contact = new BoxContact();
  private readonly relative = new Vec3();
  private readonly rA = new Vec3();
  private readonly cross = new Vec3();
  private readonly inertia = new Vec3();
  private readonly playerVelocity = new Vec3();
  constructor(
    readonly network: RoadNetwork,
    readonly seed = 73021,
    readonly limits: { maxCars: number; perTile: number } = { maxCars: TRAFFIC.maxCars, perTile: TRAFFIC.perTile },
  ) {
    const cars = festivalCars();
    const pool = cars.filter((d) => TRAFFIC.vehicleClasses.includes(String(d.classId)));
    this.pool = pool.length ? pool : cars;
    this.junctions = new Set(network.nodes.filter((n) => n.edges.length >= 3).map((n) => n.index));
    const lengths = new Map<number, number>();
    for (const e of network.edges) {
      if (!TRAFFIC.spawnClasses.includes(e.roadClass)) continue;
      for (let s = TRAFFIC.spawnSpacing / 2; s < e.length - 10; s += TRAFFIC.spawnSpacing) {
        network.at(e.offset + s, this.point);
        const key = tileKey(Math.floor(this.point.x / TILE_SIZE), Math.floor(this.point.z / TILE_SIZE));
        let list = this.points.get(key);
        if (!list) this.points.set(key, (list = []));
        list.push({ edge: e.index, s, x: this.point.x, z: this.point.z });
        lengths.set(key, (lengths.get(key) ?? 0) + TRAFFIC.spawnSpacing);
      }
    }
    for (const [key, length] of lengths)
      this.caps.set(key, Math.max(1, Math.min(limits.perTile, Math.round(length / TRAFFIC.metresPerCar))));
  }
  /** Car cap of the tile containing (x, z) (0 where traffic never spawns). */
  capAt(x: number, z: number) {
    return this.caps.get(tileKey(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE))) ?? 0;
  }
  /** Cars per tile key now. */
  tileCounts() {
    const counts = new Map<number, number>();
    for (const c of this.cars) {
      const key = tileKey(Math.floor(c.position.x / TILE_SIZE), Math.floor(c.position.z / TILE_SIZE));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }
  capOf(key: number) {
    return this.caps.get(key) ?? 0;
  }
  clear() {
    for (const c of this.cars) this.release(c);
    this.despawned += this.cars.length;
    this.cars.length = 0;
    this.claims.clear();
  }
  /** One fixed step. `player` is the car the traffic is around (spawn ring,
   * following, junction occupancy). */
  step(dt: number, player: Vehicle) {
    this.time += dt;
    this.passClock += dt;
    if (this.passClock >= TRAFFIC.passInterval) {
      this.passClock -= TRAFFIC.passInterval;
      this.pass(player);
    }
    this.planClock += dt;
    if (this.planClock >= 1 / TRAFFIC.planHz) {
      this.planClock -= 1 / TRAFFIC.planHz;
      for (const c of this.cars) this.plan(c, player);
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      c.speed = Math.max(0, c.speed + c.accel * dt);
      if (c.stunned > 0) {
        c.stunned = Math.max(0, c.stunned - dt);
        c.speed = Math.max(0, c.speed - 6 * dt);
      }
      c.s += c.speed * dt;
      // Lane keeping: back toward the lane centre after a shove.
      c.lateral += c.shove * dt;
      c.shove *= Math.exp(-2.5 * dt);
      const target = this.laneOffset(c);
      c.lateral += clamp(target - c.lateral, -1.2 * dt, 1.2 * dt);
      const e = this.network.edges[c.edge];
      if (c.s > e.length && !this.advance(c)) {
        this.remove(i);
        continue;
      }
      this.pose(c, dt);
      c.stopped = c.speed < 0.3 ? c.stopped + dt : 0;
    }
  }
  /** Lane centre offset in the travel frame (right-hand traffic). */
  private laneOffset(c: TrafficCar) {
    const half = this.network.edges[c.edge].spec.halfWidth,
      lanes = half >= 6 ? 2 : 1,
      width = half / lanes;
    return -(Math.min(c.lane, lanes - 1) + 0.5) * width;
  }
  /** Move onto the planned next edge, keeping the world position continuous. */
  private advance(c: TrafficCar) {
    const e = this.network.edges[c.edge];
    if (!c.next) {
      c.s = e.length;
      c.speed = 0;
      return true;
    }
    const over = c.s - e.length;
    const x = c.position.x,
      z = c.position.z;
    const next = this.network.edges[c.next.edge];
    // (The junction claim is kept until the car is clear of the node: pass().)
    c.edge = next.index;
    c.dir = c.next.dir;
    c.sample = next.first;
    c.next = null;
    c.ending = false;
    // Project the current position on the new edge's start frame.
    const p = this.locate(c, 0),
      tx = p.tx * c.dir,
      tz = p.tz * c.dir;
    c.s = Math.max(-6, (x - p.x) * tx + (z - p.z) * tz) + Math.max(0, over);
    // Travel-left of (tx, tz) is (tz, -tx) (Track convention).
    c.lateral = clamp((x - p.x) * tz - (z - p.z) * tx, -next.spec.halfWidth, next.spec.halfWidth);
    this.chooseNext(c);
    return true;
  }
  /** Pick the edge after the current one at its end node (deterministic). */
  private chooseNext(c: TrafficCar) {
    const e = this.network.edges[c.edge],
      node = c.dir > 0 ? e.to : e.from;
    const options = this.network
      .leaving(node)
      .filter((l) => !(l.edge.index === c.edge && l.dir === -c.dir) && TRAFFIC.driveClasses.includes(l.edge.roadClass));
    if (!options.length) {
      c.next = null;
      c.ending = true;
      return;
    }
    // The same road, then the higher class, are more likely.
    const weights = options.map((l) => (l.edge.road.id === e.road.id ? 3 : 1) * l.edge.spec.priority);
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = hash01(this.seed, c.id, c.edge, node, Math.floor(this.time)) * total;
    let k = 0;
    while (k < options.length - 1 && pick >= weights[k]) pick -= weights[k++];
    c.next = { edge: options[k].edge.index, dir: options[k].dir };
  }
  /** Network point at the car's station (cached sample search). */
  private locate(c: TrafficCar, s: number) {
    const net = this.network,
      e = net.edges[c.edge],
      local = clamp(c.dir > 0 ? s : e.length - s, 0, e.length),
      station = e.offset + local;
    let i = clamp(c.sample, e.first, e.last - 1);
    while (i > e.first && net.s[i] > station) i--;
    while (i < e.last - 1 && net.s[i + 1] < station) i++;
    c.sample = i;
    const span = net.s[i + 1] - net.s[i];
    return net.pointOnSegment(i, span > 0 ? clamp((station - net.s[i]) / span, 0, 1) : 0, this.point);
  }
  private pose(c: TrafficCar, dt: number) {
    const e = this.network.edges[c.edge],
      p = this.locate(c, c.s),
      dir = c.dir,
      tx = p.tx * dir,
      tz = p.tz * dir,
      // Beyond either end of the edge (a junction): straight on along it.
      beyond = c.s < 0 ? c.s : c.s > e.length ? c.s - e.length : 0,
      lateralEdge = c.lateral * dir;
    const spec = e.spec,
      ground = this.network.surfaceHeight(p, lateralEdge, spec.halfWidth, spec.crown);
    const x = p.x + p.nx * lateralEdge + tx * beyond,
      z = p.z + p.nz * lateralEdge + tz * beyond;
    const heading = Math.atan2(tx, tz);
    if (dt <= 0) c.yaw = heading;
    else {
      const turn = mod(heading - c.yaw + Math.PI, Math.PI * 2) - Math.PI,
        rate = Math.max(1.4, c.speed / 5) * dt;
      c.yaw += clamp(turn, -rate, rate);
    }
    const crownLeft = Math.max(0, spec.crown - Math.abs(p.bank)),
      cross = dir * (p.bank - crownLeft * Math.sign(lateralEdge));
    const b = c.body;
    bikeOrientation(b.orientation, c.yaw, Math.atan(p.gradient * dir), -Math.atan(cross));
    b.position.set(x, ground + c.half[1] + p.gradient * dir * beyond, z);
    const sy = Math.sin(c.yaw),
      cy = Math.cos(c.yaw);
    b.velocity.set(sy * c.speed + cy * c.shove, 0, cy * c.speed - sy * c.shove);
    b.omega.set(0, 0, 0);
  }
  /** Car-following and junction yielding (planner rate). */
  private plan(c: TrafficCar, player: Vehicle) {
    const net = this.network,
      e = net.edges[c.edge];
    if (!c.next && !c.ending) this.chooseNext(c);
    // Desired speed: the posted limit, the curvature advisory ahead, turns.
    let desired = (SPEED_CLASS_KMH[e.spec.speedClass] / 3.6) * c.temper;
    {
      const station = e.offset + (c.dir > 0 ? Math.max(0, c.s) : e.length - Math.max(0, c.s));
      let i = clamp(c.sample, e.first, e.last - 1);
      const ahead = Math.min(TRAFFIC.lookahead * 0.6, 20 + c.speed * 2.5);
      for (let k = 0; k < 40; k++) {
        const along = Math.abs(net.s[i] - station);
        if (along > ahead) break;
        // Comfortable lateral acceleration: the advisory is for a brisk driver.
        const v = net.advisory[i] * 0.85,
          d = Math.max(0, along - 10);
        desired = Math.min(desired, Math.sqrt(v * v + 2 * TRAFFIC.comfortBrake * d));
        i += c.dir;
        if (i < e.first || i > e.last) break;
      }
    }
    const remaining = e.length - c.s;
    let gap = Infinity,
      leaderSpeed = 0;
    // A junction turn: slow for the angle between this edge and the next.
    if (c.next && remaining < 80) {
      const n = net.edges[c.next.edge],
        end = this.locate(c, e.length),
        ax = end.tx * c.dir,
        az = end.tz * c.dir;
      const startStation = n.offset + (c.next.dir > 0 ? 0 : n.length);
      net.at(startStation, this.point);
      const bx = this.point.tx * c.next.dir,
        bz = this.point.tz * c.next.dir,
        angle = Math.acos(clamp(ax * bx + az * bz, -1, 1));
      if (angle > 0.35) {
        const turn = clamp(13 - 8 * (angle / (Math.PI / 2)), 4, 13);
        desired = Math.min(desired, Math.sqrt(turn * turn + 2 * TRAFFIC.comfortBrake * Math.max(0, remaining - 6)));
      }
      this.locate(c, c.s);
    }
    // Dead end ahead: stop at the end.
    if (c.ending && remaining < 120) {
      gap = Math.max(0.1, remaining - 4);
      leaderSpeed = 0;
    }
    // Leaders: other traffic and the player, in this lane ahead.
    const fx = Math.sin(c.yaw),
      fz = Math.cos(c.yaw);
    const corridor = (other: number) => 1.1 + other;
    let queued = false;
    for (const o of this.cars) {
      if (o === c) continue;
      const dx = o.position.x - c.position.x,
        dz = o.position.z - c.position.z;
      if (Math.abs(dx) > TRAFFIC.lookahead || Math.abs(dz) > TRAFFIC.lookahead) continue;
      let along: number;
      if (o.edge === c.edge && o.dir === c.dir && Math.abs(o.lateral - c.lateral) < 1.6) along = o.s - c.s;
      else if (c.next && o.edge === c.next.edge && o.dir === c.next.dir && Math.abs(o.lateral - c.lateral) < 1.8)
        along = remaining + o.s;
      else {
        // Other roads (a junction, a merge): world geometry, nearby only.
        along = dx * fx + dz * fz;
        const across = dx * fz - dz * fx;
        if (along > 40 || Math.abs(across) > corridor(o.half[0])) continue;
        // Crossing or oncoming traffic is handled by the junction claims.
        if (Math.sin(o.yaw) * fx + Math.cos(o.yaw) * fz < 0.5) continue;
      }
      if (along <= 0 || along > TRAFFIC.lookahead) continue;
      if (o.edge === c.edge && o.dir === c.dir && along < remaining) queued = true;
      const g = along - c.half[2] - o.half[2];
      if (g < gap) {
        gap = g;
        leaderSpeed = o.speed;
      }
    }
    {
      const pb = player.body,
        dx = pb.position.x - c.position.x,
        dz = pb.position.z - c.position.z,
        along = dx * fx + dz * fz,
        across = Math.abs(dx * fz - dz * fx),
        [phx, , phz] = player.definition.halfExtents;
      if (along > 0 && along < TRAFFIC.lookahead && across < corridor(phx)) {
        const g = along - c.half[2] - phz;
        if (g < gap) {
          gap = g;
          leaderSpeed = Math.max(0, pb.velocity.x * fx + pb.velocity.z * fz);
        }
      }
    }
    // Junction yielding at the end node.
    c.waiting = false;
    const node = c.dir > 0 ? e.to : e.from;
    if (this.junctions.has(node) && !c.ending) {
      const reach = Math.max(TRAFFIC.claimMetres, c.speed * TRAFFIC.claimSeconds);
      // Only the first car of a queue claims (no claim from behind a waiting car).
      if (remaining < reach && c.claim !== node && !queued) {
        if (this.mayClaim(c, node, player)) {
          this.release(c);
          this.claims.set(node, { car: c.id, since: this.time });
          c.claim = node;
        } else {
          c.waiting = true;
          const pad = c.dir > 0 ? e.pads[1] : e.pads[0];
          const stop = Math.max(0.1, remaining - Math.max(6, pad) - c.half[2]);
          if (stop < gap) {
            gap = stop;
            leaderSpeed = 0;
          }
        }
      }
    }
    // Intelligent driver model.
    const v = c.speed,
      v0 = Math.max(0.5, desired),
      free = 1 - (v / v0) ** 4;
    let a = TRAFFIC.accel * free;
    if (Number.isFinite(gap)) {
      const dv = v - leaderSpeed,
        star = TRAFFIC.standstill + Math.max(0, v * TRAFFIC.headway + (v * dv) / (2 * Math.sqrt(TRAFFIC.accel * TRAFFIC.comfortBrake)));
      a = TRAFFIC.accel * (free - (star / Math.max(0.2, gap)) ** 2);
    }
    if (c.stunned > 0) a = Math.min(a, -4);
    c.accel = clamp(a, -TRAFFIC.maxBrake, TRAFFIC.accel);
    c.brake = c.accel < -0.6 || (c.speed < 0.3 && c.accel <= 0) ? clamp(-c.accel / 4, 0.4, 1) : 0;
  }
  /** Junction claims: first come, first served, except that a car on a
   * lower-priority road also waits for higher-priority traffic close to the
   * node, and nobody enters while the player is in the junction. */
  private mayClaim(c: TrafficCar, node: number, player: Vehicle) {
    const held = this.claims.get(node);
    if (held && held.car !== c.id) {
      if (this.time - held.since < TRAFFIC.claimTimeout && this.cars.some((o) => o.id === held.car)) return false;
      this.claims.delete(node);
    }
    const n = this.network.nodes[node],
      pp = player.body.position;
    if (Math.hypot(pp.x - n.x, pp.z - n.z) < 14 && player.speed > 1) return false;
    const mine = this.network.edges[c.edge].spec.priority;
    for (const o of this.cars) {
      if (o === c || o.waiting) continue;
      const oe = this.network.edges[o.edge],
        onode = o.dir > 0 ? oe.to : oe.from;
      if (onode !== node || oe.spec.priority <= mine) continue;
      const left = oe.length - o.s;
      if (left / Math.max(1, o.speed) < 4) return false;
    }
    return true;
  }
  private release(c: TrafficCar) {
    if (c.claim >= 0 && this.claims.get(c.claim)?.car === c.id) this.claims.delete(c.claim);
    c.claim = -1;
  }
  private remove(i: number) {
    this.release(this.cars[i]);
    this.cars.splice(i, 1);
    this.despawned++;
  }
  /** Spawn and despawn around the player (twice a second). */
  private pass(player: Vehicle) {
    this.passes++;
    const pp = player.body.position,
      px = pp.x,
      pz = pp.z,
      fx = player.forward.x,
      fz = player.forward.z,
      fl = Math.hypot(fx, fz) || 1;
    // Claims held across the junction: released once past the node and clear of it.
    for (const c of this.cars) {
      if (c.claim < 0) continue;
      const e = this.network.edges[c.edge],
        approaching = (c.dir > 0 ? e.to : e.from) === c.claim,
        n = this.network.nodes[c.claim];
      if (!approaching && Math.hypot(c.position.x - n.x, c.position.z - n.z) > 22) this.release(c);
    }
    // Despawn: out of range, a dead end reached out of sight, a long stop
    // far away, or a tile over its cap (farthest first, never near the player).
    const counts = this.tileCounts();
    const order = this.cars
      .map((c, i) => ({ i, d: Math.hypot(c.position.x - px, c.position.z - pz) }))
      .sort((a, b) => b.d - a.d || a.i - b.i);
    const doomed = new Set<number>();
    for (const { i, d } of order) {
      const c = this.cars[i],
        key = tileKey(Math.floor(c.position.x / TILE_SIZE), Math.floor(c.position.z / TILE_SIZE));
      const over = (counts.get(key) ?? 0) > this.capOf(key);
      if (d > TRAFFIC.despawn || (d > TRAFFIC.spawnMin && (over || (c.ending && c.stopped > 2) || c.stopped > 40))) {
        doomed.add(i);
        counts.set(key, (counts.get(key) ?? 1) - 1);
      }
    }
    if (doomed.size)
      for (let i = this.cars.length - 1; i >= 0; i--) if (doomed.has(i)) this.remove(i);
    // Spawn: tiles in the ring in a fixed order, one hashed point each.
    const R = Math.ceil(TRAFFIC.spawnMax / TILE_SIZE),
      ix0 = Math.floor(px / TILE_SIZE),
      iz0 = Math.floor(pz / TILE_SIZE);
    let made = 0;
    for (let dz = -R; dz <= R && made < TRAFFIC.spawnsPerPass; dz++)
      for (let dx = -R; dx <= R && made < TRAFFIC.spawnsPerPass; dx++) {
        if (this.cars.length >= this.limits.maxCars) return;
        const key = tileKey(ix0 + dx, iz0 + dz),
          list = this.points.get(key);
        if (!list || (counts.get(key) ?? 0) >= this.capOf(key)) continue;
        const pick = list[Math.floor(hash01(this.seed, key, this.passes) * list.length)],
          ddx = pick.x - px,
          ddz = pick.z - pz,
          d = Math.hypot(ddx, ddz);
        if (d < TRAFFIC.spawnMin || d > TRAFFIC.spawnMax) continue;
        if (d < TRAFFIC.viewClear && (ddx * fx + ddz * fz) / (d * fl) > 0.35) continue;
        if (this.cars.some((o) => Math.abs(o.position.x - pick.x) < 30 && Math.abs(o.position.z - pick.z) < 30)) continue;
        const edge = this.network.edges[pick.edge],
          dir: 1 | -1 = hash01(this.seed, key, this.passes, 7) < 0.5 ? 1 : -1,
          id = ++this.serial,
          vehicle = this.pool[Math.floor(hash01(this.seed, id, 11) * this.pool.length)];
        const car = new TrafficCar(id, vehicle, edge, dir, dir > 0 ? pick.s : edge.length - pick.s, this.seed);
        const lanes = edge.spec.halfWidth >= 6 ? 2 : 1;
        car.lane = lanes > 1 && hash01(this.seed, id, 5) < 0.35 ? 0 : lanes - 1;
        car.lateral = this.laneOffset(car);
        if (lanes > 1 && car.lane === 0) car.temper += 0.08;
        this.chooseNext(car);
        this.pose(car, 0);
        car.speed = (SPEED_CLASS_KMH[edge.spec.speedClass] / 3.6) * car.temper * 0.7;
        this.cars.push(car);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        this.spawned++;
        made++;
      }
  }
  /** Place one car on an edge lane (tests, tools): `s` along the travel
   * direction, at `speed`. Counts toward the caps like any spawn. */
  place(edgeIndex: number, dir: 1 | -1, s: number, speed = 0, vehicleId?: string) {
    const edge = this.network.edges[edgeIndex],
      id = ++this.serial,
      vehicle = this.pool.find((d) => d.id === vehicleId) ?? this.pool[0];
    const car = new TrafficCar(id, vehicle, edge, dir, s, this.seed);
    car.lane = edge.spec.halfWidth >= 6 ? 1 : 0;
    car.lateral = this.laneOffset(car);
    this.chooseNext(car);
    this.pose(car, 0);
    car.speed = speed;
    this.cars.push(car);
    this.spawned++;
    return car;
  }
  /** Simplified collision with the player's car: box contact, an impulse
   * with the traffic car's mass (it loses the speed the impulse takes along
   * its heading and slides across its lane), damage to the player through
   * `impactAt`, and a hazard stop. Run after the physics substep. */
  collide(player: Vehicle) {
    const pb = player.body;
    let boxed = false;
    for (const c of this.cars) {
      const dx = c.position.x - pb.position.x,
        dz = c.position.z - pb.position.z;
      if (Math.abs(dx) > 9 || Math.abs(dz) > 9) continue;
      if (!boxed) {
        this.playerBox.half = player.definition.halfExtents;
        this.playerBox.update(pb);
        boxed = true;
      }
      c.box.update(c.body);
      if (!this.contact.intersect(this.playerBox, c.box)) continue;
      // Normal from the traffic car toward the player.
      const n = this.contact.normal,
        point = this.contact.point;
      pb.pointVelocity(point, this.playerVelocity);
      const rel = this.relative.copy(this.playerVelocity).sub(c.body.velocity),
        vn = rel.dot(n);
      const mA = pb.mass,
        mB = c.body.mass;
      this.rA.copy(point).sub(pb.position);
      this.cross.cross(this.rA, n);
      pb.inverseInertia(this.cross, this.inertia);
      const denominator = 1 / mA + 1 / mB + this.inertia.dot(this.cross);
      if (vn < 0) {
        const j = (-1.08 * vn) / denominator;
        pb.velocity.addScaled(n, j / mA);
        this.cross.cross(this.rA, n).scale(j);
        pb.inverseInertia(this.cross, this.inertia);
        pb.omega.add(this.inertia);
        // The traffic car: along its heading into speed, across into a slide.
        const fx = Math.sin(c.yaw),
          fz = Math.cos(c.yaw),
          ax = (-n.x * j) / mB,
          az = (-n.z * j) / mB;
        c.speed = Math.max(0, c.speed + ax * fx + az * fz);
        c.shove = clamp(c.shove + (ax * fz - az * fx), -6, 6);
        const energy = (0.5 * vn * vn) / denominator;
        player.impactAt(energy, point);
        if (energy > 400) {
          // One collision per contact (the substeps of one impact count once).
          if (c.stunned <= 0) this.collisions++;
          c.stunned = Math.max(c.stunned, clamp(2 + energy / 15000, 2, 6));
        }
      }
      // Separate: the player takes the share of the overlap its lighter mass gives it.
      const depth = Math.max(0, this.contact.depth - 0.004),
        share = mB / (mA + mB);
      pb.position.addScaled(n, depth * share * 0.9);
      const back = depth * (1 - share) * 0.9;
      c.lateral -= (n.x * Math.cos(c.yaw) - n.z * Math.sin(c.yaw)) * back;
    }
  }
  /** Traffic block of the festival snapshot (TRAFFIC_HEADER + n·TRAFFIC_STRIDE). */
  writeSnapshot(out = new Float32Array(TRAFFIC_HEADER + this.cars.length * TRAFFIC_STRIDE)) {
    out[0] = this.cars.length;
    out[1] = this.time;
    this.cars.forEach((c, k) => {
      const o = TRAFFIC_HEADER + k * TRAFFIC_STRIDE,
        b = c.body,
        q = b.orientation;
      out[o + TF.ID] = c.id;
      out[o + TF.VEHICLE] = c.vehicleIndex;
      out[o + TF.X] = b.position.x;
      out[o + TF.Y] = b.position.y;
      out[o + TF.Z] = b.position.z;
      out[o + TF.QX] = q.x;
      out[o + TF.QY] = q.y;
      out[o + TF.QZ] = q.z;
      out[o + TF.QW] = q.w;
      out[o + TF.SPEED] = c.speed;
      out[o + TF.BRAKE] = c.brake;
      out[o + TF.FLAGS] = (c.stunned > 0 ? TRAFFIC_FLAG.HAZARD : 0) | (c.waiting ? TRAFFIC_FLAG.WAITING : 0);
    });
    return out;
  }
  /** Order-sensitive digest of the traffic state (determinism checks). */
  digest() {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h = Math.imul(h ^ Math.round(v * 1000), 0x01000193) >>> 0;
    };
    for (const c of this.cars) {
      mix(c.id);
      mix(c.vehicleIndex);
      mix(c.edge);
      mix(c.dir);
      mix(c.s);
      mix(c.speed);
      mix(c.lateral);
    }
    return h >>> 0;
  }
  /** Registry definitions the traffic is drawn from. */
  get vehicles(): readonly VehicleDefinition[] {
    return this.pool;
  }
}
/** Machines the traffic draws from, for presentation (the same rule). */
export function trafficVehicles() {
  const cars = festivalCars(),
    pool = cars.filter((d) => TRAFFIC.vehicleClasses.includes(String(d.classId)));
  return pool.length ? pool : cars;
}
