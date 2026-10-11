import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  ATMOSPHERE,
  AtmosphereMedium,
  atmosphereSky,
  limbDarkening,
  luminance,
  miePhase,
  rayleighPhase,
  skyViewU,
  skyViewV,
} from '../src/rendering/atmosphere.ts';
import {
  SUN_OFFSET,
  SUNSET_OFFSET,
  bindSkyAtmosphere,
  circuitLightState,
  configureSky,
  daylightState,
} from '../src/rendering/daylight.ts';
import { SKY_LIGHT, skyAtmospheres, skyHaze, skyLight } from '../src/rendering/sky-light.ts';

const saturation = (c: readonly number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
/** A view direction at `elevation` degrees, `azimuth` degrees from the sun. */
function view(sun: T.Vector3, elevation: number, azimuth: number) {
  const a = Math.atan2(sun.z, sun.x) + T.MathUtils.degToRad(azimuth),
    r = T.MathUtils.degToRad(elevation);
  return new T.Vector3(Math.cos(r) * Math.cos(a), Math.sin(r), Math.cos(r) * Math.sin(a));
}

describe('physical atmosphere (Hillaire 2020)', () => {
  const day = atmosphereSky(skyHaze('day', 0), SUN_OFFSET);
  it('integrates normalised phase functions and keeps transmittance physical', () => {
    let r = 0,
      m = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const mu = -1 + (2 * (i + 0.5)) / N;
      r += rayleighPhase(mu) * 2 * Math.PI * (2 / N);
      m += miePhase(mu) * 2 * Math.PI * (2 / N);
    }
    expect(r).toBeCloseTo(1, 3);
    expect(m).toBeCloseTo(1, 2);
    const medium = new AtmosphereMedium(1);
    const ground = ATMOSPHERE.bottomRadius + 100;
    const zenith = medium.sunTransmittance(ground, 1),
      low = medium.sunTransmittance(ground, Math.sin(T.MathUtils.degToRad(5)));
    // Rayleigh optical depth at the zenith: 0.265 blue, 0.108 green, 0.046 red.
    expect(zenith[2]).toBeGreaterThan(0.72);
    expect(zenith[2]).toBeLessThan(0.8);
    expect(zenith[0]).toBeGreaterThan(0.94);
    // Longer paths redden the sun, and the planet blocks it below the horizon.
    expect(low[2] / low[0]).toBeLessThan(zenith[2] / zenith[0]);
    expect(medium.sunTransmittance(ground, -0.2)).toEqual([0, 0, 0]);
    expect(() => new AtmosphereMedium(0)).toThrow();
  });
  it('paints a deep blue zenith, a pale horizon and a bright aureole round the sun', () => {
    const at = (elevation: number, azimuth: number) =>
      day.radiance(view(SUN_OFFSET, elevation, azimuth));
    const zenith = day.radiance(new T.Vector3(0, 1, 0)),
      horizon = at(1, 120),
      mid = at(25, 90);
    expect(zenith[2] / zenith[0]).toBeGreaterThan(3);
    expect(saturation(zenith)).toBeGreaterThan(saturation(horizon) + 0.2);
    expect(luminance(horizon)).toBeGreaterThan(2 * luminance(zenith));
    expect(mid[2]).toBeGreaterThan(mid[1]);
    expect(mid[1]).toBeGreaterThan(mid[0]);
    // The Mie aureole 5 degrees from the 52 degree sun outshines the far sky.
    expect(luminance(at(47, 0))).toBeGreaterThan(4 * luminance(at(47, 180)));
    // Symmetric about the sun's vertical plane.
    at(20, 70).forEach((c, k) => expect(c).toBeCloseTo(at(20, -70)[k], 12));
    expect(skyViewU(Math.PI)).toBe(1);
    expect(skyViewV(Math.PI / 2)).toBe(1);
    expect(skyViewV(-0.1)).toBe(0);
  });
  it('reddens the golden-hour sun and sky toward it', () => {
    const dusk = atmosphereSky(skyHaze('sunset', 0), SUNSET_OFFSET);
    const noon = day.sunTransmittance,
      gold = dusk.sunTransmittance;
    expect(gold[2] / gold[0]).toBeLessThan(0.35);
    expect(noon[2] / noon[0]).toBeGreaterThan(0.7);
    const towards = dusk.radiance(view(SUNSET_OFFSET, 4, 5)),
      away = dusk.radiance(view(SUNSET_OFFSET, 4, 180));
    expect(towards[0] / towards[2]).toBeGreaterThan(1.5);
    // Away from the sun the low sky stays cool (a pale Belt of Venus at most).
    expect(away[0] / away[2]).toBeLessThan(0.5 * (towards[0] / towards[2]));
    // Limb darkening: the rim is dimmer and redder than the disc centre.
    const rim = limbDarkening(0.2);
    expect(limbDarkening(1)).toEqual([1, 1, 1]);
    expect(rim[2]).toBeLessThan(rim[0]);
  });
});

