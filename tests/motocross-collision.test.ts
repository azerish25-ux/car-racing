import { describe, expect, it } from 'vitest';
import { mod, Vec3 } from '../src/core/math.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { CollisionSolver } from '../src/simulation/collision.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

function stadiumShoulder(lateral: number) {
  const track = rigTrack('arena-nord-sx'),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', MX_450),
    p = track.at(36, trackPoint());
  bike.place(track, p.s, lateral);
  bike.dynamics.heading = Math.atan2(p.tx, p.tz) - 1.1;
  bike.body.orientation.yaw(bike.dynamics.heading);
  bike.body.velocity.set(p.tx * 6 - p.nx * 8, 0, p.tz * 6 - p.nz * 8);
  return { track, bike, p };
}

describe('motocross collision and sprung vertical velocity', () => {
  it('does not turn a real tilted two-bike position correction into the next contact impulse', () => {
    const track = rigTrack('valley-ridge-mx'),
      dt = 1 / 240,
      bikes = [
        new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', MX_250),
        new DirtBikeVehicle(1, 'medium', DEFAULT_SETUP, 'sport', MX_450),
      ],
      collisions = new CollisionSolver();
    // Both bikes start from ordinary static placement on the actual gap
    // mound. Their tilted chassis overlap by 7.6 cm; no force or velocity
    // is assigned to manufacture an impact.
    bikes[0].place(track, 593.852, -0.667);
    bikes[1].place(track, 591.752, -0.667);
    for (const bike of bikes) bike.step(dt, track);
    const authoritativeY = bikes.map((bike) => bike.body.position.y);
    collisions.solve(bikes, track);
    for (const [i, bike] of bikes.entries()) {
      expect(Math.abs(bike.body.position.y - authoritativeY[i])).toBeGreaterThan(0.005);
      bike.step(dt, track);
      const heave = (bike.body.position.y - authoritativeY[i]) / dt;
      expect(bike.body.velocity.y).toBeCloseTo(heave, 10);
      expect(Math.abs(bike.body.velocity.y)).toBeLessThan(0.2);
    }
    collisions.solve(bikes, track);
    // Previously the 1 cm depenetration became +/-2.5 m/s of false heave,
    // then the next solve accelerated the stationary bikes to 1.8–1.9 m/s.
    for (const bike of bikes) {
      expect(bike.body.velocity.length()).toBeLessThan(0.25);
      expect(bike.dynamics.crashes).toBe(0);
    }
  });

  it.each([MX_250, MX_450])('keeps physical heave continuous through $id placement and remount', (definition) => {
    const track = rigTrack('valley-ridge-mx'),
      bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition),
      dt = 1 / 240;
    bike.place(track, 593.852);
    expect(bike.body.velocity.y).toBe(0);
    for (let i = 0; i < 60; i++) {
      const previousY = bike.body.position.y;
      bike.step(dt, track);
      expect(bike.body.velocity.y).toBeCloseTo((bike.body.position.y - previousY) / dt, 10);
    }
    bike.restart(track);
    expect(bike.body.velocity.y).toBe(0);
    expect(bike.dynamics.state).toBe('remount');
    for (let i = 0; i < 120; i++) {
      const previousY = bike.body.position.y;
      bike.step(dt, track);
      expect(bike.body.velocity.y).toBeCloseTo((bike.body.position.y - previousY) / dt, 10);
      expect(bike.body.velocity.finite()).toBe(true);
    }
    const p = track.at(30, trackPoint());
    bike.placeFree(track, p.x, p.z, Math.atan2(p.tx, p.tz), p.y);
    expect(bike.body.velocity.y).toBe(0);
    const previousY = bike.body.position.y;
    bike.step(dt, track);
    expect(bike.body.velocity.y).toBeCloseTo((bike.body.position.y - previousY) / dt, 10);
    expect(bike.dynamics.crashes).toBe(0);
  });
});

