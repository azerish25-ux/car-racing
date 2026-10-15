import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FarShadow } from '../src/rendering/far-shadow.ts';
import { lightingDirection } from '../src/rendering/daylight.ts';
import { SceneAmbientPass } from '../src/rendering/scene-ambient-pass.ts';
import { LENS_BLOOM, LensBloomPass, PHYSICAL_BLOOM } from '../src/rendering/lens-bloom.ts';
import { BroadcastGradePass, GRADE_PROFILES } from '../src/rendering/broadcast-grade.ts';
import { WetRoadReflection } from '../src/rendering/wet-reflection.ts';
import { DepthOfFieldPass } from '../src/rendering/studio/dof-pass.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import { iblUniforms } from '../src/rendering/studio/ibl-energy.ts';
import {
  graphicsPreset,
  type GraphicsOptions,
  type QualityPreset,
} from '../src/rendering/options.ts';
import {
  TONE_MAPPING,
  ULTRA_FRINGE,
  UltraPipeline,
  type UltraFrame,
} from '../src/rendering/ultra/pipeline.ts';
import { SSR_MASK_HOOK, ssrMaskUniforms } from '../src/rendering/ultra/ssr-mask.ts';
import {
  CASCADES,
  MID_SHADOW_MARK,
  MidCascade,
  midCascadeChunks,
} from '../src/rendering/ultra/cascades.ts';
import { GpuPassTimer, PassLedger } from '../src/rendering/ultra/pass-ledger.ts';
import { H, HEADER } from '../src/simulation/protocol.ts';

interface MockRenderer {
  renderer: T.WebGLRenderer;
  draws: unknown[];
  info: { calls: number; triangles: number };
}
function mockRenderer(
  options: { float?: boolean; maxTexture?: number; onRender?: (o: unknown) => void } = {},
): MockRenderer {
  const draws: unknown[] = [];
  const info = { calls: 0, triangles: 0 };
  const renderer = {
    autoClear: true,
    toneMapping: T.ACESFilmicToneMapping,
    shadowMap: { enabled: true, type: T.PCFSoftShadowMap },
    xr: { enabled: false },
    info: { render: info },
    extensions: {
      has: (name: string) => name === 'EXT_color_buffer_float' && options.float !== false,
    },
    capabilities: { maxTextureSize: options.maxTexture ?? 16384, maxSamples: 4 },
    getContext: () => ({ getExtension: () => null }),
    getPixelRatio: () => 1,
    getSize: (v: T.Vector2) => v.set(320, 180),
    getDrawingBufferSize: (v: T.Vector2) => v.set(320, 180),
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    readRenderTargetPixels: () => {},
    render: (object: unknown) => {
      draws.push(object);
      info.calls++;
      info.triangles++;
      options.onRender?.(object);
    },
  } as unknown as T.WebGLRenderer;
  return { renderer, draws, info };
}

function host(options: Parameters<typeof mockRenderer>[0] = {}) {
  const mock = mockRenderer(options);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(50, 16 / 9, 0.045, 7000);
  camera.position.set(0, 1.3, 6);
  camera.lookAt(0, 0.6, 0);
  camera.updateMatrixWorld(true);
  const composer = new EffectComposer(mock.renderer);
  const scenePass = new SceneAmbientPass(scene, camera, 4);
  const bloom = new LensBloomPass();
  const output = new OutputPass();
  const grade = new BroadcastGradePass();
  for (const pass of [scenePass, bloom, output, grade]) composer.addPass(pass);
  const sun = new T.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const farShadow = new FarShadow(2048);
  const wetReflection = new WetRoadReflection();
  wetReflection.setQuality('high');
  const roadMaterial = new T.MeshStandardMaterial();
  scene.add(sun, farShadow.light);
  const ultra = new UltraPipeline({
    renderer: mock.renderer,
    scene,
    camera,
    composer,
    scenePass,
    bloom,
    grade,
    sun,
    farShadow,
    wetReflection,
    roadMaterial,
  });
  const configure = (preset: QualityPreset, graphics: GraphicsOptions = graphicsPreset(preset)) => {
    const g = ultra.deviceGraphics(graphics);
    scenePass.temporal.enabled = g.temporalAA;
    ultra.configure(preset, g);
    return g;
  };
  const presented = new Float32Array(HEADER);
  const frame = (overrides: Partial<UltraFrame> = {}) =>
    ultra.prepareFrame({
      presented,
      cars: [],
      subject: new T.Vector3(0, 0.6, 0),
      cameraMode: 'chase',
      lighting: 'sunset',
      studio: false,
      menu: false,
      photo: false,
      replay: false,
      otherDof: false,
      cut: false,
      ...overrides,
    });
  return {
    ...mock,
    scene,
    camera,
    composer,
    scenePass,
    bloom,
    output,
    grade,
    sun,
    farShadow,
    wetReflection,
    roadMaterial,
    ultra,
    configure,
    frame,
    presented,
  };
}

