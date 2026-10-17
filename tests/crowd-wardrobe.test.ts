import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { CROWD_WARDROBE_GLSL, crowdGarmentColour } from '../src/rendering/crowd-wardrobe.ts';
import { installCrowdShader } from '../src/rendering/crowd.ts';
import { installCrowdImpostorShader } from '../src/rendering/crowd-impostor.ts';

describe('shared spectator wardrobe at every LOD', () => {
  it('has stable bounded linear albedo without mutating the supplied team colour', () => {
    const original = new T.Color().setRGB(0.8, 0.07, 0.03),
      before = original.clone(),
      target = new T.Color();
    const colours = new Set<string>();
    for (let i = 0; i < 128; i++) {
      const p = (i * Math.PI * 2) / 128;
      const result = crowdGarmentColour(original, p, target);
      expect(result).toBe(target);
      expect(result.toArray().every((v) => Number.isFinite(v) && v >= 0 && v <= 0.8)).toBe(true);
      expect(result.toArray()).toEqual(crowdGarmentColour(original, p).toArray());
      colours.add(
        result
          .toArray()
          .map((value) => value.toFixed(6))
          .join(','),
      );
    }
    expect(colours.size).toBeGreaterThan(100);
    expect(original.equals(before)).toBe(true);
  });
  it('injects one identical garment transform into geometric and impostor colour shaders', () => {
    const near = new T.MeshStandardMaterial(),
      far = new T.MeshStandardMaterial();
    try {
      installCrowdShader(
        near,
        { crowdClock: { value: new T.Vector2() }, crowdMotion: { value: 0 } },
        true,
      );
      installCrowdImpostorShader(far, new T.Vector2(0, 1));
      const make = (m: T.Material) => {
        const s = {
          vertexShader: T.ShaderLib.standard.vertexShader,
          fragmentShader: T.ShaderLib.standard.fragmentShader,
          uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
        };
        m.onBeforeCompile(s as Parameters<T.Material['onBeforeCompile']>[0], {} as T.WebGLRenderer);
        return s;
      };
      const a = make(near),
        b = make(far);
      expect(a.fragmentShader).toContain(CROWD_WARDROBE_GLSL);
      expect(b.fragmentShader).toContain(CROWD_WARDROBE_GLSL);
      expect(a.fragmentShader).toContain('crowdGarmentColour(vCrowdTop.rgb, ph)');
      expect(b.vertexShader).toContain('vGarmentPhase = spectatorPhase');
      expect(b.fragmentShader).toContain('crowdGarmentColour(diffuseColor.rgb, vGarmentPhase)');
    } finally {
      near.dispose();
      far.dispose();
    }
  });
  it('does not add a time-dependent seed, texture, light or skin transform', () => {
    expect(CROWD_WARDROBE_GLSL).not.toMatch(/crowdClock|sampler|vSkin|sin\(/);
    expect(() => crowdGarmentColour(new T.Color(), NaN)).toThrow();
    expect(() => crowdGarmentColour(new T.Color().setRGB(NaN, 0, 0), 0)).toThrow();
  });
});
