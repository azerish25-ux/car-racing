import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  materials,
  METAL_F0,
  surfaceWeather,
  wetSurfaceResponse,
} from '../src/rendering/materials/index.ts';
import {
  PROCEDURAL_IDENTITY,
  PROCEDURAL_RECIPES,
  ProceduralTextures,
} from '../src/rendering/materials/procedural.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { SSR_MASK_HOOK, ssrMaskUniforms } from '../src/rendering/ultra/ssr-mask.ts';

/** Run a material's hook chain on three's real shader source. */
function compile(material: T.Material) {
  const lib =
    material instanceof T.MeshPhysicalMaterial
      ? T.ShaderLib.physical
      : material instanceof T.MeshStandardMaterial
        ? T.ShaderLib.standard
        : null;
  if (!lib) throw new Error('Unexpected material');
  const shader = {
    uniforms: T.UniformsUtils.clone(lib.uniforms),
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
    defines: {},
  } as unknown as StudioShader;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('material library API', () => {
  it('car paint is base + metallic flake normal + clear coat', () => {
    const paint = materials.carPaint({ color: 0x1b4fd8, flake: 0.8, pearl: 0.3 });
    expect(paint).toBeInstanceOf(T.MeshPhysicalMaterial);
    expect(paint.clearcoat).toBe(1);
    expect(paint.clearcoatRoughness).toBeLessThan(0.06);
    expect(paint.metalness).toBeGreaterThan(0.5);
    expect(paint.normalMap?.userData.procedural).toBe('flake:normal');
    expect(paint.clearcoatNormalMap).toBeNull();
    expect(paint.iridescence).toBeCloseTo(0.3, 6);
    expect(paint.userData.library).toBe('carPaint');
    expect(studioHookKeys(paint)).toContain(SSR_MASK_HOOK);
    const solid = materials.carPaint({ flake: 0 });
    expect(solid.normalMap).toBeNull();
    expect(solid.metalness).toBeLessThan(0.1);
  });
  it('carbon reuses the retained band-limited weave and joins SSR', () => {
    const lacquer = materials.carbon();
    expect(lacquer.userData.carbonFinish).toBe('lacquered');
    expect(lacquer.anisotropy).toBeGreaterThan(0);
    expect(studioHookKeys(lacquer)).toContain(SSR_MASK_HOOK);
    expect(materials.carbon({ finish: 'satin' }).clearcoat).toBe(0);
  });
  it('rubber is dark, rough and lettering-free (micro-relief only)', () => {
    const tyre = materials.rubber();
    expect(tyre.color.r).toBeLessThan(0.01);
    expect(tyre.roughness).toBeGreaterThan(0.85);
    expect(tyre.map).toBeNull();
    expect(tyre.normalMap?.userData.procedural).toBe('micro:normal');
    expect(materials.rubber({ wear: 1 }).roughness).toBeLessThan(tyre.roughness);
  });
  it('metals are conductors with physical F0 and anisotropic brushing', () => {
    const brushed = materials.metal({ kind: 'brushed', metal: 'steel' });
    expect(brushed.metalness).toBe(1);
    expect(brushed.anisotropy).toBeGreaterThan(0.5);
    expect(brushed.color.getHex()).toBe(new T.Color(METAL_F0.steel).getHex());
    expect(materials.metal({ kind: 'polished' }).roughness).toBeLessThan(0.1);
    expect(materials.metal({ kind: 'polished' }).normalMap).toBeNull();
  });
  it('glass is Fresnel-weighted and premultiplied', () => {
    const glass = materials.glass({ transmission: 0.9 });
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect(glass.blendSrc).toBe(T.OneFactor);
    expect(glass.blendDst).toBe(T.OneMinusSrcAlphaFactor);
    expect(glass.opacity).toBeCloseTo(0.1, 6);
    const shader = compile(glass);
    expect(shader.fragmentShader).toContain(
      'float apexF = 0.04 + 0.96 * pow( 1.0 - apexNoV, 5.0 );',
    );
    expect(shader.fragmentShader).toContain('totalSpecular + totalEmissiveRadiance, apexAlpha');
    // Transparent: never written into the SSR mask.
    expect(studioHookKeys(glass)).not.toContain(SSR_MASK_HOOK);
  });
  it('asphalt and wet road couple to the shared weather with puddles and ripples', () => {
    const road = materials.asphalt({ variant: 'patched' });
    expect(road.map?.userData.procedural).toBe('asphalt-patched:albedo');
    expect(road.normalMap?.userData.procedural).toBe('asphalt-patched:normal');
    expect(road.roughnessMap?.userData.procedural).toBe('asphalt-patched:orm');
    expect(road.clearcoat).toBeGreaterThan(0);
    const shader = compile(road);
    for (const name of ['apexSurfaceWetness', 'apexSurfaceRain', 'apexWetAmount', 'studioTime'])
      expect(shader.uniforms[name]).toBeDefined();
    expect(shader.uniforms.apexSurfaceWetness).toBe(surfaceWeather.apexSurfaceWetness);
    expect(shader.fragmentShader).toContain('apexRippleSlope( vApexWorld.xz / 0.35, studioTime )');
    expect(shader.fragmentShader).toContain('material.clearcoatF0 = vec3( 0.0204 );');
    expect(shader.vertexShader).toContain('vApexWorld = ( modelMatrix * apexWorld ).xyz;');
    const wet = materials.wetRoad({ wetness: 1 });
    expect(wet.userData.library).toBe('wetRoad');
    expect(
      (wet.userData.wetSurface as { apexWetAmount: T.IUniform<number> }).apexWetAmount.value,
    ).toBe(5);
    materials.setSurfaceWeather(0.7, 2);
    expect(surfaceWeather.apexSurfaceWetness.value).toBe(0.7);
    expect(surfaceWeather.apexSurfaceRain.value).toBe(1);
    materials.setSurfaceWeather(0, 0);
  });
  it('wet response darkens, smooths and floods monotonically', () => {
    const dry = wetSurfaceResponse(0, 0.5),
      damp = wetSurfaceResponse(0.4, 0.5),
      soaked = wetSurfaceResponse(1, 0.5);
    expect(dry.albedoScale).toBe(1);
    expect(dry.film).toBe(0);
    expect(damp.albedoScale).toBeLessThan(1);
    expect(soaked.puddle).toBeGreaterThan(damp.puddle);
    expect(soaked.film).toBeGreaterThanOrEqual(damp.film);
    expect(soaked.coatRoughness).toBeLessThan(dry.coatRoughness);
    // Low spots (low noise) fill before high ones.
    expect(wetSurfaceResponse(0.6, 0.9).puddle).toBeGreaterThanOrEqual(
      wetSurfaceResponse(0.6, 0.2).puddle,
    );
  });
  it('vegetation transmits shadowed light through the leaf', () => {
    const leaf = materials.vegetation({ translucency: 0.5 });
    expect(leaf.side).toBe(T.DoubleSide);
    const shader = compile(leaf);
    expect(shader.fragmentShader).toContain('#define RE_Direct RE_Direct_ApexLeaf');
    expect(shader.fragmentShader).toContain('RE_Direct_Physical( directLight');
    expect(shader.uniforms.apexTranslucency.value).toBe(0.5);
  });
  it('the SSR mask leaves output untouched unless the scene pass enables it', () => {
    const paint = materials.carPaint();
    const shader = compile(paint);
    expect(shader.fragmentShader).toContain(
      'gl_FragColor.a = mix( gl_FragColor.a, apexSsrCode, apexSsrEncode );',
    );
    expect(shader.uniforms.apexSsrEncode).toBe(ssrMaskUniforms.apexSsrEncode);
    expect(ssrMaskUniforms.apexSsrEncode.value).toBe(0);
  });
  it('box-projects metre UVs onto geometry without a layout', () => {
    const box = materials.boxProjectUv(new T.BoxGeometry(2, 4, 6).deleteAttribute('uv'), 2);
    const uv = box.getAttribute('uv');
    expect(uv.count).toBe(box.getAttribute('position').count);
    let max = 0;
    for (let i = 0; i < uv.count; i++)
      max = Math.max(max, Math.abs(uv.getX(i)), Math.abs(uv.getY(i)));
    expect(max).toBeCloseTo(1.5, 6);
  });
});

describe('GPU-baked procedural textures', () => {
  it('hands out identity pixels before baking and shares one source per recipe', () => {
    const set = new ProceduralTextures(16);
    const a = set.get('flake', 'normal', 4),
      b = set.get('flake', 'normal', 8);
    expect(a.source).toBe(b.source);
    expect(a.repeat.x).toBe(4);
    expect(b.repeat.x).toBe(8);
    const data = (a.image as { data: Uint8Array }).data;
    expect(Array.from(data.subarray(0, 4))).toEqual(PROCEDURAL_IDENTITY.normal);
    expect(set.get('asphalt-worn', 'albedo').colorSpace).toBe(T.SRGBColorSpace);
    expect(set.get('asphalt-worn', 'orm').colorSpace).toBe(T.NoColorSpace);
    expect(a.wrapS).toBe(T.RepeatWrapping);
    expect(a.minFilter).toBe(T.LinearMipmapLinearFilter);
    expect(set.pending).toBe(3);
  });
  it('bakes every pending recipe once, in place, and re-uploads every clone', () => {
    const set = new ProceduralTextures(8);
    const clone = set.get('concrete-rough', 'normal', 2);
    const version = clone.version;
    const drawn: string[] = [];
    let current: T.ShaderMaterial | null = null;
    const renderer = {
      autoClear: true,
      xr: { enabled: false },
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      render: (mesh: T.Mesh) => {
        current = mesh.material as T.ShaderMaterial;
        drawn.push(current.name);
      },
      readRenderTargetPixels: (
        _t: unknown,
        _x: number,
        _y: number,
        w: number,
        h: number,
        buffer: Uint8Array,
      ) => {
        expect(current?.fragmentShader).toContain('void main()');
        buffer.fill(77, 0, w * h * 4);
      },
    } as unknown as T.WebGLRenderer;
    expect(set.bake(renderer)).toBe(1);
    expect(drawn).toEqual(['APEX bake concrete-rough:normal']);
    expect((clone.image as { data: Uint8Array }).data[5]).toBe(77);
    expect(clone.version).toBeGreaterThan(version);
    expect(set.pending).toBe(0);
    expect(set.bake(renderer)).toBe(0);
    expect(set.diagnostics().bakes).toBe(1);
  });
  it('keeps flat pixels and reports a failed bake rather than breaking materials', () => {
    const set = new ProceduralTextures(4);
    const texture = set.get('micro', 'orm');
    const renderer = {
      autoClear: true,
      xr: { enabled: false },
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      render: () => {},
      readRenderTargetPixels: () => {
        throw new Error('context lost');
      },
    } as unknown as T.WebGLRenderer;
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(set.bake(renderer)).toBe(0);
    } finally {
      console.warn = warn;
    }
    expect(set.diagnostics().failures).toBe(1);
    expect(Array.from((texture.image as { data: Uint8Array }).data.subarray(0, 4))).toEqual(
      PROCEDURAL_IDENTITY.orm,
    );
  });
  it('generates tileable GLSL for every recipe and output', () => {
    for (const recipe of PROCEDURAL_RECIPES)
      for (const output of ['normal', 'orm', 'albedo'] as const) {
        const source = ProceduralTextures.source(recipe, output);
        expect(source).toContain('void main()');
        // Periodic noise only: every lattice lookup wraps with mod().
        expect(source).toContain('mod( i');
        expect(source).not.toMatch(/\bTime\b|time\b/);
      }
    expect(() => new ProceduralTextures(100)).toThrow();
  });
});
