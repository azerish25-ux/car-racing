import * as T from 'three';
import { describe, expect, it } from 'vitest';
import type { Structure } from '../src/simulation/open-world/placement.ts';
import type { GlowSource } from '../src/rendering/open-world/festival-signage.ts';
import type { ArchitecturePlan } from '../src/rendering/open-world/japan-architecture.ts';
import { NIGHT_GLOW, NightGlow } from '../src/rendering/open-world/night-glow.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';

const block = { x: 0, z: 0, hx: 6, hz: 6, heading: 0, base: 0, height: 20, floors: 6 };
const structures = [block] as unknown as Structure[];
const plan = {
  style: ['urban'],
  front: [1],
  konbiniFloor: new Set<number>(),
} as unknown as ArchitecturePlan;
const neon: GlowSource = {
  ax: 0,
  az: 10,
  bx: 0,
  bz: 10,
  y0: 3,
  y1: 9,
  color: 0xff2080,
  power: 1.5,
  reach: 13,
};

describe('festival night glow', () => {
  const glow = new NightGlow([neon], structures, plan);
  const tex = glow.texture!;
  const box = glow.uniforms.owGlowBox.value;
  const sample = (x: number, z: number) => {
    const d = tex.image.data as Uint16Array,
      w = tex.image.width,
      h = tex.image.height;
    const i = (Math.floor((z - box.y) * box.w * h) * w + Math.floor((x - box.x) * box.z * w)) * 4;
    return [0, 1, 2, 3].map((c) => T.DataUtils.fromHalfFloat(d[i + c]));
  };
  it('bakes a coloured wash that falls off with distance and records the top', () => {
    const near = sample(0, 11),
      mid = sample(6, 11),
      far = sample(0, 30);
    expect(near[0]).toBeGreaterThan(near[1] * 3); // pink: red over green
    expect(near[0]).toBeGreaterThan(mid[0]);
    expect(far[0]).toBe(0);
    expect(near[3]).toBeGreaterThan(5); // light-weighted top of the sources
    expect(near[3]).toBeLessThan(9.5);
  });
  it('chains its hook once per material and kind', () => {
    const m = new T.MeshStandardMaterial();
    glow.install(m, 'facade');
    glow.install(m, 'facade');
    expect(studioHookKeys(m)).toEqual(['festival-night-glow-facade-v1']);
  });
  it('keeps a fixed light count per tier, none by day or on LOW', () => {
    const camera = new T.PerspectiveCamera();
    camera.position.set(0, 2, 14);
    const lit = () => glow.root.children.filter((c) => c.visible).length;
    glow.update(camera, 0, 'ultra', 0, 0.016);
    expect(lit()).toBe(0);
    glow.update(camera, 1, 'low', 0, 0.016);
    expect(lit()).toBe(0);
    for (const preset of ['medium', 'high', 'ultra'] as const) {
      glow.update(camera, 1, preset, 0, 0.016);
      expect(lit()).toBe(NIGHT_GLOW.lights[preset]);
    }
    // The neon face is picked and fades in.
    for (let k = 0; k < 30; k++) glow.update(camera, 1, 'medium', 0, 0.05);
    const light = glow.root.children[0] as T.PointLight;
    expect(light.intensity).toBeGreaterThan(0);
    expect(light.position.z).toBeCloseTo(10, 3);
  });
});
