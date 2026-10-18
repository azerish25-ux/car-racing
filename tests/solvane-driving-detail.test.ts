import { describe, expect, it } from 'vitest';
import { clearCameraBoom } from '../src/rendering/open-world/camera-clearance.ts';
import { brakingEnvelope } from '../src/rendering/open-world/braking-envelope.ts';
import {
  NearMissDetector,
  type PassDriver,
  type PassTraffic,
} from '../src/simulation/open-world/near-miss.ts';
import {
  FestivalSkillChain,
  type FestivalSkillSample,
} from '../src/simulation/open-world/skill-chain.ts';
import type { Structure } from '../src/simulation/open-world/placement.ts';

const building: Structure = {
  kind: 'block',
  x: 0,
  z: -6,
  hx: 3,
  hz: 1,
  height: 10,
  base: 0,
  heading: 0,
  floors: 3,
  style: 0,
};
const start = { x: 0, y: 1, z: 0 },
  end = { x: 0, y: 3, z: -10 };
describe('camera boom against existing oriented collision footprints', () => {
  it('stops before a wall and safely supports in-place output', () => {
    const output = { ...end };
    expect(clearCameraBoom(start, output, [building], output)).toBe(true);
    expect(output.z).toBeGreaterThan(-4.62);
    expect(output.z).toBeLessThan(-4.4);
    expect(output.y).toBeGreaterThan(start.y);
  });
  it.each([Math.PI / 4, Math.PI / 2, -Math.PI / 3])('handles a rotated facade %s', (heading) => {
    const output = { ...end };
    expect(clearCameraBoom(start, end, [{ ...building, heading }], output)).toBe(true);
    expect(output.z).toBeGreaterThan(-7);
    expect(output.z).toBeLessThan(-2);
  });
  it('keeps the nearest obstacle, independent of catalogue order', () => {
    const first = { ...building, z: -3, hz: 0.3 };
    const a = { ...end },
      b = { ...end };
    clearCameraBoom(start, end, [building, first], a);
    clearCameraBoom(start, end, [first, building], b);
    expect(a).toEqual(b);
    expect(a.z).toBeGreaterThan(-2.32);
  });
  it('does not collide with a roof above, a shell below, or a parallel wall outside the boom', () => {
    for (const wall of [
      { ...building, base: 20 },
      { ...building, base: -20, height: 5 },
      { ...building, x: 20 },
    ]) {
      const out = { ...end };
      expect(clearCameraBoom(start, end, [wall], out)).toBe(false);
      expect(out).toEqual(end);
    }
  });
  it('handles a zero length boom and an origin inside an existing structure', () => {
    const out = { ...start };
    expect(clearCameraBoom(start, start, [building], out)).toBe(false);
    expect(clearCameraBoom(start, end, [{ ...building, z: 0, hz: 2 }], out)).toBe(false);
    expect(out).toEqual(end);
  });
});

describe('predictive, wet-aware advisory braking ribbon', () => {
  it('warns on the straight before the bend using a bounded backward envelope', () => {
    const curvature = new Float64Array(64);
    curvature[30] = 0.055;
    const speed = new Float64Array(64);
    brakingEnvelope(curvature, 64, 7, 0, speed);
    expect(speed[25]).toBeLessThan(30);
    expect(speed[25]).toBeGreaterThan(speed[30]);
    expect(speed[0]).toBeGreaterThan(speed[25]);
    expect(speed[40]).toBe(110);
    for (let i = 0; i < 30; i++)
      expect(speed[i] ** 2 - speed[i + 1] ** 2).toBeLessThanOrEqual(91.00001);
  });
  it('tightens on wet surfaces and ignores turn direction', () => {
    const dry = new Float64Array(4),
      wet = new Float64Array(4),
      left = new Float64Array(4);
    brakingEnvelope([0, 0.02, 0.05, 0], 4, 8, 0, dry);
    brakingEnvelope([0, 0.02, 0.05, 0], 4, 8, 1, wet);
    brakingEnvelope([0, -0.02, -0.05, 0], 4, 8, 0, left);
    expect(left).toEqual(dry);
    for (let i = 0; i < 3; i++) expect(wet[i]).toBeLessThan(dry[i]);
  });
  it('handles finish clipping and non-finite samples without NaN cues', () => {
    const out = new Float64Array(5);
    out.fill(123);
    brakingEnvelope([NaN, Infinity, 0], 2, NaN, NaN, out);
    expect(Number.isFinite(out[0])).toBe(true);
    expect(out[0]).toBeLessThan(4);
    expect(out[2]).toBe(123);
    brakingEnvelope([], 0, 5, 0, out);
    expect(out[2]).toBe(123);
  });
});