describe('motocross barriers between adjacent stadium lanes', () => {
  it('does not push a bike across the median when its corner is nearest the next rhythm lane', () => {
    const { track, bike, p } = stadiumShoulder(-5.9),
      corner = new Vec3(-MX_450.halfExtents[0], 0, MX_450.halfExtents[2]),
      nearest = trackPoint();
    bike.body.orientation.rotate(corner, corner).add(bike.body.position);
    track.nearest(corner.x, corner.z, nearest, corner.y);
    // The actual Arena Nord geometry exposes the ambiguity: this corner
    // maps ~150 m farther around the lap, to the opposite-facing lane.
    const distance = mod(nearest.s - p.s + track.length / 2, track.length) - track.length / 2;
    expect(Math.abs(distance)).toBeGreaterThan(100);
    const before = new Vec3().copy(bike.body.position);
    new CollisionSolver().solve([bike], track);
    // Every corner is still inside this straight's own wall. The old
    // neighbouring wall selected an outward correction of nearly 0.5 m.
    expect(bike.body.position.x).toBe(before.x);
    expect(bike.body.position.z).toBe(before.z);
  });

  it('pushes an overlapping bike toward its own lane, including an angled front corner', () => {
    const { track, bike, p } = stadiumShoulder(-6.8),
      before = new Vec3().copy(bike.body.position);
    new CollisionSolver().solve([bike], track);
    const inward =
      (bike.body.position.x - before.x) * p.nx +
      (bike.body.position.z - before.z) * p.nz;
    expect(inward).toBeGreaterThan(0);
    expect(inward).toBeLessThan(0.4);
    expect(bike.body.position.finite() && bike.body.velocity.finite()).toBe(true);
  });

  it('keeps the seeded eight-rider stadium start free of spurious high-energy launches', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'race',
      weather: 'clear',
      circuit: 'arena-nord-sx',
      ruleset: 'motocross-moto',
      laps: 3,
      opponents: 7,
      vehicles: Array(8).fill('mx450'),
      seed: 41003,
    });
    sim.autoPlayer = true;
    let highest = 0,
      fastestVertical = 0;
    for (let i = 0; i < 20 * 120; i++) {
      sim.step(1 / 120);
      for (const vehicle of sim.cars) {
        const bike = vehicle as DirtBikeVehicle;
        highest = Math.max(highest, bike.cgY);
        fastestVertical = Math.max(fastestVertical, Math.abs(bike.vy));
      }
    }
    // Baseline changes course station under the wheels and launches one
    // rider above 250 m. This start straight has no surveyed jump.
    expect(highest).toBeLessThan(7);
    expect(fastestVertical).toBeLessThan(12);
    expect(sim.cars.every((bike) => bike.body.position.finite())).toBe(true);
  }, 30000);

  it.each(['raw', 'sport'] as const)(
    'projects a deep manual terrain contact without an impossible launch in %s',
    (assist) => {
      const track = rigTrack('arena-nord-sx'),
        p = track.at(36, trackPoint()),
        bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, MX_450),
        collisions = new CollisionSolver();
      // Real free placement on flat ground, then throttle across the median
      // toward the neighbouring jump. No AI or fabricated airborne state.
      bike.placeFree(
        track,
        p.x - p.nx * 5,
        p.z - p.nz * 5,
        Math.atan2(-p.nx, -p.nz),
        0,
      );
      bike.dynamics.speed = 10;
      bike.gear = 2;
      bike.input.throttle = 0.2;
      let highest = bike.cgY,
        fastestVertical = 0;
      for (let i = 0; i < 5 * 240; i++) {
        bike.step(1 / 240, track);
        collisions.solve([bike], track);
        highest = Math.max(highest, bike.cgY);
        fastestVertical = Math.max(fastestVertical, Math.abs(bike.vy));
      }
      // Before the position correction, both aid settings gained ~29 m/s
      // vertically and reached 44–46 m from a 10 m/s ground approach.
      expect(highest).toBeLessThan(6);
      expect(fastestVertical).toBeLessThan(9);
      // The bad approach still carries the normal crash/recovery cost.
      expect(bike.dynamics.crashes).toBe(1);
      expect(bike.crashCauses[0].cause).toMatch(/^crash-/);
      expect(bike.airborne || bike.retired).toBe(false);
      expect(bike.body.position.finite()).toBe(true);
    },
  );
});

describe('shared paved-circuit barriers', () => {
  it.each(['formula', 'motogp'] as const)('retains inward barrier response for %s', (kind) => {
    const track = rigTrack('aurel'),
      vehicle =
        kind === 'formula'
          ? new Vehicle(0)
          : new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.gpr1),
      p = track.at(300, trackPoint()),
      boundary = track.boundaryAt(p, -1);
    vehicle.place(track, p.s, -(boundary - 0.1));
    vehicle.body.velocity.set(p.tx * 10 - p.nx * 5, 0, p.tz * 10 - p.nz * 5);
    const before = new Vec3().copy(vehicle.body.position);
    new CollisionSolver().solve([vehicle], track);
    const inward =
      (vehicle.body.position.x - before.x) * p.nx +
      (vehicle.body.position.z - before.z) * p.nz;
    expect(inward).toBeGreaterThan(0);
    expect(vehicle.body.position.finite() && vehicle.body.velocity.finite()).toBe(true);
  });
});
