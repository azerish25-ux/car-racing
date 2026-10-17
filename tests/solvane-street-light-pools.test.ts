import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  StreetLightPools,
  type StreetLightSocket,
} from '../src/rendering/open-world/street-light-pools.ts';
const sockets: StreetLightSocket[] = Array.from({ length: 24 }, (_, i) => ({
  position: new T.Vector3(i * 12, 6.82, 0),
  target: new T.Vector3(i * 12 + 1.05, 0.08, 0),
}));
function settle(
  pools: StreetLightPools,
  camera: T.Camera,
  quality: 'low' | 'medium' | 'high' | 'ultra',
  night = 1,
) {
  for (let i = 0; i < 70; i++) pools.update(camera, night, quality, 1 / 60);
}
describe('budgeted physical street-light pools', () => {
  it('keeps fixed shader light counts and never exceeds the quality budget', () => {
    const pools = new StreetLightPools(sockets),
      camera = new T.PerspectiveCamera();
    camera.position.set(48, 4, 1);
    for (const [quality, count] of [
      ['medium', 4],
      ['high', 6],
      ['ultra', 8],
      ['low', 0],
    ] as const) {
      settle(pools, camera, quality);
      const lights = pools.root.children.filter((o) => o instanceof T.SpotLight) as T.SpotLight[];
      expect(lights.filter((l) => l.visible)).toHaveLength(count);
      expect(pools.activeSockets.length).toBeLessThanOrEqual(count);
      expect(new Set(pools.activeSockets).size).toBe(pools.activeSockets.length);
      for (const light of lights) {
        expect(light.castShadow).toBe(false);
        expect(light.intensity).toBeGreaterThanOrEqual(0);
        expect(light.intensity).toBeLessThanOrEqual(520);
        if (light.intensity > 0 && light.visible) {
          const socket = sockets.find((s) => s.position.equals(light.position));
          expect(socket).toBeDefined();
          expect(light.target.position.equals(socket!.target)).toBe(true);
        }
      }
    }
    pools.dispose();
  });
  it('moves a slot only when its intensity has faded completely out', () => {
    const pools = new StreetLightPools(sockets),
      camera = new T.PerspectiveCamera();
    camera.position.set(10, 4, 0);
    settle(pools, camera, 'medium');
    camera.position.x = 220;
    const lights = pools.root.children.filter((o) => o instanceof T.SpotLight) as T.SpotLight[];
    let moved = 0;
    for (let i = 0; i < 100; i++) {
      const previous = lights.map((l) => l.position.clone());
      pools.update(camera, 1, 'medium', 1 / 60);
      lights.forEach((light, j) => {
        if (!previous[j].equals(light.position)) {
          expect(light.intensity).toBe(0);
          moved++;
        }
      });
    }
    expect(moved).toBeGreaterThan(0);
    expect(pools.activeSockets.every((index) => index >= 15)).toBe(true);
    pools.dispose();
  });
  it('does not illuminate empty countryside, daytime, LOW or invalid time samples', () => {
    const pools = new StreetLightPools(sockets),
      camera = new T.PerspectiveCamera();
    settle(pools, camera, 'ultra');
    camera.position.set(10000, 4, 10000);
    settle(pools, camera, 'ultra');
    expect(pools.activeSockets).toHaveLength(0);
    camera.position.set(48, 4, 0);
    settle(pools, camera, 'ultra', 0);
    expect(pools.activeSockets).toHaveLength(0);
    pools.update(camera, NaN, 'high', NaN);
    pools.root.traverse((o) => {
      if (o instanceof T.SpotLight) expect(Number.isFinite(o.intensity)).toBe(true);
    });
    pools.dispose();
  });
  it('owns and disposes all eight light resources exactly once', () => {
    const pools = new StreetLightPools(sockets),
      scene = new T.Scene();
    scene.add(pools.root);
    const spies = pools.root.children
      .filter((o) => o instanceof T.SpotLight)
      .map((o) => vi.spyOn(o as T.SpotLight, 'dispose'));
    pools.dispose();
    pools.dispose();
    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(scene.children).toHaveLength(0);
    expect(pools.root.children).toHaveLength(0);
  });
});
