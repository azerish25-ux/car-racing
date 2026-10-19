import { describe, expect, it } from 'vitest';
import {
  isMotocrossLandingTarget,
  MotocrossLandingChallenge,
  type LandingChallengeSample,
} from '../src/simulation/offroad/landing-challenge.ts';
import { ProfileBuilder } from '../src/simulation/offroad/profile.ts';
import { assessMotocrossLanding } from '../src/simulation/offroad/riding-feedback.ts';

const profile = new ProfileBuilder();
profile.jump({ name: 'FIRST TABLE', kind: 'tabletop', at: 20, height: 2, face: 30, gap: 10 });
profile.jump({ name: 'SECOND TABLE', kind: 'tabletop', at: 100, height: 2, face: 30, gap: 10 });
const jumps = profile.jumps;
const clean = assessMotocrossLanding(0.1, 2, 0, false);
const hard = assessMotocrossLanding(0.1, 2, 0.8, false);

function harness() {
  const challenge = new MotocrossLandingChallenge();
  const sample: LandingChallengeSample = {
    course: {},
    machine: 'mx450:sport',
    jumps,
    length: 300,
    time: 0,
    s: 0,
    speed: 20,
    lateral: 0,
    halfWidth: 6,
    airborne: false,
    airTime: 0,
    crashed: false,
    eligible: true,
    landing: clean,
  };
  const tick = (values: Partial<LandingChallengeSample>) => {
    Object.assign(sample, values);
    challenge.update(sample);
  };
  const fly = (time: number, index = 0, landingS = jumps[index].landing) => {
    const jump = jumps[index];
    tick({ time, s: jump.takeoff - 0.5, airborne: false, airTime: 0, landing: clean });
    tick({ time: time + 0.05, s: jump.takeoff + 0.5, airborne: true, airTime: 0.05 });
    tick({ time: time + 0.45, s: (jump.takeoff + landingS) / 2, airborne: true, airTime: 0.45 });
    tick({ time: time + 0.85, s: landingS, airborne: false, airTime: 0.85 });
  };
  return { challenge, sample, tick, fly };
}