describe('ULTRA pipeline wiring', () => {
  it('inserts its passes into the retained chain in pipeline order', () => {
    const h = host();
    const names = h.composer.passes.map((p) =>
      p === h.scenePass
        ? 'scene'
        : p === h.ultra.replayLens.pass
          ? 'replayDof'
          : p === h.ultra.shafts
            ? 'shafts'
            : p === h.bloom
              ? 'bloom'
              : p === h.output
                ? 'output'
                : p === h.ultra.sharpen
                  ? 'sharpen'
                  : p === h.grade
                    ? 'grade'
                    : 'other',
    );
    expect(names).toEqual(['scene', 'replayDof', 'shafts', 'bloom', 'output', 'sharpen', 'grade']);
    expect(h.scenePass.sceneStages).toContain(h.ultra.ssr);
    // The mid cascade light exists but is out of the light list until enabled.
    expect(h.ultra.mid.light.parent).toBe(h.scene);
    expect(h.ultra.mid.light.visible).toBe(false);
  });
  for (const preset of ['low', 'medium', 'high'] as const) {
    it(`${preset}: leaves every module off and every retained pass as it was`, () => {
      const h = host();
      h.configure(preset);
      h.frame({ replay: true });
      expect(h.renderer.toneMapping).toBe(T.ACESFilmicToneMapping);
      expect(h.ultra.ssr.active).toBe(false);
      expect(h.ultra.sharpen.enabled).toBe(false);
      expect(h.ultra.shafts.enabled).toBe(false);
      expect(h.ultra.replayLens.pass.enabled).toBe(false);
      expect(h.ultra.mid.light.visible).toBe(false);
      expect(h.bloom.energyConserving).toBe(false);
      expect(h.grade.lensFringe).toBe(0);
      expect(h.scenePass.obscuranceStage).toBeNull();
      expect(h.wetReflection.enabled).toBe(true);
      expect(studioHookKeys(h.roadMaterial)).not.toContain(SSR_MASK_HOOK);
      const d = h.ultra.diagnostics();
      expect(d.shadowCascades.count).toBe(2);
      expect(d.unsupported).toEqual([]);
    });
  }
  it('ULTRA: enables the modules, replaces the planar wet pass with SSR and opts the road in', () => {
    const h = host();
    const g = h.configure('ultra');
    expect(g.shadowSize).toBe(4096);
    h.frame();
    expect(h.ultra.ssr.active).toBe(true);
    expect(h.wetReflection.enabled).toBe(false);
    expect(studioHookKeys(h.roadMaterial)).toContain(SSR_MASK_HOOK);
    expect(h.scenePass.obscuranceStage).toBe(h.ultra.ao);
    expect(h.bloom.energyConserving).toBe(true);
    h.frame();
    expect(h.grade.lensFringe).toBe(ULTRA_FRINGE);
    // Photo and menu views keep their own lens.
    h.frame({ photo: true });
    expect(h.grade.lensFringe).toBe(0);
    h.frame({ menu: true });
    expect(h.grade.lensFringe).toBe(0);
    // The mid cascade waits for the far map (it must be directional shadow 2).
    expect(h.ultra.mid.enabled).toBe(true);
    expect(h.ultra.mid.light.visible).toBe(false);
  });
  it('replaces the local probe while it owns the road, else the sky at its specular scale', () => {
    const h = host();
    h.configure('ultra');
    h.scene.environmentIntensity = 0.5;
    h.frame();
    expect(h.ultra.ssr.environment.probe).toBeNull();
    expect(h.ultra.ssr.environment.skyScale).toBeCloseTo(
      0.5 * iblUniforms.apexSpecularIBL.value,
      12,
    );
    const probe = new T.WebGLCubeRenderTarget(64).texture;
    h.roadMaterial.envMap = probe;
    h.frame();
    expect(h.ultra.ssr.environment.probe).toBe(probe);
    h.roadMaterial.envMap = null;
    h.frame();
    expect(h.ultra.ssr.environment.probe).toBeNull();
  });
  it('patches car paint as cars appear, once', () => {
    const h = host();
    h.configure('ultra');
    const paint = new T.MeshPhysicalMaterial({ clearcoat: 1 });
    h.frame({ cars: [{ reflectivePaint: [paint] }] });
    h.frame({ cars: [{ reflectivePaint: [paint] }] });
    expect(studioHookKeys(paint).filter((k) => k === SSR_MASK_HOOK)).toHaveLength(1);
  });
  it('falls back without float colour buffers: probe and planar reflections stay', () => {
    const h = host({ float: false });
    h.configure('ultra');
    expect(h.ultra.ssr.supported).toBe(false);
    expect(h.ultra.ssr.active).toBe(false);
    expect(h.wetReflection.enabled).toBe(true);
    expect(studioHookKeys(h.roadMaterial)).not.toContain(SSR_MASK_HOOK);
    expect(h.ultra.diagnostics().unsupported.join()).toMatch(/ssr/);
  });
  it('limits the near map to the device and applies the tone mapper choice', () => {
    const h = host({ maxTexture: 2048 });
    expect(h.configure('ultra').shadowSize).toBe(2048);
    h.configure('ultra', { ...graphicsPreset('ultra'), toneMapper: 'agx' });
    expect(h.renderer.toneMapping).toBe(T.AgXToneMapping);
    h.configure('ultra', { ...graphicsPreset('ultra'), toneMapper: 'neutral' });
    expect(h.renderer.toneMapping).toBe(TONE_MAPPING.neutral);
  });
  it('focuses the replay lens only on recorded broadcast and chase views', () => {
    const h = host();
    h.configure('ultra');
    h.frame({ replay: false });
    expect(h.ultra.replayLens.pass.enabled).toBe(false);
    h.frame({ replay: true, cameraMode: 'trackside' });
    expect(h.ultra.replayLens.pass.enabled).toBe(true);
    const u = h.ultra.replayLens.pass.materialBokeh.uniforms;
    expect(u.focus.value).toBeCloseTo(h.camera.position.distanceTo(new T.Vector3(0, 0.6, 0)), 0);
    expect(u.lensK.value).toBeGreaterThan(0);
    h.frame({ replay: true, cameraMode: 'cockpit' });
    expect(h.ultra.replayLens.pass.enabled).toBe(false);
    h.frame({ replay: true, otherDof: true });
    expect(h.ultra.replayLens.pass.enabled).toBe(false);
    h.frame({ replay: true, photo: true });
    expect(h.ultra.replayLens.pass.enabled).toBe(false);
  });
  it('sharpens only frames the temporal resolve ran', () => {
    const h = host();
    h.configure('ultra');
    expect(h.ultra.sharpen.enabled).toBe(false);
    expect(h.scenePass.temporal.begin(h.camera, true, 1 / 60)).toBe(true);
    expect(h.ultra.sharpen.enabled).toBe(true);
    h.scenePass.temporal.end(h.camera);
    expect(h.scenePass.temporal.begin(h.camera, true, 0)).toBe(false);
    expect(h.ultra.sharpen.enabled).toBe(false);
    h.configure('ultra', { ...graphicsPreset('ultra'), taaSharpen: 0 });
    h.scenePass.temporal.begin(h.camera, true, 1 / 60);
    expect(h.ultra.sharpen.enabled).toBe(false);
    h.scenePass.temporal.end(h.camera);
  });
  it('sun shafts follow the lighting, weather and menu', () => {
    const h = host();
    h.configure('ultra');
    // Look straight at the sunset sun.
    const sun = lightingDirection('sunset').clone().normalize();
    h.camera.position.set(0, 1, 0);
    h.camera.lookAt(h.camera.position.clone().add(sun));
    h.camera.updateMatrixWorld(true);
    h.presented[H.CLOUD] = 0.3;
    h.frame();
    expect(h.ultra.shafts.enabled).toBe(true);
    h.frame({ lighting: 'night' });
    expect(h.ultra.shafts.enabled).toBe(false);
    h.frame({ menu: true });
    expect(h.ultra.shafts.enabled).toBe(false);
    h.frame({ studio: true });
    expect(h.ultra.shafts.enabled).toBe(false);
  });
});

