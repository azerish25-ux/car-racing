import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  GRADE_LUT_MAX_HUE_SHIFT,
  GRADE_LUT_SIZE,
  createGradeLut,
  gradeLut,
  gradeLutColor,
  hsvToRgb,
  rgbToHsv,
  type GradeLutProfile,
} from '../src/rendering/studio/grade-lut.ts';
import {
  LENS,
  LENS_RAIN_GLSL,
  LensEffects,
  bloomStrength,
  createLensDirt,
  createLensUniforms,
  flareWeight,
  lensRainAmount,
  postLensFrame,
} from '../src/rendering/studio/lens-effects.ts';
import { DOF_TAPS, DepthOfFieldPass } from '../src/rendering/studio/dof-pass.ts';
import { BroadcastGradePass, GRADE_PROFILES } from '../src/rendering/broadcast-grade.ts';
import { LensBloomPass } from '../src/rendering/lens-bloom.ts';
import { H } from '../src/simulation/protocol.ts';

const PROFILES: GradeLutProfile[] = ['day', 'sunset', 'night', 'studio', 'wet'];
const hueDelta = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('grade LUT', () => {
  it('round-trips HSV', () => {
    for (const rgb of [
      [0.2, 0.5, 0.9],
      [0.9, 0.1, 0.1],
      [0.3, 0.3, 0.3],
      [0.1, 0.8, 0.2],
    ] as [number, number, number][]) {
      const back = hsvToRgb(...rgbToHsv(...rgb));
      back.forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 10));
    }
  });

  it('touches the sky lightly, pulls foliage to olive and keeps saturated hues within 5 degrees', () => {
    // The physical sky is already deep: a clear-sky blue gains only a touch
    // of saturation and leans no further than the cap.
    const sky = [0.55, 0.72, 0.9] as const;
    const [hIn, sIn] = rgbToHsv(...sky);
    const [hOut, sOut, vOut] = rgbToHsv(...gradeLutColor('day', ...sky));
    expect(sOut).toBeGreaterThan(sIn);
    expect(sOut).toBeLessThan(sIn * 1.05);
    expect(vOut).toBeLessThanOrEqual(0.9);
    expect(hueDelta(hOut, hIn)).toBeLessThanOrEqual(GRADE_LUT_MAX_HUE_SHIFT + 1e-9);
    // Lime grass loses about 8 % of its saturation on the day profile.
    const grass = [0.36, 0.55, 0.18] as const;
    const before = rgbToHsv(...grass)[1],
      after = rgbToHsv(...gradeLutColor('day', ...grass))[1];
    expect(after / before).toBeGreaterThan(0.9);
    expect(after / before).toBeLessThan(0.94);
    // Livery primaries (and kerb red): hue moves at most 5 degrees in any profile.
    for (const profile of PROFILES)
      for (const hex of [
        0xb3121e, 0xf27c1e, 0x0b5e4f, 0x13235e, 0x1c5bd8, 0xe36fa8, 0x2bb3a0, 0x7fc241, 0xf2c200,
        0xc4222a,
      ]) {
        const c = new T.Color(hex);
        const out = gradeLutColor(profile, c.r, c.g, c.b);
        expect(hueDelta(rgbToHsv(...out)[0], rgbToHsv(c.r, c.g, c.b)[0])).toBeLessThanOrEqual(5);
      }
    // Neutrals stay neutral (no tint outside the shadow lift), studio is identity.
    for (const v of [0, 0.5, 0.9, 1]) {
      const [r, g, b] = gradeLutColor('day', v, v, v);
      expect(Math.abs(r - v) + Math.abs(g - v)).toBeLessThan(1e-9);
      expect(Math.abs(b - v)).toBeLessThan(0.01);
    }
    for (const rgb of [
      [0.1, 0.4, 0.8],
      [0.4, 0.6, 0.2],
      [0.7, 0.2, 0.3],
    ] as [number, number, number][])
      gradeLutColor('studio', ...rgb).forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 10));
    expect(() => gradeLutColor('day', NaN, 0, 0)).toThrow();
  });

  it('builds a 32^3 half-float lattice once per profile', () => {
    const texture = createGradeLut('day');
    expect(texture).toBeInstanceOf(T.Data3DTexture);
    expect(texture.image.width).toBe(GRADE_LUT_SIZE);
    expect(texture.image.depth).toBe(GRADE_LUT_SIZE);
    expect(texture.type).toBe(T.HalfFloatType);
    expect(texture.magFilter).toBe(T.LinearFilter);
    const data = texture.image.data as Uint16Array;
    expect(data.length).toBe(GRADE_LUT_SIZE ** 3 * 4);
    // Black and white corners map to themselves.
    expect(T.DataUtils.fromHalfFloat(data[0])).toBe(0);
    expect(T.DataUtils.fromHalfFloat(data[data.length - 4])).toBeCloseTo(1, 3);
    expect(gradeLut('day')).toBe(gradeLut('day'));
    expect(gradeLut('wet')).not.toBe(gradeLut('day'));
  });

  it('is applied by the grade pass per profile and blended toward wet', () => {
    const pass = new BroadcastGradePass();
    const u = (pass as unknown as { material: T.ShaderMaterial }).material.uniforms;
    pass.apply('sunset', 12, 0);
    expect(u.gradeLut.value).toBe(gradeLut('sunset'));
    expect(u.lutWet.value).toBe(0);
    pass.apply('day', 12, 0.6);
    expect(u.gradeLut.value).toBe(gradeLut('day'));
    expect(u.gradeLutWet.value).toBe(gradeLut('wet'));
    expect(u.lutWet.value).toBe(0.6);
    pass.apply('studio', 0, 1);
    expect(u.lutWet.value).toBe(0);
    // Gameplay grain, fringe and sharpen stay 0 in every profile.
    for (const profile of Object.values(GRADE_PROFILES)) {
      expect(profile.grain).toBe(0);
      expect(profile.fringe).toBe(0);
      expect(profile.sharpen).toBe(0);
    }
    pass.dispose();
  });
});

