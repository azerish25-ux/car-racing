import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { AUREL, STANDARD_PIT } from '../src/simulation/circuits.ts';
import { KESTREL_LEFT_PIT } from '../src/simulation/test-venues.ts';
import { Track, SURFACE, surfaceSample } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

describe('WP10 venue-owned pit and grid geometry', () => {
  it('keeps Aurel on the standard right-hand template', () => {
    const track = new Track('clear', false, undefined, AUREL);
    expect(track.pit).toBe(STANDARD_PIT);
    expect(track.pitOffset(150)).toBe(22);
    expect(track.boxS(3)).toBe(123);
    expect(track.boxLateral()).toBe(24.1);
  });
  it('builds a left-hand pit lane with a different start straight from data alone', () => {
    const aurel = new Track('clear', false, undefined, AUREL),
      kestrel = new Track('clear', false, undefined, KESTREL_LEFT_PIT);
    expect(Math.abs(kestrel.length - aurel.length)).toBeGreaterThan(100);
    expect(kestrel.pitOffset(150)).toBe(-21);
    expect(kestrel.boxLateral()).toBe(-23.1);
    const p = kestrel.at(kestrel.boxS(0), { ...aurel.points[0] });
    const sample = kestrel.sample(p.x + p.nx * -21, p.z + p.nz * -21, surfaceSample());
    expect(sample.surface).toBe(SURFACE.PIT);
    // The right-hand side is an ordinary barrier there, not a pit lane.
    expect(kestrel.boundary(kestrel.boxS(0), 1)).toBeCloseTo(p.width + 11, 6);
    expect(kestrel.boundary(150, -1)).toBeGreaterThanOrEqual(26);
  });
  it('drives a full AI pit stop into a left-hand box and rejoins', () => {
    const sim = new Simulation(
      { ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 },
      KESTREL_LEFT_PIT,
    );
    sim.autoPlayer = true;
    const car = sim.cars[0];
    car.place(sim.track, sim.track.length - 900, 0);
    car.pitRequested = true;
    let serviceLateral = 0,
      peakImpact = 0;
    for (let i = 0; i < 120 * 120 && car.pitStops === 0; i++) {
      sim.step(1 / 120);
      if (car.pitPhase === 3) serviceLateral = car.lateral;
      peakImpact = Math.max(peakImpact, car.impact);
    }
    expect(car.pitStops).toBe(1);
    expect(serviceLateral).toBeLessThan(-20);
    for (let i = 0; i < 120 * 30 && car.inPit; i++) sim.step(1 / 120);
    expect(car.inPit).toBe(false);
    expect(car.retired).toBe(false);
    expect(peakImpact).toBeLessThan(0.2);
  }, 60000);
});