describe('scene-pass stages', () => {
  it('runs the SSR stage between the scene draw and the resolve, encoding the mask only during the main draw', () => {
    const encodeDuringScene: number[] = [];
    let scene: T.Scene | null = null;
    const h = host({
      onRender: (object) => {
        if (object === scene) encodeDuringScene.push(ssrMaskUniforms.apexSsrEncode.value);
      },
    });
    scene = h.scene;
    h.configure('ultra');
    h.scenePass.setSize(64, 36);
    h.frame();
    studioUniforms.studioFrameDt.value = 1 / 60;
    const before = h.ultra.ssr.frames;
    h.scenePass.render(h.renderer, new T.WebGLRenderTarget(4, 4));
    expect(encodeDuringScene).toEqual([1]);
    expect(ssrMaskUniforms.apexSsrEncode.value).toBe(0);
    expect(h.ultra.ssr.frames).toBe(before + 1);
    // Off: no encode and no stage work.
    h.configure('high');
    h.scenePass.render(h.renderer, new T.WebGLRenderTarget(4, 4));
    expect(encodeDuringScene).toEqual([1, 0]);
    expect(h.ultra.ssr.frames).toBe(before + 1);
    studioUniforms.studioFrameDt.value = 0;
  });
  it('accumulates AO only on advancing frames and rotates its noise then', () => {
    const h = host();
    h.configure('ultra');
    h.scenePass.setSize(64, 36);
    const offset = new T.Vector2();
    expect(h.ultra.ao.noiseOffset(false, offset).toArray()).toEqual([0, 0]);
    expect(h.ultra.ao.noiseOffset(true, offset).lengthSq()).toBeGreaterThan(0);
    studioUniforms.studioFrameDt.value = 1 / 60;
    h.scenePass.render(h.renderer, new T.WebGLRenderTarget(4, 4));
    h.scenePass.render(h.renderer, new T.WebGLRenderTarget(4, 4));
    expect(h.ultra.ao.diagnostics().historyValid).toBe(true);
    studioUniforms.studioFrameDt.value = 0;
    h.scenePass.render(h.renderer, new T.WebGLRenderTarget(4, 4));
    expect(h.ultra.ao.diagnostics().historyValid).toBe(false);
  });
});

