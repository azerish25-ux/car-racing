import * as T from 'three';
import { expect, it } from 'vitest';
import { ShadowProxies } from '../src/rendering/shadow-proxies.ts';

it('F03 shadow pass draws the coarse tier only while the fine tier is the visible one', () => {
  const proxies = new ShadowProxies();
  const root = new T.Group(),
    fine = new T.Mesh(new T.BoxGeometry()),
    coarse = new T.Mesh(new T.BoxGeometry());
  fine.castShadow = coarse.castShadow = true;
  coarse.visible = false;
  root.add(fine, coarse);
  let began = 0,
    ended = 0;
  proxies.shadowSubstitutes = () => [{ fine, coarse, begin: () => began++, end: () => ended++ }];
  const during = proxies.withCasters(() => ({
    fineCasts: fine.castShadow,
    coarseVisible: coarse.visible,
  }));
  expect(during).toEqual({ fineCasts: false, coarseVisible: true });
  expect([began, ended]).toEqual([1, 1]);
  // Camera views are untouched afterwards.
  expect(fine.castShadow).toBe(true);
  expect(coarse.visible).toBe(false);
  // In a handoff (both tiers visible) or a hidden cluster nothing changes.
  coarse.visible = true;
  expect(proxies.withCasters(() => fine.castShadow)).toBe(true);
  coarse.visible = false;
  root.visible = false;
  expect(proxies.withCasters(() => coarse.visible)).toBe(false);
  expect(proxies.substitutedPairs).toBe(0);
});
