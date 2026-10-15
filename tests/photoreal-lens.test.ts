import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  LENS_BLOOM,
  LensBloomPass,
  PHYSICAL_BLOOM,
  physicalBloomMix,
} from '../src/rendering/lens-bloom.ts';
import {
  LIGHT_SHAFTS,
  LightShaftsPass,
  shaftStrength,
} from '../src/rendering/ultra/light-shafts.ts';
import { AERIAL_PERSPECTIVE } from '../src/rendering/studio/aerial-perspective.ts';
import { LENS, LensEffects, createLensUniforms } from '../src/rendering/studio/lens-effects.ts';
import { LIGHT_POOLS, LightPools } from '../src/rendering/studio/light-pools.ts';
import { Track } from '../src/simulation/track.ts';
import { HEADER } from '../src/simulation/protocol.ts';
import {
  BroadcastGradePass,
  FILMIC_BLACK,
  FILMIC_GRADE_PROFILES,
  GRADE_PROFILES,
} from '../src/rendering/broadcast-grade.ts';

function renderer() {
  return {
    autoClear: true,
    setRenderTarget: () => {},
    render: () => {},
  } as unknown as T.WebGLRenderer;
}

describe('photoreal lens: tight glare, little veil', () => {
  it('reshapes the energy-conserving PSF and keeps the threshold path unchanged', () => {
    const bloom = new LensBloomPass();
    bloom.setSize(64, 36);
    const threshold = bloom.normalization;
    let expected = 0;
    for (let i = 0; i <= LENS_BLOOM.levels; i++) expected += LENS_BLOOM.scatter ** i;
    expect(threshold).toBeCloseTo(expected, 12);
    bloom.energyConserving = true;
    expect(bloom.scatter).toBe(PHYSICAL_BLOOM.scatter);
    // About nine tenths of the redistributed share in the three finest levels,
    // under half a percent in the coarsest.
    const weights = Array.from(
      { length: LENS_BLOOM.levels + 1 },
      (_, i) => PHYSICAL_BLOOM.scatter ** i,
    );
    const total = weights.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(bloom.normalization, 12);
    expect((weights[0] + weights[1] + weights[2]) / total).toBeGreaterThan(0.7);
    expect(weights.at(-1)! / total).toBeLessThan(0.01);
    // The energy prefilter is a separate program; limits are half-float safe.
    type Internals = {
      prefilter: T.ShaderMaterial;
      energyPrefilter: T.ShaderMaterial;
      upsample: T.ShaderMaterial;
    };
    const internals = bloom as unknown as Internals;
    const read = new T.WebGLRenderTarget(64, 36);
    bloom.render(renderer(), read, read);
    expect(internals.upsample.uniforms.gain.value).toBe(PHYSICAL_BLOOM.scatter);
    const shape = internals.energyPrefilter.uniforms.shape.value as T.Vector4;
    expect(shape.z).toBeGreaterThanOrEqual(2000);
    expect(shape.w).toBeGreaterThanOrEqual(8000);
    expect(shape.w).toBeLessThan(65504);
    const f = internals.energyPrefilter.fragmentShader;
    expect(f).toContain('float level = median3(');
    expect(f).toContain(`#define OUTLIER_RATIO ${PHYSICAL_BLOOM.outlierRatio.toFixed(1)}`);
    expect(internals.prefilter.fragmentShader).not.toContain('median3');
    bloom.energyConserving = false;
    bloom.render(renderer(), read, read);
    expect(internals.upsample.uniforms.gain.value).toBe(LENS_BLOOM.scatter);
    bloom.dispose();
    read.dispose();
  });
  it('mixes 3 % by day, 2 % at the golden hour and 4.5 % wet', () => {
    expect(physicalBloomMix('day', 0)).toBe(0.03);
    expect(physicalBloomMix('night', 0)).toBe(0.03);
    expect(physicalBloomMix('sunset', 0)).toBe(0.02);
    expect(physicalBloomMix('day', 1)).toBeCloseTo(0.045, 12);
    expect(physicalBloomMix('sunset', NaN)).toBe(0.02);
  });
  it('starts sunset shafts at the disc, short and restrained, with dark near occluders', () => {
    expect(LIGHT_SHAFTS.g).toBeGreaterThanOrEqual(0.9);
    expect(LIGHT_SHAFTS.decay).toBeLessThanOrEqual(0.94);
    expect(LIGHT_SHAFTS.strength.sunset).toBeLessThanOrEqual(0.06);
    expect(shaftStrength('sunset', 0.3, 0)).toBeGreaterThan(shaftStrength('day', 0.3, 0));
    const camera = new T.PerspectiveCamera(50, 16 / 9, 0.1, 500);
    const pass = new LightShaftsPass(camera, () => new T.DepthTexture(4, 4));
    pass.setSize(64, 36);
    type Internals = { composite: T.ShaderMaterial };
    const composite = (pass as unknown as Internals).composite;
    expect(composite.fragmentShader).toContain('perspectiveDepthToViewZ');
    expect(composite.fragmentShader).toContain(
      `mix( ${LIGHT_SHAFTS.occluded.toFixed(3)}, 1.0, open )`,
    );
    pass.dispose();
    // The aerial perspective's sun-side lobe is a tight aureole.
    expect(AERIAL_PERSPECTIVE.sunPower).toBeGreaterThanOrEqual(24);
    // Half width of the lobe pow(cos, p) under 15 degrees.
    expect((Math.acos(0.5 ** (1 / AERIAL_PERSPECTIVE.sunPower)) * 180) / Math.PI).toBeLessThan(15);
  });
  it('uses a clean lens on ULTRA and keeps the dirt elsewhere', () => {
    const uniforms = createLensUniforms(),
      lens = new LensEffects(uniforms),
      camera = new T.PerspectiveCamera();
    const presented = new Float32Array(HEADER);
    lens.update(true, camera, 'chase', presented, 0, new T.Vector3(0, 1, 0), false);
    expect(uniforms.lensDirt.value).toBe(LENS.dirt);
    lens.update(true, camera, 'chase', presented, 0, new T.Vector3(0, 1, 0), false, true);
    expect(uniforms.lensDirt.value).toBe(LENS.physicalDirt);
    expect(LENS.physicalDirt).toBeLessThanOrEqual(0.3);
    lens.dispose();
  });
  it('authors floodlight heads in physical radiance only for the energy-conserving bloom', () => {
    const pools = new LightPools(new Track());
    type Internals = { headMaterial: T.MeshBasicMaterial };
    const head = (pools as unknown as Internals).headMaterial;
    const white = new T.Color(LIGHT_POOLS.colour);
    pools.update('night');
    expect(head.color.r).toBeCloseTo(white.r * LIGHT_POOLS.headGain, 6);
    pools.update('night', true);
    expect(head.color.r).toBeCloseTo(white.r * LIGHT_POOLS.physicalHeadGain, 6);
    expect(LIGHT_POOLS.physicalHeadGain).toBeGreaterThan(10 * LIGHT_POOLS.headGain);
    pools.update('day');
    expect(head.color.r).toBeCloseTo(white.r * LIGHT_POOLS.headGain, 6);
  });
  it('grades lightly over the filmic transform and keeps the hue-selective LUT', () => {
    for (const mode of ['day', 'sunset', 'night'] as const) {
      const p = FILMIC_GRADE_PROFILES[mode];
      expect(p.contrast).toBeLessThanOrEqual(0.08);
      expect(p.saturation).toBeLessThanOrEqual(1.05);
      expect(p.saturation).toBeLessThanOrEqual(GRADE_PROFILES[mode].saturation);
      expect(p.vibrance).toBeLessThanOrEqual(0.04);
      expect(p.contrast).toBeLessThan(GRADE_PROFILES[mode].contrast);
    }
    const grade = new BroadcastGradePass();
    type Internals = { material: T.ShaderMaterial };
    const u = (grade as unknown as Internals).material.uniforms;
    grade.apply('day');
    expect(u.contrast.value).toBe(GRADE_PROFILES.day.contrast);
    const material = (grade as unknown as Internals).material;
    expect(material.defines?.FILMIC_BLACK).toBeUndefined();
    grade.filmic = true;
    expect(material.defines.FILMIC_BLACK).toBe(FILMIC_BLACK.toFixed(4));
    expect(material.fragmentShader).toContain('#ifdef FILMIC_BLACK');
    expect(FILMIC_BLACK).toBeGreaterThan(0);
    expect(FILMIC_BLACK).toBeLessThan(0.05);
    grade.apply('day');
    expect(u.contrast.value).toBe(FILMIC_GRADE_PROFILES.day.contrast);
    expect(u.vibrance.value).toBe(FILMIC_GRADE_PROFILES.day.vibrance);
    expect(u.gradeLut.value).toBeTruthy();
    grade.filmic = false;
    expect(material.defines.FILMIC_BLACK).toBeUndefined();
    grade.dispose();
  });
});