describe('mid shadow cascade', () => {
  it('patches the far-shadow chunks only inside three-shadow-light guards', () => {
    const { lightsBegin, shadowPars } = midCascadeChunks(
      T.ShaderChunk.lights_fragment_begin,
      T.ShaderChunk.shadowmap_pars_fragment,
    );
    expect(lightsBegin).toContain('apexMidShadow(');
    expect(shadowPars).toContain('#define APEX_FAR_HANDOVER vDirectionalShadowCoord[ 0 ]');
    // Removing the guarded blocks and expanding the two-light macro restores the original.
    const stripped = lightsBegin
      .replace(
        /\t\t#if defined\( USE_SHADOWMAP \) && NUM_DIR_LIGHT_SHADOWS > 2[^\n]*\n[\s\S]*?\t\t#endif\n/g,
        '',
      )
      .replace('APEX_FAR_HANDOVER', 'vDirectionalShadowCoord[ 0 ]');
    expect(stripped).toBe(T.ShaderChunk.lights_fragment_begin);
    expect(midCascadeChunks(lightsBegin, shadowPars).lightsBegin).toBe(lightsBegin);
    expect(() => midCascadeChunks('void main() {}', shadowPars)).toThrow('far-shadow');
  });
  it('snaps to its texel grid, refreshes on cadence and shades only after a rendered map', () => {
    const mid = new MidCascade(1024);
    const camera = new T.PerspectiveCamera(50, 1.6, 0.1, 1000);
    camera.position.set(0, 2, 8);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    mid.setEnabled(true, true);
    expect(mid.light.visible).toBe(true);
    expect(mid.active).toBe(false);
    const frame = (x: number, advancing: boolean) => ({
      subject: new T.Vector3(x, 0, 0),
      camera,
      lighting: 'day' as const,
      nearHalfExtent: 38,
      nearSize: 4096,
      farWidth: 1800,
      farSize: 4096,
      advancing,
      cut: false,
    });
    expect(mid.prepare(frame(0, true))).toBe(true);
    const anchor = mid.light.target.position.clone();
    // A consumed request with a map marks the light for the sun's lookup.
    mid.light.shadow.needsUpdate = false;
    mid.light.shadow.map = new T.WebGLRenderTarget(1, 1);
    mid.afterFrame();
    expect(mid.active).toBe(true);
    expect(mid.light.shadow.intensity).toBe(MID_SHADOW_MARK);
    // Sub-texel motion keeps the same light-space grid position.
    const texel = (2 * mid.halfExtent) / 1024;
    mid.prepare(frame(texel * 0.2, true));
    expect(mid.light.target.position.distanceTo(anchor)).toBeLessThan(texel * 1.01);
    // Cadence: of N advancing frames about N / cadence request a refresh.
    let requests = 0;
    for (let i = 0; i < 12; i++) {
      mid.light.shadow.needsUpdate = false;
      if (mid.prepare(frame(0, true))) requests++;
      mid.afterFrame();
    }
    expect(requests).toBe(12 / CASCADES.cadence);
    // Held frames never refresh.
    mid.light.shadow.needsUpdate = false;
    expect(mid.prepare(frame(0, false))).toBe(false);
    mid.setEnabled(false, true);
    expect(mid.light.visible).toBe(false);
    expect(mid.active).toBe(false);
  });
});

