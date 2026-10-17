import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { installCrowdShader } from '../src/rendering/crowd.ts';

describe('MotoGP crowd clothing finish', () => {
  it('uses pixel-filtered cloth relief only in the colour surface pass', () => {
    const m = new T.MeshStandardMaterial();
    const uniforms = {
      crowdClock: { value: new T.Vector2() },
      crowdMotion: { value: 0 },
    };
    installCrowdShader(m, uniforms, true);
    const shader = {
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
      uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
    };
    m.onBeforeCompile(shader as Parameters<T.Material['onBeforeCompile']>[0], {} as T.WebGLRenderer);
    expect(shader.fragmentShader).toContain('float textilePixel = 1. - smoothstep(.0012, .0060, px);');
    expect(shader.fragmentShader).toContain('float textileShoeMask = step(p.y, -.205) * step(p.x, -.2);');
    expect(shader.fragmentShader).toContain('bump += .00024');
    expect(shader.fragmentShader).toContain('rough = clamp(rough + .022');
    m.dispose();
  });
});
