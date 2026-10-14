import { describe, expect, it } from 'vitest';
import {
  conveyor,
  shuttle,
  stepOnSurfaces,
  type GroundBody,
} from '../src/simulation/moving-surface.ts';

const DT = 1 / 120;
function simulate(
  surfaces: Parameters<typeof stepOnSurfaces>[1],
  seconds: number,
  start: GroundBody,
  from = 0,
) {
  const body = { ...start };
  for (let tick = 0; tick * DT < seconds; tick++)
    stepOnSurfaces(body, surfaces, from + tick * DT, DT);
  return body;
}
describe('WP44 authoritative moving surfaces', () => {
  it('a resting car on a running belt is carried at belt speed, then stops off it', () => {
    const belt = conveyor(0, 0, 4, 30, 5);
    const body = simulate([belt], 3, { x: 0, z: 1, vx: 0, vz: 0 });
    expect(body.vz).toBeCloseTo(5, 6);
    const off = simulate([belt], 8, { x: 0, z: 1, vx: 0, vz: 0 });
    expect(off.z).toBeGreaterThan(30);
    expect(Math.abs(off.vz)).toBeLessThan(1e-9);
  });
  it('a shuttle platform transports what rests on it', () => {
    const platform = shuttle(0, 0, 3, 2, 8);
    const body = simulate([platform], 1, { x: 0, z: 0, vx: platform.velocity(0, 0, 0).x, vz: 0 });
    expect(platform.contains(1, body.x, body.z)).toBe(true);
    expect(body.x).toBeCloseTo(2 * Math.sin((2 * Math.PI) / 8), 1);
  });
  it('motion is a pure function of simulation time: pause, replay and seek agree', () => {
    const belt = conveyor(0, 0, 4, 100, 6, 4, 0.5);
    const live = simulate([belt], 6, { x: 0, z: 0, vx: 0, vz: 0 });
    // Replay from the same initial state reproduces the result exactly.
    const replay = simulate([belt], 6, { x: 0, z: 0, vx: 0, vz: 0 });
    expect(replay).toEqual(live);
    // Pausing for any wall time does not advance the belt: state depends only
    // on simulation ticks, so a split run equals an unbroken run.
    const first = simulate([belt], 3, { x: 0, z: 0, vx: 0, vz: 0 });
    const resumed = simulate([belt], 3, first, Math.ceil(3 / DT) * DT);
    expect(resumed.z).toBeCloseTo(live.z, 9);
    // The duty cycle is visible and fair: off half of each 4 s period.
    expect(belt.velocity(1, 0, 0).z).toBe(6);
    expect(belt.velocity(3, 0, 0).z).toBe(0);
  });
});