describe('scene light from the sky', () => {
  it('derives the key and its 52 degree clear-day strength from the transmittance', () => {
    const light = skyLight(0, 'day');
    expect(light.sunIrradiance).toBeGreaterThan(3.7);
    expect(light.sunIrradiance).toBeLessThan(4);
    expect(daylightState(0, 0).sun).toBeCloseTo(light.sunIrradiance, 10);
    expect(Math.max(...light.sunColor)).toBe(1);
    // Warm white by day, deep gold at the golden hour.
    expect(light.sunColor[2]).toBeGreaterThan(0.7);
    const dusk = skyLight(0, 'sunset');
    expect(dusk.sunColor[2]).toBeLessThan(0.35);
    expect(dusk.sunIrradiance).toBeLessThan(0.6 * light.sunIrradiance);
    // Measured clear-sky diffuse fractions: 15-22 % of the global irradiance.
    const sine = SUN_OFFSET.clone().normalize().y,
      diffuse = Math.PI * luminance(light.skyMean),
      fraction = diffuse / (diffuse + light.sunIrradiance * sine);
    expect(fraction).toBeGreaterThan(0.15);
    expect(fraction).toBeLessThan(0.22);
    // The disc is clamped below half-float range, coloured like the key.
    expect(Math.max(...light.sunDisc)).toBeLessThanOrEqual(SKY_LIGHT.maxSunDisc);
    expect(light.sunDisc[2] / light.sunDisc[0]).toBeCloseTo(light.sunColor[2], 6);
  });
  it('lights clouds white by day, gold at dusk and grey under a closed deck', () => {
    const day = skyLight(0.12, 'day'),
      dusk = skyLight(0.12, 'sunset'),
      deck = skyLight(1, 'day');
    expect(saturation(day.cloudKey)).toBeLessThan(0.3);
    expect(dusk.cloudKey[0] / dusk.cloudKey[2]).toBeGreaterThan(2);
    // The deck hides the key; its base is a blue-grey diffuse light.
    expect(luminance(deck.cloudKey)).toBeLessThan(0.15 * luminance(day.cloudKey));
    expect(saturation(deck.deck)).toBeLessThan(0.4);
    expect(deck.deck[2]).toBeGreaterThan(deck.deck[0]);
    // Cover blends two baked haze levels; the weight is continuous.
    const a = skyAtmospheres(0.25, 'day');
    expect(a.weight).toBeCloseTo(0.5, 12);
    expect(skyAtmospheres(0.5, 'day').low).toBe(skyAtmospheres(0.75, 'day').low);
    expect(() => skyLight(NaN, 'day')).toThrow();
  });
  it('uses the sky horizon as the haze colour of the aerial perspective', () => {
    const light = skyLight(0, 'day'),
      state = daylightState(0, 0);
    expect([state.fogRed, state.fogGreen, state.fogBlue]).toEqual(light.horizonAntiSun);
    const dusk = circuitLightState(0, 0, 'sunset');
    expect(dusk.exposure).toBeGreaterThan(state.exposure);
    expect(dusk.sun).toBeLessThan(state.sun);
  });
});

describe('sky dome shader', () => {
  it('replaces the Preetham fit with the baked sky view and a limb-darkened disc', () => {
    const sky = new Sky();
    configureSky(sky);
    const { fragmentShader, uniforms } = sky.material;
    expect(fragmentShader).not.toContain('totalRayleigh');
    expect(fragmentShader).toContain('uniform sampler2D skyViewLow');
    expect(fragmentShader).toContain('radiance += sunDiscRadiance * limb * disc');
    expect(fragmentShader).toContain('#include <tonemapping_fragment>');
    expect(uniforms.skyViewLow.value).toBeInstanceOf(T.DataTexture);
    expect(uniforms.skyViewLow.value.type).toBe(T.HalfFloatType);
    expect(uniforms.skyRadiance.value).toBeCloseTo(
      ATMOSPHERE.sceneIrradiance * SKY_LIGHT.luminanceFactor,
      10,
    );
    // A cube capture (PMREM, local probe) holds sky only; screens show the disc.
    const probe = { getRenderTarget: () => new T.WebGLCubeRenderTarget(4) },
      screen = { getRenderTarget: () => null };
    const render = (renderer: object) =>
      sky.onBeforeRender(
        renderer as T.WebGLRenderer,
        new T.Scene(),
        new T.PerspectiveCamera(),
        sky.geometry,
        sky.material,
        null as unknown as T.Group,
      );
    render(probe);
    expect(uniforms.sunDiscAmount.value).toBe(0);
    render(screen);
    expect(uniforms.sunDiscAmount.value).toBe(1);
    // Binding a lighting swaps in its sky view and key.
    const light = bindSkyAtmosphere(sky.material, 0.3, 'sunset');
    expect(uniforms.skyViewLow.value).toBe(skyAtmospheres(0.3, 'sunset').low.skyViewTexture);
    expect(uniforms.cloudKey.value.toArray()).toEqual(light.cloudKey);
    sky.geometry.dispose();
    sky.material.dispose();
  });
});
