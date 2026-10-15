import { afterEach, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  COCKPIT_FOV,
  graphicsPreset,
  validateGraphics,
  bufferSize,
} from '../src/rendering/options.ts';
import { presentationControls } from '../src/ui/presentation.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { InputPump } from '../src/input/pump.ts';
import { TextureBudget } from '../src/rendering/texture-budget.ts';
import { setupControlStep } from '../src/ui/interface.ts';
import type { Setup } from '../src/simulation/config.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each([1, 2, 3])('migrates version %i without losing controls or setup', (version) => {
  const old = structuredClone(DEFAULT_SETTINGS);
  const saved = {
    ...old,
    version,
    quality: 'high',
    bindings: { ...old.bindings, throttle: 'KeyI' },
  };
  const migrated = validateSettings(saved);
  expect(migrated.version).toBe(6);
  expect(migrated.graphics).toEqual(graphicsPreset('high'));
  expect(migrated.bindings.throttle).toBe('KeyI');
  expect(migrated.setup).toEqual(old.setup);
});
it('preserves independent quality controls through version-four serialization', () => {
  const saved = structuredClone(DEFAULT_SETTINGS);
  Object.assign(saved.graphics, {
    resolutionScale: 0.55,
    textureSize: 128,
    shadowSize: 512,
    reflections: 'local',
    particleDensity: 0.2,
    crowd: false,
    bloom: true,
    motionBlur: 0.35,
    antialias: false,
    anisotropy: 4,
  });
  saved.colorblind = true;
  saved.highContrast = true;
  expect(validateSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
});
it('bounds every numeric budget and rejects unsupported quality values', () => {
  const g = validateGraphics(
    {
      resolutionScale: Infinity,
      textureSize: 12345,
      shadowSize: 999,
      particleDensity: -8,
      vegetationDensity: 10,
      motionBlur: 8,
      anisotropy: 999,
      reflections: 'magic',
      antialias: 'false',
    },
    'medium',
  );
  expect(g.resolutionScale).toBe(1);
  expect(g.textureSize).toBe(512);
  expect(g.shadowSize).toBe(2048);
  expect(g.particleDensity).toBe(0);
  expect(g.vegetationDensity).toBe(1);
  expect(g.motionBlur).toBe(0.6);
  expect(g.anisotropy).toBe(8);
  expect(g.reflections).toBe('environment');
  expect(g.antialias).toBe(true);
});
it('adds the studio keys: temporal AA opt-in, lens effects above Low, 54 degree cockpit lens', () => {
  expect(COCKPIT_FOV).toEqual({ default: 54, min: 44, max: 70 });
  for (const [quality, lens] of [
    ['low', false],
    ['medium', true],
    ['high', true],
  ] as const)
    expect(graphicsPreset(quality)).toMatchObject({
      temporalAA: false,
      lensEffects: lens,
      cockpitFov: 54,
    });
  expect(validateGraphics({ cockpitFov: 10 }, 'medium').cockpitFov).toBe(44);
  expect(validateGraphics({ cockpitFov: 99 }, 'medium').cockpitFov).toBe(70);
  expect(validateGraphics({ cockpitFov: 61.5 }, 'medium').cockpitFov).toBe(61.5);
  for (const invalid of [NaN, Infinity, '60', null])
    expect(validateGraphics({ cockpitFov: invalid }, 'high').cockpitFov).toBe(54);
  const typed = validateGraphics({ temporalAA: 'true', lensEffects: 0 }, 'high');
  expect(typed.temporalAA).toBe(false);
  expect(typed.lensEffects).toBe(true);
  const chosen = validateGraphics({ temporalAA: true, lensEffects: false }, 'high');
  expect(chosen.temporalAA).toBe(true);
  expect(chosen.lensEffects).toBe(false);
  // Version-6 saves written before these keys existed take the preset values.
  const saved = structuredClone(DEFAULT_SETTINGS) as unknown as {
    graphics: Record<string, unknown>;
  };
  for (const key of ['temporalAA', 'lensEffects', 'cockpitFov']) delete saved.graphics[key];
  expect(validateSettings(saved).graphics).toEqual(graphicsPreset('medium'));
  const controls = presentationControls(DEFAULT_SETTINGS);
  expect(controls).toContain('name="graphics_cockpitFov" type="range" min="44" max="70" step="1"');
  expect(controls).toContain('<input type="checkbox" name="graphics_temporalAA">');
  expect(controls).toContain('<input type="checkbox" name="graphics_lensEffects">');
});
it('calculates bounded physical pixels without changing aspect ratio', () => {
  expect(bufferSize(1920, 1080, 0.5, 8192)).toEqual({ width: 960, height: 540 });
  expect(bufferSize(8000, 4000, 2, 4096)).toEqual({ width: 4096, height: 2048 });
  expect(() => bufferSize(NaN, 100, 1, 4096)).toThrow();
});
it('samples input without any animation callbacks and stops cleanly', () => {
  vi.useFakeTimers();
  const sample = vi.fn();
  let now = 1000;
  const pump = new InputPump(sample, () => now);
  pump.start();
  pump.start();
  now += 20;
  vi.advanceTimersByTime(20);
  expect(sample).toHaveBeenCalledTimes(1);
  expect(sample).toHaveBeenLastCalledWith(0.02);
  now += 5000;
  pump.poll();
  expect(sample).toHaveBeenLastCalledWith(0.25);
  pump.dispose();
  const count = sample.mock.calls.length;
  vi.advanceTimersByTime(2000);
  expect(sample).toHaveBeenCalledTimes(count);
});
it('resizes immutable texture assets but never live displays and can restore resolution', () => {
  class Canvas {
    width = 1024;
    height = 512;
    getContext() {
      return { drawImage: vi.fn(), clearRect: vi.fn() };
    }
  }
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  const original = new Canvas() as unknown as HTMLCanvasElement;
  const map = new T.CanvasTexture(original);
  const display = new T.CanvasTexture(new Canvas() as unknown as HTMLCanvasElement);
  display.userData.dynamic = true;
  const group = new T.Group();
  group.add(new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial({ map })));
  group.add(new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial({ map: display })));
  const budget = new TextureBudget();
  budget.register(group);
  budget.configure(128, 2);
  expect(map.image.width).toBe(128);
  expect(map.image.height).toBe(64);
  expect(display.image.width).toBe(1024);
  expect(map.anisotropy).toBe(2);
  budget.configure(1024, 16);
  expect(map.image).toBe(original);
  expect(map.anisotropy).toBe(16);
  budget.dispose();
});
it('keeps the resampled copy of a CPU-read skin CPU-backed, and only that copy', () => {
  // Diagnostics read the presented flank skin back on every call. An
  // accelerated budget copy made that read wait ~20-30 s behind queued GPU
  // frames while an Aurel 12-car session loaded on a software rasterizer.
  const requests: unknown[][] = [];
  class Canvas {
    width = 1024;
    height = 1024;
    getContext(...args: unknown[]) {
      requests.push(args);
      return { drawImage: vi.fn(), clearRect: vi.fn() };
    }
  }
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  const skin = new T.CanvasTexture(new Canvas() as unknown as HTMLCanvasElement);
  skin.userData.cpuReadback = true;
  const sign = new T.CanvasTexture(new Canvas() as unknown as HTMLCanvasElement);
  const group = new T.Group();
  for (const map of [skin, sign])
    group.add(new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial({ map })));
  const budget = new TextureBudget();
  budget.register(group);
  expect(skin.image.width).toBe(512);
  expect(sign.image.width).toBe(512);
  expect(requests[0]).toEqual(['2d', { willReadFrequently: true }]);
  expect(requests[2]).toEqual(['2d', undefined]);
  budget.dispose();
});

it.each<[keyof Setup, number, number | 'any']>([
  ['rearARB', 16500, 500],
  ['rearARB', 16750, 'any'],
  ['frontSpring', 115250, 'any'],
  ['frontPressure', 151.25, 'any'],
  ['frontRide', 0.06725, 'any'],
  ['frontToe', -0.00123, 'any'],
  ['rearARB', 21000, 500],
  ['frontPressure', 155, 1],
  ['diffPower', 0.34, 0.001],
  ['frontToe', -0.001, 0.0005],
])(
  'preserves the setup value %s=%s instead of snapping it on opening the garage',
  (key, value, step) => {
    expect(setupControlStep(key, value)).toBe(step);
  },
);
