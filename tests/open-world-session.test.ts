import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { controls } from '../src/simulation/config.ts';
import { DriftMeter, type FestivalResult } from '../src/simulation/open-world/festival-events.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { CAR_STRIDE, F, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { TOURING_TC1, vehicleIndex } from '../src/simulation/vehicles.ts';

function runUntilResult(sim: OpenWorldSimulation, seconds: number): FestivalResult | null {
  for (let i = 0; i < seconds * 120; i++) {
    sim.step(1 / 120);
    const r = sim.takeResult();
    if (r) return r;
  }
  return null;
}

describe('festival free-roam session', () => {
  it('spawns on the ground, drives, writes circuit-layout frames and streams within budget', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 24 });
    const start = new Vec3().copy(sim.player.body.position);
    sim.setInput({ ...controls(), throttle: 0.6 });
    for (let i = 0; i < 360; i++) sim.step(1 / 120);
    const status = sim.status();
    expect(status.mode).toBe('free');
    expect(status.road.onRoad).toBe(true);
    expect(sim.player.speed).toBeGreaterThan(5);
    const p = sim.player.body.position;
    expect(Math.hypot(p.x - start.x, p.z - start.z)).toBeGreaterThan(5);
    expect(sim.player.up.y).toBeGreaterThan(0.95);
    const frame = sim.makeFrame();
    expect(frame.length).toBe(HEADER + CAR_STRIDE);
    expect(frame[carBase(0) + F.SPEED]).toBeCloseTo(sim.player.speed, 3);
    expect(frame[carBase(0) + RACE_BASE + R.VEHICLE]).toBe(vehicleIndex('tc1'));
    expect(status.streaming.resident).toBeLessThanOrEqual(24);
  });
  it('restores saved discoveries and travels only to discovered events', () => {
    const sim = new OpenWorldSimulation({
      vehicle: 'tc1',
      discovered: ['pass-zone', 'no-such-event'],
    });
    expect([...sim.discovered]).toContain('pass-zone');
    expect(sim.discovered.has('no-such-event')).toBe(false);
    expect(() => sim.command({ type: 'travel', event: 'quarry-drift' })).toThrow(/discovered/);
    sim.command({ type: 'travel', event: 'pass-zone' });
    const marker = sim.events.find((e) => e.spec.id === 'pass-zone')!.marker;
    const p = sim.player.body.position;
    expect(Math.hypot(p.x - marker.x, p.z - marker.z)).toBeLessThan(12);
    // Parked on the mountain grade: it holds until the driver acts.
    const placed = new Vec3().copy(p);
    for (let i = 0; i < 360; i++) sim.step(1 / 120);
    expect(Math.hypot(p.x - placed.x, p.z - placed.z)).toBeLessThan(1);
    expect(sim.status().road.onRoad).toBe(true);
    expect(sim.status().discovered).toContain('pass-zone');
    // Driving off: the speed zone starts at its entry gate.
    sim.setInput({ ...controls(), throttle: 0.8 });
    for (let i = 0; i < 480 && sim.status().mode === 'free'; i++) sim.step(1 / 120);
    expect(sim.status().mode).toBe('running');
    expect(sim.status().event?.id).toBe('pass-zone');
  });
  it('resets an upturned or drowned car onto the nearest road, repaired', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1' });
    const car = sim.player;
    // Roll it over in a field.
    sim.placeAt(car, 2600, 600, 0);
    car.body.orientation.x = 1;
    car.body.orientation.y = 0;
    car.body.orientation.z = 0;
    car.body.orientation.w = 0;
    car.frontHealth = 0.2;
    for (let i = 0; i < 120 * 5; i++) sim.step(1 / 120);
    const after = sim.player;
    expect(after).not.toBe(car);
    expect(after.frontHealth).toBe(1);
    expect(after.up.y).toBeGreaterThan(0.9);
    expect(sim.status().road.onRoad).toBe(true);
    // Into the sea.
    sim.placeAt(sim.player, 0, -3400, 0);
    for (let i = 0; i < 120 * 4; i++) sim.step(1 / 120);
    expect(sim.status().road.onRoad).toBe(true);
    // Reset on request keeps to the road.
    sim.command({ type: 'reset' });
    expect(sim.status().message).toMatch(/road/i);
  });
  it('races a sprint against route-following rivals and emits a typed result', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1' });
    sim.command({ type: 'autopilot', value: true });
    sim.command({ type: 'start', event: 'valley-sprint' });
    expect(sim.cars.length).toBe(4);
    expect(sim.status().mode).toBe('countdown');
    const result = runUntilResult(sim, 150)!;
    expect(result).not.toBeNull();
    expect(result.kind).toBe('festival-result');
    expect(result.eventKind).toBe('sprint');
    expect(result.completed).toBe(true);
    expect(result.position).toBeGreaterThanOrEqual(1);
    expect(result.entrants).toBe(4);
    expect(result.time).toBeGreaterThan(20);
    expect(result.assisted).toBe(true);
    expect(result.standings).toHaveLength(4);
    // Every rival also covered the route legally (no resets needed).
    expect(result.standings.filter((s) => s.time !== null).length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 120 * 31; i++) sim.step(1 / 120);
    expect(sim.status().mode).toBe('free');
    expect(sim.cars.length).toBe(1);
  });
  it('resets onto the route at the legal progress, never ahead of it (a shortcut gains nothing)', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1' });
    sim.command({ type: 'start', event: 'valley-sprint' });
    for (let i = 0; i < 120 * 3.2; i++) sim.step(1 / 120);
    expect(sim.status().mode).toBe('running');
    const path = sim.events.find((e) => e.spec.id === 'valley-sprint')!.path,
      p = pathPoint(),
      at = () => path.locate(sim.player.body.position.x, sim.player.body.position.z, 0, 400);
    const legal = at();
    // A shortcut that rejoins the route 90 m ahead (beyond RouteProgress's
    // 60 m step): progress cannot follow, the car is off its legal route.
    path.at(legal + 90, p);
    sim.placeAt(sim.player, p.x, p.z, Math.atan2(p.tx, p.tz), p.y + 0.5);
    for (let i = 0; i < 12; i++) sim.step(1 / 120);
    expect(sim.status().event!.offRoute).toBe(true);
    // R: back at the legal progress, where RouteProgress matches at once.
    sim.command({ type: 'reset' });
    expect(at()).toBeLessThan(legal + 12);
    for (let i = 0; i < 12; i++) sim.step(1 / 120);
    expect(sim.status().event!.offRoute).toBe(false);
    // Driving on is credited again and the race carries on.
    sim.command({ type: 'autopilot', value: true });
    const before = sim.status().event!.progress;
    for (let i = 0; i < 120 * 12; i++) sim.step(1 / 120);
    const status = sim.status();
    expect(status.mode).toBe('running');
    expect(status.event!.offRoute).toBe(false);
    expect(status.event!.progress).toBeGreaterThan(before + 0.02);
  });
  it('measures a speed trap and a speed zone as skill challenges', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1' });
    sim.command({ type: 'autopilot', value: true });
    sim.command({ type: 'start', event: 'coast-trap' });
    expect(sim.status().mode).toBe('running');
    const trap = runUntilResult(sim, 60)!;
    expect(trap.eventKind).toBe('speed-trap');
    expect(trap.completed).toBe(true);
    expect(trap.trapKmh).toBeGreaterThan(60);
    expect(trap.stars).toBeGreaterThanOrEqual(0);
    sim.command({ type: 'start', event: 'plateau-zone' });
    const zone = runUntilResult(sim, 120)!;
    expect(zone.eventKind).toBe('speed-zone');
    expect(zone.completed).toBe(true);
    expect(zone.averageKmh).toBeGreaterThan(40);
    // Time covers the legal measured section, not the extra braking run-out
    // at the end of the authored path. Those metres used to inflate records.
    const finish = sim.events.find((e) => e.spec.id === 'plateau-zone')!.distance;
    expect(zone.averageKmh!).toBeLessThanOrEqual((finish / zone.time!) * 3.6);
    expect(zone.averageKmh!).toBeCloseTo((zone.legalDistance / zone.time!) * 3.6, 0);
  });
  it('opens a race card at its marker only when the player stops there', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1' });
    const event = sim.events.find((e) => e.spec.id === 'valley-sprint')!;
    sim.placeAt(
      sim.player,
      event.marker.x,
      event.marker.z,
      event.marker.heading,
      event.marker.y + 1,
    );
    for (let i = 0; i < 60; i++) sim.step(1 / 120);
    const status = sim.status();
    expect(status.mode).toBe('card');
    expect(status.card?.id).toBe('valley-sprint');
    expect(status.discovered).toContain('valley-sprint');
    // "Not now" keeps it closed while the player stays at the marker...
    sim.command({ type: 'cancel' });
    for (let i = 0; i < 60; i++) sim.step(1 / 120);
    expect(sim.status().mode).toBe('free');
    // ...and it offers itself again after the player has left and returned.
    sim.placeAt(sim.player, event.marker.x + 200, event.marker.z, event.marker.heading);
    for (let i = 0; i < 12; i++) sim.step(1 / 120);
    sim.placeAt(
      sim.player,
      event.marker.x,
      event.marker.z,
      event.marker.heading,
      event.marker.y + 1,
    );
    for (let i = 0; i < 60; i++) sim.step(1 / 120);
    expect(sim.status().mode).toBe('card');
  });
});

describe('festival drift scoring', () => {
  it('scores slides with scoring.ts (angle, duration, combo) and voids bailouts', () => {
    const meter = new DriftMeter();
    const car = new Vehicle(0, 'medium', undefined, 'sport', TOURING_TC1);
    let time = 0;
    const slide = (seconds: number, angle: number, speed: number, offRoad = false) => {
      for (let i = 0; i < seconds * 30; i++) {
        car.localVelocity.set(Math.sin(angle) * speed, 0, Math.cos(angle) * speed);
        time += 1 / 30;
        meter.update(car, time, 1 / 30, offRoad, false);
      }
    };
    slide(2, 0.6, 20);
    slide(1, 0, 20);
    slide(1.5, 0.5, 22);
    slide(1, 0, 20);
    slide(1.5, 0.6, 20, true);
    slide(1, 0, 20);
    const { total, lines } = meter.finish(time);
    expect(lines.length).toBe(3);
    expect(lines[0].points).toBeGreaterThan(0);
    expect(lines[1].combo).toBeGreaterThan(1);
    expect(lines[2].points).toBe(0);
    expect(total).toBe(lines[0].points + lines[1].points);
  });
});