describe('post-lens modules', () => {
  it('energy-conserving bloom has no threshold and blends with a constant share', () => {
    const { renderer } = mockRenderer();
    const bloom = new LensBloomPass();
    bloom.setSize(64, 36);
    const read = new T.WebGLRenderTarget(64, 36);
    type Internals = { prefilter: T.ShaderMaterial; composite: T.ShaderMaterial };
    const { prefilter, composite } = bloom as unknown as Internals;
    bloom.render(renderer, read, read);
    expect(prefilter.uniforms.shape.value.x).toBe(LENS_BLOOM.threshold);
    expect(composite.blendDst).toBe(T.OneFactor);
    bloom.energyConserving = true;
    bloom.render(renderer, read, read);
    expect(prefilter.uniforms.shape.value.x).toBe(0);
    expect(composite.blendDst).toBe(T.OneMinusConstantAlphaFactor);
    expect(composite.blendAlpha).toBe(PHYSICAL_BLOOM.mix);
    expect(composite.uniforms.gain.value).toBeCloseTo(PHYSICAL_BLOOM.mix / bloom.normalization, 12);
    bloom.energyConserving = false;
    bloom.render(renderer, read, read);
    expect(composite.blendDst).toBe(T.OneFactor);
    expect(prefilter.uniforms.shape.value.y).toBe(LENS_BLOOM.knee);
  });
  it('adds restrained fringe to gameplay grades only', () => {
    const grade = new BroadcastGradePass();
    type Internals = { material: T.ShaderMaterial };
    const u = (grade as unknown as Internals).material.uniforms;
    grade.apply('day');
    expect(u.fringe.value).toBe(GRADE_PROFILES.day.fringe);
    grade.lensFringe = ULTRA_FRINGE;
    grade.apply('day');
    expect(u.fringe.value).toBeCloseTo(GRADE_PROFILES.day.fringe + ULTRA_FRINGE, 12);
    grade.photoOverride = { ...GRADE_PROFILES.studio, fringe: 0.01 };
    grade.apply('day');
    expect(u.fringe.value).toBe(0.01);
  });
  it('builds the thin-lens bokeh variant without changing the retained depth of field', () => {
    const camera = new T.PerspectiveCamera();
    const depth = new T.DepthTexture(4, 4);
    const retained = new DepthOfFieldPass(
      camera,
      { focus: 10, aperture: 0.001, maxblur: 0.01 },
      depth,
    );
    const lens = new DepthOfFieldPass(camera, { focus: 10, aperture: 0, maxblur: 0.01 }, depth, {
      thinLens: true,
      taps: 48,
    });
    expect(retained.materialBokeh.fragmentShader).toContain('(depth - focus) * aperture');
    expect(retained.materialBokeh.fragmentShader).not.toContain('lensK');
    expect(lens.materialBokeh.fragmentShader).toContain('lensK * (1.0 - focus / max(depth, 1e-3))');
    expect(lens.materialBokeh.fragmentShader).toContain('i < 48');
    expect(
      () => new DepthOfFieldPass(camera, { focus: 1, aperture: 0, maxblur: 0 }, depth, { taps: 4 }),
    ).toThrow();
  });
});