describe('solo surveyed landing targets', () => {
  it('offers only real surveyed downslopes, excluding a kicker landing on flat ground', () => {
    const p = new ProfileBuilder();
    p.jump({ name: 'KICKER', kind: 'kicker', at: 20, height: 1, face: 25, gap: 10 });
    expect(isMotocrossLandingTarget(p.jumps[0])).toBe(false);
    expect(jumps.every(isMotocrossLandingTarget)).toBe(true);
    const h = harness();
    h.tick({ jumps: [{ ...jumps[0], landingPitch: 0 }] });
    h.fly(1);
    h.tick({ time: 2.11 });
    expect(h.challenge.cleared.size).toBe(0);
  });
  it('waits for clean suspension settlement and counts each distinct feature once', () => {
    const h = harness();
    h.fly(1);
    expect(h.challenge.cleared.size).toBe(0);
    h.tick({ time: 2.11 });
    expect(h.challenge.cleared.size).toBe(1);
    expect(h.challenge.last).toMatchObject({ kind: 'target', first: true, at: 1.85 });
    h.tick({ time: 2.11 });
    expect(h.challenge.cleared.size).toBe(1);
    h.fly(4);
    h.tick({ time: 5.11 });
    expect(h.challenge.cleared.size).toBe(1);
    expect(h.challenge.last).toMatchObject({ kind: 'target', first: false });
    h.fly(8, 1);
    h.tick({ time: 9.11 });
    expect(h.challenge.cleared.size).toBe(2);
  });

  it.each(['short', 'long'] as const)(
    'distinguishes a smooth but %s touchdown from the surveyed zone',
    (kind) => {
      const h = harness();
      const j = jumps[0];
      const land = j.landing + (kind === 'short' ? -1 : 1) * (j.landingLength / 2 + 1);
      h.fly(1, 0, land);
      h.tick({ time: 2.11 });
      expect(h.challenge.cleared.size).toBe(0);
      expect(h.challenge.last?.kind).toBe(kind);
    },
  );

  it('retains a late bottom-out through settlement even after its telemetry decays', () => {
    const h = harness();
    h.fly(1);
    h.tick({ time: 1.95, landing: hard });
    h.tick({ time: 2.11, landing: clean });
    expect(h.challenge.cleared.size).toBe(0);
    expect(h.challenge.last?.kind).toBe('rough');
  });

  it('rejects rebounds, tiny hops and entering a replay already airborne', () => {
    const bounce = harness();
    bounce.fly(1);
    bounce.tick({ time: 1.93, airborne: true, airTime: 0.03 });
    bounce.tick({ time: 1.98, airborne: false, airTime: 0.08 });
    bounce.tick({ time: 2.4 });
    expect(bounce.challenge.cleared.size).toBe(0);
    const hop = harness();
    hop.tick({ time: 1, s: jumps[0].takeoff - 0.1 });
    hop.tick({ time: 1.02, s: jumps[0].takeoff + 0.1, airborne: true, airTime: 0.02 });
    hop.tick({ time: 1.06, airborne: false, airTime: 0.06 });
    hop.tick({ time: 1.4 });
    expect(hop.challenge.cleared.size).toBe(0);
    const replay = harness();
    replay.tick({ time: 1.5, s: jumps[0].landing - 2, airborne: true, airTime: 0.7 });
    replay.tick({ time: 1.6, s: jumps[0].landing, airborne: false, airTime: 0.8 });
    replay.tick({ time: 1.9 });
    expect(replay.challenge.cleared.size).toBe(0);
  });

  it.each(['automatic', 'off-course', 'crash', 'teleport', 'reverse'] as const)(
    'invalidates an attempt on %s without awarding a target',
    (reason) => {
      const h = harness();
      h.fly(1);
      h.tick({
        time: 1.95,
        ...(reason === 'automatic' ? { eligible: false } : {}),
        ...(reason === 'off-course' ? { lateral: 7 } : {}),
        ...(reason === 'crash' ? { crashed: true } : {}),
        ...(reason === 'teleport' ? { s: h.sample.s + 60 } : {}),
        ...(reason === 'reverse' ? { s: h.sample.s - 3 } : {}),
      });
      h.tick({ time: 2.3, eligible: true, lateral: 0, crashed: false });
      expect(h.challenge.cleared.size).toBe(0);
    },
  );

  it('never counts an automated takeoff after control is returned in midair', () => {
    const h = harness();
    h.tick({ eligible: false });
    h.fly(1);
    h.tick({ time: 2, eligible: true });
    h.tick({ time: 2.3 });
    expect(h.challenge.cleared.size).toBe(0);
  });

  it('keeps earned targets across a dropped frame interval but resets a new run or seek', () => {
    for (const changed of ['course', 'machine', 'seek', 'invalid'] as const) {
      const h = harness();
      h.fly(1);
      h.tick({ time: 2.11 });
      h.tick({ time: 10 });
      expect(h.challenge.cleared.size).toBe(1);
      h.tick({
        time: changed === 'seek' ? 9 : changed === 'invalid' ? NaN : 10.1,
        ...(changed === 'course' ? { course: {} } : {}),
        ...(changed === 'machine' ? { machine: 'mx250:raw' } : {}),
      });
      expect(h.challenge.cleared.size).toBe(0);
    }
  });

  it('handles ordinary forward travel across the lap seam without losing earned targets', () => {
    const h = harness();
    h.fly(1);
    h.tick({ time: 2.11 });
    h.tick({ time: 20, s: 298 });
    h.tick({ time: 20.2, s: 2 });
    expect(h.challenge.cleared.size).toBe(1);
  });

  it('suspends the live goal while recorded footage is viewed, preserving earned targets', () => {
    const h = harness();
    h.fly(1);
    h.tick({ time: 2.11 });
    h.challenge.suspend();
    h.challenge.suspend();
    h.tick({ time: 2.11 });
    h.tick({ time: 2.3 });
    expect(h.challenge.cleared.size).toBe(1);
    expect(h.challenge.last).toBeNull();
  });
});
