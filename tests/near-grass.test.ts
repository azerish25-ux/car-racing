import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  GRASS_MOW_CONTRAST,
  GRASS_MOW_METRES,
  GRASS_TINT,
  GRAVEL,
  GRAVEL_HOOK,
  installGravelFinish,
} from '../src/rendering/studio/grass-gravel-finish.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

const compile = (m: T.Material) => {
  const shader = {
    uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  } as unknown as StudioShader;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};
const srgb = (linear: number) =>
  Math.round(255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055));
const linear = (byte: number) => {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

describe('olive turf', () => {
  it('tints the shared grass texels to a mown summer-turf #4d5f3c albedo', () => {
    const texel = [89, 101, 53].map(linear);
    const lin = texel.map((v, i) => v * GRASS_TINT[i]);
    const albedo = lin.map(srgb);
    // TEST-UPDATE (photoreal pass): the KPI 9 olive #808054 read as khaki felt
    // as bright as the road; real mown turf is ~0.08-0.12 luminance, G/R 1.5-1.8.
    const target = [0x4d, 0x5f, 0x3c];
    albedo.forEach((v, i) => expect(Math.abs(v - target[i])).toBeLessThanOrEqual(8));
    const luminance = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    expect(luminance).toBeGreaterThan(0.08);
    expect(luminance).toBeLessThan(0.12);
    expect(lin[1] / lin[0]).toBeGreaterThan(1.4);
    expect(lin[1] / lin[0]).toBeLessThan(1.9);
    // Less saturated than the old irrigated tint (sRGB 80/104/48).
    const sat = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
    expect(sat(albedo)).toBeLessThan(sat([80, 104, 48]));
  });

  it('mows 4 m bands at +-6 % with regional variation and dry patches, on apron and terrain', () => {
    expect(GRASS_MOW_METRES).toBe(4);
    expect(GRASS_MOW_CONTRAST).toBe(0.06);
    for (const kind of ['grass', 'terrain'] as const) {
      const m = new T.MeshStandardMaterial();
      installCircuitFinish(m, kind);
      const f = compile(m).fragmentShader;
      expect(f).toContain(
        `diffuseColor.rgb *= vec3(${GRASS_TINT.map((v) => v.toFixed(3)).join(',')});`,
      );
      expect(m.customProgramCacheKey()).toContain('olive-d19-v1');
      if (kind === 'grass') {
        expect(f).toContain('float mowPhase=abs(vFinishMetres.x)/4.0;');
        expect(f).toContain('mix(0.940,1.060,mowBand)');
        expect(f).toContain('float dryPatch=');
      }
    }
  });
});

describe('gravel', () => {
  it('draws Voronoi pebbles, cavities and raked furrows in river-gravel #8f8470', () => {
    const gravel = new T.MeshStandardMaterial({ color: 0x777777 });
    expect(installGravelFinish(gravel)).toBe(true);
    expect(installGravelFinish(gravel)).toBe(false);
    expect(gravel.color.getHex()).toBe(0xffffff);
    expect(studioHookKeys(gravel)).toEqual([GRAVEL_HOOK]);
    const shader = compile(gravel);
    expect((shader.uniforms.gravelColour.value as T.Color).getHex()).toBe(
      new T.Color(GRAVEL.color).getHex(),
    );
    const f = shader.fragmentShader;
    expect(f).toContain('vGravelWorld.xz * 50.0000');
    expect(f).toContain('vGravelMetres.x / 0.3000');
    expect(f).toContain('normal = apexGravelRelief( normal, gravelRelief );');
    // River gravel, not sand: linear albedo 0.2-0.32.
    const g = new T.Color(GRAVEL.color);
    expect(0.2126 * g.r + 0.7152 * g.g + 0.0722 * g.b).toBeGreaterThan(0.2);
    expect(0.2126 * g.r + 0.7152 * g.g + 0.0722 * g.b).toBeLessThan(0.32);
    expect(GRAVEL.cellsPerMetre).toBeGreaterThanOrEqual(40);
    expect(GRAVEL.cellsPerMetre).toBeLessThanOrEqual(60);
  });
});