describe('lens effects', () => {
  it('sets the P11 bloom strengths', () => {
    expect(bloomStrength('day', 0)).toBe(0.45);
    expect(bloomStrength('sunset', 0)).toBe(0.55);
    expect(bloomStrength('night', 0)).toBe(0.8);
    expect(bloomStrength('day', 1)).toBe(0.8);
    expect(bloomStrength('day', 0.5)).toBeCloseTo(0.625, 10);
    expect(bloomStrength('day', NaN)).toBe(0.45);
  });

  it('flares only near the view axis and rains only in rain', () => {
    const deg = Math.PI / 180;
    expect(flareWeight(0)).toBe(1);
    expect(flareWeight(LENS.flareInnerDeg * deg)).toBe(1);
    expect(flareWeight(LENS.flareOuterDeg * deg)).toBe(0);
    expect(flareWeight(90 * deg)).toBe(0);
    expect(LENS.flare).toBeLessThanOrEqual(0.04);
    expect(lensRainAmount(0)).toBe(0);
    expect(lensRainAmount(LENS.rainFull)).toBe(1);
    expect(lensRainAmount(2)).toBeGreaterThan(0);
    // Sparse drops with a thin meniscus: at most 15 % of the drop cells, rims
    // darkened by at most 15 % (a full grid of outlined bubbles read as noise).
    expect(LENS.dropShare).toBeLessThanOrEqual(0.15);
    expect(LENS.dropRim).toBeLessThanOrEqual(0.15);
    expect(LENS_RAIN_GLSL).toContain(`${LENS.dropShare.toFixed(3)} * lensRain`);
    // Soft drops: refraction and meniscus fade out toward the edge (no ring).
    expect(LENS.dropSoft).toBeGreaterThan(0.3);
    expect(LENS.dropSoft).toBeLessThan(0.9);
    expect(LENS_RAIN_GLSL).toContain(
      `float soft = 1.0 - smoothstep(${LENS.dropSoft.toFixed(3)}, 1.0, r);`,
    );
    expect(LENS_RAIN_GLSL).toContain('vec2 offset = -n * radius * 1.6 * wet * soft;');
    // The dimming peaks at the centre (h) and is 0 at the edge: no ring.
    expect(LENS_RAIN_GLSL).toContain(`${LENS.dropRim.toFixed(3)} * h * soft * wet`);
  });

  it('builds the same dirt mask every time', () => {
    const a = createLensDirt(),
      b = createLensDirt();
    expect(a.image.data).toEqual(b.image.data);
    const data = a.image.data as Uint8Array;
    expect(Math.max(...data)).toBeGreaterThan(100);
    expect(data.filter((v) => v < 60).length).toBeGreaterThan(data.length / 2);
  });

  it('updates from presented state only: off, cockpit, exterior rain and a sun-facing view', () => {
    const uniforms = createLensUniforms();
    const lens = new LensEffects(uniforms);
    const camera = new T.PerspectiveCamera();
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const frame = new Float32Array(32);
    frame[H.TIME] = 40;
    frame[H.RAIN] = 12;
    const sun = new T.Vector3(0, 0, -1);
    lens.update(false, camera, 'chase', frame, 70, sun, false);
    expect([uniforms.lensFlare.value, uniforms.lensDirt.value, uniforms.lensRain.value]).toEqual([
      0, 0, 0,
    ]);
    expect(uniforms.lensTime.value).toBe(40);
    lens.update(true, camera, 'chase', frame, 70, sun, false);
    expect(uniforms.lensRain.value).toBe(1);
    expect(uniforms.lensStreak.value).toBe(1);
    expect(uniforms.lensFlare.value).toBeCloseTo(LENS.flare, 6);
    expect(uniforms.lensDirtMap.value).toBeInstanceOf(T.DataTexture);
    // No rain on the visor in the cockpit; no flare at night.
    lens.update(true, camera, 'cockpit', frame, 70, sun, true);
    expect(uniforms.lensRain.value).toBe(0);
    expect(uniforms.lensFlare.value).toBe(0);
    lens.dispose();
  });

  it('wires the bloom composite and the grade pass to the shared uniforms in one call', () => {
    const uniforms = createLensUniforms();
    const lens = new LensEffects(uniforms);
    const grade = new BroadcastGradePass(uniforms);
    const bloom = new LensBloomPass(6, uniforms);
    const frame = new Float32Array(32);
    frame[H.TIME] = 5;
    frame[H.RAIN] = 30;
    frame[H.WATER] = 1;
    const camera = new T.PerspectiveCamera();
    postLensFrame(grade, bloom, frame, 'night', true, camera, 'pod', 0, lens);
    expect(bloom.strength).toBe(0.8);
    expect(grade.profile).toBe('night');
    const gu = (grade as unknown as { material: T.ShaderMaterial }).material.uniforms;
    expect(gu.lensRain).toBe(uniforms.lensRain);
    expect(gu.lensRain.value).toBe(1);
    expect(gu.lutWet.value).toBe(1);
    const composite = (bloom as unknown as { composite: T.ShaderMaterial }).composite;
    expect(composite.uniforms.lensFlare).toBe(uniforms.lensFlare);
    expect(composite.fragmentShader).toContain('lensGhosts(vUv)');
    postLensFrame(grade, bloom, frame, 'studio', false, camera, 'chase', 0, lens);
    expect(bloom.strength).toBe(0.45);
    expect(gu.lensRain.value).toBe(0);
    grade.dispose();
    bloom.dispose();
    lens.dispose();
  });
});