function pass(
  options: {
    side?: number;
    y?: number;
    yaw?: number;
    stunned?: boolean;
    spawnAlongside?: boolean;
    jump?: boolean;
    assisted?: boolean;
    hz?: number;
  } = {},
) {
  const detector = new NearMissDetector();
  const hz = options.hz ?? 120,
    dt = 1 / hz;
  const p: PassDriver = {
    x: 0,
    y: 0,
    z: 0,
    fx: 0,
    fz: 1,
    speed: 26,
    halfWidth: 1,
    halfLength: 2.2,
  };
  const t: PassTraffic = {
    id: 1,
    x: options.side ?? 2.7,
    y: options.y ?? 0,
    z: options.spawnAlongside ? 0 : 20,
    speed: 12,
    yaw: options.yaw ?? 0,
    halfWidth: 1,
    halfLength: 2.2,
    stunned: options.stunned ?? false,
  };
  let count = 0;
  for (let i = 0; i < hz * 4; i++) {
    p.z += p.speed * dt;
    t.z += t.speed * Math.cos(t.yaw) * dt;
    if (options.jump && i === hz) t.z -= 30;
    if (detector.begin(p, dt, !options.assisted) && detector.observe(p, t, dt)) count++;
  }
  return { count, detector };
}
describe('actual-motion traffic passes, not proximity farming', () => {
  it.each([30, 60, 120])('awards one clean overtaking pass at %s Hz', (hz) =>
    expect(pass({ hz }).count).toBe(1),
  );
  it('awards a clean oncoming pass once', () => expect(pass({ yaw: Math.PI }).count).toBe(1));
  it.each([
    { side: 1.9 },
    { side: 5 },
    { y: 9 },
    { yaw: Math.PI / 2 },
    { stunned: true },
    { spawnAlongside: true },
    { jump: true },
    { assisted: true },
  ])('rejects invalid encounter %j', (options) => expect(pass(options).count).toBe(0));
  it('resets pending passes on invalid time/motion and retains at most 24 encounters', () => {
    const detector = new NearMissDetector();
    const p = { x: 0, y: 0, z: 0, fx: 0, fz: 1, speed: 26, halfWidth: 1, halfLength: 2 };
    expect(detector.begin(p, 1 / 60, true)).toBe(true);
    for (let i = 0; i < 200; i++)
      detector.observe(
        p,
        {
          id: i,
          x: 2.7,
          y: 0,
          z: 20,
          yaw: 0,
          speed: 12,
          halfWidth: 1,
          halfLength: 2,
          stunned: false,
        },
        1 / 60,
      );
    expect(detector.size).toBe(24);
    expect(detector.begin(p, NaN, true)).toBe(false);
    expect(detector.size).toBe(0);
    expect(detector.begin({ ...p, speed: 0 }, 1 / 60, true)).toBe(false);
  });
});

const slide: FestivalSkillSample = {
  lateral: 13,
  forward: 22,
  onRoad: true,
  grounded: true,
  impact: false,
  assisted: false,
};
const advance = (
  chain: FestivalSkillChain,
  sample: FestivalSkillSample,
  seconds: number,
  hz = 120,
) => {
  for (let i = 0; i < Math.round(seconds * hz); i++) chain.update(sample, 1 / hz);
};
describe('clean pass and sustained drift transition rewards', () => {
  it('adds one transition bonus only after both sides qualify', () => {
    const transition = new FestivalSkillChain(),
      same = new FestivalSkillChain();
    advance(transition, slide, 1);
    advance(transition, { ...slide, lateral: -13 }, 1);
    advance(same, slide, 2);
    expect(transition.status().score - same.status().score).toBe(180);
    expect(transition.status().label).toBe('DRIFT TRANSITION');
  });
  it('does not award alternating tiny slides or stale/airborne transitions', () => {
    const chain = new FestivalSkillChain(),
      same = new FestivalSkillChain();
    for (let i = 0; i < 120; i++) chain.update({ ...slide, lateral: i % 2 ? 13 : -13 }, 1 / 120);
    advance(same, slide, 1);
    expect(chain.status().score).toBe(same.status().score);
    const stale = new FestivalSkillChain();
    advance(stale, slide, 1);
    advance(stale, { ...slide, grounded: false }, 2);
    advance(stale, { ...slide, lateral: -13 }, 1);
    expect(stale.status().score).toBe(same.status().score * 2);
  });
  it('takes a verified clean-pass bonus through ordinary banking, and voids impacts/autopilot', () => {
    const chain = new FestivalSkillChain(),
      calm = { ...slide, lateral: 0, forward: 20 };
    chain.update({ ...calm, nearMiss: true }, 1 / 120);
    expect(chain.status()).toMatchObject({ label: 'NEAR MISS', score: 150 });
    advance(chain, calm, 4);
    expect(chain.status().sessionTotal).toBe(150);
    for (const sample of [
      { ...calm, impact: true },
      { ...calm, assisted: true },
    ]) {
      const invalid = new FestivalSkillChain();
      invalid.update({ ...sample, nearMiss: true }, 1 / 120);
      expect(invalid.status().score).toBe(0);
    }
  });
});
