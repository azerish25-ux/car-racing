import { describe, expect, it } from 'vitest';
import {
  FestivalChaseDynamics,
  advanceChaseSpring,
} from '../src/rendering/open-world/chase-dynamics.ts';
import { driftFeedback } from '../src/simulation/open-world/drift-feedback.ts';
import { FESTIVAL_SKILLS } from '../src/simulation/open-world/skill-chain.ts';
const motion = { speed: 40, forward: 35, lateral: 12, yawRate: 0.4, longitudinalG: 0.3 };
describe('Motion-informed Festival camera', () => {
  it('has frame-rate independent filtering and critically damped tracking', () => {
    const outputs = [];
    for (const fps of [30, 60, 120, 144]) {
      const dynamics = new FestivalChaseDynamics();
      dynamics.update({ ...motion, speed: 0, lateral: 0, yawRate: 0 }, 0, true);
      const p = { x: 6, y: 10, z: 4 },
        v = { x: 0, y: 0, z: 0 },
        target = { x: 0, y: 2, z: -5 };
      for (let i = 0; i < fps * 2; i++) {
        dynamics.update(motion, 1 / fps);
        advanceChaseSpring(p, v, target, 9, 1 / fps);
      }
      outputs.push({ cue: { ...dynamics.cues }, p, v });
    }
    for (const actual of outputs.slice(1)) {
      for (const key of Object.keys(actual.cue) as (keyof typeof actual.cue)[])
        expect(actual.cue[key]).toBeCloseTo(outputs[0].cue[key], 8);
      for (const key of ['x', 'y', 'z'] as const) {
        expect(actual.p[key]).toBeCloseTo(outputs[0].p[key], 8);
        expect(actual.v[key]).toBeCloseTo(outputs[0].v[key], 8);
      }
    }
  });
  it('uses symmetric slip and real yaw rate without whipping round in reverse', () => {
    const d = new FestivalChaseDynamics();
    const left = { ...d.update(motion, 0, true) },
      right = { ...d.update({ ...motion, lateral: -12, yawRate: -0.4 }, 0, true) };
    expect(left.yaw).toBeGreaterThan(0);
    expect(right.yaw).toBeCloseTo(-left.yaw, 8);
    expect(right.lookYaw).toBeCloseTo(-left.lookYaw, 8);
    expect(d.update({ ...motion, forward: -30, lateral: 0, yawRate: 0 }, 0, true).yaw).toBe(0);
    expect(d.update({ ...motion, speed: 0 }, 0, true).yaw).toBe(0);
  });
  it('gives bounded speed/load cues and freezes on duplicate paused samples', () => {
    const d = new FestivalChaseDynamics(),
      fast = { ...d.update({ ...motion, speed: 5000, longitudinalG: 400 }, 0, true) };
    expect(fast.fov).toBe(11);
    expect(fast.height).toBeCloseTo(-0.1125);
    expect(fast.distance).toBeCloseTo(0.345);
    d.update({ ...motion, speed: 0 }, 0);
    expect(d.cues).toEqual(fast);
    for (const dt of [NaN, Infinity, -1]) {
      d.update(motion, dt);
      expect(d.cues).toEqual(fast);
    }
    d.update(
      { ...motion, speed: NaN, lateral: Infinity, yawRate: NaN, longitudinalG: Infinity },
      0,
      true,
    );
    expect(Object.values(d.cues).every(Number.isFinite)).toBe(true);
  });
  it('resets on a cut instead of carrying the last car drift into a new vehicle', () => {
    const d = new FestivalChaseDynamics();
    d.update(motion, 0.1);
    d.reset();
    expect(Object.values(d.cues).every((v) => v === 0)).toBe(true);
    d.update({ ...motion, speed: 0, forward: 0, lateral: 0 }, 0, true);
    expect(d.cues.fov).toBe(0);
    const p = { x: 0, y: 0, z: 0 },
      v = { x: 0, y: 0, z: 0 },
      target = { x: 10, y: 0, z: 0 };
    for (let i = 0; i < 10; i++) {
      advanceChaseSpring(p, v, target, 9, 0.25);
      expect(p.x).toBeLessThanOrEqual(10);
      expect(p.x).toBeGreaterThanOrEqual(0);
    }
  });
});
describe('Drift angle feedback without invented score', () => {
  const at = (angle: number, speed = 20) =>
    driftFeedback(speed * Math.sin(angle), speed * Math.cos(angle), true);
  it('uses real motion, exact scoring admission limits and symmetric directions', () => {
    const lo = FESTIVAL_SKILLS.minDriftAngle,
      hi = FESTIVAL_SKILLS.maxDriftAngle;
    expect(at(lo - 0.001)).toMatchObject({ action: 'build', scoring: false });
    expect(at(lo + 0.001)).toMatchObject({ action: 'hold', scoring: true });
    expect(at(hi - 0.001)).toMatchObject({ action: 'recover', scoring: true });
    expect(at(hi + 0.001)).toMatchObject({ action: 'recover', scoring: false });
    const left = at(0.5)!,
      right = at(-0.5)!;
    expect(left.side).toBe('left');
    expect(right.side).toBe('right');
    expect(left.angleDegrees).toBe(right.angleDegrees);
    expect(left.marker).toBeCloseTo(0.5 / (Math.PI / 2));
  });
  it('never praises airborne motion, parking-lot wheelspin, reversing, or invalid input', () => {
    for (const v of [
      [0, 0],
      [20, 0],
      [8, 1],
      [10, -20],
      [NaN, 20],
      [20, Infinity],
    ])
      expect(driftFeedback(v[0], v[1], true)).toBeNull();
    expect(driftFeedback(12, 20, false)).toBeNull();
    expect(at(0.4, 8.9)).toBeNull();
    expect(at(0.1)).toBeNull();
  });
});
