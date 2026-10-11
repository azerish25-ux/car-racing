import { expect, it } from 'vitest';
import * as T from 'three';
import { CAR_STRIDE, F, H, HEADER, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';
import { EFFECT_CAPACITY, Effects } from '../src/rendering/effects.ts';

function frame(time: number, pickup: number) {
  const f = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  f[H.TIME] = time;
  f[H.CARS] = 1;
  f[o + F.QW] = 1;
  f[o + F.SPEED] = 30;
  f[o + F.VZ] = 30;
  f[o + WHEEL_BASE + W.LOAD] = 2200;
  f[o + F.MARBLE_PICKUP_FR] = pickup;
  return f;
}
function attributes(effects: Effects) {
  const out: T.BufferAttribute[] = [];
  effects.group.traverse((o) => {
    if (o instanceof T.Points || o instanceof T.Mesh)
      out.push(...(Object.values(o.geometry.attributes) as T.BufferAttribute[]));
  });
  return out;
}

it('uploads nothing for an idle particle pool and only the live span of a busy one', () => {
  const effects = new Effects();
  const all = attributes(effects);
  const versions = () => all.map((a) => a.version);
  // A dry, clean frame: no particle is alive, so no attribute is re-sent.
  effects.update(frame(0, 0), 0.016);
  const idle = versions();
  for (let i = 1; i < 10; i++) effects.update(frame(i * 0.016, 0), 0.016);
  expect(versions()).toEqual(idle);
  // An empty pool submits no particle draw.
  const spray = effects.group.getObjectByName('Lit wheel-water spray clouds') as T.Mesh<
    T.InstancedBufferGeometry,
    T.Material
  >;
  const rain = effects.group.children[1] as T.Mesh<T.InstancedBufferGeometry, T.Material>;
  expect((effects.group.children[0] as T.Points).geometry.drawRange.count).toBe(0);
  expect(spray.geometry.instanceCount).toBe(0);
  expect(rain.geometry.instanceCount).toBe(0);
  // Real marble pickup: births mark only the items they touched.
  effects.update(frame(0.2, 0.05), 0.016);
  const points = effects.group.children[0] as T.Points;
  const opacity = points.geometry.getAttribute('opacity') as T.BufferAttribute;
  expect(opacity.version).toBeGreaterThan(idle[all.indexOf(opacity)]);
  expect(opacity.updateRanges.length).toBeGreaterThan(0);
  const touched = opacity.updateRanges.reduce((n, r) => n + r.count, 0);
  expect(touched).toBeGreaterThan(0);
  expect(touched).toBeLessThan(EFFECT_CAPACITY.contact);
  // Live particles stay inside the submitted span.
  const live = points.geometry.drawRange.count;
  expect(live).toBeGreaterThan(0);
  expect(spray.geometry.instanceCount).toBe(live);
  for (let i = live; i < EFFECT_CAPACITY.contact; i++) expect(opacity.array[i]).toBe(0);
  // clear() zeroes the whole pool and must re-send all of it, even after a
  // partial mark in the same frame.
  effects.clear();
  effects.update(frame(0.3, 0.05), 0);
  expect(opacity.updateRanges).toEqual([{ start: 0, count: opacity.array.length }]);
  expect(Array.from(opacity.array).every((v) => v === 0)).toBe(true);
});
