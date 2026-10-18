import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { createPhotoSkyUniforms } from '../src/rendering/assets/photo-sky-shader.ts';
import type { PhotoSky } from '../src/rendering/assets/photo-sky.ts';
import { FESTIVAL_PALETTE, SKY_RAMPS, skyBlend } from '../src/rendering/assets/sky-catalogue.ts';
import { createSkyCloudUniforms, SkyClouds } from '../src/rendering/studio/sky-clouds.ts';
import {
  FESTIVAL_CLOUD_SHADOW,
  installFestivalCloudShadow,
} from '../src/rendering/open-world/festival-cloud-shadow.ts';
import {
  FESTIVAL_LIGHT,
  FESTIVAL_SKY,
  FestivalSky,
  FestivalSkyClouds,
  festivalCloudCover,
  festivalEnvironment,
  festivalExposure,
  festivalLight,
  sunFacing,
  festivalPhotoClouds,
} from '../src/rendering/open-world/festival-sky.ts';

/** A sky material with the photo and cloud uniforms (as configureSky declares). */
function skyMaterial() {
  return new T.ShaderMaterial({
    uniforms: { ...createPhotoSkyUniforms(), ...createSkyCloudUniforms() } as never,
  });
}

describe('festival sky', () => {
  it('keeps circuits on the photograph alone (opt-in clouds)', () => {
    expect(createPhotoSkyUniforms().photoClouds.value).toBe(0);
  });

  it('never shows less than fair-weather cloud, and keeps heavier cover', () => {
    expect(festivalCloudCover(0.12, 'day')).toBe(FESTIVAL_SKY.cloudFloor.day);
    expect(festivalCloudCover(0, 'sunset')).toBe(FESTIVAL_SKY.cloudFloor.sunset);
    expect(festivalCloudCover(0.8, 'day')).toBe(0.8);
    expect(festivalCloudCover(2, 'night')).toBe(1);
    // A whole cover bin: the clear day shows one crisp panorama, no crossfade.
    expect(Number.isInteger(FESTIVAL_SKY.cloudFloor.day * 8)).toBe(true);
    expect(() => festivalCloudCover(Number.NaN, 'day')).toThrow();
  });

  it('lays the baked clouds only over cloud-free photographs', () => {
    expect(festivalPhotoClouds({ a: 'kiara-5-noon', b: 'kiara-5-noon' }, 0)).toBe(1);
    expect(festivalPhotoClouds({ a: 'kloppenheim-02', b: 'kloppenheim-02' }, 0)).toBe(1);
    expect(festivalPhotoClouds({ a: 'table-mountain-1', b: 'table-mountain-1' }, 0)).toBe(0);
    // Crossfading into the broken-cumulus photo fades the baked clouds out.
    expect(festivalPhotoClouds({ a: 'kiara-5-noon', b: 'rural-landscape' }, 0.25)).toBeCloseTo(
      0.75,
    );
    expect(festivalPhotoClouds(null, 0)).toBe(0);
    // The festival's clear day is a cloud-free photograph.
    expect(skyBlend(SKY_RAMPS[FESTIVAL_PALETTE].day, 0.12).a).toBe('kiara-5-noon');
  });

  it('binds the visible dome and every PMREM bin above the cloud floor', () => {
    const material = skyMaterial();
    const clouds = FestivalSkyClouds.forFestival(material, () => new T.Vector3(0, 1, 0));
    const renderer = {} as T.WebGLRenderer;
    const bind = vi.spyOn(SkyClouds.prototype, 'bind').mockReturnValue(() => {});
    const prepare = vi.spyOn(SkyClouds.prototype, 'prepare').mockReturnValue(true);
    try {
      clouds.bind(renderer, 1, 'day');
      expect(bind).toHaveBeenLastCalledWith(renderer, FESTIVAL_SKY.cloudFloor.day * 8, 'day');
      clouds.bind(renderer, 7, 'day');
      expect(bind).toHaveBeenLastCalledWith(renderer, 7, 'day');
      clouds.prepare(renderer, 0.12, 'day');
      expect(prepare).toHaveBeenLastCalledWith(renderer, FESTIVAL_SKY.cloudFloor.day, 'day');
    } finally {
      bind.mockRestore();
      prepare.mockRestore();
    }
  });

  it('raises the skyline and sets the clouds in captures as in the visible dome', () => {
    const material = skyMaterial();
    const u = material.uniforms;
    const photo = {
      palette: FESTIVAL_PALETTE,
      key: 'coast:2k:1',
      shownPair: { a: 'kiara-5-noon', b: 'kiara-5-noon', weight: 0 },
      bind: (m: T.ShaderMaterial) => {
        // As PhotoSky.bind: the photo's own skyline (0 for kiara-5-noon).
        (m.uniforms.photoA.value as T.Vector4).set(0, 0, 1, 0);
        (m.uniforms.photoB.value as T.Vector4).set(0, 0, 1, 0);
        m.uniforms.photoWeight.value = 0;
        return true;
      },
      fogPalette: () => null,
    } as unknown as PhotoSky;
    const sky = new FestivalSky(photo);
    sky.horizon.setRGB(0.3, 0.4, 0.6);
    for (const capture of [false, true]) {
      u.photoClouds.value = 0;
      expect(sky.bind(material, 0.12, 'day', capture)).toBe(true);
      expect(u.photoClouds.value).toBe(1);
      expect(((u.photoA.value as T.Vector4).w * 180) / Math.PI).toBeCloseTo(9.8, 3);
      expect((u.photoHorizon.value as T.Vector4).w).toBe(1);
    }
    expect(sky.key).toBe('coast:2k:1');
    // No photograph (Low): no baked clouds over it (the procedural dome has its own).
    const off = new FestivalSky({ ...photo, bind: () => false } as unknown as PhotoSky);
    u.photoClouds.value = 1;
    expect(off.bind(material, 0.12, 'day', false)).toBe(false);
    expect(u.photoClouds.value).toBe(0);
  });

  it('shades the landscape under the clouds, never the street around the camera', () => {
    expect(installFestivalCloudShadow(new T.MeshBasicMaterial())).toBe(false);
    const material = new T.MeshStandardMaterial();
    expect(installFestivalCloudShadow(material)).toBe(true);
    expect(installFestivalCloudShadow(material)).toBe(false);
    const shader = {
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
      uniforms: {} as Record<string, T.IUniform>,
    } as unknown as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.fragmentShader).toContain('apexCloudShadowAt( geometryPosition )');
    expect(shader.fragmentShader).toContain(
      `smoothstep(${FESTIVAL_CLOUD_SHADOW.near.toFixed(1)}, ${FESTIVAL_CLOUD_SHADOW.far.toFixed(1)}`,
    );
    expect(shader.uniforms.apexCloudField).toBeDefined();
  });

  it('opens the golden-hour camera up and keeps the midday key crisp under the extra cloud', () => {
    const at = (mode: 'day' | 'sunset' | 'night', clouds = 1, exposure = 1) =>
      festivalLight({ exposure, environment: 1, cover: 0.12 }, mode, clouds);
    expect(at('day').exposure).toBe(FESTIVAL_LIGHT.exposure.day);
    expect(at('sunset', 0, 1.62).exposure).toBeCloseTo(1.62 * FESTIVAL_LIGHT.exposure.sunset);
    // The shown clouds brighten the captured dome: its diffuse share is
    // scaled back toward the simulated cover's dome.
    const day = at('day').environment;
    expect(day).toBeLessThan(FESTIVAL_LIGHT.diffuse.day);
    expect(day).toBeGreaterThan(0.3);
    // A photo with its own clouds (no baked clouds in the capture) keeps the
    // dome's light; night keeps its authored fill.
    expect(at('sunset', 0).environment).toBeCloseTo(FESTIVAL_LIGHT.diffuse.sunset);
    expect(at('night').environment).toBe(1);
    // At or above the cloud floor nothing is shown beyond the simulation.
    expect(festivalEnvironment(0.6, 'day')).toBeCloseTo(FESTIVAL_LIGHT.diffuse.day);
  });

  it('adapts the golden-hour exposure to the camera facing the sun', () => {
    const sun = new T.Vector3(-215, 45, -150);
    expect(sunFacing(new T.Vector3(-215, -20, -150), sun)).toBeCloseTo(1);
    expect(sunFacing(new T.Vector3(215, 0, 150), sun)).toBeCloseTo(-1);
    expect(festivalExposure('sunset', -1)).toBe(FESTIVAL_LIGHT.exposure.sunset);
    expect(festivalExposure('sunset', 1)).toBeCloseTo(FESTIVAL_LIGHT.intoSun.sunset);
    let previous = Infinity;
    for (let f = -1; f <= 1.0001; f += 0.1) {
      const e = festivalExposure('sunset', f);
      expect(e).toBeLessThanOrEqual(previous + 1e-9);
      previous = e;
    }
    // Midday and night do not adapt.
    expect(festivalExposure('day', 1)).toBe(festivalExposure('day', -1));
    expect(festivalExposure('night', 1)).toBe(festivalExposure('night', -1));
  });
});
