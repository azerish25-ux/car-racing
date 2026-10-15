import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  FACADE_STREET_LIGHT,
  FACADE_WINDOWS,
  facadeStreetUniforms,
  facadeWindowPlan,
  installFacadeStreetLight,
} from '../src/rendering/venue-kit/materials.ts';
import { URBAN_SKYGLOW, configureSky, urbanFogColor } from '../src/rendering/daylight.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';

describe('night city frontage', () => {
  it('lights about a third of the rooms at log-normal levels, mostly warm', () => {
    const plan = [91, 108, 125].flatMap((seed, i) => facadeWindowPlan(seed, i !== 1, 32 * 40));
    expect(facadeWindowPlan(91, true, 32)).toEqual(facadeWindowPlan(91, true, 32));
    const lit = plan.filter((p) => p.luminance >= FACADE_WINDOWS.min);
    const share = lit.length / plan.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.38);
    const sorted = lit.map((p) => p.luminance).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeGreaterThan(0.18);
    expect(median).toBeLessThan(0.35);
    // A real spread, not identical panes: some near the floor, a few full.
    expect(sorted[Math.floor(sorted.length * 0.1)]).toBeLessThan(0.12);
    expect(sorted.at(-1)).toBeLessThanOrEqual(1);
    expect(sorted.filter((v) => v > 0.8).length).toBeGreaterThan(0);
    // Warm homes dominate; a few cool offices.
    const cool = lit.filter((p) => p.temperature === 3).length / lit.length;
    expect(cool).toBeGreaterThan(0.05);
    expect(cool).toBeLessThan(0.4);
    // A lit pane never reaches the old 1.6 x white: under 0.6 linear.
    expect(FACADE_WINDOWS.emissive).toBeLessThanOrEqual(0.6);
  });
  it('lets the street light the lower storeys of the frontage', () => {
    const m = new T.MeshStandardMaterial();
    installFacadeStreetLight(m);
    const shader = {
      uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as unknown as StudioShader;
    m.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.vertexShader).toContain('attribute float streetLevel;');
    expect(shader.fragmentShader).toContain('Street lamps light the lower storeys');
    expect(shader.uniforms.facadeStreetLight).toBe(facadeStreetUniforms.facadeStreetLight);
    expect(FACADE_STREET_LIGHT.irradiance).toBeGreaterThan(1);
    m.dispose();
  });
  it('puts a warm urban skyglow over night cities and washes out the stars', () => {
    const sky = new Sky();
    configureSky(sky);
    expect(sky.material.uniforms.urbanGlow.value).toBe(0);
    const f = sky.material.fragmentShader;
    expect(f).toContain('urbanGlow * (');
    expect(f).toContain(`mix(1.0, ${URBAN_SKYGLOW.stars.toFixed(3)}, urbanGlow)`);
    // ~0.03 at the horizon, ~0.004 by 30 degrees.
    const glow = (deg: number) =>
      URBAN_SKYGLOW.zenith +
      (URBAN_SKYGLOW.horizon - URBAN_SKYGLOW.zenith) *
        Math.exp(-((deg * Math.PI) / 180) / URBAN_SKYGLOW.falloff);
    expect(glow(0)).toBeCloseTo(0.03, 6);
    expect(glow(30)).toBeLessThan(0.005);
    // The night haze lifts to the glow's horizon colour, never darkens.
    const fog = urbanFogColor(new T.Color(0.0153, 0.0196, 0.0254));
    expect(fog.r).toBeCloseTo(0.03, 6);
    expect(fog.b).toBeCloseTo(0.0254, 6);
    sky.geometry.dispose();
    sky.material.dispose();
  });
});
