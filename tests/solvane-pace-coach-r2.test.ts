import { describe, expect, it } from 'vitest';
import { paceEnvelope } from '../src/rendering/open-world/pace-coach.ts';
import { HorizonGuidance } from '../src/rendering/open-world/horizon-guidance.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { resolveEvents } from '../src/simulation/open-world/festival-events.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import * as T from 'three';

const curve = () => {
  const k = new Float64Array(64);
  k[20] = 0.02;
  k[21] = 0.03;
  k[22] = 0.02;
  return k;
};
function advice(
  options: {
    wet?: number;
    speed?: number;
    surface?: number;
    slope?: number;
    k?: Float64Array;
  } = {},
) {
  const k = options.k ?? curve(),
    speed = new Float64Array(k.length);
  const g = new Float64Array(k.length).fill(options.surface ?? 0.92);
  const y = Float64Array.from(g, (_v, i) => i * 7 * (options.slope ?? 0));
  const cue = paceEnvelope(k, g, y, k.length, 7, options.wet ?? 0, options.speed ?? 30, speed);
  return { cue, speed };
}

describe('Surface and grade aware Festival pace advice', () => {
  it('gives the next bend direction, apex distance and finite target before the corner', () => {
    const { cue, speed } = advice();
    expect(cue).toMatchObject({
      direction: 'left',
      severity: 'hairpin',
      distance: 154,
      loose: false,
      wet: false,
    });
    expect(cue!.targetSpeed).toBeCloseTo(Math.sqrt(7.2 / 0.03), 5);
    expect(speed[0]).toBeGreaterThan(speed[15]);
    expect(speed[15]).toBeGreaterThan(speed[21]);
    expect(speed.every((v) => Number.isFinite(v) && v > 0 && v <= 110)).toBe(true);
  });
  it('treats negative curvature as RIGHT with the same speed envelope', () => {
    const left = advice(),
      right = advice({ k: curve().map((k) => -k) });
    expect(right.speed).toEqual(left.speed);
    expect(right.cue!.direction).toBe('right');
  });
  it('reduces speed guidance on loose ground, wet roads and downhill approaches', () => {
    const dry = advice(),
      wet = advice({ wet: 1 }),
      dirt = advice({ surface: 0.66 }),
      down = advice({ slope: -0.12 });
    for (const result of [wet, dirt, down]) expect(result.speed[10]).toBeLessThan(dry.speed[10]);
    expect(wet.cue!.wet).toBe(true);
    expect(dirt.cue!.loose).toBe(true);
    expect(advice({ slope: 0.12 }).speed).toEqual(dry.speed);
  });
  it('uses a reaction interval for early braking and never takes control of the car', () => {
    const fast = advice({ speed: 55 }),
      slow = advice({ speed: 12 });
    expect(fast.cue!.action).toBe('brake');
    expect(slow.cue!.action).toBe('prepare');
    expect(fast.cue!.allowedSpeed).toBeLessThan(fast.speed[0]);
    expect(fast.speed).toEqual(slow.speed);
  });
  it('does not replace the imminent left bend with a stronger later right turn', () => {
    const k = curve();
    k[30] = -0.12;
    expect(advice({ k }).cue).toMatchObject({ direction: 'left', distance: 154 });
  });
  it('clears finished/empty output and suppresses straight, reverse and malformed cues', () => {
    expect(advice({ k: new Float64Array(64) }).cue).toBeNull();
    expect(advice({ speed: -8 }).cue).toBeNull();
    const output = new Float64Array(5).fill(99);
    expect(paceEnvelope([], [], [], 0, NaN, NaN, NaN, output)).toBeNull();
    expect(Array.from(output)).toEqual([0, 0, 0, 0, 0]);
    expect(paceEnvelope([NaN, Infinity], [NaN, 0], [NaN, 0], 2, NaN, NaN, 10, output)).toBeNull();
    expect(output.every(Number.isFinite)).toBe(true);
    expect(output[0]).toBeLessThan(2);
    expect(output[2]).toBe(0);
  });
  it('repeats the same paused advice exactly and clips samples at the finish', () => {
    expect(advice()).toEqual(advice());
    const output = new Float64Array(64).fill(99),
      k = curve();
    expect(
      paceEnvelope(k, new Float64Array(64).fill(0.92), new Float64Array(64), 10, 7, 0, 30, output),
    ).toBeNull();
    expect(output.slice(10).every((v) => v === 0)).toBe(true);
  });
  it('integrates with an actual event and clears the cue on leaving its height layer or cancelling', () => {
    const world = openWorld(),
      events = resolveEvents(world);
    const event = events.find((e) => e.spec.kind === 'drift-zone')!;
    expect(event).toBeDefined();
    const p = pathPoint(),
      guidance = new HorizonGuidance();
    let cueSeen = false;
    for (let d = 0; d < Math.min(event.path.finishDistance, 1500); d += 100) {
      event.path.at(d, p);
      const subject = new T.Vector3(p.x, p.y, p.z);
      guidance.update(event, event.marker, subject, 25, () => p.y, 0.5);
      if (guidance.cue) {
        cueSeen = true;
        break;
      }
    }
    expect(cueSeen).toBe(true);
    guidance.update(event, event.marker, new T.Vector3(p.x, p.y + 20, p.z), 25, () => p.y, 0.5);
    expect(guidance.cue).toBeNull();
    guidance.update(null, null, new T.Vector3(), 25, () => 0);
    expect(guidance.cue).toBeNull();
    expect(guidance.root.visible).toBe(false);
    guidance.reset();
    expect(guidance.cue).toBeNull();
    guidance.dispose();
  });
});
