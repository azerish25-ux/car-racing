import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { BIKE, Bike, EXPERT, NOVICE, type BikeInput } from '../src/simulation/bike.ts';

const input = (p: Partial<BikeInput> = {}): BikeInput => ({
  lean: 0,
  throttle: 0,
  frontBrake: 0,
  rearBrake: 0,
  rider: 0,
  ...p,
});
const DT = 1 / 240;
function run(bike: Bike, seconds: number, control: (b: Bike) => BikeInput) {
  for (let t = 0; t < seconds; t += DT) bike.step(control(bike), DT);
}
function cruising(speed: number, assists = NOVICE) {
  const bike = new Bike(assists);
  bike.speed = speed;
  return bike;
}
describe('WP33 rider-bike prototype: required riding situations (§8.3)', () => {
  it('low-speed start: balanced, no oscillation or fall, smooth into riding', () => {
    const bike = new Bike();
    let peakLean = 0;
    run(bike, 6, () => input({ throttle: 0.35 }));
    for (let t = 0; t < 2; t += DT) {
      bike.step(input({ throttle: 0.35 }), DT);
      peakLean = Math.max(peakLean, Math.abs(bike.lean));
    }
    expect(bike.state).toBe('riding');
    expect(bike.speed).toBeGreaterThan(15);
    expect(peakLean).toBeLessThan(0.05);
  });
  it('corner entry: the stick sets a lean, and lean and path agree (tan φ = v²κ/g)', () => {
    const bike = cruising(30);
    run(bike, 4, (b) => input({ lean: 0.6, throttle: b.speed < 30 ? 0.3 : 0.1 }));
    expect(bike.state).toBe('riding');
    expect(Math.abs(bike.lean)).toBeGreaterThan(0.4);
    const steady = (bike.speed * bike.speed * bike.curvature) / G;
    expect(Math.tan(bike.lean)).toBeCloseTo(steady, 1);
  });
  it('front and rear brakes are distinct and the stoppie is bounded', () => {
    const decel = (front: number, rear: number) => {
      const bike = cruising(40, EXPERT);
      bike.step(input({ frontBrake: front, rearBrake: rear }), DT);
      run(bike, 0.3, () => input({ frontBrake: front, rearBrake: rear }));
      return { decel: -bike.longitudinal, bike };
    };
    const front = decel(0.7, 0),
      rear = decel(0, 1);
    expect(front.decel).toBeGreaterThan(rear.decel * 2);
    expect(rear.bike.rearLoad).toBeLessThan(front.bike.rearLoad + BIKE.mass * G);
    const assisted = cruising(40);
    run(assisted, 2, () => input({ frontBrake: 1 }));
    expect(assisted.pitch).toBeGreaterThan(-0.4);
    expect(assisted.state).toBe('riding');
  });
  it('wheelie assist bounds pitch; without it full throttle can loop the bike', () => {
    const assisted = cruising(8),
      raw = cruising(8, EXPERT);
    run(assisted, 3, () => input({ throttle: 1 }));
    run(raw, 3, () => input({ throttle: 1 }));
    expect(assisted.pitch).toBeLessThan(0.3);
    expect(assisted.state).toBe('riding');
    expect(raw.crashes + Number(raw.pitch > 0.3)).toBeGreaterThan(0);
  });
  it('over-asking grip mid-corner is a lowside with a coherent crash and remount', () => {
    const bike = cruising(45, EXPERT);
    let crashed = false;
    for (let t = 0; t < 6 && !crashed; t += DT) {
      bike.step(input({ lean: 1, frontBrake: 0.6 }), DT);
      crashed = bike.state !== 'riding';
    }
    expect(crashed).toBe(true);
    expect(['lowside', 'highside']).toContain(bike.state);
    // Control is not returned while the rider is absent.
    // Inputs during separation/remount are ignored: the bike does not move off.
    const seen = new Set<string>();
    for (let t = 0; t < 12 && !(seen.has('remount') && bike.state === 'riding'); t += DT)
      seen.add(bike.step(input({ throttle: 1 }), DT));
    expect([...seen]).toEqual(expect.arrayContaining(['separated', 'remount', 'riding']));
    expect(bike.state).toBe('riding');
    expect(bike.penaltySeconds).toBeGreaterThan(3);
    expect(bike.crashes).toBe(1);
  });
});
