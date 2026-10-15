import { describe, expect, it } from 'vitest';
import {
  QUALITY_PRESETS,
  detailTier,
  graphicsPreset,
  isQualityPreset,
  validateGraphics,
  type GraphicsOptions,
} from '../src/rendering/options.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { deviceGraphics, unsupportedModules } from '../src/rendering/ultra/capabilities.ts';
import { presentationControls } from '../src/ui/presentation.ts';

/** The graphics keys that existed before ULTRA (a saved v6 settings object). */
const LEGACY_KEYS = [
  'resolutionScale',
  'textureSize',
  'shadowSize',
  'reflections',
  'mirrorQuality',
  'particleDensity',
  'vegetationDensity',
  'crowd',
  'bloom',
  'autoExposure',
  'localFog',
  'motionBlur',
  'antialias',
  'anisotropy',
  'msaa',
  'ambientOcclusion',
  'filmGrade',
  'temporalAA',
  'lensEffects',
  'cockpitFov',
] as const;
const ULTRA_KEYS = [
  'ssr',
  'taaSharpen',
  'aoTemporal',
  'toneMapper',
  'physicalBloom',
  'chromaticAberration',
  'lightShafts',
  'shadowCascades',
  'replayDof',
] as const;
function legacy(graphics: GraphicsOptions) {
  return Object.fromEntries(LEGACY_KEYS.map((k) => [k, graphics[k]]));
}

describe('ULTRA preset', () => {
  it('is opt-in: the default and every existing preset keep every module off', () => {
    expect(DEFAULT_SETTINGS.quality).toBe('medium');
    for (const q of ['low', 'medium', 'high'] as const) {
      const g = graphicsPreset(q);
      expect(g.ssr).toBe(false);
      expect(g.taaSharpen).toBe(0);
      expect(g.aoTemporal).toBe(false);
      expect(g.toneMapper).toBe('aces');
      expect(g.physicalBloom).toBe(false);
      expect(g.chromaticAberration).toBe(false);
      expect(g.lightShafts).toBe(false);
      expect(g.shadowCascades).toBe(2);
      expect(g.replayDof).toBe(false);
      expect(g.temporalAA).toBe(false);
      expect(g.shadowSize).toBeLessThanOrEqual(2048);
    }
  });
  it('pins the pre-ULTRA preset values exactly (no drift on Low/Medium/High)', () => {
    expect(legacy(graphicsPreset('low'))).toEqual({
      resolutionScale: 0.75,
      textureSize: 256,
      shadowSize: 0,
      reflections: 'environment',
      mirrorQuality: 'low',
      particleDensity: 0,
      vegetationDensity: 0.5,
      crowd: false,
      bloom: false,
      autoExposure: false,
      localFog: false,
      motionBlur: 0,
      antialias: true,
      anisotropy: 2,
      msaa: 0,
      ambientOcclusion: false,
      filmGrade: true,
      temporalAA: false,
      lensEffects: false,
      cockpitFov: 54,
    });
    expect(legacy(graphicsPreset('high'))).toMatchObject({
      textureSize: 1024,
      shadowSize: 2048,
      reflections: 'local',
      msaa: 4,
      motionBlur: 0.5,
      anisotropy: 16,
    });
  });
  it('is High-tier geometry plus TAA, SSR, temporal AO, 4096 shadows and three cascades', () => {
    const ultra = graphicsPreset('ultra');
    const high = graphicsPreset('high');
    expect(detailTier('ultra')).toBe('high');
    for (const q of ['low', 'medium', 'high'] as const) expect(detailTier(q)).toBe(q);
    expect(ultra.mirrorQuality).toBe('high');
    expect(ultra.textureSize).toBe(high.textureSize);
    expect(ultra.msaa).toBe(4);
    expect(ultra.temporalAA).toBe(true);
    expect(ultra.taaSharpen).toBeGreaterThan(0);
    expect(ultra.ssr).toBe(true);
    expect(ultra.aoTemporal).toBe(true);
    expect(ultra.shadowSize).toBe(4096);
    expect(ultra.shadowCascades).toBe(3);
    expect(ultra.physicalBloom && ultra.lightShafts && ultra.replayDof).toBe(true);
    expect(ultra.chromaticAberration).toBe(true);
    // Tone mapping stays the calibrated ACES; AgX/Neutral are user choices.
    expect(ultra.toneMapper).toBe('aces');
    expect(QUALITY_PRESETS).toEqual(['low', 'medium', 'high', 'ultra']);
    expect(isQualityPreset('ultra')).toBe(true);
    expect(isQualityPreset('epic')).toBe(false);
  });
});

