import { describe, it, expect } from 'vitest';
import { Track, surfaceSample, trackPoint } from '../src/simulation/track.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { RACING_LINE, RacingLine, racingLineFor } from '../src/simulation/racing-line.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS, startingGrid } from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';

const circuits = ['aurel', 'vellamar'] as const;
const track = (id: (typeof circuits)[number]) =>
  new Track('clear', false, undefined, circuitDefinition(id));

describe('minimum-curvature racing line', () => {
  for (const id of circuits)
    it(`${id}: stays on the asphalt, is smooth and opens every corner`, () => {
      const t = track(id),
        line = racingLineFor(t),
        p = trackPoint();
      let centreMax = 0,
        lineMax = 0,
        apexes = 0,
        inside = 0;
      for (let i = 0; i < line.count; i++) {
        const s = i * line.step;
        t.at(s, p);
        expect(Math.abs(line.offsets[i])).toBeLessThanOrEqual(
          p.width - RACING_LINE.edgeMargin + 1e-5,
        );
        // No steps or kinks: across the track at under ~11 degrees to the
        // centreline (0.8 m per 4 m sample), with a continuous slope.
        const prev = line.offsets[(i - 1 + line.count) % line.count],
          next = line.offsets[(i + 1) % line.count];
        expect(Math.abs(next - line.offsets[i])).toBeLessThan(0.8);
        expect(Math.abs(next - 2 * line.offsets[i] + prev)).toBeLessThan(0.25);
        centreMax = Math.max(centreMax, Math.abs(p.curvature));
        lineMax = Math.max(lineMax, Math.abs(line.curvature[i]));
        // At a tight apex the line is on the inside of the corner.
        if (Math.abs(p.curvature) > 0.016) {
          apexes++;
          if (Math.sign(line.offsets[i]) === Math.sign(p.curvature)) inside++;
        }
      }
      expect(apexes).toBeGreaterThan(5);
      expect(inside / apexes).toBeGreaterThan(0.85);
      // The tightest radius driven grows (Aurel 43.8 -> 61.6 m, Vellamar 24.3 -> 27.1 m).
      expect(1 / lineMax).toBeGreaterThan((1 / centreMax) * (id === 'aurel' ? 1.3 : 1.08));
      expect(line.offsetAt(line.count * line.step + 2)).toBeCloseTo(line.offsetAt(2), 6);
    });
  it('is solved once per circuit geometry and shared by its tracks', () => {
    const a = track('aurel'),
      b = track('aurel');
    expect(racingLineFor(a)).toBe(racingLineFor(a));
    expect(racingLineFor(b)).not.toBe(racingLineFor(a));
    expect(racingLineFor(b).offsets).toBe(racingLineFor(a).offsets);
    expect(new RacingLine(track('vellamar')).offsets).not.toBe(racingLineFor(a).offsets);
  });
  it('lays race-day rubber along the line, not down the centre', () => {
    const t = track('aurel'),
      line = racingLineFor(t),
      p = trackPoint();
    // A corner where the line is far from the centreline.
    let best = 0,
      bestS = 0;
    for (let i = 0; i < line.count; i++)
      if (Math.abs(line.offsets[i]) > Math.abs(best)) {
        best = line.offsets[i];
        bestS = i * line.step;
      }
    t.at(bestS, p);
    const sample = t.sample(p.x + p.nx * best, p.z + p.nz * best, surfaceSample()).rubber;
    const centre = t.sample(p.x, p.z, surfaceSample()).rubber;
    expect(sample).toBeGreaterThan(0.3);
    expect(centre).toBeLessThan(0.15);
  });
  it('the AI drives the line: quicker, valid laps without damage', async () => {
    for (const [circuit, bound] of [
      ['aurel', 52],
      ['vellamar', 72],
    ] as const) {
      const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, mode: 'practice', opponents: 0 });
      sim.autoPlayer = true;
      const line = racingLineFor(sim.track);
      let error = 0,
        samples = 0;
      for (let tick = 0; tick < 120 * 200 && sim.race.laps[0].completed < 2; tick++) {
        sim.step(1 / 120);
        // Service runner IPC without changing the fixed simulation step or samples.
        if (tick % 2400 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        if (sim.race.laps[0].completed >= 1) {
          error += Math.abs(sim.cars[0].lateral - line.offsetAt(sim.cars[0].s));
          samples++;
        }
      }
      const lap = sim.race.laps[0];
      expect(lap.completed).toBe(2);
      expect(lap.lastValid).toBe(true);
      expect(lap.last).toBeLessThan(bound);
      expect(error / samples).toBeLessThan(1.5);
      expect(sim.cars[0].frontHealth).toBe(1);
    }
  }, 120000);
  it('a mid-field start still races wheel to wheel on the line', async () => {
    // The race-review criterion: one rival within 18 m (and 22 m along the
    // lap) for 5 s. On-track position changes are counted at 15 Hz.
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      laps: 2,
      opponents: 7,
      grid: startingGrid(8, 'midfield'),
    });
    sim.autoPlayer = true;
    const length = sim.track.length,
      distance = new Float64Array(8),
      lastS = sim.cars.map((c) => c.s);
    let order: number[] = [],
      passes = 0,
      run = 0,
      best = 0,
      last = -1,
      clock = 0;
    for (let tick = 0; tick < 120 * 240 && sim.race.phase !== PHASE.FINISHED; tick++) {
      sim.step(1 / 120);
      // Yield before the sampling branches can continue to the next physics tick.
      if (tick % 2400 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      if ((clock += 1 / 120) < 1 / 15) continue;
      clock = 0;
      sim.cars.forEach((c, i) => {
        distance[i] += ((c.s - lastS[i] + length * 1.5) % length) - length / 2;
        lastS[i] = c.s;
      });
      if (sim.race.phase !== PHASE.RACING) continue;
      const now = [...distance.keys()].sort((a, b) => distance[b] - distance[a]);
      for (let k = 0; order.length && k < 7; k++)
        if (order.indexOf(now[k]) > order.indexOf(now[k + 1]) && !sim.cars[now[k]].inPit) passes++;
      order = now;
      const a = sim.cars[0];
      let rival = -1,
        nearest = Infinity;
      for (const b of sim.cars) {
        if (b === a || b.speed < 5 || a.speed < 5) continue;
        const ds = ((b.s - a.s + length * 1.5) % length) - length / 2,
          gap = Math.hypot(
            b.body.position.x - a.body.position.x,
            b.body.position.y - a.body.position.y,
            b.body.position.z - a.body.position.z,
          );
        if (gap <= 18 && Math.abs(ds) <= 22 && gap < nearest) {
          rival = b.id;
          nearest = gap;
        }
      }
      run = rival >= 0 && rival === last ? run + 1 / 15 : 0;
      last = rival;
      best = Math.max(best, run);
    }
    expect(sim.race.phase).toBe(PHASE.FINISHED);
    expect(best).toBeGreaterThanOrEqual(5);
    expect(passes).toBeGreaterThan(5);
    for (const c of sim.cars) expect(c.frontHealth).toBeGreaterThan(0.9);
  }, 240000);
});
