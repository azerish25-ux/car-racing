import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  SkyEnvironment,
  configureSky,
  lightingDirection,
  skyCosineRadiance,
} from '../src/rendering/daylight.ts';
import {
  CLOUD_DOME_MEANS,
  SKY_CLOUDS,
  SKY_CLOUD_LIGHTING,
  SKY_CLOUD_SAMPLE,
  SKY_CLOUD_UNIFORMS,
  SkyClouds,
  cloudDomeTerms,
  cloudLayer,
  cloudLightKey,
  createSkyCloudUniforms,
  skyCloudLight,
} from '../src/rendering/studio/sky-clouds.ts';
import { skyLight } from '../src/rendering/sky-light.ts';

afterEach(() => vi.restoreAllMocks());

/** CPU ownership double for the bakes: records each full-screen draw (its
 * material and target) and the state restored afterwards. No rasterization;
 * the GLSL is compiled and inspected in a real browser separately. */
function bakeDouble() {
  const state = {
    target: null as T.WebGLRenderTarget | null,
    face: 1,
    mip: 2,
    viewport: new T.Vector4(1, 2, 30, 20),
    scissor: new T.Vector4(3, 4, 10, 8),
    scissorTest: true,
    autoClear: false,
    draws: [] as { material: string; target: T.WebGLRenderTarget | null; uniforms: unknown }[],
    fail: false,
  };
  const renderer = {
    xr: { enabled: true },
    get autoClear() {
      return state.autoClear;
    },
    set autoClear(v: boolean) {
      state.autoClear = v;
    },
    toneMapping: T.ACESFilmicToneMapping,
    compile: () => {},
    getRenderTarget: () => state.target,
    getActiveCubeFace: () => state.face,
    getActiveMipmapLevel: () => state.mip,
    getViewport: (out: T.Vector4) => out.copy(state.viewport),
    getScissor: (out: T.Vector4) => out.copy(state.scissor),
    getScissorTest: () => state.scissorTest,
    setRenderTarget: (target: T.WebGLRenderTarget | null, face = 0, mip = 0) => {
      state.target = target;
      state.face = face;
      state.mip = mip;
    },
    setViewport: (v: T.Vector4) => state.viewport.copy(v),
    setScissor: (v: T.Vector4) => state.scissor.copy(v),
    setScissorTest: (v: boolean) => {
      state.scissorTest = v;
    },
    render: (mesh: T.Mesh<T.BufferGeometry, T.RawShaderMaterial>) => {
      if (state.fail) throw new Error('Injected bake failure');
      const u = mesh.material.uniforms ?? {};
      state.draws.push({
        material: mesh.material.name,
        target: state.target,
        uniforms: Object.fromEntries(
          Object.entries(u).map(([k, v]) => [
            k,
            v.value instanceof T.Vector3 ? v.value.toArray() : v.value,
          ]),
        ),
      });
    },
  };
  return { renderer: renderer as unknown as T.WebGLRenderer, state };
}

