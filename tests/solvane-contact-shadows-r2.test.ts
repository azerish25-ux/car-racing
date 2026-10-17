import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { FestivalContactShadows } from '../src/rendering/open-world/contact-shadows.ts';
import { festivalContactLocal } from '../src/rendering/open-world/festival-contacts.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { vehicleDefinition, vehicleIndex } from '../src/simulation/vehicles.ts';

function frameFor(id = 'tc1', count = 1, y = 0) {
  const frame = new Float32Array(HEADER + count * CAR_STRIDE),
    def = vehicleDefinition(id);
  frame[H.CARS] = count;
  for (let car = 0; car < count; car++) {
    const o = carBase(car);
    frame[o + F.QW] = 1;
    frame[o + F.X] = car * 3;
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
    for (let wheel = 0; wheel < 4; wheel++) {
      const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
      frame[p + W.LENGTH] = def.spec.restLength;
      frame[p + W.RADIUS] = def.spec.wheelRadius;
      frame[p + W.LOAD] = 2200;
    }
    frame[o + F.Y] = y - festivalContactLocal(frame, car, 0, new T.Vector3()).y;
  }
  return frame;
}
const camera = () => {
  const c = new T.PerspectiveCamera();
  c.position.set(0, 3, -8);
  return c;
};
const strengths = (field: FestivalContactShadows) =>
  Array.from(field.geometry.attributes.strength.array.slice(0, field.stats.patches * 9));
const positions = (field: FestivalContactShadows) =>
  Array.from(field.geometry.attributes.position.array.slice(0, field.stats.patches * 27));

describe('Physical contact grounding in Festival', () => {
  it('uses one bounded draw for body and four tyres, with no image resources', () => {
    const field = new FestivalContactShadows();
    field.update(frameFor(), camera(), 'low', () => 0);
    expect(field.stats).toMatchObject({ cars: 1, patches: 5, triangles: 40, draws: 1 });
    expect(field.geometry.drawRange.count).toBe(120);
    expect(positions(field).every(Number.isFinite)).toBe(true);
    for (let i = 1; i < positions(field).length; i += 3)
      expect(positions(field)[i]).toBeCloseTo(0.012, 5);
    expect(field.material.depthWrite).toBe(false);
    field.dispose();
  });
  it('uses two real bike contacts rather than four coincident tyre decals', () => {
    const field = new FestivalContactShadows();
    field.update(frameFor('gpr1'), camera(), 'low', () => 0);
    expect(field.stats.patches).toBe(3);
    field.dispose();
  });
  it('keeps tyre contact on the queried bridge layer and conforms corners to a grade', () => {
    const field = new FestivalContactShadows(),
      frame = frameFor('tc1', 1, 8);
    const queried: number[] = [];
    const ground = (x: number, z: number, y = 0) => {
      queried.push(y);
      return (y > 4 ? 8 : 0) + x * 0.02 + z * 0.035;
    };
    field.update(frame, camera(), 'low', ground);
    const p = positions(field);
    expect(field.stats.patches).toBe(5);
    for (let i = 0; i < p.length; i += 3)
      expect(p[i + 1]).toBeCloseTo(8 + p[i] * 0.02 + p[i + 2] * 0.035 + 0.012, 4);
    expect(Math.min(...queried)).toBeGreaterThan(7.7);
    field.update(frameFor(), camera(), 'low', ground);
    expect(Math.max(...positions(field).filter((_v, i) => i % 3 === 1))).toBeLessThan(0.2);
    field.dispose();
  });
  it('rejects cliff-spanning patches instead of bridging height discontinuities', () => {
    const field = new FestivalContactShadows();
    field.update(frameFor(), camera(), 'low', (x) => (x > 0 ? 8 : 0));
    expect(field.stats.patches).toBeLessThan(5);
    for (let p = 0; p < field.stats.patches; p++) {
      const y = positions(field)
        .slice(p * 27, (p + 1) * 27)
        .filter((_v, i) => i % 3 === 1);
      expect(Math.max(...y) - Math.min(...y)).toBeLessThan(0.6);
    }
    field.dispose();
  });
  it('fades real wheel clearance and hides unloaded airborne cars', () => {
    const field = new FestivalContactShadows(),
      frame = frameFor();
    field.update(frame, camera(), 'low', () => 0);
    const dry = Math.max(...strengths(field));
    frame[carBase(0) + F.Y] += 0.35;
    field.update(frame, camera(), 'low', () => 0);
    expect(Math.max(...strengths(field))).toBeLessThan(dry * 0.5);
    for (let i = 0; i < 4; i++) frame[carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE + W.LOAD] = 0;
    field.update(frame, camera(), 'low', () => 0);
    expect(field.stats.patches).toBe(0);
    expect(field.mesh.visible).toBe(false);
    field.dispose();
  });
  it('uses lower strengths alongside higher-quality real sun shadows and remains deterministic on pause', () => {
    const field = new FestivalContactShadows(),
      frame = frameFor();
    field.update(frame, camera(), 'low', () => 0);
    const low = strengths(field);
    field.update(frame, camera(), 'high', () => 0);
    const high = strengths(field),
      p = positions(field);
    expect(high.every((v, i) => v < low[i])).toBe(true);
    field.update(frame, camera(), 'high', () => 0);
    expect(strengths(field)).toEqual(high);
    expect(positions(field)).toEqual(p);
    field.dispose();
  });
  it('caps dense grids, clears travel leftovers and ignores non-finite pose data', () => {
    const field = new FestivalContactShadows(),
      frame = frameFor('tc1', 24),
      c = camera();
    field.update(frame, c, 'low', () => 0);
    expect(field.stats.cars).toBe(8);
    expect(field.stats.patches).toBeLessThanOrEqual(40);
    expect(field.stats.triangles).toBeLessThanOrEqual(320);
    c.position.set(30000, 0, 30000);
    field.update(frame, c, 'low', () => 0);
    expect(field.stats.patches).toBe(0);
    frame[carBase(0) + F.X] = NaN;
    field.update(frame.subarray(0, HEADER + CAR_STRIDE), camera(), 'low', () => 0);
    expect(field.stats.patches).toBe(0);
    field.dispose();
  });
  it('releases geometry and material exactly once and rejects subsequent updates', () => {
    const field = new FestivalContactShadows(),
      g = vi.spyOn(field.geometry, 'dispose'),
      m = vi.spyOn(field.material, 'dispose');
    field.dispose();
    field.dispose();
    field.update(frameFor(), camera(), 'low', () => 0);
    expect(g).toHaveBeenCalledTimes(1);
    expect(m).toHaveBeenCalledTimes(1);
    expect(field.root.children).toHaveLength(0);
    expect(field.stats.draws).toBe(0);
  });
});
