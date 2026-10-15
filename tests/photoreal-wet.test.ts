import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { ROAD_FILM, installWetRoad } from '../src/rendering/materials.ts';
import { PUDDLES, installWetDetail } from '../src/rendering/studio/wet-detail.ts';
import { SSR, ScreenSpaceReflections } from '../src/rendering/ultra/ssr.ts';
import { SSR_MASK, ssrLayerRoughness } from '../src/rendering/ultra/ssr-mask.ts';

describe('heavy-rain road', () => {
  it('turns a 0.5 mm water depth into a smooth, full sheet the SSR trusts', () => {
    // From ~0.55 mm the racing surface is a continuous sheet (coat 1).
    expect(ROAD_FILM.sheetMm[1]).toBeLessThanOrEqual(0.6);
    // SSR reads the coat: the old 0.58-strength, 0.22-roughness film encoded
    // as 0.55 (faded out); the sheet encodes as its own roughness.
    const old = ssrLayerRoughness(0.22, 0.58, 0.22),
      sheet = ssrLayerRoughness(0.08, 1, ROAD_FILM.sheetRoughness + ROAD_FILM.rainRoughness);
    expect(old).toBeGreaterThan(SSR_MASK.maxRoughness * 0.8);
    expect(sheet).toBeLessThan(0.15);
    expect(sheet).toBeLessThan(SSR_MASK.maxRoughness * 0.6);
    // The emerging dry line (wet ~0.55) stays a broader 0.12-0.16 lobe.
    const dryLine = 0.26 + (ROAD_FILM.sheetRoughness - 0.26) * 0.55;
    expect(dryLine).toBeGreaterThan(0.12);
    expect(dryLine).toBeLessThan(0.16);
    const material = new T.MeshPhysicalMaterial({ clearcoat: 1 }),
      state = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, T.RGBAFormat);
    installWetRoad(material, state, true);
    installWetDetail(material);
    const shader = {
      uniforms: {},
      vertexShader: T.ShaderLib.physical.vertexShader,
      fragmentShader: T.ShaderLib.physical.fragmentShader,
    };
    material.onBeforeCompile(shader as T.WebGLProgramParametersWithUniforms, {} as T.WebGLRenderer);
    const f = shader.fragmentShader;
    // Ripples ride on the whole sheet; the coat flattens to the water plane.
    expect(f).toContain('float roadRippleGain = roadSheet *');
    expect(f).toContain(
      'clearcoatNormal = normalize(mix(roadFilmNormal, clearcoatNormal, roadSheet));',
    );
    // Deeper water joins the hollows: puddle coverage grows with depth.
    expect(f).toContain(`${PUDDLES.depthBias.toFixed(4)} * smoothstep(`);
    material.dispose();
    state.dispose();
  });
  it('stretches wet-road reflections into streaks along the view-projected normal', () => {
    const resolve = ScreenSpaceReflections.glsl.resolve;
    expect(resolve).toContain('uniform float streak;');
    expect(resolve).toContain('vec2 axis = ( ray.xy - vUv ) * stretch;');
    expect(resolve).toContain('smoothstep( 0.8, 0.95, ( cameraWorld * vec4( n, 0.0 ) ).y )');
    expect(SSR.streak).toBeGreaterThan(0.1);
    expect(SSR.streakTaps).toBeLessThanOrEqual(6);
  });
});
