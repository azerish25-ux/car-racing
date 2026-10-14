import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { FIGURE_EIGHT_OVERPASS } from '../src/simulation/test-venues.ts';
import { SURFACE, Track, surfaceSample, trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

describe('WP11 overpass route identity', () => {
  const track = new Track('clear', false, undefined, FIGURE_EIGHT_OVERPASS);
  it('the two roads really share a horizontal position 9 m apart', () => {
    const lower = track.at(0, trackPoint()),
      upper = track.at(track.length / 2, trackPoint());
    expect(Math.hypot(lower.x - upper.x, lower.z - upper.z)).toBeLessThan(1);
    expect(upper.y - lower.y).toBeCloseTo(9, 1);
  });
  it('resolves the station by layer, not by the horizontally closest centreline', () => {
    const p = trackPoint();
    track.nearest(0, 0, p, 0.5);
    expect(Math.min(p.s, track.length - p.s)).toBeLessThan(2);
    track.nearest(0, 0, p, 9.5);
    expect(Math.abs(p.s - track.length / 2)).toBeLessThan(2);
    // Surface sampling under the bridge reports the lower road's height.
    const under = track.sample(0, 0, surfaceSample(), 0.5);
    expect(under.height).toBeLessThan(1);
    const over = track.sample(0, 0, surfaceSample(), 9.5);
    expect(over.height).toBeGreaterThan(8);
  });
  it('an AI lap over and under the bridge never teleports progress or surface', () => {
    const sim = new Simulation(
      { ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 },
      FIGURE_EIGHT_OVERPASS,
    );
    sim.autoPlayer = true;
    const car = sim.cars[0];
    car.place(sim.track, 60, 0);
    let previous = car.s,
      jump = 0,
      offRoad = 0,
      crossedUnder = 0,
      crossedOver = 0;
    const L = sim.track.length;
    for (let i = 0; i < 120 * 160 && sim.race.laps[0].completed < 2; i++) {
      sim.step(1 / 120);
      const ds = ((car.s - previous + L * 1.5) % L) - L / 2;
      jump = Math.max(jump, Math.abs(ds));
      previous = car.s;
      if (car.contacts.some((c) => c.surface === SURFACE.GRASS || c.surface === SURFACE.GRAVEL))
        offRoad++;
      if (Math.hypot(car.body.position.x, car.body.position.z) < 6) {
        if (car.body.position.y < 3) crossedUnder++;
        else crossedOver++;
      }
    }
    expect(sim.race.laps[0].completed).toBeGreaterThanOrEqual(1);
    expect(car.retired).toBe(false);
    // Progress advances continuously: no station jump at either crossing.
    expect(jump).toBeLessThan(2);
    expect(crossedUnder).toBeGreaterThan(0);
    expect(crossedOver).toBeGreaterThan(0);
    expect(offRoad).toBe(0);
  }, 120000);
});
