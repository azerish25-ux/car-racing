import { describe, expect, it } from 'vitest';
import {
  MagneticRider,
  loopPoints,
  rotationMinimizingFrames,
} from '../src/simulation/local-frame.ts';

const frames = rotationMinimizingFrames(loopPoints(15), { x: 0, y: 1, z: 0 });
const total = frames[frames.length - 1].s;
function ride(rider: MagneticRider, seconds: number, drive = 0) {
  let topReached = false;
  for (let t = 0; t < seconds; t += 1 / 240) {
    rider.step(drive, 1 / 240);
    if (rider.attached && rider.position.y > 29) topReached = true;
  }
  return topReached;
}
describe('WP43 local frames and explicit magnetic adhesion', () => {
  it('frames stay continuous through the inversion (no normal flip)', () => {
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1].n,
        b = frames[i].n;
      expect(a.x * b.x + a.y * b.y + a.z * b.z).toBeGreaterThan(0.99);
    }
    const top = frames[Math.round(frames.length / 2)];
    expect(top.n.y).toBeLessThan(-0.99);
  });
  it('a fast car holds the loop by ordinary contact; a slow one detaches with inherited velocity', () => {
    const fast = new MagneticRider(frames, [], 0, 30);
    expect(ride(fast, 2.5)).toBe(true);
    expect(fast.detachments).toBe(0);
    const slow = new MagneticRider(frames, [], 0, 25);
    ride(slow, 3);
    expect(slow.detachments).toBeGreaterThan(0);
    expect(slow.attached).toBe(false);
  });
  it('inside a magnetic zone the slow car stays attached through the inversion', () => {
    const magnetic = new MagneticRider(frames, [{ start: 0, end: total, adhesion: 15 }], 0, 25);
    expect(ride(magnetic, 3, 2)).toBe(true);
    expect(magnetic.detachments).toBe(0);
  });
  it('detaches across a non-adhesive gap and reattaches beyond it', () => {
    const zones = [
      { start: 0, end: total * 0.46, adhesion: 15 },
      { start: total * 0.54, end: total, adhesion: 15 },
    ];
    const rider = new MagneticRider(frames, zones, 0, 25);
    const captures: number[] = [];
    for (let t = 0; t < 8; t += 1 / 240) {
      const was = rider.attached;
      rider.step(0, 1 / 240);
      if (!was && rider.attached) captures.push(rider.s);
    }
    // Falls off at the gap with inherited velocity, and is only ever captured
    // by an adhesive section, never inside the gap.
    expect(rider.detachments).toBeGreaterThan(0);
    expect(captures.length).toBeGreaterThan(0);
    for (const s of captures) expect(s < total * 0.46 || s > total * 0.54).toBe(true);
  });
});
