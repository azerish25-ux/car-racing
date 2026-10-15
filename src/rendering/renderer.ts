import { loadAurelQuarry } from './aurel-quarry.ts';
import { loadAurelVegetation } from './aurel-vegetation.ts';
import { loadTrackSignalHardware } from './track-signal-hardware.ts';
import { loadTrackBoards } from './track-boards.ts';
import { loadBroadcastCameras } from './broadcast-cameras.ts';
import { loadConcreteBarriers } from './concrete-barriers.ts';
import { loadSteelGuardrails } from './steel-guardrails.ts';
import { loadCatchFence } from './catch-fence.ts';
import { loadImpactBarriers } from './impact-barriers.ts';
import { loadRecoveryGates } from './recovery-gates.ts';
import { loadMarshalPosts } from './marshal-posts.ts';
import { loadStartGantry } from './start-gantry.ts';
import { loadRivalLevels, type RivalLevels } from './a61-rival.ts';
import { GridPresentationView } from './grid-presentation-view.ts';
import { gridBroadcastShot, gridShot } from './grid-broadcast.ts';
import { cockpitEye, cockpitDirection, cockpitFov, tcamFov } from './cockpit-framing.ts';
import { loadPitJacks } from './a32-pit-jacks.ts';
import { measurePitJackFits } from './a32-jack-contact.ts';
import { loadWheelGuns, WheelGunStorage } from './wheel-gun.ts';
import { measureWheelGunFits } from './wheel-gun-contact.ts';
import { loadPitBuildingFrontage } from './pit-building-frontage.ts';
import {
  loadTyreEquipment,
  installTyreEquipment,
  type TyreEquipmentKit,
} from './tyre-trolleys-racks.ts';
import { loadPitWallStation } from './pit-wall-station.ts';
import { loadHeroGarage } from './hero-garage.ts';
import { loadTyreBlankets } from './tyre-blankets.ts';
import { compileSceneTarget, PreparationTrace } from './preparation.ts';
import { warmPitMaterials } from './pit-material-warmup.ts';
import { frontToBackOpaque } from './opaque-order.ts';
import { loadSuppliedPlayer, type SuppliedPlayerAsset } from './supplied-player.ts';
import { detailDistance, feedDetailDistance } from './view-detail.ts';
import { readRaceReviewFrame } from './race-review.ts';
import { GhostCar } from './ghost-car.ts';
import { SafetyCarView } from './studio/safety-car.ts';
import { LightPools } from './studio/light-pools.ts';
import { setBrandLedLighting } from './studio/trackside-branding.ts';
import { setAerialExtinction } from './studio/aerial-perspective.ts';
import { MENU_CAR_DATUM, SHOWROOM } from './menu-preview.ts';
import { focusOnSubject, subjectLens, type SubjectLens } from './studio/subject-focus.ts';
import { reflectInWetRoad } from './wet-reflection.ts';
import { ghostPose, type GhostPose } from '../core/ghost-lap.ts';
import { WeatherPresentation } from './weather-presentation.ts';
import { applyCircuitLightPalette } from './lighting-coherence.ts';
import { installSpecularIBL, setIblEnergy } from './studio/ibl-energy.ts';
import { PEOPLE_ASSET } from './people-asset.ts';
import { loadDriverAsset, type DriverAsset } from './driver-asset.ts';
import { loadHeroShells, type HeroShells } from './hero-shells.ts';
import { AdaptiveExposurePass } from './adaptive-exposure.ts';
import { METER_KEY } from './exposure-meter.ts';
import { LensBloomPass } from './lens-bloom.ts';
import { postLensFrame } from './studio/lens-effects.ts';
import { LocalAtmosphere } from './local-atmosphere.ts';
import { RaceComposition } from './race-composition.ts';
import { captureRenderedCanvas } from './frame-capture.ts';
import { reviewHardware } from '../ui/review-hardware.ts';
import type { ReviewFrame } from './presentation-review.ts';
import { photoSubject } from './photo-subject.ts';
import { HeadquartersStage } from './headquarters-stage.ts';
import { DepthOfFieldPass } from './studio/dof-pass.ts';
import { GeometrySurvey } from './geometry-survey.ts';
import { DrivingGuide } from './driving-guide.ts';
import { GridPreparationView } from './grid-preparation.ts';
import { PhotoStage, ScenePresentationScope } from './photo-stage.ts';
import { VenueLighting } from './venue-lighting.ts';
import {
  photoGrade,
  photoLens,
  photoFov,
  photoOffset,
  validatePhoto,
  type PhotoSettings,
} from './photo-camera.ts';
import { type Livery } from '../storage/livery.ts';
import {
  configureSky,
  circuitLightState,
  shadowAnchor,
  SkyEnvironment,
  SUN_OFFSET,
  bindSkyCelestial,
  lightingDirection,
  lightingMode,
  type LightingMode,
} from './daylight.ts';
import { prewarmSky, skySunKey } from './sky-light.ts';
import { SKY_CLOUDS, SkyClouds } from './studio/sky-clouds.ts';
import { EngineeringView } from './engineering-view.ts';
import type { EngineeringSample } from '../workers/diagnostics.ts';
import * as T from 'three';
import type { FrameMetrics } from '../core/performance.ts';
import type { BuildProgress } from './build-queue.ts';
import { TracksideDirector } from './trackside.ts';
import { CameraClock, InertialCamera, ViewOrientation } from './camera-dynamics.ts';
import { ReflectionSystem } from './reflections.ts';
import { ShadowProxies } from './shadow-proxies.ts';
import { FarShadow } from './far-shadow.ts';
import { sunPenumbraScale } from './studio/shadow-filter.ts';
import { DebrisView } from './debris.ts';
import { PitCrewView, serviceWheelOffset } from './pit-crew.ts';
import { MotionBlur } from './motion-blur.ts';
import { GpuTimer } from './gpu-timer.ts';
import { GpuFrameGate } from './gpu-frame-gate.ts';
import { TextureBudget } from './texture-budget.ts';
import {
  graphicsPreset,
  validateGraphics,
  bufferSize,
  detailTier,
  type GraphicsOptions,
  type Quality,
  type QualityPreset,
} from './options.ts';
import { UltraPipeline } from './ultra/pipeline.ts';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { SceneAmbientPass } from './scene-ambient-pass.ts';
import { BroadcastGradePass, GRADE_PROFILES } from './broadcast-grade.ts';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FormulaCar } from './car.ts';
import { carLod } from './lod.ts';
import { attachDrawLedger, type DrawLedger } from './draw-ledger.ts';
import { installSpecularAntialiasing } from './specular-aa.ts';
import { renderCensus, cubeCensusCameras, mergeCensus } from './render-census.ts';
import { CircuitScene } from './circuit.ts';
import { Effects } from './effects.ts';
import { PresentedFrame } from './frame-state.ts';
import { StudioFrame } from './studio/studio-frame.ts';
import { EffectPlayback } from './effect-playback.ts';
import { AudioViewTracker } from '../audio/spatial.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { CAR_STRIDE, F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';
import { VehicleBodies } from './vehicle-bodies/index.ts';
import { BIKE_CHASE_ROLL, BikeShells } from './bike.ts';
export type CameraMode = 'chase' | 'cockpit' | 'pod' | 'trackside';
/** Chase rig in metres, m/s and vertical-FOV degrees. */
// P5 retuned to its own target (KPI 10 iteration): 1.65 m / 4.9 m framed the
// car at 31 % of the width, low in the frame. PSQ036 (the primary reference)
// needs a 1.3 m eye 4.5 m back, pitched about 4 degrees down: rear tyres at
// ~41 % of the width, the rear wing top at y ~0.59 and the horizon at ~0.42.
// At speed only the P5 +4 degree lens widens (the 0.0065 s pull-back left the
// car at 34.9 % of the width at 265 km/h, shots/qa-signoff-medium KPI 10).
export const CHASE = Object.freeze({
  height: 1.3,
  heightPerMS: 0.002,
  distance: 4.5,
  distancePerMS: 0,
  lookAhead: 10,
  lookLift: -0.25,
  fov: 50,
  fovGain: 4,
});
/** T-cam lift above the authored pod socket and its downward gaze slope (P7). */
export const TCAM_LIFT_M = 0.09;
export const TCAM_PITCH = -0.075;
/** Metres of planting, stands and buildings around the track in the far sun shadow. */
export const FAR_SHADOW_MARGIN_M = 150;
/** Local-probe cube faces rendered per frame by a periodic refresh. */
export const PROBE_FACES_PER_FRAME = 1;
export type { Quality } from './options.ts';
export class RacingRenderer {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(58, 1, 0.045, 7000);
  readonly circuit: CircuitScene;
  readonly cars: FormulaCar[] = [];
  readonly audioView = new AudioViewTracker();
  readonly effects = new Effects();
  readonly presented = new PresentedFrame();
  /** Procedural exteriors of non-Formula definitions (WP30). */
  readonly vehicleBodies = new VehicleBodies();
  /** Motorcycle entrants (WP34): procedural bikes and riders over the snapshot pose. */
  readonly bikeShells = new BikeShells();
  /** Accessibility master switch: no motion blur (camera vibration is set by the app). */
  reducedMotion = false;
  readonly studioFrame = new StudioFrame();
  /** Time Trial ghost, built on first use; posed from setGhost() each frame. */
  private ghost: GhostCar | null = null;
  private ghostPose: GhostPose = ghostPose();
  private ghostActive = false;
  private safetyCar: SafetyCarView | null = null;
  private safetyCarPose: GhostPose = ghostPose();
  private safetyCarActive = false;
  private readonly wetPlanePoint = trackPoint();
  readonly effectPlayback = new EffectPlayback(this.effects);
  readonly debris = new DebrisView();
  readonly pitCrew = new PitCrewView();
  readonly gridPreparation = new GridPreparationView();
  readonly gridPerformance = new GridPresentationView();
  gridPresentationTime: number | null = null;
  gridReducedMotion = false;
  /** Live pre-race broadcast shot (camera, lens and lower-third caption). */
  readonly gridShot = gridShot();
  private readonly gridFocus = new T.Vector3();
  private gridShotIndex = -1;
  gridPrepared = false;
  readonly photoStage = new PhotoStage();
  private headquarters: HeadquartersStage | null = null;
  private scenePresentation = new ScenePresentationScope(this.scene);
  private nightFog = new T.Color(0x111b2c);
  readonly guide: DrivingGuide;
  readonly venueLighting: VenueLighting;
  /** D28: lap-space floodlight pools and their visible pole rows. */
  readonly lightPools: LightPools;
  private lightingMode: LightingMode = 'day';
  get lighting(): LightingMode {
    return this.lightingMode;
  }
  set lighting(value: LightingMode) {
    this.lightingMode = lightingMode(value);
  }
  // Legacy inspection routes retain their boolean day/night contract.
  get night() {
    return this.lightingMode === 'night';
  }
  set night(value: boolean) {
    this.lightingMode = lightingMode(value);
  }
  colorblind = false;
  readonly sun = new T.DirectionalLight(0xfff0dc, 3.9);
  private hemisphere = new T.HemisphereLight(0x8fb6ea, 0x4a4237, 0.14);
  private sky = new Sky();
  private composer: EffectComposer;
  /** ULTRA modules (SSR, temporal AO, sharpening, shafts, cascades, replay lens). */
  readonly ultra: UltraPipeline;
  private exposure = new AdaptiveExposurePass();
  private atmosphere: LocalAtmosphere;
  private weatherPresentation = new WeatherPresentation();
  private composition = new RaceComposition();
  private bloom: LensBloomPass;
  private scenePass: SceneAmbientPass;
  private grade = new BroadcastGradePass();
  private photoFocus: DepthOfFieldPass | null = null;
  /** Trackside broadcast telephoto: a thin-lens pass (studio/subject-focus.ts). */
  private broadcastFocus: DepthOfFieldPass | null = null;
  private geometrySurvey: GeometrySurvey | null = null;
  private motionBlur: MotionBlur;
  private fxaa = new ShaderPass(FXAAShader);
  private textures = new TextureBudget();
  private drawLedger: DrawLedger;
  graphics: GraphicsOptions = graphicsPreset('medium');
  private renderWidth = 1;
  private renderHeight = 1;
  private environment: SkyEnvironment;
  private disposed = false;
  private heroShells: HeroShells | null = null;
  private rivalLevels: RivalLevels | null = null;
  private driverAsset: DriverAsset | null = null;
  private suppliedPlayerAsset: SuppliedPlayerAsset | null = null;
  tyreEquipment: TyreEquipmentKit | null = null;
  wheelGunStorage: WheelGunStorage | null = null;
  private target = new T.Vector3();
  private desired = new T.Vector3();
  private velocity = new T.Vector3();
  private gaze = new T.Vector3();
  private direction = new T.Vector3();
  private orbitTime = 0;
  private initialized = false;
  private trackside: TracksideDirector;
  mode: CameraMode = 'chase';
  photo: PhotoSettings | null = null;
  /** Detail tier of the preset (ULTRA draws High-tier scenery). */
  quality: Quality = 'medium';
  preset: QualityPreset = 'medium';
  shake = 0.35;
  lookX = 0;
  lookY = 0;
  fps = 60;
  frameMs = 16.7;
  renderMs = 0;
  private lastRenderCPUms = 0;
  debug = false;
  private follow = 0;
  private cameraClock = new CameraClock();
  private inertia = new InertialCamera();
  private viewOrientation = new ViewOrientation();
  private reflection = Object.assign(new ReflectionSystem(), {
    // Periodic probe refreshes render one cube face per frame (six frames
    // per refresh) instead of all six in one frame.
    probeFacesPerFrame: PROBE_FACES_PER_FRAME,
  });
  /** Rivals shown coarser for the current mirror pass, and each rival's last
   * mirror level (for hysteresis). */
  private mirrorDetailShown: FormulaCar[] = [];
  private mirrorLevels = new WeakMap<FormulaCar, number>();
  /** Merged depth-only casters for the cars' rigid parts (sun shadow pass). */
  private shadowProxies = new ShadowProxies();
  /** Static sun shadow map of the whole circuit, beyond the car-following one. */
  private farShadow = new FarShadow();
  private farShadowBounds = new T.Box3();
  /** Lighting (and LIVE sun key) the far shadow was baked for. */
  private farShadowBaked: string | null = null;
  /** Inputs of the baked far map besides the lighting: size and planting. */
  private farShadowInputs = '';
  private gpuTimer: GpuTimer;
  private gpuFrames: GpuFrameGate;
  private previousAnchor = new T.Vector3();
  private temporary = new T.Vector3();
  private chaseBasis = new T.Quaternion();
  private chaseEuler = new T.Euler();
  private eyeLocal = new T.Vector3();
  private reflectionMaterials: T.MeshStandardMaterial[][] = [];
  private reflectionFollow = -1;
  private probeHidden: T.Object3D[] = [];
  private mirrorHidden: T.Object3D[] = [];
  readonly engineeringView = new EngineeringView();
  engineering: EngineeringSample | null = null;
  replayView = false;
  // Requested mode changes on input; diagnostics describe a completed rendered
  // frame, so camera/listener data cannot claim two different views.
  private renderedMode: CameraMode | null = null;
  private frameSamples = new Float32Array(300);
  private sampleIndex = 0;
  private sampleCount = 0;
  constructor(
    readonly canvas: HTMLCanvasElement,
    track: Track,
    deferred = false,
  ) {
    // Before any material program compiles (idempotent, shared chunk).
    installSpecularAntialiasing();
    const context = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!context)
      throw new Error(
        'This browser or graphics driver does not provide WebGL2. Enable hardware acceleration, then reload.',
      );
    this.renderer = new T.WebGLRenderer({
      canvas,
      context,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.gpuTimer = new GpuTimer(context);
    this.drawLedger = attachDrawLedger(this.renderer);
    this.gpuFrames = new GpuFrameGate(context);
    this.atmosphere = new LocalAtmosphere(track);
    this.guide = new DrivingGuide(track);
    this.venueLighting = new VenueLighting(track);
    this.lightPools = new LightPools(track);
    this.scene.add(
      this.lightPools.root,
      this.guide.mesh,
      this.gridPreparation.root,
      this.gridPerformance.root,
      this.photoStage.root,
      this.venueLighting.root,
    );
    this.scene.add(this.debris.mesh, this.pitCrew.root, this.vehicleBodies.root);
    this.scene.add(this.bikeShells.root);
    // Catalogue bodies and bikes get the same material installers as the Formula cars.
    this.vehicleBodies.onBuild = this.bikeShells.install = (root) => {
      this.textures.register(root);
      reflectInWetRoad(root);
      this.weatherPresentation.install(root);
      this.atmosphere.install(root);
      installSpecularIBL(root);
    };
    this.textures.register(this.pitCrew.root);
    this.renderer.info.autoReset = false;
    this.renderer.setOpaqueSort(frontToBackOpaque);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.shadowProxies.install(this.renderer);
    this.shadowProxies.shadowSubstitutes = () => [
      ...this.circuit.crowdClusters.map((c) => c.shadowSubstitute()),
      ...this.circuit.startFinish.shadowSubstitutes(),
      ...this.vehicleBodies.shadowSubstitutes(),
    ];
    this.reflection.mirrorDetail = {
      before: (camera, height) => this.showMirrorDetail(camera, height),
      after: () => this.restoreMirrorDetail(),
    };
    this.sky.scale.setScalar(450000);
    this.sky.userData.excludeMotionBlur = true;
    configureSky(this.sky);
    const clouds = SkyClouds.forSky(this.sky.material, lightingDirection);
    this.environment = new SkyEnvironment(this.sky, clouds);
    this.scene.add(this.sky);
    this.scene.environmentIntensity = 0.7;
    this.scene.fog = new T.FogExp2(0xb9c7c1, 0.00044);
    this.scene.add(this.hemisphere, this.sun, this.sun.target);
    // After the sun: shader patches read the far map as directional shadow 1.
    this.scene.add(this.farShadow.light, this.farShadow.light.target);
    // Three culls lights by camera layer too: the wet reflection needs them.
    for (const light of [this.hemisphere, this.sun, this.farShadow.light]) reflectInWetRoad(light);
    this.sun.position.copy(SUN_OFFSET);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -38,
      right: 38,
      top: 38,
      bottom: -38,
      near: 20,
      far: 500,
    });
    this.sun.shadow.bias = -0.000015;
    this.sun.shadow.normalBias = 0.008;
    // PCSS for the sun's 0.53° disc (studio/shadow-filter.ts reads it as radius).
    this.sun.shadow.radius = sunPenumbraScale(this.sun.shadow.camera);
    this.circuit = new CircuitScene(track, true);
    // Catalogue tunnels are sheltered: no rain is born under a roof (WP30).
    const kit = this.circuit.venueKit;
    if (kit) this.effects.sheltered = (x, z) => kit.covers(x, z);
    this.reflection.probeDetail = this.circuit.probeDetail;
    // The far map covers the circuit and the planting and stands around it.
    const point = trackPoint();
    for (let s = 0; s < track.length; s += 10) {
      track.at(s, point);
      this.farShadowBounds.expandByPoint(this.temporary.set(point.x, point.y, point.z));
    }
    this.farShadowBounds.min.y -= 20;
    this.farShadowBounds.max.y += 60;
    this.farShadowBounds.expandByVector(
      this.temporary.set(FAR_SHADOW_MARGIN_M, 0, FAR_SHADOW_MARGIN_M),
    );
    this.configureFarShadow();
    // Baked behind the loading screen, after every scenery task, so the first
    // menu or race frames never pay for it.
    this.circuit.construction.add('Far sun shadow', 9, () => this.bakeFarShadow(this.lighting));
    this.circuit.construction.add('Event hall broadcast bounds', 1, () =>
      this.venueLighting.registerSightlines(this.circuit.sightlines),
    );
    this.circuit.construction.add('Environment lighting', 1, () => {
      // Bake every haze level of the physical sky behind the loading screen.
      prewarmSky(this.lighting);
      this.environment.update(this.renderer, this.scene, 0);
    });
    // Bind after every static venue task and spatial batching; early binding
    // misses the district, grandstand, foliage and infrastructure materials.
    this.circuit.construction.add('Local weather materials', 5, () => {
      this.weatherPresentation.install(this.scene);
      this.atmosphere.install(this.scene);
      installSpecularIBL(this.scene);
    });
    this.trackside = new TracksideDirector(track, (from, to) =>
      this.circuit.sightlines.blocked(from, to),
    );
    this.scene.add(this.circuit.group, this.effects.group, this.engineeringView.group);