describe('pass ledger', () => {
  it('attributes draws to ULTRA passes and reports none without GPU timestamps', () => {
    const info = { calls: 0, triangles: 0 };
    const ledger = new PassLedger(info, new GpuPassTimer(null));
    ledger.measure('ssr', () => {
      info.calls += 8;
      info.triangles += 8;
    });
    ledger.estimate('ssr', 7.5e6);
    ledger.idle('lightShafts');
    const snapshot = ledger.snapshot();
    expect(snapshot.ssr).toEqual({ calls: 8, triangles: 8, frames: 1, gpuMs: null, fetchesM: 7.5 });
    expect(snapshot.lightShafts.calls).toBe(0);
  });
  it('reads asynchronous GPU timestamps where the browser exposes them', () => {
    const results = new Map<object, number>();
    let clock = 1000;
    const ext = {
      TIMESTAMP_EXT: 1,
      QUERY_COUNTER_BITS_EXT: 2,
      GPU_DISJOINT_EXT: 3,
      queryCounterEXT: (query: object) => {
        clock += 1.5e6;
        results.set(query, clock);
      },
    };
    const gl = {
      QUERY_RESULT_AVAILABLE: 10,
      QUERY_RESULT: 11,
      getExtension: () => ext,
      getQuery: () => 64,
      createQuery: () => ({}),
      deleteQuery: () => {},
      getParameter: () => false,
      isContextLost: () => false,
      getQueryParameter: (query: object, name: number) => (name === 10 ? true : results.get(query)),
    } as unknown as WebGL2RenderingContext;
    const timer = new GpuPassTimer(gl);
    expect(timer.supported).toBe(true);
    const info = { calls: 0, triangles: 0 };
    const ledger = new PassLedger(info, timer);
    ledger.measure('aoTemporal', () => {});
    ledger.poll();
    expect(ledger.snapshot().aoTemporal.gpuMs).toBeCloseTo(1.5, 9);
  });
});
