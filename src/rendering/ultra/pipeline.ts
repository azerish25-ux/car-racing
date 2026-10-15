import * as T from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { BroadcastGradePass } from '../broadcast-grade.ts';
import { lightingDirection, type LightingMode } from '../daylight.ts';
import type { FarShadow } from '../far-shadow.ts';
import type { LensBloomPass } from '../lens-bloom.ts';
import { physicalBloomMix } from '../lens-bloom.ts';
import { prepareMaterials, materialDiagnostics, setSurfaceWeather } from '../materials/library.ts';
import {
  detailTier,
  type GraphicsOptions,
  type QualityPreset,
  type ToneMapper,
} from '../options.ts';
import type { SceneAmbientPass } from '../scene-ambient-pass.ts';
import { surfaceDampness } from '../weather-presentation.ts';
import { iblUniforms } from '../studio/ibl-energy.ts';
import type { WetRoadReflection } from '../wet-reflection.ts';
import { H } from '../../simulation/protocol.ts';
import { AO_TEMPORAL, TemporalObscurance } from './ao-temporal.ts';
import { MidCascade } from './cascades.ts';
import {
  deviceGraphics,
  probeCapabilities,
  unsupportedModules,
  type UltraCapabilities,
} from './capabilities.ts';
import { LightShaftsPass, shaftStrength } from './light-shafts.ts';
import { GpuPassTimer, PassLedger, instrumentRender } from './pass-ledger.ts';
import { ReplayLens } from './replay-lens.ts';
import { ScreenSpaceReflections, HIZ, SSR } from './ssr.ts';
import { installSsrMask } from './ssr-mask.ts';
import { TaaSharpenPass } from './taa-sharpen.ts';

/** Display transforms by setting (three 0.180 operators). */
export const TONE_MAPPING: Readonly<Record<ToneMapper, T.ToneMapping>> = Object.freeze({
  aces: T.ACESFilmicToneMapping,
  agx: T.AgXToneMapping,
  neutral: T.NeutralToneMapping,
});
/** Restrained lateral chromatic aberration (grade `fringe` units: about two
 * pixels of red/blue separation in a 1080p corner, none at the centre). */
export const ULTRA_FRINGE = 0.0012;

export interface UltraHost {
  renderer: T.WebGLRenderer;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  composer: EffectComposer;
  scenePass: SceneAmbientPass;
  bloom: LensBloomPass;
  grade: BroadcastGradePass;
  sun: T.DirectionalLight;
  farShadow: FarShadow;
  wetReflection: WetRoadReflection;
  roadMaterial: T.Material;
}
export interface UltraFrame {
  presented: Float32Array;
  cars: readonly { reflectivePaint: readonly T.Material[] }[];
  /** Followed subject (near shadow anchor, replay focus). */
  subject: T.Vector3;
  cameraMode: string;
  lighting: LightingMode;
  studio: boolean;
  menu: boolean;
  photo: boolean;
  replay: boolean;
  /** Another depth of field owns this frame (photo, showroom, telephoto, grid). */
  otherDof: boolean;
  /** View cut or seek this frame. */
  cut: boolean;
}

/**
 * The ULTRA rendering modules, inserted into the retained pipeline without
 * restructuring it:
 *
 *   scene pass: [scene draw] -> SSR stage -> TAA resolve -> GTAO (+temporal) -> composite
 *   composer:   scene -> (DOF) -> replay DOF -> exposure -> sun shafts -> bloom
 *               (threshold | energy-conserving) -> output (ACES | AgX | Neutral)
 *               -> CAS sharpen -> FXAA -> grade (+ restrained fringe)
 *   shadows:    near (4096 at ULTRA) -> mid cascade -> far (baked)
 *
 * Every module is gated by its own graphics option and by device capability;
 * all are off on Low/Medium/High, where this object only bakes shared
 * material-library textures and reports diagnostics.
 */
