import { describe, expect, it } from 'vitest';
import { festivalMenuState } from '../src/session/festival-controls.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  AmbientTraffic,
  TF,
  TRAFFIC,
  TRAFFIC_FLAG,
  TRAFFIC_HEADER,
  TRAFFIC_STRIDE,
} from '../src/simulation/open-world/ambient-traffic.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { TILE_SIZE } from '../src/simulation/open-world/terrain-tiles.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

/** Ambient traffic in the festival (ambient-traffic.ts): deterministic from
 * the seed and the step sequence, capped per tile and in total, never spawned
 * close to the player, off during events, and physically in the way. */
function drive(seed: number, seconds: number, check?: (sim: OpenWorldSimulation) => void) {
  const sim = new OpenWorldSimulation({ vehicle: 'tc1', traffic: true, seed, tileBudget: 24 });
  sim.command({ type: 'autopilot', value: true });
  for (let i = 0; i < seconds * 120; i++) {
    sim.step(1 / 120);
    // The cruise stops at each marker: carry on to the next.
    if (!sim.autopilot && i % 600 === 0) sim.command({ type: 'autopilot', value: true });
    check?.(sim);
  }
  return sim;
}

describe('festival ambient traffic', () => {
  it('is deterministic: the same seed and inputs give the same traffic, another seed differs', () => {
    const a = drive(73021, 30),
      b = drive(73021, 30),
      c = drive(9001, 30);
    expect(a.traffic.cars.length).toBeGreaterThan(4);
    expect(a.traffic.digest()).toBe(b.traffic.digest());
    expect(Array.from(a.trafficFrame())).toEqual(Array.from(b.trafficFrame()));
    expect(a.player.body.position.x).toBe(b.player.body.position.x);
    expect(c.traffic.digest()).not.toBe(a.traffic.digest());
  });
  it('keeps the total and per-tile caps and never spawns close to the player', () => {
    const seen = new Set<number>();
    let peak = 0,
      closest = Infinity,
      worstTile = 0;
    drive(73021, 90, (sim) => {
      const t = sim.traffic,
        p = sim.player.body.position;
      peak = Math.max(peak, t.cars.length);
      expect(t.cars.length).toBeLessThanOrEqual(TRAFFIC.maxCars);
      for (const c of t.cars) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        closest = Math.min(closest, Math.hypot(c.position.x - p.x, c.position.z - p.z));
      }
      if (sim.tick % 60 !== 0) return;
      // Per tile, counting cars outside the near radius (near ones are never
      // removed in view; spawning stops in a full tile).
      const counts = new Map<number, number>();
      for (const c of t.cars) {
        if (Math.hypot(c.position.x - p.x, c.position.z - p.z) < TRAFFIC.spawnMin) continue;
        const key = (Math.floor(c.position.x / TILE_SIZE) + 512) * 1024 + Math.floor(c.position.z / TILE_SIZE) + 512;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, n] of counts) worstTile = Math.max(worstTile, n - t.capOf(key));
    });
    expect(peak).toBeGreaterThan(8);
    expect(seen.size).toBeGreaterThan(peak);
    // Spawned beyond the near radius (less the distance driven in one step).
    expect(closest).toBeGreaterThan(TRAFFIC.spawnMin - 2);
    // Over a pass interval cars can drive into a full tile; the pass removes
    // the excess (never more than the cars that crossed in between).
    expect(worstTile).toBeLessThanOrEqual(1);
  });
  it('is off during events and returns in free roam; the HUD toggle turns it off', () => {
    const sim = drive(73021, 20);
    expect(sim.traffic.cars.length).toBeGreaterThan(0);
    expect(sim.status().traffic).toEqual({ enabled: true, cars: sim.traffic.cars.length });
    sim.command({ type: 'start', event: 'coast-trap' });
    let during = 0,
      result = null;
    for (let i = 0; i < 120 * 60 && !result; i++) {
      sim.step(1 / 120);
      during = Math.max(during, sim.traffic.cars.length);
      result = sim.takeResult();
    }
    expect(result).not.toBeNull();
    expect(during).toBe(0);
    for (let i = 0; i < 120 * 6; i++) sim.step(1 / 120);
    expect(sim.status().mode).toBe('free');
    expect(sim.traffic.cars.length).toBeGreaterThan(0);
    sim.command({ type: 'traffic', value: false });
    for (let i = 0; i < 120 * 2; i++) sim.step(1 / 120);
    expect(sim.traffic.cars.length).toBe(0);
    expect(sim.status().traffic.enabled).toBe(false);
  });
  it('shows the traffic choice in the redrawn menu before the worker reports it', () => {
    // FestivalSession redraws the pause menu as soon as the toggle is
    // pressed; the last status it holds was sent before the change.
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', traffic: true, tileBudget: 24 });
    const stale = sim.status();
    expect(stale.traffic.enabled).toBe(true);
    const save = { vehicle: 'tc1', discovered: [], traffic: true };
    expect(festivalMenuState(stale, save, 'day').traffic).toBe(true);
    save.traffic = false;
    expect(festivalMenuState(stale, save, 'day').traffic).toBe(false);
    // Once the worker has applied it, its status agrees.
    sim.command({ type: 'traffic', value: false });
    expect(sim.status().traffic.enabled).toBe(festivalMenuState(sim.status(), save, 'day').traffic);
    // The rest still follows the worker's status (machine, discoveries, events).
    const menu = festivalMenuState(stale, { ...save, vehicle: 'rs5' }, 'night');
    expect(menu).toMatchObject({ lighting: 'night', vehicle: stale.vehicleId, inEvent: false, autopilot: false });
    expect(festivalMenuState(null, { ...save, vehicle: 'rs5' }, 'day').vehicle).toBe('rs5');
  });
  it('drives the right-hand lane, follows the car ahead and the player, and writes its snapshot block', () => {
    const world = openWorld(),
      traffic = new AmbientTraffic(world.network, 7),
      edge = world.network.edges.find((e) => e.roadClass === 'country' && e.length > 500)!;
    const lead = traffic.place(edge.index, 1, 260, 0),
      follower = traffic.place(edge.index, 1, 180, 18);
    lead.stunned = 30; // a hazard stop ahead
    // The player parked 40 m off the road beside them (inside the despawn
    // radius, outside every lane corridor).
    const player = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.tc1);
    const fx = Math.sin(follower.yaw),
      fz = Math.cos(follower.yaw);
    player.body.position.set(follower.position.x + fz * 40, 0, follower.position.z - fx * 40);
    for (let i = 0; i < 120 * 20; i++) traffic.step(1 / 120, player);
    expect(lead.speed).toBe(0);
    expect(follower.speed).toBeLessThan(0.5);
    const gap = lead.s - follower.s - lead.half[2] - follower.half[2];
    expect(gap).toBeGreaterThan(1.5);
    expect(gap).toBeLessThan(12);
    // Right-hand traffic: negative lateral (left is positive), on the carriageway.
    expect(follower.lateral).toBeLessThan(0);
    expect(Math.abs(follower.lateral)).toBeLessThan(edge.spec.halfWidth);
    // The player stopped in the lane ahead is followed the same way.
    const other = new AmbientTraffic(world.network, 8),
      marker = other.place(edge.index, 1, 420, 0);
    player.body.position.copy(marker.position);
    player.body.orientation.yaw(marker.yaw);
    other.cars.splice(other.cars.indexOf(marker), 1);
    const chaser = other.place(edge.index, 1, 330, 16);
    for (let i = 0; i < 120 * 15; i++) other.step(1 / 120, player);
    other.collide(player);
    const behind =
      (player.body.position.x - chaser.position.x) * Math.sin(chaser.yaw) +
      (player.body.position.z - chaser.position.z) * Math.cos(chaser.yaw) -
      chaser.half[2] -
      player.definition.halfExtents[2];
    expect(chaser.speed).toBeLessThan(0.5);
    expect(behind).toBeGreaterThan(1.5);
    expect(behind).toBeLessThan(12);
    expect(other.collisions).toBe(0);
    const block = traffic.writeSnapshot();
    expect(block.length).toBe(TRAFFIC_HEADER + traffic.cars.length * TRAFFIC_STRIDE);
    const ids = traffic.cars.map((_, k) => block[TRAFFIC_HEADER + k * TRAFFIC_STRIDE + TF.ID]);
    expect(new Set(ids).size).toBe(ids.length);
    // The lead is still in its hazard stop; the follower only waits.
    const flags = (car: (typeof traffic.cars)[number]) =>
      block[TRAFFIC_HEADER + traffic.cars.indexOf(car) * TRAFFIC_STRIDE + TF.FLAGS];
    expect(flags(lead) & TRAFFIC_FLAG.HAZARD).toBe(TRAFFIC_FLAG.HAZARD);
    expect(flags(follower) & TRAFFIC_FLAG.HAZARD).toBe(0);
  });
  it('collides with the player: an impulse with its mass, damage, and a hazard stop', () => {
    const world = openWorld(),
      traffic = new AmbientTraffic(world.network, 11),
      edge = world.network.edges.find((e) => e.roadClass === 'highway' && e.length > 500)!;
    const car = traffic.place(edge.index, 1, 250, 12);
    const player = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.tc1);
    const fx = Math.sin(car.yaw),
      fz = Math.cos(car.yaw),
      overlap = 0.25,
      back = car.half[2] + player.definition.halfExtents[2] - overlap;
    player.body.position.set(car.position.x - fx * back, car.position.y, car.position.z - fz * back);
    player.body.orientation.yaw(car.yaw);
    player.body.velocity.set(fx * 30, 0, fz * 30);
    const before = 30 * player.body.mass + 12 * car.body.mass;
    traffic.collide(player);
    const vp = player.body.velocity.x * fx + player.body.velocity.z * fz;
    expect(vp).toBeLessThan(25);
    expect(car.speed).toBeGreaterThan(17);
    // Momentum along the lane is (nearly) conserved by the impulse.
    const after = vp * player.body.mass + car.speed * car.body.mass;
    expect(Math.abs(after - before) / before).toBeLessThan(0.05);
    expect(traffic.collisions).toBe(1);
    expect(car.stunned).toBeGreaterThan(1.5);
    expect(player.frontHealth).toBeLessThan(1);
    // The overlap is resolved (the player is pushed back out).
    const gap = (car.position.x - player.body.position.x) * fx + (car.position.z - player.body.position.z) * fz;
    expect(gap).toBeGreaterThan(back);
    // The stopped car brakes to a halt with its hazards on.
    for (let i = 0; i < 120 * 3; i++) traffic.step(1 / 120, player);
    expect(car.speed).toBeLessThan(2);
    const k = traffic.cars.indexOf(car),
      block = traffic.writeSnapshot();
    expect(block[TRAFFIC_HEADER + k * TRAFFIC_STRIDE + TF.FLAGS] & TRAFFIC_FLAG.HAZARD).toBe(TRAFFIC_FLAG.HAZARD);
  });
});