describe('cloud layer and coverage', () => {
  it('maps weather cover to a flat-based slab and a monotonic coverage threshold', () => {
    expect(cloudLayer(0).threshold).toBeGreaterThan(1); // no clouds at all
    let previous = Infinity;
    for (let bin = 1; bin <= 8; bin++) {
      const layer = cloudLayer(bin / 8);
      expect(layer.threshold).toBeLessThan(previous);
      expect(layer.threshold).toBeGreaterThanOrEqual(0);
      previous = layer.threshold;
      expect(layer.baseAltitude).toBeGreaterThanOrEqual(900);
      expect(layer.baseAltitude).toBeLessThanOrEqual(1400);
      expect(layer.thickness).toBeGreaterThan(1000);
    }
    // Fair-weather cumulus on a 1400 m base; a lower, thicker deck at overcast.
    expect(cloudLayer(0.12).baseAltitude).toBe(1400);
    expect(cloudLayer(1).baseAltitude).toBe(900);
    expect(cloudLayer(1).thickness).toBeGreaterThan(cloudLayer(0.12).thickness);
    expect(cloudLayer(-1)).toEqual(cloudLayer(0));
    expect(cloudLayer(2)).toEqual(cloudLayer(1));
    expect(() => cloudLayer(NaN)).toThrow();
  });
  it('keeps the measured dome means monotonic and the clear preset fair-weather', () => {
    for (let bin = 1; bin < CLOUD_DOME_MEANS.length; bin++)
      expect(CLOUD_DOME_MEANS[bin][0]).toBeGreaterThanOrEqual(CLOUD_DOME_MEANS[bin - 1][0]);
    expect(CLOUD_DOME_MEANS[0]).toEqual([0, 0, 0, 0, 0]);
    // A low sun lights less of each cloud than the day sun.
    for (const row of CLOUD_DOME_MEANS.slice(1)) expect(row[2]).toBeLessThan(row[1]);
    // The clear preset (0.12): scattered cumulus, mostly blue sky overhead.
    const clear = cloudDomeTerms(0.12, 'day');
    expect(clear.opacity).toBeGreaterThan(0.1);
    expect(clear.opacity).toBeLessThan(0.2);
    expect(cloudDomeTerms(1, 'day').opacity).toBeGreaterThan(0.95);
    // Blended linearly between neighbouring bins, as the dome blends panoramas.
    const mid = cloudDomeTerms(0.1875, 'day');
    expect(mid.opacity).toBeCloseTo((CLOUD_DOME_MEANS[1][0] + CLOUD_DOME_MEANS[2][0]) / 2, 10);
    expect(cloudDomeTerms(0.3, 'sunset').sun).toBeLessThan(cloudDomeTerms(0.3, 'day').sun);
  });
  it('lights clouds white by day, warm at dusk and grey under a closed deck', () => {
    const terms = { sun: 0.5, sky: 0.3, ground: 0.1 };
    const day = skyCloudLight(terms, skyLight(0.12, 'day')),
      dusk = skyCloudLight(terms, skyLight(0.12, 'sunset')),
      deck = skyCloudLight(terms, skyLight(1, 'day'));
    expect(Math.max(...day) / Math.min(...day)).toBeLessThan(1.35);
    expect(dusk[0] / dusk[2]).toBeGreaterThan(1.8);
    // The sun is hidden by a closed deck; the sky term carries it.
    const key = { sun: 1, sky: 0, ground: 0 };
    expect(skyCloudLight(key, skyLight(1, 'day'))[1]).toBeLessThan(
      0.15 * skyCloudLight(key, skyLight(0.12, 'day'))[1],
    );
    expect(deck.every((v) => v > 0)).toBe(true);
    expect(SKY_CLOUD_LIGHTING).toContain('terms.r * cloudKey');
  });
});