describe('settings migration', () => {
  it('validates a save written before ULTRA to exactly its preset, every module off', () => {
    for (const quality of ['low', 'medium', 'high'] as const) {
      const old = { ...legacy(graphicsPreset(quality)) };
      const saved = { ...structuredClone(DEFAULT_SETTINGS), quality, graphics: old };
      const result = validateSettings(saved);
      expect(result.quality).toBe(quality);
      expect(result.graphics).toEqual(graphicsPreset(quality));
      for (const key of ULTRA_KEYS)
        expect(result.graphics[key]).toEqual(graphicsPreset(quality)[key]);
    }
  });
  it('keeps custom pre-ULTRA overrides untouched', () => {
    const custom = {
      ...legacy(graphicsPreset('medium')),
      msaa: 4,
      motionBlur: 0.2,
      temporalAA: true,
    };
    const result = validateSettings({ ...structuredClone(DEFAULT_SETTINGS), graphics: custom });
    expect(result.graphics.msaa).toBe(4);
    expect(result.graphics.motionBlur).toBe(0.2);
    expect(result.graphics.temporalAA).toBe(true);
    expect(result.graphics.ssr).toBe(false);
  });
  it('persists an ULTRA save and its module choices', () => {
    const graphics = { ...graphicsPreset('ultra'), toneMapper: 'agx', ssr: false, taaSharpen: 0.6 };
    const saved = { ...structuredClone(DEFAULT_SETTINGS), quality: 'ultra', graphics };
    const result = validateSettings(JSON.parse(JSON.stringify(saved)));
    expect(result.quality).toBe('ultra');
    expect(result.graphics).toEqual(graphics);
  });
  it('falls back for unknown presets and invalid module values', () => {
    const result = validateSettings({
      ...structuredClone(DEFAULT_SETTINGS),
      quality: 'cinematic',
      graphics: {
        ...graphicsPreset('medium'),
        toneMapper: 'filmic9000',
        shadowCascades: 4,
        shadowSize: 8192,
        taaSharpen: 7,
        ssr: 'yes',
      },
    });
    expect(result.quality).toBe('medium');
    expect(result.graphics.toneMapper).toBe('aces');
    expect(result.graphics.shadowCascades).toBe(2);
    expect(result.graphics.shadowSize).toBe(2048);
    expect(result.graphics.taaSharpen).toBe(1);
    expect(result.graphics.ssr).toBe(false);
    expect(validateGraphics({ shadowSize: 4096 }, 'high').shadowSize).toBe(4096);
  });
});

describe('device capability fallbacks', () => {
  const caps = { floatColorBuffer: true, maxTextureSize: 16384, maxSamples: 4 };
  it('returns the same object when the device supports the request', () => {
    for (const q of ['low', 'medium', 'high', 'ultra'] as const) {
      const g = graphicsPreset(q);
      expect(deviceGraphics(g, caps)).toBe(g);
    }
  });
  it('halves a 4096 shadow map on a device limited to 2048 textures', () => {
    const g = deviceGraphics(graphicsPreset('ultra'), { ...caps, maxTextureSize: 2048 });
    expect(g.shadowSize).toBe(2048);
    expect(graphicsPreset('ultra').shadowSize).toBe(4096);
  });
  it('names modules that cannot run and why', () => {
    expect(unsupportedModules(graphicsPreset('ultra'), caps)).toEqual([]);
    const reasons = unsupportedModules(
      { ...graphicsPreset('ultra'), temporalAA: false, shadowSize: 0 },
      { ...caps, floatColorBuffer: false },
    );
    expect(reasons.join('\n')).toMatch(/ssr/);
    expect(reasons.join('\n')).toMatch(/taaSharpen/);
    expect(reasons.join('\n')).toMatch(/shadowCascades/);
  });
});

describe('settings controls', () => {
  it('offers every ULTRA module toggle and the tone mapper choice', () => {
    const html = presentationControls(DEFAULT_SETTINGS);
    for (const key of [
      'ssr',
      'aoTemporal',
      'physicalBloom',
      'chromaticAberration',
      'lightShafts',
      'replayDof',
    ])
      expect(html).toContain(`<input type="checkbox" name="graphics_${key}">`);
    expect(html).toContain('name="graphics_taaSharpen" type="range" min="0" max="1"');
    expect(html).toContain('<select name="graphics_toneMapper"><option value="aces">');
    expect(html).toContain('<option value="agx">');
    expect(html).toContain('<option value="4096">');
    expect(html).toContain('<select name="graphics_shadowCascades">');
  });
});