export class UltraPipeline {
  readonly capabilities: UltraCapabilities;
  readonly ssr: ScreenSpaceReflections;
  readonly ao = new TemporalObscurance();
  readonly sharpen = new TaaSharpenPass();
  readonly shafts: LightShaftsPass;
  readonly replayLens: ReplayLens;
  readonly mid = new MidCascade();
  readonly ledger: PassLedger;
  private readonly timer: GpuPassTimer;
  private graphics: GraphicsOptions | null = null;
  private preset: QualityPreset = 'medium';
  private sharpenWanted = false;
  private ssrInstalled = false;
  private readonly patched = new WeakSet<T.Material>();
  private readonly sunDirection = new T.Vector3();
  private readonly size = new T.Vector2();
  private disposed = false;
  constructor(private readonly host: UltraHost) {
    const { renderer, scene, camera, composer, scenePass } = host;
    this.capabilities = probeCapabilities(renderer);
    this.timer = new GpuPassTimer(renderer.getContext() as WebGL2RenderingContext);
    this.ledger = new PassLedger(renderer.info.render, this.timer);
    this.ssr = new ScreenSpaceReflections(this.capabilities.floatColorBuffer);
    this.ssr.bindScene(scene);
    instrumentRender(this.ssr, 'ssr', this.ledger);
    instrumentRender(this.ao, 'aoTemporal', this.ledger);
    scenePass.addSceneStage(this.ssr);
    this.shafts = new LightShaftsPass(camera, () => scenePass.target.depthTexture);
    this.replayLens = new ReplayLens(camera, scenePass.target.depthTexture!);
    instrumentRender(this.shafts, 'lightShafts', this.ledger);
    instrumentRender(this.replayLens.pass, 'replayDof', this.ledger);
    instrumentRender(this.sharpen, 'taaSharpen', this.ledger);
    // The sharpen pass runs only on frames the temporal resolve ran: decided
    // when the composer reaches it, after the scene pass of the same frame.
    const sharpen = this.sharpen;
    Object.defineProperty(sharpen, 'enabled', {
      configurable: true,
      get: () => this.sharpenWanted && scenePass.temporal.resolving,
      set: () => {},
    });
    const passes = composer.passes;
    // Replay DOF directly after the scene pass (photo DOF inserts itself at 1 too).
    composer.insertPass(this.replayLens.pass, 1);
    composer.insertPass(this.shafts, Math.max(1, passes.indexOf(host.bloom)));
    const output = passes.findIndex((p) => p instanceof OutputPass);
    composer.insertPass(sharpen, output >= 0 ? output + 1 : passes.length);
    // Third shadowed directional light: after the sun and the far light.
    scene.add(this.mid.light, this.mid.light.target);
  }
  /** Device-limited options (renderer.setQuality applies them). */
  deviceGraphics(graphics: GraphicsOptions) {
    return deviceGraphics(graphics, this.capabilities);
  }
  /** Called at the end of renderer.setQuality with the applied options. */
  configure(preset: QualityPreset, graphics: GraphicsOptions) {
    if (this.disposed) return;
    this.preset = preset;
    this.graphics = graphics;
    const { renderer, scenePass, bloom, wetReflection } = this.host;
    renderer.toneMapping = TONE_MAPPING[graphics.toneMapper];
    this.sharpen.strength = graphics.taaSharpen;
    this.sharpenWanted = graphics.temporalAA && graphics.taaSharpen > 0;
    this.ssr.enabled = graphics.ssr;
    if (this.ssr.enabled && this.ssr.supported) {
      if (!this.ssrInstalled) this.patch(this.host.roadMaterial);
      this.ssrInstalled = true;
      // SSR resolves the wet road from the frame itself (every visible object,
      // ripples, roughness); the planar wet pass would reflect it twice.
      wetReflection.setQuality('low');
    }
    const ao = graphics.aoTemporal && graphics.ambientOcclusion;
    this.ao.enabled = ao;
    scenePass.setSliceOverride(ao ? AO_TEMPORAL.slices : null);
    scenePass.setObscuranceStage(ao ? this.ao : null);
    bloom.energyConserving = graphics.physicalBloom;
    this.shafts.wanted = graphics.lightShafts;
    this.mid.setEnabled(
      graphics.shadowCascades === 3 && graphics.shadowSize > 0,
      this.shadowsReady(),
    );
  }
  private shadowsReady() {
    return (
      this.host.renderer.shadowMap.enabled && this.host.sun.castShadow && this.host.farShadow.baked
    );
  }
  private patch(material: T.Material) {
    if (this.patched.has(material)) return;
    this.patched.add(material);
    installSsrMask(material);
  }
  /** Per frame, immediately before the composer renders. */
  prepareFrame(frame: UltraFrame) {
    if (this.disposed) return;
    // Shared library textures bake on every preset (a no-op when none pend).
    prepareMaterials(this.host.renderer);
    const p = frame.presented;
    const rain = p[H.RAIN],
      water = p[H.WATER];
    const wet = Number.isFinite(rain) && Number.isFinite(water) ? surfaceDampness(rain, water) : 0;
    const rain01 = Number.isFinite(rain) ? Math.min(1, Math.max(0, rain / 18)) : 0;
    setSurfaceWeather(frame.studio ? 0 : wet, frame.studio ? 0 : rain01);
    const g = this.graphics;
    if (!g) return;
    const { camera, grade, bloom } = this.host;
    // Screen-space reflections: opted-in materials appear with their cars.
    if (this.ssr.enabled && this.ssr.supported)
      for (const car of frame.cars) for (const m of car.reflectivePaint) this.patch(m);
    this.ssr.rain = frame.studio ? 0 : rain01;
    this.ssr.prepare(true);
    // The road and the followed car share the local probe while it owns them.
    const road = this.host.roadMaterial as T.MeshStandardMaterial;
    const probe = road.envMap && (road.envMap as T.CubeTexture).isCubeTexture ? road.envMap : null;
    this.ssr.environment.probe = probe;
    this.ssr.environment.skyScale =
      (this.host.scene.environmentIntensity ?? 1) * iblUniforms.apexSpecularIBL.value;
    // Static fetch estimates (upper bounds) at the current drawing-buffer size.
    const size = this.host.renderer.getDrawingBufferSize(this.size);
    const full = size.x * size.y,
      half = full / 4;
    if (this.ssr.active)
      this.ledger.estimate('ssr', half * 9 * 1.33 + half * (8 + SSR.maxIterations) + full * 14);
    else this.ledger.idle('ssr');
    if (!this.ao.enabled) this.ledger.idle('aoTemporal');
    else this.ledger.estimate('aoTemporal', half * 11);
    // Lens: restrained fringe on live and replay views only.
    grade.lensFringe =
      g.chromaticAberration && !frame.menu && !frame.photo && !frame.studio ? ULTRA_FRINGE : 0;
    bloom.energyMix = physicalBloomMix(frame.studio ? 'day' : frame.lighting, wet);
    // Sun shafts.
    this.sunDirection.copy(lightingDirection(frame.lighting));
    const mode = frame.studio ? 'studio' : frame.lighting;
    this.shafts.prepare(
      this.sunDirection,
      frame.menu ? 0 : shaftStrength(mode, p[H.CLOUD], rain01),
    );
    if (!this.shafts.enabled) this.ledger.idle('lightShafts');
    else this.ledger.estimate('lightShafts', (full / 16) * (4 + 48) + full);
    // Replay depth of field on broadcast and chase views.
    const replayDof =
      g.replayDof &&
      frame.replay &&
      !frame.photo &&
      !frame.menu &&
      !frame.otherDof &&
      (frame.cameraMode === 'trackside' || frame.cameraMode === 'chase');
    if (!this.replayLens.update(replayDof, frame.subject)) this.ledger.idle('replayDof');
    if (!this.sharpenWanted) this.ledger.idle('taaSharpen');
    // Shadow cascades.
    const sun = this.host.sun;
    this.mid.setEnabled(g.shadowCascades === 3 && g.shadowSize > 0, this.shadowsReady());
    this.mid.prepare({
      subject: frame.subject,
      camera,
      lighting: frame.lighting,
      nearHalfExtent: sun.shadow.camera.right,
      nearSize: sun.shadow.mapSize.x,
      farWidth: this.farWidth(),
      farSize: this.host.farShadow.light.shadow.mapSize.x,
      advancing: !frame.menu && !frame.photo && p[H.TIME] !== this.lastTime,
      cut: frame.cut,
    });
    this.lastTime = p[H.TIME];
  }
  private lastTime = NaN;
  private farWidth() {
    const c = this.host.farShadow.light.shadow.camera;
    return Math.max(1, c.right - c.left, c.top - c.bottom);
  }
  /** Per frame, after the composer rendered. */
  afterFrame() {
    if (this.disposed) return;
    this.mid.afterFrame();
    this.ledger.poll();
  }
  diagnostics() {
    const g = this.graphics;
    return {
      preset: this.preset,
      tier: detailTier(this.preset),
      capabilities: { ...this.capabilities },
      unsupported: g ? unsupportedModules(g, this.capabilities) : [],
      toneMapper: g?.toneMapper ?? 'aces',
      gpuPassTimestamps: this.timer.supported,
      passes: this.ledger.snapshot(),
      ssr: this.ssr.diagnostics(),
      hizLevels: HIZ.levels,
      aoTemporal: this.ao.diagnostics(),
      taaSharpen: {
        wanted: this.sharpenWanted,
        strength: this.sharpen.strength,
        frames: this.sharpen.frames,
      },
      physicalBloom: { enabled: this.host.bloom.energyConserving, mix: this.host.bloom.energyMix },
      chromaticAberration: this.host.grade.lensFringe,
      lightShafts: this.shafts.diagnostics(),
      replayDof: this.replayLens.diagnostics(),
      shadowCascades: {
        count: this.mid.active ? 3 : 2,
        near: {
          mapSize: this.host.sun.shadow.mapSize.x,
          halfExtent: this.host.sun.shadow.camera.right,
        },
        mid: this.mid.diagnostics(),
        far: this.host.farShadow.diagnostics(),
      },
      materials: materialDiagnostics(),
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ssr.dispose();
    this.ao.dispose();
    this.sharpen.dispose();
    this.shafts.dispose();
    this.replayLens.dispose();
    this.mid.dispose();
    this.timer.dispose();
  }
}
