import { describe, expect, it } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import { DriftMeter } from '../src/simulation/open-world/festival-events.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import {
  FestivalSkillChain,
  type FestivalSkillSample,
} from '../src/simulation/open-world/skill-chain.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { TOURING_TC1 } from '../src/simulation/vehicles.ts';

const slide: FestivalSkillSample = {
  lateral: Math.sin(0.6) * 23,
  forward: Math.cos(0.6) * 23,
  onRoad: true,
  grounded: true,
  impact: false,
  assisted: false,
};
const calm: FestivalSkillSample = { ...slide, lateral: 0, forward: 15 };
function advance(
  chain: FestivalSkillChain,
  sample: FestivalSkillSample,
  seconds: number,
  hz = 120,
) {
  for (let i = 0; i < Math.round(seconds * hz); i++) chain.update(sample, 1 / hz);
}

describe('festival manual driving chains', () => {
  it('builds a drift multiplier and banks exactly its displayed points after a clean exit', () => {
    const chain = new FestivalSkillChain();
    advance(chain, slide, 6);
    const active = chain.status();
    expect(active.phase).toBe('active');
    expect(active.multiplier).toBeGreaterThan(1);
    expect(active.total).toBeGreaterThan(active.score);
    advance(chain, calm, 3.5);
    expect(chain.status().phase).toBe('active');
    expect(chain.status().bankRemaining).toBeCloseTo(0.5, 4);
    advance(chain, calm, 0.5);
    expect(chain.status()).toMatchObject({
      phase: 'banked',
      score: 0,
      total: 0,
      lastBank: active.total,
      sessionTotal: active.total,
      bestChain: active.total,
      sequence: 1,
    });
  });

  it('scores the same driving time at 30 Hz and 120 Hz', () => {
    const slow = new FestivalSkillChain(),
      fast = new FestivalSkillChain();
    advance(slow, slide, 6, 30);
    advance(fast, slide, 6, 120);
    expect(slow.status().total).toBe(fast.status().total);
    expect(slow.status().multiplier).toBe(fast.status().multiplier);
  });

  it('loses pending points on impact, reset, spin or autopilot without spending an earlier bank', () => {
    for (const reason of ['impact', 'reset', 'spin', 'assisted']) {
      const chain = new FestivalSkillChain();
      advance(chain, slide, 3);
      advance(chain, calm, 4);
      const banked = chain.status().sessionTotal;
      advance(chain, slide, 2);
      if (reason === 'reset') chain.reset();
      else if (reason === 'spin') chain.update({ ...slide, forward: 0, lateral: 20 }, 1 / 120);
      else chain.update({ ...slide, [reason]: true }, 1 / 120);
      expect(chain.status().phase, reason).toBe('lost');
      expect(chain.status().total, reason).toBe(0);
      advance(chain, calm, 5);
      expect(chain.status().sessionTotal, reason).toBe(banked);
    }
  });

  it('does not award stationary, backward, airborne, off-road or automated movement', () => {
    const invalid = [
      { ...slide, lateral: 0, forward: 0 },
      { ...slide, forward: -20 },
      { ...slide, grounded: false },
      { ...slide, onRoad: false },
      { ...slide, assisted: true },
    ];
    for (const sample of invalid) {
      const chain = new FestivalSkillChain();
      advance(chain, sample, 10);
      expect(chain.status().total).toBe(0);
      expect(chain.status().sessionTotal).toBe(0);
    }
  });

  it('rewards a sustained clean high-speed line, with a lead-in and a safe return to bank', () => {
    const chain = new FestivalSkillChain();
    const fast = { ...calm, forward: 35 };
    advance(chain, fast, 1.9);
    expect(chain.status().score).toBe(0);
    advance(chain, fast, 2.1);
    expect(chain.status().label).toBe('CLEAN LINE');
    expect(chain.status().score).toBeGreaterThan(50);
    // A long hop cannot bank in mid-air, even after the exit timer ends.
    advance(chain, { ...calm, grounded: false }, 4.5);
    expect(chain.status().sessionTotal).toBe(0);
    chain.update(calm, 1 / 120);
    expect(chain.status().sessionTotal).toBeGreaterThan(50);
  });
});

