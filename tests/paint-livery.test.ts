import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  PAINT_FINISHES,
  applyPaintFinish,
  installPaintFinish,
  installPaintFlakes,
} from '../src/rendering/paint-finish.ts';
import {
  LIVERY_SCHEMES,
  flankLivery,
  installLiveryPattern,
  installTeamPaint,
  liveryScheme,
  playerSecondary,
  repaintFlank,
  setLiveryPattern,
} from '../src/rendering/car-livery.ts';
import { CARBON_FINISHES, carbonMaterial } from '../src/rendering/materials.ts';
import { LIVERIES } from '../src/simulation/config.ts';
import { BRANDS } from '../src/rendering/studio/brand-atlas.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import { DEFAULT_LIVERY } from '../src/storage/livery.ts';

const compile = (m: T.Material) => {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};
/** Canvas stub recording fills and strokes in call order. */
function recordingCanvas() {
  const calls: string[] = [];
  const context = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args: unknown[]) => {
        calls.push(
          `${key}:${args.map((a) => (typeof a === 'number' ? Math.round(a) : String(a))).join(',')}`,
        );
      };
    },
    set(target, key: string, value) {
      if (key === 'fillStyle' || key === 'strokeStyle' || key === 'lineWidth')
        calls.push(`${key}=${typeof value === 'object' ? 'gradient' : String(value)}`);
      target[key] = value;
      return true;
    },
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const saturation = (hex: string) => {
  const { r, g, b } = new T.Color(hex).getRGB({ r: 0, g: 0, b: 0 }, T.SRGBColorSpace);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  return max > 0 ? (max - min) / max : 0;
};
const srgbLuminance = (hex: string) => {
  const c = new T.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

describe('D06 paint finishes', () => {
  it('pins the finish table of the work order', () => {
    expect(PAINT_FINISHES.gloss).toMatchObject({
      metalness: 0,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    });
    expect(PAINT_FINISHES.metallic.metalness).toBeGreaterThanOrEqual(0.45);
    expect(PAINT_FINISHES.metallic.metalness).toBeLessThanOrEqual(0.6);
    expect(PAINT_FINISHES.metallic).toMatchObject({ roughness: 0.38, clearcoatRoughness: 0.04 });
    expect(PAINT_FINISHES.satin).toMatchObject({
      roughness: 0.48,
      clearcoat: 0.35,
      clearcoatRoughness: 0.32,
    });
    expect(PAINT_FINISHES.matte).toMatchObject({ roughness: 0.62, clearcoat: 0 });
    const m = applyPaintFinish(new T.MeshPhysicalMaterial(), 'satin');
    expect([m.roughness, m.clearcoat, m.clearcoatRoughness, m.userData.paintFinish]).toEqual([
      0.48,
      0.35,
      0.32,
      'satin',
    ]);
  });
  it('chains flakes and orange peel after the pigment finish with constants only', () => {
    const m = new T.MeshPhysicalMaterial();
    let previous = 0;
    m.onBeforeCompile = () => void previous++;
    expect(installPaintFlakes(m, 1, 0.002)).toBe(true);
    expect(installPaintFlakes(m, 1, 0.002)).toBe(false);
    installPaintFinish(m);
    expect(studioHookKeys(m)).toEqual(['paint-flake-100-20-v1']);
    expect(m.customProgramCacheKey()).toContain('aurel-filtered-pigment-v2');
    const s = compile(m);
    expect(previous).toBe(1);
    expect(s.uniforms).toEqual({});
    expect(s.fragmentShader.match(/APEX_PAINT_FLAKE_DECLARED/g)).toHaveLength(2);
    expect(s.fragmentShader).toContain('normal = normalize(normal + 0.1800');
    expect(s.fragmentShader).toContain('clearcoatNormal = normalize(clearcoatNormal');
    expect(s.fragmentShader.indexOf('flakeTilt')).toBeGreaterThan(
      s.fragmentShader.indexOf('#include <normal_fragment_maps>'),
    );
    expect(s.fragmentShader.indexOf('peelResolved')).toBeGreaterThan(
      s.fragmentShader.indexOf('#include <clearcoat_normal_fragment_maps>'),
    );
    const gloss = new T.MeshPhysicalMaterial();
    installPaintFlakes(gloss, 0, 0.002);
    const g = compile(gloss);
    expect(g.fragmentShader).not.toContain('flakeTilt');
    expect(g.fragmentShader).toContain('peelResolved');
    expect(gloss.customProgramCacheKey()).not.toBe(m.customProgramCacheKey());
    const matte = new T.MeshPhysicalMaterial();
    expect(installPaintFlakes(matte, 0, 0)).toBe(false);
    expect(() => installPaintFlakes(matte, NaN, 0)).toThrow();
  });
});

describe('D06 team liveries', () => {
  it('derives one saturated two-tone scheme per team colour with fictional sponsors', () => {
    expect(LIVERY_SCHEMES).toHaveLength(LIVERIES.length);
    expect(LIVERIES.map((c) => `#${c.toString(16).padStart(6, '0')}`)).toEqual([
      '#b3121e',
      '#f27c1e',
      '#0b5e4f',
      '#13235e',
      '#e9e9eb',
      '#1c5bd8',
      '#e36fa8',
      '#16181b',
      '#2bb3a0',
      '#9ea4aa',
      '#7fc241',
      '#f2c200',
    ]);
    LIVERY_SCHEMES.forEach((scheme, i) => {
      expect(scheme.primary).toBe(`#${LIVERIES[i].toString(16).padStart(6, '0')}`);
      expect(srgbLuminance(scheme.secondary), scheme.secondary).toBeLessThan(0.05);
      expect(srgbLuminance(scheme.accent), scheme.accent).toBeGreaterThan(0.3);
      for (const brand of [scheme.title, ...scheme.partners]) expect(BRANDS).toContain(brand);
      expect(Object.keys(PAINT_FINISHES)).toContain(scheme.finish);
    });
    const mean =
      LIVERY_SCHEMES.reduce((sum, scheme) => sum + saturation(scheme.primary), 0) /
      LIVERY_SCHEMES.length;
    expect(mean).toBeGreaterThanOrEqual(0.45);
    expect(liveryScheme(13)).toBe(LIVERY_SCHEMES[1]);
    expect(() => liveryScheme(-1)).toThrow();
    expect(srgbLuminance(playerSecondary('#2266bb'))).toBeLessThan(srgbLuminance('#2266bb'));
  });
  it('installs the body pattern with its own uniforms, recolourable without recompiling', () => {
    const paint = installTeamPaint(new T.MeshPhysicalMaterial({ color: LIVERIES[2] }), 2);
    expect(paint.userData.paintFinish).toBe('metallic');
    expect(paint.metalness).toBe(PAINT_FINISHES.metallic.metalness);
    expect(studioHookKeys(paint)).toEqual(['paint-flake-100-20-v1', 'livery-pattern-v1']);
    const s = compile(paint);
    expect(Object.keys(s.uniforms).sort()).toEqual(['liveryAccent', 'liverySecondary']);
    expect(s.fragmentShader.match(/uniform vec3 liverySecondary/g)).toHaveLength(1);
    expect(
      s.fragmentShader.indexOf('diffuseColor.rgb = mix(diffuseColor.rgb, liverySecondary'),
    ).toBeLessThan(s.fragmentShader.indexOf('#include <map_fragment>'));
    const key = paint.customProgramCacheKey();
    const uniform = s.uniforms.liverySecondary as T.IUniform<T.Color>;
    expect(uniform.value.getHexString()).toBe('06231e');
    expect(setLiveryPattern(paint, { secondary: '#102030', accent: '#ffeeaa' })).toBe(true);
    expect(uniform.value.getHexString()).toBe('102030');
    expect(paint.customProgramCacheKey()).toBe(key);
    expect(installLiveryPattern(paint, { secondary: '#000000', accent: '#ffffff' })).toBe(false);
    expect(
      setLiveryPattern(new T.MeshPhysicalMaterial(), { secondary: '#000000', accent: '#ffffff' }),
    ).toBe(false);
  });
  it('paints flank skins with a sweep, pinstripes, carbon, a 120 px number and three sponsors', () => {
    const calls = recordingCanvas();
    const paint = installTeamPaint(new T.MeshPhysicalMaterial({ color: LIVERIES[5] }), 5);
    const flank = flankLivery(paint, 1, 5);
    expect(flank.userData.liverySide).toBe(1);
    expect(flank.userData.paintFinish).toBe('metallic');
    expect(studioHookKeys(flank)).toEqual(['paint-flake-100-20-v1']);
    expect(flank.clearcoatRoughness).toBe(0.04);
    // Base coat first: the whole canvas in the team primary (the under-floor
    // corner keeps it, which the e2e livery checks read back).
    const base = calls.indexOf('fillRect:0,0,1024,1024');
    expect(base).toBeGreaterThan(0);
    expect(calls[base - 1]).toBe(`fillStyle=${LIVERY_SCHEMES[5].primary}`);
    expect(calls.filter((c) => c === 'fillStyle=gradient').length).toBeGreaterThanOrEqual(1);
    const widths = calls.filter((c) => c.startsWith('lineWidth=')).map((c) => Number(c.slice(10)));
    expect(widths).toContain(2.5);
    expect(widths).toContain(5);
    expect(calls.filter((c) => c.startsWith('setTransform:0')).length).toBeGreaterThanOrEqual(4);
    expect(calls.some((c) => c.startsWith('fillText') || c.startsWith('font'))).toBe(false);
    calls.length = 0;
    repaintFlank(flank, 0, { ...DEFAULT_LIVERY, primary: '#285c89', pattern: 'split' });
    expect(calls[calls.indexOf('fillRect:0,0,1024,1024') - 1]).toBe('fillStyle=#285c89');
  });
  it('keeps flank skins CPU-backed so the diagnostics readback never waits on queued GPU work', () => {
    // apexDiagnostics() reads a flank pixel back on every call. On an
    // accelerated canvas that read waited ~30 s behind a software rasterizer's
    // queued frames during session loading, stalling the worker's first
    // snapshot (e2e/55 Aurel held grid). The skin must request a CPU canvas.
    const requests: unknown[][] = [];
    const context = new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) =>
        key in target
          ? target[key]
          : key === 'createLinearGradient'
            ? () => ({ addColorStop() {} })
            : () => undefined,
      set: (target, key: string, value) => ((target[key] = value), true),
    });
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: (...args: unknown[]) => (requests.push(args), context),
      }),
    });
    const paint = installTeamPaint(new T.MeshPhysicalMaterial({ color: LIVERIES[0] }), 0);
    const flank = flankLivery(paint, -1, 0);
    expect(requests[0]).toEqual(['2d', { willReadFrequently: true }]);
    // TextureBudget's presented (resampled) copy follows this flag.
    expect(flank.map!.userData.cpuReadback).toBe(true);
  });
  it('makes rival carbon a lacquered physical twill and the floor raw satin', () => {
    const coat = carbonMaterial();
    expect(coat).toBeInstanceOf(T.MeshPhysicalMaterial);
    expect(coat.color.getHexString()).toBe('0e1012');
    expect([coat.roughness, coat.clearcoat, coat.clearcoatRoughness]).toEqual([0.36, 0.85, 0.07]);
    // TEST-UPDATE (env realism): tows carry an anisotropic sheen, warp/weft per twill cell.
    expect(coat.customProgramCacheKey()).toBe('apex-metre-carbon-v5-tow-sheen-coat');
    expect(coat.anisotropy).toBeGreaterThan(0);
    const s = compile(coat);
    expect(s.fragmentShader).toContain('#define CARBON_WEAVE 0.180');
    expect(s.fragmentShader).toContain('normal = normalize(normal - 0.06 * carbonResolved');
    expect(s.fragmentShader).toContain(
      'diffuseColor.rgb *= 1.0 + twillStrand * carbonResolved * CARBON_WEAVE;',
    );
    const satin = carbonMaterial('satin');
    expect([satin.roughness, satin.clearcoat]).toEqual([CARBON_FINISHES.satin.roughness, 0]);
    expect(satin.customProgramCacheKey()).toBe('apex-metre-carbon-v5-tow-sheen-satin');
    expect(compile(satin).fragmentShader).toContain('#define CARBON_WEAVE 0.080');
  });
});
