import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  SkyEnvironment,
  circuitLightState,
  configureSky,
  daylightState,
} from '../src/rendering/daylight.ts';
import { LocalAtmosphere } from '../src/rendering/local-atmosphere.ts';
import {
  AERIAL_PERSPECTIVE,
  AERIAL_PERSPECTIVE_FRAGMENT,
  AERIAL_PERSPECTIVE_PARS,
  aerialAmount,
  aerialFogColor,
  aerialHeightMean,
  aerialSunGlow,
  aerialUniforms,
  setAerialPerspective,
} from '../src/rendering/studio/aerial-perspective.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import { Track } from '../src/simulation/track.ts';

const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);

describe('P12 aerial perspective', () => {
  const clear = daylightState(0, 0).fogDensity;
  it('sets the P12 densities by weather and lighting', () => {
    expect(clear).toBeCloseTo(0.00055, 10);
    expect(daylightState(1, 0).fogDensity).toBeCloseTo(0.0008, 10);
    // The 24 mm/h rain preset (cover 0.95).
    const rain = daylightState(0.95, 24).fogDensity;
    expect(rain).toBeGreaterThanOrEqual(0.0015);
    expect(rain).toBeLessThanOrEqual(0.002);
    expect(circuitLightState(0, 0, 'sunset').fogDensity).toBeCloseTo(0.00065, 5);
    expect(circuitLightState(0, 0, 'night').fogDensity).toBeCloseTo(0.0004, 4);
  });
  it('loses 25-30 % contrast at 1 km on the flat and keeps the near field crisp', () => {
    const eye = v(0, 1.2, 0);
    const at = (d: number, y = 0.5) => aerialAmount(eye, v(d, y, 0), clear);
    expect(at(1000)).toBeGreaterThanOrEqual(0.25);
    expect(at(1000)).toBeLessThanOrEqual(0.3);
    expect(at(150)).toBeLessThan(0.01);
    expect(at(500)).toBeLessThan(0.1);
    // Elevated ridges 2-3 km out keep their shape in blue haze (55-65 % at 3 km
    // for a 150 m ridge), where a flat valley floor at 3 km is nearly gone.
    expect(at(3000, 150)).toBeGreaterThan(0.55);
    expect(at(3000, 150)).toBeLessThan(0.7);
    expect(at(3000, 0)).toBeGreaterThan(0.85);
    expect(at(2000, 120)).toBeGreaterThan(0.35);
    expect(at(2000, 120)).toBeLessThan(0.6);
  });
  it('thins with altitude along the sightline, continuously through a level ray', () => {
    // Valley floors haze more than ridgelines at the same distance.
    const eye = v(0, 20, 0);
    expect(aerialAmount(eye, v(1500, 0, 0), clear)).toBeGreaterThan(
      aerialAmount(eye, v(1500, 200, 0), clear),
    );
    // A sightline down into the valley hazes more than a level one up high,
    // and a ray and its reverse cross the same air.
    expect(aerialHeightMean(100, -100)).toBeGreaterThan(aerialHeightMean(100, 0));
    expect(aerialHeightMean(100, -100)).toBeCloseTo(aerialHeightMean(0, 100), 12);
    for (const rise of [-1e-3, -1e-5, 0, 1e-5, 1e-3])
      expect(aerialHeightMean(5, rise)).toBeCloseTo(Math.exp(-5 / 150), 4);
    // The datum and scale height of the producer decision.
    expect(AERIAL_PERSPECTIVE.scaleHeight).toBe(150);
    expect(aerialAmount(eye, eye, clear)).toBe(0);
    expect(() => aerialAmount(eye, v(NaN, 0, 0), clear)).toThrow();
  });
  it('colours the haze by view: anti-sun blue, sun-side glow, one grey under cloud', () => {
    const c = AERIAL_PERSPECTIVE.colors;
    expect(aerialFogColor(0, 0, 'day')).toEqual([...c.dayAntiSun]);
    // Overcast and rain grey it; a 60 mm/h storm darkens it.
    const overcast = aerialFogColor(1, 0, 'day'),
      rain = aerialFogColor(1, 24, 'day'),
      storm = aerialFogColor(1, 60, 'day');
    overcast.forEach((x, k) => expect(x).toBeCloseTo(c.overcast[k], 10));
    rain.forEach((x, k) => expect(x).toBeCloseTo(c.rain[k], 10));
    storm.forEach((x, k) => expect(x).toBeCloseTo(c.storm[k], 10));
    const sat = (x: number[]) => (Math.max(...x) - Math.min(...x)) / Math.max(...x);
    expect(sat(overcast)).toBeLessThan(0.5 * sat([...c.dayAntiSun]));
    // The renderer's scene fog colour is the anti-sun haze.
    const day = daylightState(0, 0);
    expect([day.fogRed, day.fogGreen, day.fogBlue]).toEqual([...c.dayAntiSun]);
    const dusk = circuitLightState(0, 0, 'sunset');
    expect([dusk.fogRed, dusk.fogGreen, dusk.fogBlue]).toEqual([...c.sunsetAntiSun]);
    const night = circuitLightState(0, 0, 'night');
    expect([night.fogRed, night.fogGreen, night.fogBlue]).toEqual([...c.night]);
    // Sun side: warm white by day, orange at dusk, none at night or overcast.
    const glow = aerialSunGlow(0, 'day');
    expect(glow.x).toBeCloseTo(c.daySunSide[0] - c.dayAntiSun[0], 10);
    expect(aerialSunGlow(0, 'sunset').x).toBeGreaterThan(3 * aerialSunGlow(0, 'sunset').y);
    expect(aerialSunGlow(0, 'night').length()).toBe(0);
    expect(aerialSunGlow(1, 'day').length()).toBe(0);
    expect(aerialSunGlow(0.5, 'day').length()).toBeLessThan(glow.length());
  });
  it('replaces only the FogExp2 term in the local-atmosphere fog chunk', () => {
    const fog = new LocalAtmosphere(new Track()),
      m = new T.MeshStandardMaterial();
    fog.installMaterial(m);
    const shader = {
      uniforms: {},
      vertexShader: '#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader: '#include <fog_pars_fragment>\n#include <fog_fragment>',
    } as unknown as T.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.fragmentShader).toContain(AERIAL_PERSPECTIVE_PARS);
    expect(shader.fragmentShader).toContain(AERIAL_PERSPECTIVE_FRAGMENT);
    // A linear T.Fog keeps three's own chunk (e2e/38's pocket comparison).
    expect(AERIAL_PERSPECTIVE_FRAGMENT).toMatch(
      /#if defined\( USE_FOG \) && defined\( FOG_EXP2 \)[\s\S]*#else\s*#include <fog_fragment>\s*#endif/,
    );
    // The pockets still follow, with the shared bounded uniform.
    expect(shader.fragmentShader.indexOf('apexLocalSigma > 0.')).toBeGreaterThan(
      shader.fragmentShader.indexOf('apexAerialPerspective(gl_FragColor.rgb, vApexFogWorld)'),
    );
    expect(shader.uniforms.apexAerialSunGlow).toBe(aerialUniforms.apexAerialSunGlow);
    expect(shader.uniforms.apexAerialFalloff).toBe(aerialUniforms.apexAerialFalloff);
    expect(shader.uniforms.studioSunDir).toBe(studioUniforms.studioSunDir);
    expect(m.customProgramCacheKey()).toContain('v4-vector-quadrature:transformed');
    expect(m.customProgramCacheKey()).toContain('|apex-aerial-perspective-v1');
    // No wall clock in the term.
    expect(AERIAL_PERSPECTIVE_PARS).not.toMatch(/\btime\b/i);
    m.dispose();
  });
  it('composes nested scene fog installers on a shared spectator material exactly once', () => {
    const oldScene = new LocalAtmosphere(new Track());
    const currentScene = new LocalAtmosphere(new Track());
    const material = new T.MeshStandardMaterial({ name: 'Spectator team flags' });
    oldScene.installMaterial(material);
    currentScene.installMaterial(material);
    const shader = {
      uniforms: {},
      vertexShader: '#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader: '#include <fog_pars_fragment>\n#include <fog_fragment>',
    } as unknown as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.vertexShader.match(/varying vec3 vApexFogWorld;/g)).toHaveLength(1);
    expect(shader.fragmentShader.match(/varying vec3 vApexFogWorld;/g)).toHaveLength(1);
    expect(shader.vertexShader.match(/vec4 apexFogPosition =/g)).toHaveLength(1);
    expect(shader.fragmentShader.match(/float apexLocalDensity\\(/g)).toHaveLength(1);
    expect(shader.fragmentShader.match(/float apexPocketIntegral\\(/g)).toHaveLength(1);
    expect(shader.uniforms.apexLocalSigma).toBe(currentScene.sigma);
    expect(shader.uniforms.apexFogVolumes).toBeDefined();
    material.dispose();
  });
  it('follows the presented cover and lighting through the sky environment', () => {
    setAerialPerspective(0, 'day');
    const sky = new Sky();
    configureSky(sky);
    const environment = new SkyEnvironment(sky);
    const renderer = {
      compile: () => {},
      xr: { enabled: false },
      autoClear: true,
      toneMapping: T.NoToneMapping,
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      getViewport: (o: T.Vector4) => o,
      getScissor: (o: T.Vector4) => o,
      getScissorTest: () => false,
      setRenderTarget: () => {},
      setViewport: () => {},
      setScissor: () => {},
      setScissorTest: () => {},
      render: () => {},
    } as unknown as T.WebGLRenderer;
    const capture = T.PMREMGenerator.prototype.fromScene;
    T.PMREMGenerator.prototype.fromScene = () => new T.WebGLRenderTarget(8, 8);
    try {
      environment.update(renderer, new T.Scene(), 0, 'sunset');
      expect(aerialUniforms.apexAerialSunGlow.value.toArray()).toEqual(
        aerialSunGlow(0, 'sunset').toArray(),
      );
      // A held frame (no PMREM work) still writes the same state.
      environment.update(renderer, new T.Scene(), 0, 'sunset');
      environment.update(renderer, new T.Scene(), 1, 'day');
      expect(aerialUniforms.apexAerialSunGlow.value.length()).toBe(0);
    } finally {
      T.PMREMGenerator.prototype.fromScene = capture;
      environment.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      setAerialPerspective(0, 'day');
    }
  });
});