describe('festival drift feedback integrity', () => {
  function sample(
    meter: DriftMeter,
    car: Vehicle,
    start: number,
    seconds: number,
    angle: number,
    hz = 120,
    impact = false,
  ) {
    for (let i = 0; i < Math.round(seconds * hz); i++) {
      car.localVelocity.set(Math.sin(angle) * 23, 0, Math.cos(angle) * 23);
      meter.update(car, start + (i + 1) / hz, 1 / hz, false, impact);
    }
    return start + seconds;
  }

  it('shows exactly the final score, including repetition/combo, while the second drift is still active', () => {
    const meter = new DriftMeter();
    const car = new Vehicle(0, 'medium', undefined, 'sport', TOURING_TC1);
    let time = sample(meter, car, 0, 2, 0.65);
    time = sample(meter, car, time, 0.5, 0);
    time = sample(meter, car, time, 1.5, 0.65);
    const displayed = meter.live(time);
    expect(displayed).toBeGreaterThan(0);
    expect(meter.finish(time).total).toBe(displayed);
  });

  it('voids a wall contact in the exit grace period and a reset during a slide', () => {
    for (const reset of [false, true]) {
      const meter = new DriftMeter();
      const car = new Vehicle(0, 'medium', undefined, 'sport', TOURING_TC1);
      const time = sample(meter, car, 0, 2, 0.65);
      expect(meter.live(time)).toBeGreaterThan(0);
      if (reset) meter.invalidate(time);
      else sample(meter, car, time, 0.2, 0, 120, true);
      expect(meter.live(time + 0.2)).toBe(0);
      expect(meter.finish(time + 0.2).total).toBe(0);
    }
  });

  it('is independent of sample frequency and does not score an airborne slide', () => {
    const scores: number[] = [];
    for (const hz of [30, 120]) {
      const meter = new DriftMeter();
      const car = new Vehicle(0, 'medium', undefined, 'sport', TOURING_TC1);
      const time = sample(meter, car, 0, 3, 0.7, hz);
      scores.push(meter.finish(time).total);
    }
    expect(scores[0]).toBe(scores[1]);
    const meter = new DriftMeter();
    const car = new Vehicle(0, 'medium', undefined, 'sport', TOURING_TC1);
    car.localVelocity.set(12, 0, 20);
    for (let i = 0; i < 240; i++) meter.update(car, (i + 1) / 120, 1 / 120, false, false, false);
    expect(meter.finish(2).total).toBe(0);
  });
});

describe('festival rolling gates and measurement', () => {
  it('crosses a passive gate in the same moving car without teleporting or repairing it', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 12 });
    const event = sim.events.find((e) => e.spec.id === 'coast-trap')!;
    const p = event.path.at(0, pathPoint());
    const car = sim.player;
    sim.placeAt(car, p.x - p.tx * 18, p.z - p.tz * 18, Math.atan2(p.tx, p.tz), p.y + 0.5);
    sim.setInput({ ...controls(), throttle: 0.25 });
    car.body.velocity.set(p.tx * 32, 0, p.tz * 32);
    car.gear = 4;
    car.frontHealth = 0.8;
    for (const tire of car.tires) tire.omega = 32 / tire.radius;
    for (let i = 0; i < 26; i++) sim.step(1 / 120);
    expect(sim.status().mode).toBe('free'); // still behind the start plane
    for (let i = 0; i < 180 && sim.status().mode === 'free'; i++) sim.step(1 / 120);
    expect(sim.status().event?.id).toBe('coast-trap');
    expect(sim.player).toBe(car);
    expect(sim.player.speed).toBeGreaterThan(20);
    expect(sim.player.frontHealth).toBeLessThanOrEqual(0.8);
    expect(
      (car.body.position.x - p.x) * p.tx + (car.body.position.z - p.z) * p.tz,
    ).toBeGreaterThanOrEqual(0);
  });

  it('does not open a blocking race card while passing its marker at road speed', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 12 });
    const event = sim.events.find((e) => e.spec.id === 'valley-sprint')!;
    const p = event.path.at(0, pathPoint());
    sim.placeAt(sim.player, p.x, p.z, Math.atan2(p.tx, p.tz), p.y + 0.5);
    sim.setInput({ ...controls(), throttle: 0.2 });
    sim.player.body.velocity.set(p.tx * 16, 0, p.tz * 16);
    for (const tire of sim.player.tires) tire.omega = 16 / tire.radius;
    for (let i = 0; i < 30; i++) sim.step(1 / 120);
    expect(sim.player.speed).toBeGreaterThan(10);
    expect(sim.status().mode).toBe('free');
  });

  it('cannot inflate a speed-zone progress bar by reversing and re-driving the same section', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 12 });
    sim.command({ type: 'start', event: 'plateau-zone' });
    const path = sim.events.find((e) => e.spec.id === 'plateau-zone')!.path;
    const place = (d: number) => {
      const p = path.at(d, pathPoint());
      sim.placeAt(sim.player, p.x, p.z, Math.atan2(p.tx, p.tz), p.y + 0.5);
      sim.setInput({ ...controls(), brake: 1 });
      for (let i = 0; i < 8; i++) sim.step(1 / 120);
      return sim.status().event!.progress;
    };
    const first = place(32);
    expect(place(12)).toBeLessThan(first);
    expect(place(32)).toBeCloseTo(first, 3);
  });
});