describe('baked cumulus panorama', () => {
  it('declares unbound panoramas in the sky shader and samples nothing until bound', () => {
    const sky = new Sky();
    configureSky(sky);
    const { fragmentShader, uniforms } = sky.material;
    expect(fragmentShader).toContain(SKY_CLOUD_UNIFORMS);
    expect(fragmentShader).toContain(SKY_CLOUD_SAMPLE);
    expect(fragmentShader).toContain('radiance = radiance * (1.0 - cover) + skyCloudLight(clouds);');
    // The value-noise smudges are gone; nothing animates by wall clock.
    expect(fragmentShader).not.toContain('skyNoise');
    expect(fragmentShader).not.toMatch(/\btime\b/i);
    expect(uniforms.cloudReady.value).toBe(0);
    expect(uniforms.cloudLow.value).toBeNull();
    // Bound to the clear day sky's key by configureSky.
    expect(uniforms.cloudKey.value.toArray()).toEqual(skyLight(0, 'day').cloudKey);
    expect(SKY_CLOUD_SAMPLE).toContain(
      'if (cloudReady < 0.5 || direction.y <= 0.0) return vec4(0.0);',
    );
    // Wind drift is an azimuthal offset in turns, set from presented time.
    expect(SKY_CLOUD_SAMPLE).toContain('+ 0.5 + cloudDrift');
    expect(uniforms.cloudDrift.value).toBe(0);
    expect(SKY_CLOUDS.driftPerSecond * 3600).toBeLessThan(0.5);
    sky.geometry.dispose();
    sky.material.dispose();
  });
  it('bakes the field once and each bin panorama on first use, restoring renderer state', () => {
    const { renderer, state } = bakeDouble();
    const uniforms = createSkyCloudUniforms();
    const clouds = new SkyClouds(uniforms, lightingDirection);
    // Clear preset: bins 0 (empty, no bake) and 1.
    expect(clouds.prepare(renderer, 0.12, 'day')).toBe(true);
    expect(state.draws.map((d) => d.material)).toEqual([
      'Sky cloud field bake',
      'Sky cloud panorama bake',
    ]);
    const panorama = state.draws[1];
    expect(panorama.target?.width).toBe(SKY_CLOUDS.panoramaWidth);
    expect(panorama.target?.height).toBe(SKY_CLOUDS.panoramaHeight);
    expect(panorama.target?.texture.type).toBe(T.HalfFloatType);
    const u = panorama.uniforms as Record<string, unknown>;
    expect(u.threshold).toBe(cloudLayer(1 / 8).threshold);
    expect(u.cloudField).toBe(state.draws[0].target?.texture); // the baked field
    const sun = lightingDirection('day').clone().normalize().toArray();
    (u.sunDirection as number[]).forEach((v, i) => expect(v).toBeCloseTo(sun[i], 12));
    // Restored exactly.
    expect(state.target).toBeNull();
    expect([state.face, state.mip, state.scissorTest, state.autoClear]).toEqual([
      1,
      2,
      true,
      false,
    ]);
    expect(state.viewport.toArray()).toEqual([1, 2, 30, 20]);
    expect(uniforms.cloudReady.value).toBe(1);
    expect(uniforms.cloudWeight.value).toBeCloseTo(0.96, 12);
    expect(uniforms.cloudHigh.value).toBe(panorama.target?.texture);
    expect(uniforms.cloudLow.value).not.toBe(uniforms.cloudHigh.value);
    // A held or repeated frame costs nothing.
    expect(clouds.prepare(renderer, 0.12, 'day')).toBe(false);
    // Within the same bins only the weight changes: no draw.
    expect(clouds.prepare(renderer, 0.1, 'day')).toBe(true);
    expect(state.draws).toHaveLength(2);
    // Night shares the day sun direction, so the same panorama.
    clouds.prepare(renderer, 0.12, 'night');
    expect(state.draws).toHaveLength(2);
    expect(cloudLightKey('night')).toBe(cloudLightKey('day'));
    // Sunset: one new bake for its own sun; the field is reused.
    clouds.prepare(renderer, 0.12, 'sunset');
    expect(state.draws.map((d) => d.material).slice(2)).toEqual(['Sky cloud panorama bake']);
    expect(clouds.diagnostics()).toMatchObject({
      bakes: 2,
      fieldBakes: 1,
      drift: 'presented-time',
    });
    clouds.dispose();
    expect(uniforms.cloudReady.value).toBe(0);
  });
  it('binds one bin for a PMREM capture and restores the visible blend', () => {
    const { renderer } = bakeDouble();
    const uniforms = createSkyCloudUniforms();
    const clouds = new SkyClouds(uniforms, lightingDirection);
    clouds.prepare(renderer, 0.3, 'day');
    const visible = [uniforms.cloudLow.value, uniforms.cloudHigh.value, uniforms.cloudWeight.value];
    const restore = clouds.bind(renderer, 2, 'day');
    expect(uniforms.cloudLow.value).toBe(clouds.cached(2, 'day'));
    expect(uniforms.cloudHigh.value).toBe(uniforms.cloudLow.value);
    expect(uniforms.cloudWeight.value).toBe(0);
    restore();
    expect([uniforms.cloudLow.value, uniforms.cloudHigh.value, uniforms.cloudWeight.value]).toEqual(
      visible,
    );
    expect(() => clouds.bind(renderer, 9, 'day')).toThrow('Invalid cloud bin');
    expect(() => clouds.prepare(renderer, NaN, 'day')).toThrow();
    clouds.dispose();
  });
  it('never evicts a bound panorama and keeps at most the cache size', () => {
    const { renderer } = bakeDouble();
    const uniforms = createSkyCloudUniforms();
    const clouds = new SkyClouds(uniforms, lightingDirection);
    const disposed: T.Texture[] = [];
    const dispose = T.WebGLRenderTarget.prototype.dispose;
    vi.spyOn(T.WebGLRenderTarget.prototype, 'dispose').mockImplementation(function (
      this: T.WebGLRenderTarget,
    ) {
      disposed.push(this.texture);
      dispose.call(this);
    });
    for (const cover of [0.2, 0.45, 0.7, 0.95, 0.3]) {
      clouds.prepare(renderer, cover, 'day');
      const low = uniforms.cloudLow.value,
        high = uniforms.cloudHigh.value;
      expect(disposed).not.toContain(low);
      expect(disposed).not.toContain(high);
      expect(clouds.diagnostics().cached.length).toBeLessThanOrEqual(SKY_CLOUDS.cacheSize);
    }
    expect(disposed.length).toBeGreaterThan(0);
    clouds.dispose();
  });
  it('does not cache a failed bake', () => {
    const { renderer, state } = bakeDouble();
    const clouds = new SkyClouds(createSkyCloudUniforms(), lightingDirection);
    state.fail = true;
    expect(() => clouds.prepare(renderer, 0.5, 'day')).toThrow('Injected bake failure');
    state.fail = false;
    expect(clouds.prepare(renderer, 0.5, 'day')).toBe(true);
    expect(clouds.diagnostics().bakes).toBe(1);
    clouds.dispose();
  });
  it('captures each PMREM bin with that bin panorama and restores the dome blend', () => {
    const sky = new Sky();
    configureSky(sky);
    const { renderer } = bakeDouble();
    const clouds = SkyClouds.forSky(sky.material, lightingDirection);
    const seen: {
      cover: number;
      low: unknown;
      high: unknown;
      weight: number;
      ready: number;
      disc: number;
    }[] = [];
    vi.spyOn(T.PMREMGenerator.prototype, 'fromScene').mockImplementation((scene) => {
      const u = (scene.children[0] as Sky).material.uniforms;
      seen.push({
        cover: u.cloudCover.value,
        low: u.cloudLow.value,
        high: u.cloudHigh.value,
        weight: u.cloudWeight.value,
        ready: u.cloudReady.value,
        disc: u.sunDiscAmount.value,
      });
      return new T.WebGLRenderTarget(8, 8);
    });
    vi.spyOn(T.PMREMGenerator.prototype, 'dispose');
    // The PMREM's blend quad also goes through the double.
    const environment = new SkyEnvironment(sky, clouds);
    environment.update(renderer, new T.Scene(), 0.3, 'day');
    expect(seen.map((s) => s.cover)).toEqual([0.25, 0.375]);
    expect(seen[0].low).toBe(clouds.cached(2, 'day'));
    expect(seen[1].low).toBe(clouds.cached(3, 'day'));
    for (const s of seen) {
      expect(s.high).toBe(s.low);
      expect(s.weight).toBe(0);
      expect(s.ready).toBe(1);
      // The capture holds sky only: the directional light carries the sun.
      expect(s.disc).toBe(0);
    }
    expect(sky.material.uniforms.sunDiscAmount.value).toBe(1);
    // The visible dome blends the same two panoramas.
    const u = sky.material.uniforms;
    expect(u.cloudLow.value).toBe(clouds.cached(2, 'day'));
    expect(u.cloudHigh.value).toBe(clouds.cached(3, 'day'));
    expect(u.cloudWeight.value).toBeCloseTo(0.4, 12);
    expect(environment.diagnostics().clouds).toMatchObject({ bakes: 2, fieldBakes: 1 });
    // The ground's skylight follows the cloud dome means: brighter, whiter skylight
    // under broken cumulus than under a clear sky.
    expect(skyCosineRadiance(0.5, 'day').r).toBeGreaterThan(skyCosineRadiance(0, 'day').r);
    environment.dispose();
    expect(u.cloudReady.value).toBe(0);
    sky.geometry.dispose();
    sky.material.dispose();
  });
});