describe('depth of field', () => {
  it('keeps the BokehPass controls and gathers the scene depth without a re-render', () => {
    const camera = new T.PerspectiveCamera(40, 16 / 9, 0.1, 3000);
    const depth = new T.DepthTexture(4, 4, T.FloatType);
    const pass = new DepthOfFieldPass(
      camera,
      { focus: 17, aperture: 0.002, maxblur: 0.016 },
      depth,
    );
    expect(pass.focus).toBe(17);
    expect(pass.materialBokeh.uniforms.tDepth.value).toBe(depth);
    for (const key of ['focus', 'aperture', 'maxblur'] as const)
      expect(pass.materialBokeh.uniforms[key]).toBeDefined();
    expect(pass.materialBokeh.fragmentShader).toContain(`i < ${DOF_TAPS}`);
    expect(DOF_TAPS).toBeGreaterThanOrEqual(16);
    expect(DOF_TAPS).toBeLessThanOrEqual(24);
    // It owns no scene: the pass cannot re-render geometry.
    expect(Object.values(pass).some((v) => v instanceof T.Scene)).toBe(false);
    pass.setSize(1280, 720);
    expect(pass.materialBokeh.uniforms.resolution.value.toArray()).toEqual([1280, 720]);
    pass.dispose();
  });
});