    this.composer = new EffectComposer(this.renderer);
    // One multisampled scene draw with a float depth attachment feeds contact
    // obscurance; it replaces RenderPass without a second geometry pass.
    this.scenePass = new SceneAmbientPass(this.scene, this.camera, this.graphics.msaa);
    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.exposure);
    // Motion blur and sun contact shadows run in the scene pass composite (no extra draw).
    this.motionBlur = new MotionBlur(this.renderer.extensions.has('EXT_color_buffer_float'));
    this.scenePass.attach(this.motionBlur, this.sun);
    // Linear-HDR threshold above sunlit white paint and smoke: only speculars,
    // lamps and the sun disc bloom, never road markings or diffuse volumes.
    // Single-pixel fireflies are limited before the round-filtered pyramid.
    this.bloom = new LensBloomPass();
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.fxaa);
    this.composer.addPass(this.grade);
    this.ultra = new UltraPipeline({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      composer: this.composer,
      scenePass: this.scenePass,
      bloom: this.bloom,
      grade: this.grade,
      sun: this.sun,
      farShadow: this.farShadow,
      wetReflection: this.circuit.wetReflection,
      roadMaterial: this.circuit.roadMaterial,
    });
    if (!deferred) {
      this.circuit.construction.runSynchronously();
      this.textures.register(this.circuit.group);
    }
    this.resize();
  }
  /** The factory owns partial resources until the complete scene is ready.
   * Cancellation disposes the partial scene; a failed job is never hidden. */
  static async create(
    canvas: HTMLCanvasElement,
    track: Track,
    progress: (value: BuildProgress) => void,
    cancelled: () => boolean,
    initial?: { quality: QualityPreset; graphics?: GraphicsOptions },
  ): Promise<RacingRenderer | null> {
    const renderer = new RacingRenderer(canvas, track, true);
    // Night venues open floodlit (a live sky, if enabled, still overrides).
    if (track.circuit.catalogue?.night) renderer.lighting = 'night';
    // The starting settings decide the far shadow map baked while loading;
    // applied later, a different map size would discard it and bake again on
    // the first rendered frame.
    if (initial) renderer.setQuality(initial.quality, initial.graphics);
    renderer.circuit.construction.add('Player car and live instruments', 1, () =>
      renderer.setCars(1),
    );
    try {
      progress({ completed: 0, total: 1, fraction: 0, label: 'Loading Blender-authored bodywork' });
      renderer.heroShells = await loadHeroShells(cancelled);
      renderer.rivalLevels = await loadRivalLevels(cancelled);
      renderer.driverAsset = await loadDriverAsset(cancelled);
      progress({
        completed: 0,
        total: 1,
        fraction: 0,
        label: 'Loading your RB19 car and R06 driver/cockpit',
      });
      renderer.suppliedPlayerAsset = await loadSuppliedPlayer(cancelled);
      progress({
        completed: 0,
        total: 1,
        fraction: 0,
        label: 'Loading authored Aurel working garage',
      });
      renderer.circuit.heroGarage = await loadHeroGarage(cancelled);
      progress({
        completed: 0,
        total: 1,
        fraction: 0,
        label: 'Loading A34 tyre blankets and controllers',
      });
      renderer.circuit.tyreBlankets = await loadTyreBlankets(cancelled);
      progress({
        completed: 0,
        total: 1,
        fraction: 0,
        label: 'Loading Aurel pit-wall command station',
      });
      renderer.circuit.pitWallStation = await loadPitWallStation(cancelled);
      // A35 owns its instancing/LODs outside destructive static prop batching.
      progress({ completed: 0, total: 1, fraction: 0, label: 'Loading Aurel tyre logistics' });
      renderer.tyreEquipment = await loadTyreEquipment(cancelled);
      installTyreEquipment(renderer.tyreEquipment, track);
      renderer.circuit.group.add(renderer.tyreEquipment.root);
      progress({ completed: 0, total: 1, fraction: 0, label: 'Loading A31 authored wheel guns' });
      renderer.pitCrew.installWheelGuns(await loadWheelGuns(cancelled));
      progress({ completed: 0, total: 1, fraction: 0, label: 'Loading A32 front and rear jacks' });
      renderer.pitCrew.installPitJacks(await loadPitJacks(cancelled));
      renderer.textures.register(renderer.pitCrew.root);
      renderer.wheelGunStorage = new WheelGunStorage(
        renderer.pitCrew.wheelGuns!.prototype,
        renderer.circuit.heroGarage.root,
      );
      progress({
        completed: 0,
        total: 1,
        fraction: 0,
        label: 'Loading Aurel pit-building frontage',
      });
      renderer.circuit.pitBuildingFrontage = await loadPitBuildingFrontage(cancelled);
      // This original kit is terrain/route-validated for Aurel. Vellamar keeps
      // its own retained infrastructure until separately authored and reviewed.
      if (track.circuit.id === 'aurel') {
        progress({ completed: 0, total: 1, fraction: 0, label: 'Loading A01 concrete barriers' });
        renderer.circuit.concreteBarriers = await loadConcreteBarriers(cancelled);
        progress({ completed: 0, total: 1, fraction: 0, label: 'Loading A02 steel guardrails' });
        renderer.circuit.steelGuardrails = await loadSteelGuardrails(cancelled);
        progress({ completed: 0, total: 1, fraction: 0, label: 'Loading A03 catch fence' });
        renderer.circuit.catchFence = await loadCatchFence(cancelled);
        renderer.circuit.catchFence.setGateSites(renderer.circuit.trackInfrastructure.marshalPosts);
        progress({ completed: 0, total: 1, fraction: 0, label: 'Loading A04 impact barriers' });
        renderer.circuit.impactBarriers = await loadImpactBarriers(cancelled);
        progress({ completed: 0, total: 1, fraction: 0, label: 'Loading A05 recovery gates' });
        renderer.circuit.recoveryGates = await loadRecoveryGates(cancelled);
        renderer.circuit.recoveryGates.setSites(track, renderer.circuit.serviceSites);
        progress({ completed: 0, total: 1, fraction: 0, label: 'Loading A06 marshal posts' });
        renderer.circuit.marshalPosts = await loadMarshalPosts(cancelled);
        progress({ completed: 0, total: 1, fraction: 0, label: 'Loading A07 start gantry' });
        renderer.circuit.startGantry = await loadStartGantry(cancelled);
        progress({
          completed: 0,
          total: 1,
          fraction: 0,
          label: 'Loading A08 trackside signal hardware',
        });
        renderer.circuit.signalHardware = await loadTrackSignalHardware(cancelled);
        progress({
          completed: 0,
          total: 1,
          fraction: 0,
          label: 'Loading A09 braking and sector boards',
        });
        renderer.circuit.trackBoards = await loadTrackBoards(cancelled);
        progress({
          completed: 0,
          total: 1,
          fraction: 0,
          label: 'Loading A10 broadcast camera installations',
        });
        renderer.circuit.broadcastCameras = await loadBroadcastCameras(cancelled);
        progress({
          completed: 0,
          total: 1,
          fraction: 0,
          label: 'Loading A51-A54 authored planting',
        });
        renderer.circuit.vegetation = await loadAurelVegetation(cancelled);
        renderer.circuit.quarry = await loadAurelQuarry(cancelled);
        renderer.circuit.quarry.enqueue(
          track,
          renderer.circuit.props,
          renderer.circuit.serviceSites,
          renderer.circuit.construction,
          (x, z, padding) =>
            renderer.circuit.recoveryGates?.blocksVegetation(x, z, padding) ?? false,
        );
      }
      if (cancelled()) {
        renderer.dispose();
        return null;
      }
      if (!(await renderer.circuit.construction.run(progress, cancelled))) {
        renderer.dispose();
        return null;
      }
      renderer.textures.register(renderer.circuit.group);
      // Large, bright or near-edge scenery mirrors in standing water; small
      // props, people, planting and the road ribbons themselves do not.
      reflectInWetRoad(renderer.circuit.props);
      return renderer;
    } catch (error) {
      renderer.dispose();
      if (cancelled()) return null;
      throw error;
    }
  }
  /** Show the saved personal-best lap at this pose, or hide it (null). */
  setGhost(pose: GhostPose | null) {
    this.ghostActive = !!pose;
    if (!pose) return;
    Object.assign(this.ghostPose, pose);
    if (!this.ghost) {
      this.ghost = new GhostCar(this.heroShells ?? undefined);
      this.scene.add(this.ghost.root);
      this.textures.register(this.ghost.root);
    }
  }
  /** D30 replay director: follow this car on the broadcast cameras (null: the photo subject or the player). */
  setBroadcastFollow(id: number | null) {
    const next = id ?? this.photo?.target ?? 0;
    if (next === this.follow || !Number.isInteger(next) || next < 0 || next >= this.cars.length)
      return;
    this.follow = next;
    this.trackside.reset();
  }
  /** The presented broadcast shot (camera, trackside rig, followed car) for the replay HUD. */
  get broadcastShot() {
    return {
      camera: this.mode as string,
      rig: this.mode === 'trackside' ? this.trackside.activeId : -1,
      follow: this.follow,
    };
  }
  ghostVisible() {
    return this.ghost?.visible ?? false;
  }
  /** Pose the presentation-only safety car (D27), or hide it (null). */
  setSafetyCar(pose: GhostPose | null) {
    this.safetyCarActive = !!pose;
    if (!pose) return;
    Object.assign(this.safetyCarPose, pose);
    if (!this.safetyCar) {
      this.safetyCar = new SafetyCarView(this.heroShells ?? undefined);
      this.scene.add(this.safetyCar.root);
      this.textures.register(this.safetyCar.root);
    }
  }
  setCars(n: number) {
    while (this.cars.length < n) {
      const car = new FormulaCar(
        this.cars.length,
        this.heroShells ?? undefined,
        this.driverAsset ?? undefined,
        this.cars.length === 0 ? (this.suppliedPlayerAsset ?? undefined) : undefined,
        this.rivalLevels ?? undefined,
      );
      this.cars.push(car);
      this.pitCrew.setWheelGunFits(car.id, measureWheelGunFits(car));
      if (this.pitCrew.pitJacks) this.pitCrew.setPitJackFits(car.id, measurePitJackFits(car));
      this.scene.add(car.root);
      reflectInWetRoad(car.root);
      this.textures.register(car.root);
      this.weatherPresentation.install(car.root);
      this.atmosphere.install(car.root);
      installSpecularIBL(car.root);
      // After the material installs above: the casters are depth-only.
      this.shadowProxies.add(...car.shadowFrames());
      this.reflectionMaterials.push([...car.reflectivePaint, this.circuit.roadMaterial]);
      if (car.id === 0) {
        this.reflection.attachMirrors(car.mirrors);
        this.reflection.quality(this.graphics.mirrorQuality);
        this.reflectionFollow = 0;
      }
    }
    this.cars.forEach((c, i) => (c.root.visible = i < n));
  }
  readonly preparation = new PreparationTrace();
  warmupFrames = 0;
  warmupPitPasses = 0;
  async waitForPreparedFrame(cancelled: () => boolean, yieldFrame: () => Promise<void>) {
    const deadline = performance.now() + 45000;
    while (!cancelled() && !this.gpuFrames.ready()) {
      // A slow GPU starts the session late rather than failing it.
      if (performance.now() >= deadline) return;
      await yieldFrame();
    }
  }
  async warmPitPresentation(
    frame: Float32Array,
    cancelled: () => boolean,
    yieldFrame: () => Promise<void>,
  ) {
    this.warmupPitPasses += await warmPitMaterials({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      crew: this.pitCrew,
      frame,
      submitted: () => this.gpuFrames.submittedFrame(),
      ready: () => this.gpuFrames.ready(),
      cancelled,
      yieldFrame,
    });
  }
  /** Build the grid and warm real GPU paths while the physics worker is paused.
   * Yield between car construction and shader stages so progress can repaint.
   * No recording sample or race time is invented during loading. */
  async prepare(
    frame: Float32Array,
    progress: (message: string) => void,
    cancelled: () => boolean,
    yieldFrame: () => Promise<void> = () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve())),
  ) {
    return this.preparation.run(progress, async (progress) => {
      const total = frame[H.CARS];
      if (!Number.isInteger(total) || total < 1 || total > 12)
        throw new Error('Invalid warmup grid');
      for (let n = this.cars.length + 1; n <= total; n++) {
        if (cancelled()) return false;
        progress(`Building original Formula car ${n} / ${total}…`);
        this.setCars(n);
        await yieldFrame();
      }
      if (cancelled()) return false;
      this.setCars(total);
      for (let i = 0; i < total; i++)
        this.cars[i].update(frame, frame, carBase(i), 1, 1 / 120, frame[H.TIME], false);
      progress('Compiling circuit and vehicle materials…');
      await yieldFrame();
      if (cancelled()) return false;
      await compileSceneTarget(this.renderer, this.scene, this.camera, this.composer.readBuffer);
      if (cancelled()) return false;
      progress('Compiling shadow casters around the circuit…');
      await yieldFrame();
      if (cancelled()) return false;
      this.warmShadowCasters();
      const camera = this.mode;
      try {
        for (const mode of ['chase', 'cockpit'] as const) {
          progress(
            mode === 'chase'
              ? 'Warming shadows and scene reflections…'
              : 'Warming cockpit, mirrors and post-processing…',
          );
          await yieldFrame();
          if (cancelled()) return false;
          this.changeCamera(mode);
          this.draw(frame, frame, 1, 1 / 120, false, true);
          this.warmupFrames++;
          if (mode === 'chase') {
            progress('Warming offscreen pit-service materials…');
            await this.warmPitPresentation(frame, cancelled, yieldFrame);
            if (cancelled()) return false;
          }
          await compileSceneTarget(
            this.renderer,
            this.scene,
            this.camera,
            this.composer.readBuffer,
          );
          // Shader linking alone does not finish GPU uploads or the warmup draw.
          // Keep the worker paused until its actual submission has completed.
          progress(`Waiting for completed ${mode} GPU work…`);
          await this.waitForPreparedFrame(cancelled, yieldFrame);
          if (cancelled()) return false;
        }
      } finally {
        if (!cancelled()) {
          this.changeCamera(camera);
          this.reset();
        }
      }
      return true;
    });
  }
  /** A settings edit is not a new race. Drain the preceding submission before
   * releasing its textures/targets, and compile without drawing or resetting
   * the camera, car poses, physics, replay or recorded presentation clocks.
   * The application owns normal-frame exclusion for the whole transaction. */
  async prepareQuality(
    quality: QualityPreset,
    graphics: GraphicsOptions,
    cancelled: () => boolean,
    yieldControl: () => Promise<void>,
  ): Promise<boolean> {
    const stopped = () => this.disposed || cancelled();
    if (stopped()) return false;
    await this.waitForPreparedFrame(stopped, yieldControl);
    if (stopped()) return false;
    this.setQuality(quality, graphics);
    await yieldControl();
    if (stopped()) return false;
    await compileSceneTarget(this.renderer, this.scene, this.camera, this.composer.readBuffer);
    return !stopped();
  }
  setQuality(preset: QualityPreset, options: GraphicsOptions = graphicsPreset(preset)) {
    this.preset = preset;
    const q = detailTier(preset);
    this.quality = q;
    this.graphics = this.ultra.deviceGraphics(validateGraphics(options, preset));
    const g = this.graphics;
    this.reflection.quality(g.mirrorQuality);
    this.circuit.wetReflection.setQuality(g.reflections === 'local' ? q : 'low');
    this.environment.highDetail = g.reflections === 'local';
    this.renderer.shadowMap.enabled = g.shadowSize > 0;
    this.configureFarShadow();
    if (this.sun.shadow.mapSize.x !== g.shadowSize && g.shadowSize > 0) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapPass?.dispose();
      this.sun.shadow.mapPass = null;
      this.sun.shadow.mapSize.set(g.shadowSize, g.shadowSize);
      this.sun.shadow.needsUpdate = true;
    }
    this.bloom.enabled = g.bloom;
    this.motionBlur.setStrength(g.motionBlur);
    this.scenePass.setSamples(Math.min(g.msaa, this.renderer.capabilities.maxSamples));
    // FXAA only substitutes for missing multisampling. Applying it on top of
    // resolved MSAA blurs texture detail, which then invites artificial sharpening.
    this.fxaa.enabled = g.antialias && this.scenePass.samples === 0;
    this.scenePass.ambientOcclusion = g.ambientOcclusion;
    this.grade.enabled = g.filmGrade;
    this.scenePass.temporal.enabled = g.temporalAA;
    // Stored only: lensEffects (post-lens), cockpitFov (camera-cockpit).
    this.circuit.crowd.visible = g.crowd;
    this.applyVegetationDensity();
    this.effects.enabled = g.particleDensity > 0;
    this.effects.density = g.particleDensity;
    this.textures.configure(
      g.textureSize,
      Math.min(g.anisotropy, this.renderer.capabilities.getMaxAnisotropy()),
    );
    this.ultra.configure(preset, g);
    this.resize();
  }
  resize() {
    this.exposure.reset();
    this.studioFrame.reset();
    const w = this.canvas.clientWidth || innerWidth,
      h = this.canvas.clientHeight || innerHeight;
    const size = bufferSize(
      w,
      h,
      Math.min(devicePixelRatio, 1.5) * this.graphics.resolutionScale,
      this.renderer.capabilities.maxTextureSize,
    );
    const ratio = Math.min(size.width / w, size.height / h);
    // Assigning a canvas size, even an unchanged one, discards its drawing
    // buffer and waits for queued GPU work; most settings changes resize with
    // the window and resolution unchanged.
    const current = this.renderer.getSize(new T.Vector2());
    if (current.x !== w || current.y !== h || this.renderer.getPixelRatio() !== ratio)
      this.renderer.setDrawingBufferSize(w, h, ratio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    const actual = this.renderer.getDrawingBufferSize(new T.Vector2());
    this.renderWidth = actual.x;
    this.renderHeight = actual.y;
    this.fxaa.uniforms.resolution.value.set(1 / actual.x, 1 / actual.y);
  }
  setLivery(livery: Livery) {
    const car = this.cars[0];
    if (!car) return;
    car.setLivery(livery);
    for (const material of car.reflectivePaint)
      if (material.map) this.textures.refresh(material.map);
    this.reflection.invalidate();
  }
  setPhoto(value: PhotoSettings | null, cars = this.cars.length) {
    const previous = this.photo;
    this.photo = value ? validatePhoto(value, cars) : null;
    if (previous?.view !== this.photo?.view || previous?.target !== this.photo?.target) {
      this.trackside.reset();
      this.composition.reset();
      this.exposure.reset();
    }
    if (this.photo?.backdrop === 'headquarters' && !this.headquarters) {
      this.headquarters = new HeadquartersStage();
      this.scene.add(this.headquarters.root);
      this.textures.register(this.headquarters.root);
      this.textures.configure(
        this.graphics.textureSize,
        Math.min(this.graphics.anisotropy, this.renderer.capabilities.getMaxAnisotropy()),
      );
    }
    if (this.photo?.depthOfField && !this.photoFocus) {
      // Gathers the scene pass's depth: no second scene render (D09).
      this.photoFocus = new DepthOfFieldPass(
        this.camera,
        photoLens(this.photo, this.photo.distance),
        this.scenePass.target.depthTexture!,
      );
      this.composer.insertPass(this.photoFocus, 1);
    }
    if (this.photoFocus) this.photoFocus.enabled = !!this.photo?.depthOfField;
    if (this.photo && this.photo.survey !== 'off') {
      this.geometrySurvey ??= new GeometrySurvey();
      if (!previous || previous.survey === 'off' || previous.target !== this.photo.target)
        this.geometrySurvey.dirty = true;
    }
    this.follow = this.photo?.target ?? 0;
    this.initialized = false;
    this.motionBlur.reset();
    this.audioView.reset();
    this.reflection.invalidate();
  }
  /** Called by the application's RAF loop before mutating presentation state. */
  canSubmitFrame(): boolean {
    return this.gpuFrames.ready();
  }
  /** Called immediately after draw; preserveDrawingBuffer is not required. */
  capturePhoto(): Promise<Blob> {
    // Called in the same presentation task: own the pixels before async PNG encoding.
    return captureRenderedCanvas(this.canvas);
  }
  changeCamera(mode?: CameraMode) {
    // The meter invalidates old-view reads while preserving adapted brightness.
    this.composition.reset();
    this.motionBlur.reset();
    this.audioView.reset();
    this.cameraClock.reset();
    const modes: CameraMode[] = ['chase', 'cockpit', 'pod', 'trackside'];
    this.mode = mode ?? modes[(modes.indexOf(this.mode) + 1) % modes.length];
    this.initialized = false;
    this.inertia.reset();
    this.viewOrientation.reset();
    this.trackside.reset();
    this.lookX = 0;
    this.lookY = 0;
    return this.mode;
  }
  reset() {
    this.circuit.startFinish.reset();
    this.exposure.reset();
    this.studioFrame.reset();
    this.composition.reset();
    this.reflection.invalidate();
    this.motionBlur.reset();
    this.audioView.reset();
    this.cameraClock.reset();
    this.initialized = false;
    this.inertia.reset();
    this.viewOrientation.reset();
    this.trackside.reset();
    this.effectPlayback.reset();
    this.sampleCount = 0;
    this.sampleIndex = 0;
    this.follow = 0;
  }
  draw(
    a: Float32Array,
    b: Float32Array,
    alpha: number,
    dt: number,
    menu = false,
    replay = false,
    wallDelta = dt,
  ) {
    const pregame = this.gridPresentationTime !== null && this.gridPresentationTime !== undefined;
    const cameraMode: CameraMode = pregame
      ? 'chase'
      : this.photo && this.photo.view !== 'orbit'
        ? this.photo.view
        : this.mode;
    const start = performance.now();
    dt = clamp(dt, 1 / 300, 0.08);
    this.frameMs = this.frameMs * 0.95 + wallDelta * 1000 * 0.05;
    this.fps = 1000 / this.frameMs;
    this.frameSamples[this.sampleIndex++ % 300] = wallDelta * 1000;
    this.sampleCount = Math.min(300, this.sampleCount + 1);
    this.setCars(b[H.CARS]);
    this.orbitTime += dt;
    const presented = this.presented.sample(a, b, alpha);
    const cameraDt = this.cameraClock.step(presented[H.TIME], menu && !this.photo);
    if (this.cameraClock.discontinuous) {
      // Exposure owns its own simulation clock and camera-cut generation.
      this.composition.reset();
      this.inertia.reset();
      this.viewOrientation.reset();
      this.trackside.reset();
      this.audioView.reset();
      this.initialized = false;
    }
    const time = b[H.TIME],
      o = carBase(this.follow);
    const car = this.cars[this.follow],
      speed = b[o + F.SPEED];
    const bikeFollow = !!this.bikeShells && BikeShells.isBike(b, this.follow);
    // The followed car always uses the near mesh. Its articulated subject is
    // needed to solve this frame's camera; every car is posed exactly once.
    car.setLod(0, this.quality, true, !!this.photo);
    car.update(
      a,
      b,
      o,
      alpha,
      dt,
      time,
      (!this.photo || this.photo.view === 'cockpit') &&
        (!menu || !!this.photo) &&
        cameraMode === 'cockpit',
    );
    const reflectionMaterials = this.reflectionMaterials[this.follow];
    if (this.reflectionFollow !== this.follow) {
      this.reflection.attachMirrors(car.mirrors);
      this.reflection.invalidate();
      this.reflectionFollow = this.follow;
    }
    const studio = !!this.photo && this.photo.backdrop !== 'circuit';
    const illumination: LightingMode = studio ? 'day' : this.lighting;
    const daylight = circuitLightState(presented[H.CLOUD], presented[H.RAIN], illumination);
    if (this.night && !studio)
      this.nightFog.setRGB(daylight.fogRed, daylight.fogGreen, daylight.fogBlue);
    if (studio) {
      daylight.sun = 1.4;
      daylight.fill = 0.25;
      daylight.environment = 0.3;
    }
    this.venueLighting.update(
      illumination !== 'day',
      car.root.position,
      illumination === 'sunset' ? 0.18 : 1,
    );
    this.lightPools.update(studio ? 'day' : illumination, this.bloom.energyConserving);
    setBrandLedLighting(studio ? 'day' : illumination);
    applyCircuitLightPalette(this.sun, this.hemisphere, daylight.cover, illumination);
    this.sun.intensity = daylight.sun;
    this.hemisphere.intensity = daylight.fill;
    this.scene.environmentIntensity = daylight.environment;
    // Sky fallback and already-lit local radiance have different gains.
    const specularIBL = setIblEnergy(daylight.environment, illumination, undefined, !studio);
    this.reflection.setSkyIntensity(reflectionMaterials, daylight.environment, specularIBL);
    this.renderer.toneMappingExposure = daylight.exposure * 2 ** (this.photo?.exposure ?? 0);
    const fog = this.scene.fog as T.FogExp2;
    fog.density = daylight.fogDensity;
    // The local atmosphere's extinction: the sky's own air plus rain.
    const rainRate = presented[H.RAIN];
    setAerialExtinction(daylight.haze, studio || !Number.isFinite(rainRate) ? 0 : rainRate);
    fog.color.setRGB(daylight.fogRed, daylight.fogGreen, daylight.fogBlue);
    this.sky.material.uniforms.cloudCover.value = daylight.cover;
    this.sky.material.uniforms.skyRadiance.value = daylight.skyRadiance;
    this.sky.material.uniforms.nightAmount.value = illumination === 'night' ? 1 : 0;
    this.sky.material.uniforms.sunsetAmount.value = illumination === 'sunset' ? 1 : 0;
    this.sky.material.uniforms.sunPosition.value.copy(lightingDirection(illumination));
    // Moon, stars and twilight: the live ephemeris or the preset's fixed sky.
    bindSkyCelestial(this.sky.material, illumination);
    // Clouds drift with presented simulation time: held by pause and replay.
    this.sky.material.uniforms.cloudDrift.value =
      (presented[H.TIME] * SKY_CLOUDS.driftPerSecond) % 1;
    this.target.copy(car.root.position);
    this.direction.set(0, 0, 1).applyQuaternion(car.root.quaternion);
    if (pregame) {
      const shot = gridBroadcastShot(
        this.gridPresentationTime!,
        this.gridReducedMotion,
        this.gridShot,
      );
      // Hard cut between shots: no motion-blur smear across the edit.
      if (shot.index !== this.gridShotIndex) this.motionBlur.reset();
      this.gridShotIndex = shot.index;
      this.camera.fov = shot.fov;
      this.desired.copy(shot.eye).applyQuaternion(car.root.quaternion).add(car.root.position);
      this.gaze.copy(shot.target).applyQuaternion(car.root.quaternion).add(car.root.position);
      this.gridFocus.copy(shot.focus).applyQuaternion(car.root.quaternion).add(car.root.position);
    } else if (this.photo?.view === 'orbit') {
      const offset = photoOffset(this.photo);
      // Read actual articulated world transforms after this snapshot's car update.
      // A close helmet photograph must orbit the helmet, not the chassis centre.
      photoSubject(car, this.photo.focusSubject, this.gaze);
      this.desired
        .set(offset[0], offset[1] - 0.15, offset[2])
        .applyQuaternion(car.root.quaternion)
        .add(this.gaze);
      this.camera.fov = photoFov(this.photo.focalLength);
    } else if (menu && !this.photo) {
      // D29 showroom: low eye, long lens, slow orbit; the car sits right of the menu.
      const angle = SHOWROOM.angle + Math.sin(this.orbitTime * SHOWROOM.rate) * SHOWROOM.sway;
      this.desired
        .set(Math.sin(angle) * SHOWROOM.radius, 0, Math.cos(angle) * SHOWROOM.radius)
        .applyQuaternion(car.root.quaternion)
        .add(this.target);
      const road = car.root.position.y - MENU_CAR_DATUM;
      this.desired.y = road + SHOWROOM.height;
      this.gaze.copy(this.target);
      this.gaze.y = road + SHOWROOM.aim;
      // Across-view direction (to the camera's right) from the view azimuth.
      this.temporary.subVectors(this.gaze, this.desired).setY(0).normalize();
      this.gaze.x += this.temporary.z * SHOWROOM.shift;
      this.gaze.z -= this.temporary.x * SHOWROOM.shift;
      this.camera.fov = SHOWROOM.fov;
    } else if (cameraMode === 'trackside') {
      const composition = this.composition.update(presented, this.follow);
      this.trackside.update(
        presented[o + F.S],
        composition.target,
        composition.velocity,
        cameraDt,
        this.camera.aspect,
        composition.radius,
        true,
        composition.visibility,
      );
      this.desired.copy(this.trackside.position);
      this.gaze.copy(this.trackside.gaze);
      this.camera.fov = this.trackside.fov;
    } else {
      const seated = cameraMode === 'cockpit' || cameraMode === 'pod';
      if (seated) {
        if (cameraDt > 0)
          this.inertia.step(
            cameraDt,
            b[o + F.G_LAT],
            b[o + F.G_LONG],
            b[o + F.G_VERT],
            b[o + F.IMPACT],
            this.shake,
          );
        if (car.suppliedPlayer) {
          if (cameraMode === 'cockpit')
            cockpitEye(car.suppliedPlayer.eye, this.inertia.offset, this.desired);
          // T-cam: sit slightly above the authored airbox socket so the
          // helmet crown occupies the lower edge rather than the lower fifth.
          else
            this.desired
              .copy(car.suppliedPlayer.pod)
              .add(this.inertia.offset)
              .add(this.temporary.set(0, TCAM_LIFT_M, 0));
          this.desired.applyQuaternion(car.root.quaternion).add(car.root.position);
        } else {
          this.inertia.eye(
            car.root.position,
            car.root.quaternion,
            cameraMode === 'pod',
            this.desired,
          );
        }
        const orientation = this.viewOrientation.update(car.root.quaternion, cameraDt);
        if (cameraMode === 'cockpit' && car.suppliedPlayer) cockpitDirection(this.direction);
        else this.direction.set(0, cameraMode === 'pod' ? TCAM_PITCH : -0.035, 1);
        this.direction.applyQuaternion(orientation).normalize();
        this.gaze.copy(this.desired).addScaledVector(this.direction, 40);
        // A bike's onboard cameras are mounted on the bike and roll with it.
        if (bikeFollow) {
          this.bikeShells.onboard(car.root, this.desired, this.direction, cameraMode === 'pod');
          this.gaze.copy(this.desired).addScaledVector(this.direction, 40);
        }
      } else {
        // Close, low chase framing: the car fills more of the lower centre and
        // the horizon sits nearer mid-frame, as in modern broadcast-style games.
        // The rig follows heading and a bounded pitch but never roll, so a
        // spinning or overturned car cannot swing the camera under the road.
        const pitch = Math.asin(clamp(this.direction.y, -0.4, 0.4));
        this.chaseBasis.setFromEuler(
          this.chaseEuler.set(-pitch, Math.atan2(this.direction.x, this.direction.z), 0, 'YXZ'),
        );
        this.desired
          .set(
            0,
            CHASE.height + speed * CHASE.heightPerMS,
            -CHASE.distance - speed * CHASE.distancePerMS,
          )
          .applyQuaternion(this.chaseBasis)
          .add(this.target);
        this.direction.set(0, 0, 1).applyQuaternion(this.chaseBasis);
        this.gaze.copy(this.target).addScaledVector(this.direction, CHASE.lookAhead);
        this.gaze.y += CHASE.lookLift;
      }
      if (this.lookX || this.lookY) {
        this.direction
          .set(Math.sin(this.lookX), this.lookY, Math.cos(this.lookX))
          .applyQuaternion(car.root.quaternion);
        this.gaze.copy(this.desired).addScaledVector(this.direction, 30);
      }
      this.camera.fov =
        cameraMode === 'cockpit' && car.suppliedPlayer
          ? cockpitFov(this.graphics.cockpitFov)
          : cameraMode === 'chase'
            ? CHASE.fov + Math.min(CHASE.fovGain, speed * 0.06)
            : tcamFov(speed);
    }
    if (!this.initialized || cameraMode !== 'chase' || menu || this.photo || pregame) {
      this.camera.position.copy(this.desired);
      this.velocity.set(0, 0, 0);
      this.initialized = true;
    } else {
      // Translation feed-forward removes the steady-speed spring lag. Only
      // changes of the chase offset are filtered in this world-space spring.
      this.camera.position.add(this.temporary.copy(this.target).sub(this.previousAnchor));
      // Critically damped positional camera spring; bounded integration substeps.
      const omega = 15,
        n = Math.max(1, Math.ceil(cameraDt * 120)),
        h = cameraDt / n;
      for (let k = 0; k < n; k++) {
        this.velocity.addScaledVector(
          this.direction.copy(this.desired).sub(this.camera.position),
          omega * omega * h,
        );
        this.velocity.multiplyScalar(Math.exp(-2 * omega * h));
        this.camera.position.addScaledVector(this.velocity, h);
      }
    }
    this.previousAnchor.copy(this.target);
    this.camera.up.set(0, 1, 0);
    if (
      (!this.photo || this.photo.view !== 'orbit') &&
      (!menu || !!this.photo) &&
      (cameraMode === 'cockpit' || cameraMode === 'pod')
    ) {
      this.temporary.set(0, 1, 0).applyQuaternion(car.root.quaternion);
      this.camera.up.lerp(this.temporary, 0.2).normalize();
    }
    if (bikeFollow && (!menu || !!this.photo) && (!this.photo || this.photo.view !== 'orbit')) {
      // Chase rolls partly with the bike's lean; onboard views roll fully.
      this.temporary.set(0, 1, 0).applyQuaternion(car.root.quaternion);
      if (cameraMode === 'chase') this.camera.up.lerp(this.temporary, BIKE_CHASE_ROLL).normalize();
      else if (cameraMode === 'cockpit' || cameraMode === 'pod')
        this.camera.up.copy(this.temporary);
    }
    this.camera.lookAt(this.gaze);
    if (this.photo) this.camera.rotateZ((this.photo.roll * Math.PI) / 180);
    this.camera.updateProjectionMatrix();
    this.circuit.concreteBarriers?.update(this.camera, this.quality);
    this.circuit.steelGuardrails?.update(this.camera, this.quality);
    this.circuit.catchFence?.update(this.camera, this.quality);
    this.circuit.impactBarriers?.update(this.camera, this.quality);
    this.circuit.recoveryGates?.update(this.camera, this.quality);
    this.circuit.marshalPosts?.update(this.camera, this.quality);
    this.circuit.startGantry?.update(this.camera, this.quality);
    this.circuit.signalHardware?.update(this.camera, this.quality);
    this.circuit.trackBoards?.update(this.camera, this.quality);
    this.circuit.broadcastCameras?.update(this.camera, this.quality);
    this.circuit.venueKit?.update(this.camera, this.night);
    this.circuit.vegetation?.update(this.camera, this.quality);
    this.circuit.quarry?.update(this.camera, this.quality);
    this.circuit.heroGarage?.update(this.camera, this.quality, illumination);
    this.tyreEquipment?.update(this.camera, this.quality);
    this.wheelGunStorage?.update(this.camera);
    this.circuit.tyreBlankets?.update(this.camera, this.quality, illumination);
    if (this.circuit.heroGarage)
      this.circuit.tyreBlankets?.alignGarageWheels(this.circuit.heroGarage.spareWheelStorage);
    this.circuit.pitBuildingFrontage?.update(this.camera, this.quality, illumination);
    this.circuit.pitWallStation?.update(
      this.camera,
      this.quality,
      illumination,
      presented,
      this.photo ? 'HELD' : replay ? 'REPLAY' : menu ? 'STANDBY' : 'LIVE',
      !studio,
    );
    // A replay cut, follow change or photo lens must use the NEW view, not
    // last frame's camera. Choose the representation before posing it, since
    // reduced cars update only their active wheel/suspension representation.
    for (let id = 0; id < b[H.CARS]; id++) {
      if (id === this.follow) continue;
      const base = carBase(id);
      const distance = this.temporary
        .set(presented[base + F.X], presented[base + F.Y], presented[base + F.Z])
        .distanceTo(this.camera.position);
      this.cars[id].setLod(
        detailDistance(distance, this.camera.fov, this.camera.aspect),
        this.quality,
        false,
      );
      this.cars[id].update(a, b, base, alpha, dt, time, false);
    }
    // Non-Formula definitions are drawn by their own procedural bodies;
    // motorcycles by their bike and rider shells.
    this.vehicleBodies?.update(a, b, alpha, this.cars, illumination !== 'day');
    this.bikeShells?.update(a, b, alpha, this.cars, this.camera, this.quality, this.follow);
    this.ghost?.update(
      this.ghostActive && !replay && !menu && !this.photo ? this.ghostPose : null,
      this.camera,
      this.quality,
      time,
      dt,
    );
    this.safetyCar?.update(
      this.safetyCarActive && !menu ? this.safetyCarPose : null,
      this.camera,
      this.quality,
      time,
      dt,
    );
    shadowAnchor(
      this.target,
      this.sun.shadow.mapSize.x,
      this.sun.shadow.camera.right,
      this.sun.target.position,
      illumination,
    );
    this.sun.position.copy(this.sun.target.position).add(lightingDirection(illumination));
    this.sun.target.updateMatrixWorld();
    this.circuit.update(b);
    this.circuit.startFinish.update(presented, this.camera, this.night);
    this.atmosphere.update(presented, this.graphics.localFog && !studio);
    this.weatherPresentation.update(presented, !studio);
    this.circuit.staff.update(
      presented,
      this.camera.position,
      this.circuit.crowd.visible && !studio && !menu,
    );
    if (this.circuit.crowd.visible)
      for (const cluster of this.circuit.crowdClusters)
        cluster.update(
          presented[H.TIME],
          this.camera.position,
          presented[H.RAIN],
          presented,
          this.camera.fov,
          this.camera.aspect,
        );
    this.effectPlayback.update(presented, !menu, !replay);
    this.effects.setSignalLights(presented, !studio);
    this.debris.update(b);
    this.pitCrew.update(
      presented,
      this.camera.position,
      !menu && !studio,
      this.camera.fov,
      this.camera.aspect,
    );
    this.gridPreparation.update(
      presented,
      this.camera.position,
      (!menu || !!this.photo) && !studio && !pregame && !this.gridPrepared,
    );
    this.gridPerformance?.update(
      presented,
      this.camera.position,
      pregame ? this.gridPresentationTime : null,
    );
    this.guide.update(presented, !menu && !this.photo && !pregame, this.colorblind);
    this.replayView = replay;
    this.engineeringView.update(this.engineering, b[H.TIME], this.debug, replay);
    this.reflection.beginFrame(
      menu ? this.orbitTime : presented[H.TIME],
      (!this.photo || this.photo.view === 'cockpit') &&
        (!menu || !!this.photo) &&
        cameraMode === 'cockpit',
    );
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const studioView = `${cameraMode}:${this.follow}:${this.trackside.activeId}:${menu}:${pregame}`;
    this.studioFrame.update(presented, this.camera, this.sun, studioView);
    this.audioView.update(
      this.camera,
      this.presented.value[H.TIME],
      cameraMode === 'trackside' ? this.trackside.activeId + 1 : 0,
      !menu && (cameraMode === 'cockpit' || cameraMode === 'pod'),
      this.follow,
    );
    this.eyeLocal.copy(this.camera.position);
    car.root.worldToLocal(this.eyeLocal);
    this.renderer.info.reset();
    this.drawLedger.begin();
    this.gpuTimer.begin();
    const originalOverride = this.scene.overrideMaterial;
    // World matrices were solved once above for this frame. Every pass below
    // (shadow, mirror, probe, wet plane, scene) would otherwise re-walk and
    // recompose the entire graph inside renderer.render(). Passes that move
    // something (stages, probe and reflection cameras) update it themselves.
    this.scene.matrixWorldAutoUpdate = false;
    try {
      if (studio) {
        const road = this.circuit.track.at(presented[o + F.S], { ...this.circuit.track.points[0] });
        const stage =
          this.photo?.backdrop === 'headquarters' ? this.headquarters! : this.photoStage;
        stage.position(car.root, road.y);
        this.scenePresentation.begin(stage.background, true);
        this.scenePresentation.visibilityFor(stage.root, true);
        for (const group of [
          this.circuit.group,
          this.sky,
          this.venueLighting.root,
          this.effects.group,
          this.debris.mesh,
          this.gridPreparation.root,
          this.gridPerformance.root,
          this.pitCrew.root,
          this.engineeringView.group,
        ])
          this.scenePresentation.visibilityFor(group, false);
        for (const other of this.cars)
          if (other !== car) this.scenePresentation.visibilityFor(other.root, false);
      } else if (this.night) {
        this.scenePresentation.begin(this.venueLighting.nightBackground, false, this.nightFog);
        // Retain the real skydome and its recorded-cloud night shader.
      }
      // The wet-road reflection is re-rendered for this camera below; until then
      // the environment, probe and mirror passes must not sample last frame's.
      this.circuit.wetReflection.suspend();
      // Include weather-driven environment captures in real GPU/draw metrics.
      this.drawLedger.mark('environment');
      if (
        this.circuit.construction.ready &&
        this.farShadowBaked !== `${illumination}${skySunKey()}`
      )
        this.bakeFarShadow(illumination);
      this.environment.update(this.renderer, this.scene, daylight.cover, illumination);
      let wheelWater = 0;
      for (let wheel = 0; wheel < 4; wheel++)
        wheelWater = Math.max(wheelWater, b[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.WATER]);
      const wetReflection = wheelWater > 0.04 || b[H.RAIN] > 0.01;
      this.refreshReflectionExclusions(car);
      this.drawLedger.mark('probe');
      this.reflection.updateProbe(
        this.renderer,
        this.scene,
        car.root,
        reflectionMaterials,
        this.graphics.reflections === 'local' && !menu && !studio,
        wetReflection ? 0.55 : 1.5,
        this.sky.material.uniforms.probeSkyIntensity,
      );
      this.drawLedger.mark('mirrors');
      this.reflection.renderMirrors(this.renderer, this.scene, car.root, dt);
      this.drawLedger.mark('wet');
      // Planar reflection about the road under the followed car, only while the
      // track carries water; the film's own masks decide where it shows.
      const roadPoint = this.circuit.track.at(presented[o + F.S], this.wetPlanePoint);
      this.circuit.wetReflection.update(
        this.renderer,
        this.scene,
        this.camera,
        roadPoint.y + roadPoint.bank * presented[o + F.LATERAL],
        !menu && !studio && (presented[H.WATER] > 0.02 || wetReflection) ? 1 : 0,
      );
      this.drawLedger.mark('other');
      this.motionBlur.setStrength(
        this.reducedMotion ? 0 : this.graphics.motionBlur,
        !this.photo && !menu,
      );
      this.motionBlur.prepareFrame(presented, this.camera, this.follow, cameraMode, replay);
      // D29/D30: depth of field on the subject car (showroom, broadcast telephoto).
      const lens: SubjectLens | null =
        pregame && this.gridShot.maxblur > 0
          ? this.gridShot
          : subjectLens(menu, !!this.photo, cameraMode, this.camera.fov);
      if (lens?.thinLens) {
        this.broadcastFocus ??= new DepthOfFieldPass(
          this.camera,
          { focus: 10, aperture: 0, maxblur: lens.maxblur },
          this.scenePass.target.depthTexture!,
          { thinLens: true },
        );
        if (!this.composer.passes.includes(this.broadcastFocus))
          this.composer.insertPass(this.broadcastFocus, 1);
        focusOnSubject(this.broadcastFocus, this.camera, this.target, lens, this.temporary);
        if (this.photoFocus && !this.photo?.depthOfField) this.photoFocus.enabled = false;
      } else if (lens) {
        this.photoFocus ??= new DepthOfFieldPass(
          this.camera,
          { focus: 10, ...lens },
          this.scenePass.target.depthTexture!,
        );
        if (!this.composer.passes.includes(this.photoFocus))
          this.composer.insertPass(this.photoFocus, 1);
        focusOnSubject(
          this.photoFocus,
          this.camera,
          pregame ? this.gridFocus : this.target,
          lens,
          this.temporary,
        );
      } else if (this.photoFocus && !this.photo?.depthOfField) this.photoFocus.enabled = false;
      if (this.broadcastFocus && !lens?.thinLens) this.broadcastFocus.enabled = false;
      if (this.photoFocus?.enabled && this.photo) {
        // Optical-axis depth, rather than Euclidean distance, matches the depth shader.
        this.camera.updateMatrixWorld();
        const depth = -this.temporary.copy(this.gaze).applyMatrix4(this.camera.matrixWorldInverse)
          .z;
        const lens = photoLens(this.photo, depth);
        for (const key of ['focus', 'aperture', 'maxblur'] as const)
          this.photoFocus.materialBokeh.uniforms[key].value = lens[key];
      }
      // The meter sees linear scene pixels; only the final output exposure adapts.
      // Photo exposure and studio lighting remain manual and exactly held.
      this.renderer.toneMappingExposure = this.exposure.prepare(
        presented[H.TIME],
        `${illumination}:${cameraMode}:${cameraMode === 'trackside' ? this.trackside.activeId : -1}:${this.follow}`,
        daylight.exposure * 2 ** (this.photo?.exposure ?? 0),
        this.graphics.autoExposure && !this.photo && !menu,
        METER_KEY[illumination],
      );
      // Grade + LUT, P11 bloom and lens effects (studio/lens-effects.ts).
      const lensOn = this.graphics.lensEffects && !menu && !studio && !this.photo;
      // D30: the photo studio's filter, vignette, grain and saturation (photo only).
      this.grade.photoOverride = this.photo
        ? photoGrade(GRADE_PROFILES[studio ? 'studio' : illumination], this.photo)
        : null;
      postLensFrame(
        this.grade,
        this.bloom,
        presented,
        studio ? 'studio' : illumination,
        lensOn,
        this.camera,
        cameraMode,
        speed,
      );
      this.ultra.prepareFrame({
        presented,
        cars: this.cars,
        subject: this.target,
        cameraMode,
        lighting: illumination,
        studio,
        menu,
        photo: !!this.photo,
        replay,
        otherDof: !!this.photoFocus?.enabled || !!this.broadcastFocus?.enabled,
        cut: this.cameraClock.discontinuous,
      });
      this.drawLedger.mark('composer');
      this.composer.render();
      this.ultra.afterFrame();
      this.drawLedger.mark('other');
      if (this.photo && this.photo.survey !== 'off' && this.geometrySurvey) {
        if (this.geometrySurvey.dirty)
          this.geometrySurvey.rebuild(
            [this.circuit.group, ...this.cars.filter((c) => c.root.visible).map((c) => c.root)],
            car.root.position,
          );
        this.geometrySurvey.render(
          this.renderer,
          this.camera,
          this.photo.survey === 'points' ? 1 : this.photo.split,
        );
      }
    } finally {
      // BokehPass temporarily installs a depth override; restore even on GPU failure.
      this.scene.overrideMaterial = originalOverride;
      this.scene.matrixWorldAutoUpdate = true;
      this.scenePresentation.restore();
      this.gpuTimer.end();
      this.drawLedger.end();
    }
    this.gpuFrames.submittedFrame();
    this.renderedMode = cameraMode;
    this.lastRenderCPUms = performance.now() - start;
    this.renderMs = this.renderMs * 0.9 + this.lastRenderCPUms * 0.1;
  }
  /** Rebuilt in place each frame (no allocation): the car set, follow target
   * and lazily loaded pit kits can change between frames. */
  /** Map size and planting density decide the far map; bake again only
   * when they change. */
  private configureFarShadow() {
    const g = this.graphics,
      size = Math.max(1024, g.shadowSize),
      inputs = `${g.shadowSize > 0}|${size}|${g.vegetationDensity}`;
    this.farShadow.setEnabled(g.shadowSize > 0, size);
    if (inputs !== this.farShadowInputs) this.farShadowBaked = null;
    this.farShadowInputs = inputs;
  }
  /** Compile every shadow caster's depth program while loading (see
   * FarShadow.warmCasters). */
  private warmShadowCasters() {
    this.farShadow.warmCasters(
      this.renderer,
      this.scene,
      this.sun,
      lightingDirection(this.lighting),
      this.farShadowBounds,
    );
  }
  /** Bake the static far sun shadow for this lighting: no cars, people,
   * particles or moving equipment; groves and treelines cast into it only. */
  private applyVegetationDensity() {
    this.circuit.vegetationGroup.traverse((object) => {
      if (object instanceof T.InstancedMesh)
        object.count = Math.floor(object.userData.fullCount * this.graphics.vegetationDensity);
    });
  }
  private bakeFarShadow(illumination: LightingMode) {
    // Planting built after the last quality change still has its full count;
    // the map must hold the density its inputs say it does.
    this.applyVegetationDensity();
    const farCasters: T.Object3D[] = [];
    this.circuit.vegetationGroup.traverse((object) => {
      if (object instanceof T.InstancedMesh && !object.castShadow) farCasters.push(object);
    });
    this.farShadow.bake(this.renderer, this.scene, {
      direction: lightingDirection(illumination),
      bounds: this.farShadowBounds,
      hidden: [
        ...this.cars.map((car) => car.root),
        this.ghost?.root,
        this.pitCrew.root,
        this.gridPreparation.root,
        this.gridPerformance.root,
        this.debris.mesh,
        this.guide.mesh,
        this.engineeringView.group,
        this.effects.group,
        this.circuit.crowd,
        this.circuit.staff.root,
        this.circuit.tyreBlankets?.root,
        ...this.circuit.crowdClusters.map((cluster) => cluster.root),
      ],
      farCasters,
      sun: this.sun,
    });
    this.farShadowBaked = `${illumination}${skySunKey()}`;
  }
  /** A rival 30 m behind fills a few dozen pixels of a 512 x 192 mirror, yet
   * the main view's LOD drew it at full detail (93 draws) in every pass. Each
   * mirror pass shows a rival at the detail its size in that feed calls for,
   * never more than the main view's, and the main view's LOD is restored. */
  private showMirrorDetail(camera: T.PerspectiveCamera, height: number) {
    for (const car of this.cars) {
      if (car.suppliedPlayer || !car.root.visible) continue;
      const distance = feedDetailDistance(
        car.root.position.distanceTo(camera.position),
        camera.fov,
        camera.aspect,
        height,
        this.renderHeight,
      );
      const previous = this.mirrorLevels.get(car) ?? car.lodLevel;
      const level = Math.max(car.lodLevel, carLod(distance, previous, this.quality, false));
      this.mirrorLevels.set(car, level);
      if (level === car.lodLevel) continue;
      car.showDetail(level);
      this.mirrorDetailShown.push(car);
    }
  }
  private restoreMirrorDetail() {
    for (const car of this.mirrorDetailShown) car.showDetail(car.lodLevel);
    this.mirrorDetailShown.length = 0;
  }
  private refreshReflectionExclusions(subject: FormulaCar) {
    const smallDetail = [
      this.pitCrew.root,
      this.gridPreparation.root,
      this.gridPerformance.root,
      this.debris.mesh,
      this.guide.mesh,
      this.engineeringView.group,
      this.circuit.crowd,
      this.tyreEquipment?.root,
      this.circuit.tyreBlankets?.root,
      this.wheelGunStorage?.root,
    ];
    const probe = this.probeHidden,
      mirror = this.mirrorHidden;
    probe.length = 0;
    mirror.length = 0;
    for (const root of smallDetail)
      if (root) {
        probe.push(root);
        mirror.push(root);
      }
    // Mirrors keep rival cars and spray; the probe (paint/wet-road reflection
    // at 128 px) keeps static scenery only. The subject car is hidden by the probe itself.
    probe.push(this.effects.group);
    for (const other of this.cars) if (other !== subject) probe.push(other.root);
    if (this.ghost) {
      probe.push(this.ghost.root);
      mirror.push(this.ghost.root);
    }
    this.reflection.probeExclusions = probe;
    this.reflection.mirrorExclusions = mirror;
  }
  reviewHardware() {
    return reviewHardware(this.renderer.getContext());
  }
  visualDiagnostics() {
    const car = this.cars[this.follow];
    const wheel = new T.Vector3(0, 0.01, -0.025);
    if (car.suppliedPlayer) car.suppliedPlayer.screenWorld(wheel);
    else car.steering.localToWorld(wheel);
    const distance = wheel.distanceTo(this.camera.position);
    const ray = new T.Raycaster(
      this.camera.position,
      wheel.clone().sub(this.camera.position).normalize(),
      0.001,
      distance + 0.005,
    );
    const visibleHit = ray
      .intersectObject(car.suppliedPlayer?.root ?? car.root, true)
      .find((hit) => {
        for (let object: T.Object3D | null = hit.object; object; object = object.parent)
          if (!object.visible) return false;
        return true;
      });
    const screenVisible = !!visibleHit && visibleHit.distance >= distance - 0.008;
    wheel.project(this.camera);
    const halo = new T.Vector3(0, 0.35, 0.64);
    car.root.localToWorld(halo);
    halo.project(this.camera);
    return {
      screenVisible,
      wheelProjection: wheel.toArray(),
      driver: car.driver.diagnostics(),
      authoredBodywork: this.heroShells?.diagnostics() ?? null,
      rivalBodywork: this.rivalLevels?.map((asset) => asset.diagnostics()) ?? null,
      rivalCars: this.cars.map((car) => ({
        id: car.id,
        level: car.lodLevel,
        supplied: !!car.suppliedPlayer,
        a61: car.root.userData.a61 !== null && car.root.userData.a61 !== undefined,
      })),
      authoredDriver: this.driverAsset?.diagnostics() ?? null,
      suppliedPlayer: car.suppliedPlayer?.diagnostics() ?? null,
      // Bounded CPU summary; no texture readback or per-person geometry walk.
      pitPersonnel: this.pitCrew.summary(),
      crowdPersonnel: {
        ...PEOPLE_ASSET,
        clusters: this.circuit.crowdClusters.length,
        population: this.circuit.crowdClusters.reduce((n, c) => n + c.levels[0].count, 0),
        // LOD selections, not a claim that off-frustum instances were drawn.
        selectedByLevel: [0, 1, 2, 3].map((level) =>
          this.circuit.crowdClusters.reduce(
            (n, c) => n + (c.levels[level].visible ? c.levels[level].count : 0),
            0,
          ),
        ),
      },
      pitCrews: this.pitCrew.activeCrews,
      // Draw-submission estimates by owner group for the main view, the local
      // probe's six faces and the two mirror cameras (profiling aid).
      census: (() => {
        const roots = [this.circuit.group, this.circuit.props, this.circuit.surfaces];
        const probeCameras = cubeCensusCameras(
          car.root.position.clone().add(new T.Vector3(0, 1.5, 0)),
          1600,
          this.reflection.probeLayers,
        );
        return {
          main: renderCensus(this.scene, [this.camera], roots).slice(0, 24),
          probe: renderCensus(this.scene, probeCameras, roots).slice(0, 24),
          // Pose the mirror cameras on the car first: they are only oriented
          // when a feed renders, and can lag far behind on slow frames.
          // Each feed with the detail its passes show.
          mirrors: mergeCensus(
            this.reflection.poseMirrorCameras(car.root).map((camera) => {
              this.showMirrorDetail(camera as T.PerspectiveCamera, this.reflection.mirrorHeight);
              try {
                return renderCensus(this.scene, [camera], roots);
              } finally {
                this.restoreMirrorDetail();
              }
            }),
          ).slice(0, 24),
          // Casters inside the sun's shadow camera as of the last shadow pass.
          shadow: this.shadowProxies
            .withCasters(() => renderCensus(this.scene, [this.sun.shadow.camera], roots, true))
            .slice(0, 24),
        };
      })(),
      haloProjection: halo.toArray(),
      mirrors: this.reflection.diagnostics(this.renderer),
      particles: this.effects.diagnostics(),
    };
  }
  /** Copy unaveraged counters without allocating/sorting a debug snapshot. */
  readPerformanceMetrics(target: FrameMetrics) {
    target.renderCPUms = this.lastRenderCPUms;
    target.drawCalls = this.renderer.info.render.calls;
    target.triangles = this.renderer.info.render.triangles;
    target.gpuMs = this.gpuTimer.milliseconds;
    target.gpuSequence = this.gpuTimer.sampleSequence;
  }
  /** Cheap opt-in review counters. Frame identity comes from the SAME presented
   * snapshot/camera used by audio, car lights, spray and replay presentation. */
  readReviewMetrics(target: ReviewFrame) {
    this.readPerformanceMetrics(target);
    const frame = this.presented.value,
      b = carBase(this.follow);
    target.physicsMs = frame[H.STEP_MS];
    target.time = frame[H.TIME];
    target.s = frame[b + F.S];
    target.laps = frame[b + F.LAPS];
    target.x = this.camera.position.x;
    target.y = this.camera.position.y;
    target.z = this.camera.position.z;
    target.qx = this.camera.quaternion.x;
    target.qy = this.camera.quaternion.y;
    target.qz = this.camera.quaternion.z;
    target.qw = this.camera.quaternion.w;
    target.fov = this.camera.fov;
    target.rig = this.mode === 'trackside' ? this.trackside.activeId : -1;
    target.exposure = this.renderer.toneMappingExposure;
    target.textures = this.renderer.info.memory.textures;
    target.geometries = this.renderer.info.memory.geometries;
    target.programs = this.renderer.info.programs?.length ?? 0;
    target.nearCars = target.midCars = target.farCars = 0;
    for (const car of this.cars) {
      if (!car.root.visible) continue;
      if (car.lodLevel === 0) target.nearCars++;
      else if (car.lodLevel === 1) target.midCars++;
      else target.farCars++;
    }
    target.rain = frame[H.RAIN];
    target.cloud = frame[H.CLOUD];
    target.water = frame[H.WATER];
    target.mirrors = this.reflection.mirrorUpdates;
    target.probes = this.reflection.probeUpdates;
    readRaceReviewFrame(frame, this.follow, 0, this.pitCrew.actorCountFor(this.follow), target);
    target.sprayParticles = this.effects.activeSprayCountFor(target.leader);
  }
  reviewCar() {
    return this.follow;
  }
  stats() {
    const info = this.renderer.info.render;
    const sorted = Array.from(this.frameSamples.subarray(0, this.sampleCount)).sort(
      (a, b) => a - b,
    );
    const slowCount = Math.ceil(sorted.length * 0.01);
    let slowTotal = 0;
    for (let i = sorted.length - slowCount; i < sorted.length; i++) slowTotal += sorted[i];
    return {
      authoredBodywork: this.heroShells?.diagnostics() ?? null,
      rivalBodywork: this.rivalLevels?.map((asset) => asset.diagnostics()) ?? null,
      rivalCars: this.cars.map((car) => ({
        id: car.id,
        level: car.lodLevel,
        supplied: !!car.suppliedPlayer,
        a61: car.root.userData.a61 !== null && car.root.userData.a61 !== undefined,
      })),
      authoredDriver: this.driverAsset?.diagnostics() ?? null,
      suppliedPlayer: this.cars[0]?.suppliedPlayer?.diagnostics() ?? null,
      // Bounded CPU summary; no texture readback or per-person geometry walk.
      pitPersonnel: this.pitCrew.summary(),
      crowdPersonnel: {
        ...PEOPLE_ASSET,
        clusters: this.circuit.crowdClusters.length,
        population: this.circuit.crowdClusters.reduce((n, c) => n + c.levels[0].count, 0),
        // LOD selections, not a claim that off-frustum instances were drawn.
        selectedByLevel: [0, 1, 2, 3].map((level) =>
          this.circuit.crowdClusters.reduce(
            (n, c) => n + (c.levels[level].visible ? c.levels[level].count : 0),
            0,
          ),
        ),
      },
      // Read-only presented state, not the newer live-worker frame during replay.
      pitState: {
        car: this.follow,
        time: this.presented.value[H.TIME],
        phase: this.presented.value[carBase(this.follow) + F.PIT_PHASE],
        clock: this.presented.value[carBase(this.follow) + F.PIT_CLOCK],
        speed: this.presented.value[carBase(this.follow) + F.SPEED],
        inPit: this.presented.value[carBase(this.follow) + F.IN_PIT],
        jackHeight: this.presented.value[carBase(this.follow) + F.JACK_HEIGHT],
        // A renderer rebuilt for another circuit has presented nothing yet.
        wheelOffsets: [0, 1, 2, 3].map((wheel) =>
          this.presented.value.length < carBase(this.follow) + CAR_STRIDE
            ? 0
            : serviceWheelOffset(
                this.presented.value[carBase(this.follow) + F.PIT_PHASE],
                this.presented.value[carBase(this.follow) + F.PIT_CLOCK],
                this.presented.value[
                  carBase(this.follow) + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD
                ],
              ),
        ),
      },
      // CPU-only rig diagnostics. suppliedRig is the active R06 player skeleton;
      // arms retains the legacy AI format and is not player evidence when suppliedRig is present.
      // Neither path raycasts the car or synchronously reads mirror pixels.
      driverPose: {
        car: this.follow,
        time: this.presented.value[H.TIME],
        wheelRadians:
          this.cars[this.follow].suppliedPlayer?.driverPose().wheelRadians ??
          this.cars[this.follow].steering.rotation.z,
        arms: this.cars[this.follow].driver.diagnostics(),
        suppliedRig: this.cars[this.follow].suppliedPlayer?.driverPose() ?? null,
      },
      photo: this.photo ? { ...this.photo } : null,
      geometrySurvey: {
        count: this.geometrySurvey?.count ?? 0,
        candidates: this.geometrySurvey?.candidates ?? 0,
        active: !!this.photo && this.photo.survey !== 'off',
        source: 'rendered geometry; not LiDAR',
      },
      photoFocus: {
        enabled: this.photoFocus?.enabled ?? false,
        focus: this.photoFocus?.materialBokeh.uniforms.focus.value ?? null,
        // Which lens owns the pass: photo mode's own settings, or the subject
        // lens outside photo mode (D29 showroom, D30 broadcast telephoto).
        source: !this.photoFocus?.enabled ? 'off' : this.photo?.depthOfField ? 'photo' : 'subject',
      },
      // Trackside broadcast telephoto: thin lens on a 2/3-inch gate.
      broadcastFocus: {
        enabled: this.broadcastFocus?.enabled ?? false,
        focus: this.broadcastFocus?.materialBokeh.uniforms.focus.value ?? null,
        backgroundBlur: this.broadcastFocus?.materialBokeh.uniforms.lensK?.value ?? null,
      },
      night: this.night,
      guide: this.guide.diagnostics(),
      gridPreparation: this.gridPreparation.diagnostics(),
      gridPerformance: this.gridPerformance?.diagnostics() ?? null,
      venueLighting: this.venueLighting.diagnostics(),
      studioFrame: this.studioFrame.diagnostics(),
      environmentAssets: {
        ...this.circuit.environmentDiagnostics(),
        tyreEquipment: this.tyreEquipment?.diagnostics() ?? null,
      },
      playerPaint: this.cars[0]
        ? {
            primary: `#${this.cars[0].paint.color.getHexString()}`,
            accent: `#${this.cars[0].accent.color.getHexString()}`,
            lookdev: this.cars[0].suppliedLookdev,
            flankSizes: this.cars[0].reflectivePaint
              .filter((m) => m.map && m.userData.liverySide !== undefined)
              .map((m) => {
                const image = m.map!.image as HTMLCanvasElement;
                const pixel = image.getContext('2d')?.getImageData(0, 0, 1, 1).data;
                return {
                  width: image.width,
                  height: image.height,
                  corner: pixel ? Array.from(pixel) : [],
                };
              }),
          }
        : null,
      warmupFrames: this.warmupFrames,
      warmupPitPasses: this.warmupPitPasses,
      preparation: this.preparation.snapshot(),
      graphics: { ...this.graphics },
      renderWidth: this.renderWidth,
      renderHeight: this.renderHeight,
      construction: { ...this.circuit.construction.statistics },
      carLods: this.cars.map((car) => car.lodLevel),
      camera: this.renderedMode,
      requestedCamera: this.mode,
      presentedCamera: this.renderedMode,
      tracksideRig: this.trackside.activeId,
      tracksideCuts: this.trackside.cuts,
      broadcastOccluded: this.trackside.occluded,
      broadcastVisibilityCuts: this.trackside.visibilityCuts,
      broadcastSolidOccluders: this.circuit.sightlines.count,
      broadcastSubjectRadius: this.trackside.subjectRadius,
      broadcastFov: this.trackside.fov,
      broadcastSubjectScreenFraction: this.trackside.subjectScreenFraction,
      broadcastFramingFits: this.trackside.framingFits,
      broadcastVisibleSubjectSamples: this.trackside.subjectVisibleSamples,
      broadcastSubjectSampleCount: this.trackside.subjectSampleCount,
      broadcastSubjectWithinRange: this.trackside.subjectWithinRange,
      cameraLocalPosition: this.eyeLocal.toArray(),
      mirrorUpdates: this.reflection.mirrorUpdates,
      mirrorWidth: this.reflection.mirrorWidth,
      reflectionProbeUpdates: this.reflection.probeUpdates,
      reflectionProbeDetailOmitted: this.reflection.probeDetailOmitted,
      shadowCasters: this.shadowProxies.count,
      farShadow: this.farShadow.diagnostics(),
      shadowCasterBytes: this.shadowProxies.bytes,
      skyEnvironmentUpdates: this.environment.captures,
      lighting: this.lighting,
      vegetationTrees: this.circuit.vegetationGroup.userData.treeCount,
      infrastructureDetail: this.circuit.infrastructureDiagnostics(),
      trackInfrastructure: {
        drains: this.circuit.trackInfrastructure.drains.length,
        marshalPosts: this.circuit.trackInfrastructure.marshalPosts.length,
        utilities: this.circuit.trackInfrastructure.utilities.length,
        cameras: this.circuit.trackInfrastructure.cameras.length,
      },
      localProbeActive: this.reflection.localProbeActive,
      reflectionSubject: this.reflectionFollow,
      reflectionIntensity: this.reflectionMaterials[this.follow]?.[0]?.envMapIntensity ?? null,
      visibleSkyIntensity: this.sky.material.uniforms.probeSkyIntensity.value,
      motionBlur: this.motionBlur.diagnostics(),
      scenePass: this.scenePass.diagnostics(),
      grade: this.grade.enabled ? this.grade.profile : 'off',
      automaticExposure: this.exposure.diagnostics(),
      localAtmosphere: this.atmosphere.diagnostics(),
      weatherPresentation: this.weatherPresentation.diagnostics(),
      raceComposition: this.composition.diagnostics(),
      gpuFrameQueue: this.gpuFrames.diagnostics(),
      gpuMilliseconds: this.gpuTimer.milliseconds,
      gpuTimerSupported: this.gpuTimer.supported,
      fps: this.fps,
      frameMs: this.frameMs,
      p1FPS: slowTotal ? (1000 * slowCount) / slowTotal : 0,
      renderCPUms: this.renderMs,
      drawCalls: info.calls,
      triangles: info.triangles,
      // Per-phase attribution of the same completed frame's counters.
      drawBreakdown: this.drawLedger.snapshot(),
      // ULTRA modules: per-pass draws, fetch estimates and GPU timestamps.
      ultra: this.ultra.diagnostics(),
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Restore immutable source images before any asset owner closes its bitmap.
    this.textures.dispose();
    // Each kit removes its owned root before the generic scene disposer, so
    // source, cloned templates, atlas maps and all LODs are released once.
    this.circuit.concreteBarriers?.dispose();
    this.circuit.steelGuardrails?.dispose();
    this.circuit.catchFence?.dispose();
    this.circuit.impactBarriers?.dispose();
    this.circuit.recoveryGates?.dispose();
    this.circuit.marshalPosts?.dispose();
    this.circuit.startGantry?.dispose();
    this.circuit.signalHardware?.dispose();
    this.circuit.trackBoards?.dispose();
    this.circuit.broadcastCameras?.dispose();
    this.circuit.vegetation?.dispose();
    this.circuit.quarry?.dispose();
    this.circuit.secondaryStands.dispose();

    if (this.circuit.tyreBlankets && !this.circuit.tyreBlankets.root.parent)
      this.circuit.tyreBlankets.dispose();
    this.heroShells?.dispose();
    this.rivalLevels?.forEach((asset) => asset.dispose());
    this.driverAsset?.dispose();
    this.suppliedPlayerAsset?.dispose();
    this.tyreEquipment?.dispose();
    if (this.circuit.heroGarage && !this.circuit.heroGarage.root.parent)
      this.circuit.heroGarage.dispose();
    if (this.circuit.pitWallStation && !this.circuit.pitWallStation.root.parent)
      this.circuit.pitWallStation.dispose();
    if (this.circuit.pitBuildingFrontage && !this.circuit.pitBuildingFrontage.root.parent)
      this.circuit.pitBuildingFrontage.dispose();
    this.cars.forEach((car) => car.suppliedPlayer?.disposeAnimation());
    this.circuit.wetReflection.dispose();
    this.ghost?.dispose();
    this.pitCrew.dispose();
    this.gridPerformance.dispose();
    this.reflection.dispose();
    this.shadowProxies.dispose();
    this.farShadow.dispose();
    this.gpuTimer.dispose();
    this.gpuFrames.dispose();
    this.motionBlur.dispose();
    this.exposure.dispose();
    this.weatherPresentation.dispose();
    this.photoFocus?.dispose();
    this.broadcastFocus?.dispose();
    this.geometrySurvey?.dispose();
    this.bloom.dispose();
    this.fxaa.dispose();
    this.scenePass.dispose();
    this.grade.dispose();
    this.ultra.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    const skeletons = new Set<T.Skeleton>();
    this.scene.traverse((o) => {
      if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton);
      // Instance attributes are owned by the object, not its shared geometry.
      // Release them before disposing the renderer's WebGL bookkeeping.
      if (o instanceof T.InstancedMesh) o.dispose();
      if (o instanceof T.Mesh || o instanceof T.Points || o instanceof T.Line) {
        geometries.add(o.geometry);
        if (o instanceof T.Mesh) {
          if (o.customDepthMaterial) materials.add(o.customDepthMaterial);
          if (o.customDistanceMaterial) materials.add(o.customDistanceMaterial);
        }
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(m);
          for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
        }
      }
    });
    for (const skeleton of skeletons) skeleton.dispose();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) {
      t.dispose();
      if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
    }
    this.circuit.stateTexture.dispose();
    this.environment.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
