import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AudioViewTracker } from '../../audio/spatial.ts';
import { clamp } from '../../core/math.ts';
import type { FestivalEvent } from '../../simulation/open-world/festival-events.ts';
import { carvedGroundHeight } from '../../simulation/open-world/ground-height.ts';
import type { Structure } from '../../simulation/open-world/placement.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { MATERIAL } from '../../simulation/surface-material.ts';
import { BroadcastGradePass } from '../broadcast-grade.ts';
import {
  bindSkyCelestial,
  circuitLightState,
  configureSky,
  lightingDirection,
  shadowAnchor,
  SkyEnvironment,
  type LightingMode,
} from '../daylight.ts';
import { FarShadow } from '../far-shadow.ts';
import { PresentedFrame } from '../frame-state.ts';
import { LensBloomPass } from '../lens-bloom.ts';
import { applyCircuitLightPalette } from '../lighting-coherence.ts';
import {
  bufferSize,
  detailTier,
  graphicsPreset,
  validateGraphics,
  type GraphicsOptions,
  type QualityPreset,
} from '../options.ts';
import { SceneAmbientPass } from '../scene-ambient-pass.ts';
import { prewarmSky } from '../sky-light.ts';
import { postLensFrame } from '../studio/lens-effects.ts';
import { SKY_CLOUDS } from '../studio/sky-clouds.ts';
import { studioUniforms } from '../studio/studio-frame.ts';
import { UltraPipeline } from '../ultra/pipeline.ts';
import { PhotoSky } from '../assets/photo-sky.ts';
import { scannedGround } from '../ground/scan-store.ts';
import { FESTIVAL_PALETTE } from '../assets/sky-catalogue.ts';
import { WetRoadReflection } from '../wet-reflection.ts';
import { Buildings } from './buildings.ts';
import { FestivalCars } from './festival-cars.ts';
import { EventMarkers } from './markers.ts';
import { RoadMeshes } from './roads.ts';
import { RoadFurniture } from './road-furniture.ts';
import { TERRAIN_BUDGETS, TerrainStreamer } from './terrain.ts';
import { Vegetation } from './vegetation.ts';
import { FestivalFlora } from './flora.ts';
import { installSeasonLibrary, installSeasonMeadow, installSeasonRoads } from './season-flora.ts';
import { photoVegetationEnabled, VegetationLibrary } from '../vegetation/library.ts';
import { speciesForPalette } from '../vegetation/species.ts';
import { Water } from './water.ts';
import { Effects } from '../effects.ts';
import { EffectPlayback } from '../effect-playback.ts';
import { ReflectionSystem } from '../reflections.ts';
import {
  iblUniforms,
  installSpecularIBL,
  installSpecularIBLMaterial,
  setIblEnergy,
} from '../studio/ibl-energy.ts';
import { StreetLightPools } from './street-light-pools.ts';
import { surfaceDampness } from '../weather-presentation.ts';
import { SolvaneDetails } from './solvane-details.ts';
import { StreetDetails } from './street-details.ts';
import { FestivalContactShadows } from './contact-shadows.ts';
import { clearCameraBoom } from './camera-clearance.ts';
import { FestivalChaseDynamics, advanceChaseSpring } from './chase-dynamics.ts';
import { driftFeedback, type DriftCue } from '../../simulation/open-world/drift-feedback.ts';
import { HorizonGuidance } from './horizon-guidance.ts';
import { FestivalTrails } from './festival-trails.ts';
import { HorizonDressing } from './horizon-dressing.ts';
import { DistantLandscape } from './distant-landscape.ts';
import { FestivalAtmosphere, festivalGrade } from './festival-atmosphere.ts';
import {
  FestivalSky,
  FestivalSkyClouds,
  festivalCloudCover,
  festivalLight,
  sunFacing,
} from './festival-sky.ts';
import { setCloudShadow } from '../studio/cloud-shadow.ts';
import { FestivalDriftSmoke } from './drift-smoke.ts';
import { FestivalEventDressing } from './event-dressing.ts';
import { DragStrip, type DragView } from './drag-strip.ts';
import { FestivalSpeedBlur } from './speed-blur.ts';
import { applySeason, SEASONS, type Season } from './season.ts';
import { architecturePlan } from './japan-architecture.ts';
import { FestivalSignage } from './festival-signage.ts';
import {
  createFestivalContactOffset,
  festivalContactEnabled,
  festivalDiffuserEnabled,
} from './festival-contacts.ts';

export type FestivalCamera = 'chase' | 'far' | 'hood';
const CAMERAS: readonly FestivalCamera[] = ['chase', 'far', 'hood'];
/** Chase rigs (m): distance behind, height, look-ahead, look lift, fov.
 * The chase rig is measured from the in-race reference frames (FH6 ref
 * 041/042): at rest the horizon sits at ~40 % of the frame height, the
 * car's rear bumper at ~92 % and its roof at ~55 %, the car ~30 % of the
 * frame width (eye ~1.9 m above the road, ~5 m behind the car's centre). */
const RIGS = {
  chase: { distance: 5.0, height: 1.45, perMs: 0.016, lookAhead: 8, lift: 0.08, fov: 57 },
  far: { distance: 11, height: 3.6, perMs: 0.03, lookAhead: 10, lift: 1.1, fov: 58 },
} as const;

/**
 * Renderer of the festival region. It shares the application's WebGL
 * context (the circuit renderer stays loaded but idle) and reuses the
 * production lighting and image chain: the physical sky dome with baked
 * clouds and its PMREM environment (daylight.ts), the circuit light palette,
 * sun shadows anchored in light space, the multisampled ambient scene pass,
 * lens bloom, output transform, FXAA and the broadcast grade, and the ULTRA
 * modules (TAA+CAS, SSR, temporal GTAO, sun shafts, AgX/Neutral) where the
 * preset and device enable them. The world is streamed terrain, the road
 * network meshes, procedural buildings, instanced vegetation, sea and river
 * and the event markers.
 */
export class FestivalRenderer {
  readonly scene = new T.Scene();
  // Far plane past the distant ranges and the volcano (to 48 km from any
  // point of the region). Depth precision is set by the near plane
  // (d^2 / (near * 2^24)), so this costs nothing nearer than 26 km.
  readonly camera = new T.PerspectiveCamera(60, 1, 0.3, 90000);
  readonly terrain: TerrainStreamer;
  readonly roads: RoadMeshes;
  readonly furniture: RoadFurniture;
  readonly streetLights: StreetLightPools;
  readonly buildings: Buildings;
  readonly dressing: HorizonDressing;
  /** Landmark volcano and the ranges beyond the streamed terrain. */
  readonly distant: DistantLandscape;
  /** Aerial perspective of the region (replaces FogExp2 on its materials). */
  readonly atmosphere = new FestivalAtmosphere();
  readonly signage: FestivalSignage;
  details: SolvaneDetails | null = null;
  private detailLoading: Promise<boolean> | null = null;
  streetDetails: StreetDetails | null = null;
  private streetLoading: Promise<boolean> | null = null;
  readonly contacts = new FestivalContactShadows();
  private readonly cameraAnchor = new T.Vector3();
  readonly chaseDynamics = new FestivalChaseDynamics();
  driftCue: DriftCue | null = null;
  readonly vegetation = new Vegetation();
  /** Susuki, wildflowers and bamboo groves (decorative, season-shaded). */
  readonly flora: FestivalFlora;
  /** Photographic trees and shrubs, when loaded (see loadPhotoVegetation). */
  photoVegetation: VegetationLibrary | null = null;
  readonly water: Water;
  readonly markers: EventMarkers;
  readonly cars = new FestivalCars();
  readonly effects = new Effects();
  private readonly effectPlayback = new EffectPlayback(this.effects);
  readonly guidance = new HorizonGuidance();
  readonly trails = new FestivalTrails();
  readonly smoke = new FestivalDriftSmoke();
  readonly eventDressing: FestivalEventDressing;
  private readonly speedBlur: FestivalSpeedBlur;
  private readonly bufferSize = new T.Vector2();
  private readonly reflection = new ReflectionSystem();
  private readonly reflectionMaterials: T.MeshStandardMaterial[] = [];
  private reflectionVersion = -1;
  private readonly vehicleRoots: T.Object3D[] = [];
  private readonly vehiclePaint: T.MeshStandardMaterial[] = [];
  private vehiclePaintVersion = 0;
  private reflectedVehicleVersion = -1;
  private readonly events: ReadonlyMap<string, FestivalEvent>;
  private readonly orbit: OrbitControls;
  photo = false;
  readonly audioView = new AudioViewTracker();
  readonly presented = new PresentedFrame();
  readonly sun = new T.DirectionalLight(0xfff0dc, 3.9);
  private readonly hemisphere = new T.HemisphereLight(0x8fb6ea, 0x4a4237, 0.14);
  private readonly sky = new Sky();
  private readonly environment: SkyEnvironment;
  /** Photographed CC0 sky of the region (assets/photo-sky.ts). */
  readonly photoSky = new PhotoSky(FESTIVAL_PALETTE, true);
  /** The festival's binding of it: skyline, horizon band, baked clouds. */
  private readonly festivalSky = new FestivalSky(this.photoSky);
  private readonly clouds: FestivalSkyClouds;
  private readonly composer: EffectComposer;
  private readonly scenePass: SceneAmbientPass;
  private readonly bloom = new LensBloomPass();
  private readonly grade = new BroadcastGradePass();
  private readonly fxaa = new ShaderPass(FXAAShader);
  readonly ultra: UltraPipeline;
  private readonly farShadow = new FarShadow(1024);
  private readonly wet = new WetRoadReflection();
  graphics: GraphicsOptions = graphicsPreset('medium');
  preset: QualityPreset = 'medium';
  lighting: LightingMode = 'day';
  private currentSeason: Season = 'summer';
  /** Presentation season (foliage, ground cover, snow, petals). */
  get season(): Season {
    return this.currentSeason;
  }
  set season(value: Season) {
    this.currentSeason = value;
    applySeason(value);
  }
  mode: FestivalCamera = 'chase';
  lookX = 0;
  private readonly target = new T.Vector3();
  private readonly desired = new T.Vector3();
  private readonly gaze = new T.Vector3();
  private readonly velocity = new T.Vector3();
  private readonly forward = new T.Vector3();
  private readonly temp = new T.Vector3();
  private readonly temp2 = new T.Vector2();
  private readonly basis = new T.Quaternion();
  private readonly euler = new T.Euler();
  private initialized = false;
  private lastTime = NaN;
  private readonly lastSubject = new T.Vector3(NaN, NaN, NaN);
  private lastVehicle = -1;
  private disposed = false;
  private readonly heightAt = (x: number, z: number, y?: number) => this.groundHeight(x, z, y);
  readonly discovered = new Set<string>();
  activeEvent: string | null = null;
  gate: { x: number; z: number } | null = null;
  /** The running drag's tree and lanes (status), sequencing the 3D lights. */
  drag: DragView | null = null;
  readonly dragStrip: DragStrip;
  stats = { drawCalls: 0, triangles: 0, renderMs: 0 };
  constructor(
    readonly renderer: T.WebGLRenderer,
    readonly canvas: HTMLCanvasElement,
    readonly world: OpenWorld,
    events: readonly FestivalEvent[],
    readonly structures: readonly Structure[],
    tileWorker: Worker,
  ) {
    const scene = this.scene;
    // The season uniforms are shared module state: start every session clean.
    applySeason(this.currentSeason);
    this.events = new Map(events.map((event) => [event.spec.id, event]));
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.minDistance = 2.5;
    this.orbit.maxDistance = 22;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.enablePan = false;
    this.reflection.probeFacesPerFrame = 1;
    this.reflection.probeExclusions = [
      this.cars.root,
      this.effects.group,
      this.guidance.root,
      this.trails.root,
      this.contacts.root,
      this.smoke.root,
    ];
    this.effects.looseColours = new Map([
      [MATERIAL.DIRT, [0.43, 0.32, 0.19] as const],
      [MATERIAL.MUD, [0.23, 0.19, 0.14] as const],
      [MATERIAL.SAND, [0.69, 0.59, 0.4] as const],
      [MATERIAL.SNOW, [0.81, 0.85, 0.89] as const],
      [MATERIAL.GRAVEL_ROAD, [0.51, 0.47, 0.39] as const],
    ]);
    this.effects.contactOffset = createFestivalContactOffset(this.heightAt);
    this.effects.contactEnabled = festivalContactEnabled;
    this.effects.diffuserEnabled = festivalDiffuserEnabled;
    scene.name = 'Festival region';
    this.sky.scale.setScalar(450000);
    this.sky.userData.excludeMotionBlur = true;
    configureSky(this.sky);
    this.clouds = FestivalSkyClouds.forFestival(this.sky.material, lightingDirection);
    this.photoSky.setQuality(this.preset);
    this.environment = new SkyEnvironment(this.sky, this.clouds, this.festivalSky);
    scene.add(this.sky);
    scene.environmentIntensity = 0.7;
    scene.fog = new T.FogExp2(0xb9c7c1, 0.00012);
    scene.add(this.hemisphere, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -70,
      right: 70,
      top: 70,
      bottom: -70,
      near: 20,
      far: 900,
    });
    this.sun.shadow.bias = -0.00003;
    this.sun.shadow.normalBias = 0.02;
    this.terrain = new TerrainStreamer(tileWorker, TERRAIN_BUDGETS.medium);
    this.roads = new RoadMeshes(world.network, world.field);
    this.furniture = new RoadFurniture(world, structures, (x, z) => this.groundHeight(x, z));
    this.streetLights = new StreetLightPools([
      ...this.roads.lampSockets,
      ...this.furniture.lampSockets,
    ]);
    scene.add(this.streetLights.root);
    const architecture = architecturePlan(world, structures);
    this.buildings = new Buildings(structures, architecture);
    this.dressing = new HorizonDressing(world, structures);
    this.flora = new FestivalFlora(world, structures);
    // Season cover on the festival's own road and meadow materials.
    installSeasonRoads(this.roads.materials);
    installSeasonMeadow(this.dressing.root);
    this.distant = new DistantLandscape(
      (x, z, wavelength) => world.field.height(x, z, wavelength),
      world.field.region.seed,
    );
    scene.add(this.distant.root);
    this.signage = new FestivalSignage(world, structures, architecture);
    this.water = new Water(world.field);
    this.markers = new EventMarkers(events, (x, z) => this.groundHeight(x, z));
    this.reflection.probeExclusions.push(this.markers.root);
    this.eventDressing = new FestivalEventDressing(events, world, structures, this.heightAt);
    this.dragStrip = new DragStrip(
      events.find((e) => e.spec.kind === 'drag') ?? null,
      this.eventDressing.startLamps,
      this.heightAt,
    );
    scene.add(
      this.terrain.root,
      this.roads.root,
      this.furniture.root,
      this.buildings.root,
      this.dressing.root,
      this.signage.root,
      this.vegetation.root,
      this.flora.root,
      this.water.root,
      this.markers.root,
      this.cars.root,
      this.effects.group,
      this.guidance.root,
      this.trails.root,
      this.contacts.root,
      this.smoke.root,
      this.eventDressing.root,
      this.dragStrip.root,
    );
    installSpecularIBL(scene);
    installSpecularIBLMaterial(this.terrain.material);
    this.composer = new EffectComposer(renderer);
    this.scenePass = new SceneAmbientPass(scene, this.camera, this.graphics.msaa);
    this.composer.addPass(this.scenePass);
    // Festival speed blur: the shared depth-reprojected camera blur, gathered
    // in this scene pass's composite (no extra draw).
    this.speedBlur = new FestivalSpeedBlur(renderer.extensions.has('EXT_color_buffer_float'));
    this.scenePass.attach(this.speedBlur.motion);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.fxaa);
    this.composer.addPass(this.grade);
    // The festival's own grade over the shared profiles (festival-atmosphere.ts).
    this.grade.profileAdjust = festivalGrade;
    this.ultra = new UltraPipeline({
      renderer,
      scene,
      camera: this.camera,
      composer: this.composer,
      scenePass: this.scenePass,
      bloom: this.bloom,
      grade: this.grade,
      sun: this.sun,
      farShadow: this.farShadow,
      wetReflection: this.wet,
      roadMaterial: this.roads.materials.asphalt,
    });
    prewarmSky('day');
  }
  /** Separately posed motorcycles belong to the same reflection system,
   * and must not appear inside the probe taken at their own position. */
  registerVehicleRoot(root: T.Object3D) {
    if (this.vehicleRoots.includes(root)) return;
    this.vehicleRoots.push(root);
    this.reflection.probeExclusions.push(root);
    this.refreshVehicleMaterials();
  }
  refreshVehicleMaterials() {
    const unique = new Set<T.MeshStandardMaterial>();
    for (const root of this.vehicleRoots) {
      installSpecularIBL(root);
      root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          if (material instanceof T.MeshPhysicalMaterial && material.clearcoat > 0)
            unique.add(material);
      });
    }
    this.vehiclePaint.length = 0;
    this.vehiclePaint.push(...unique);
    this.vehiclePaintVersion++;
  }
  /** Keep road queries analytic on the requested height layer. Off-road
   * points and ground beneath bridges use the existing carved surface. */
  groundHeight(x: number, z: number, y?: number) {
    const net = this.world.network,
      p = {
        s: 0,
        x: 0,
        y: 0,
        z: 0,
        tx: 0,
        tz: 1,
        nx: 1,
        nz: 0,
        curvature: 0,
        width: 0,
        bank: 0,
        gradient: 0,
      };
    const l = net.nearest(x, z, p, y),
      e = net.edges[net.edgeOf[net.lastSegment]],
      reach = e.spec.halfWidth + e.spec.shoulder,
      layered = y !== undefined && Number.isFinite(y);
    // A height-matching segment can end far ahead of this point. Its
    // lateral offset alone does not establish a road footprint here.
    if (net.lastLayerMatch && Math.abs(l) < reach && (!layered || net.lastDistance < reach))
      return net.surfaceHeight(p, l, e.spec.halfWidth, e.spec.crown);
    return carvedGroundHeight(this.world.carver, x, z);
  }
  /** Load the photographic trees and shrubs (not on LOW); call before the
   * world streams so every tile is planted the same way. Failures keep the
   * procedural crowns. */
  async loadPhotoVegetation() {
    if (this.photoVegetation || !photoVegetationEnabled(this.preset)) return false;
    try {
      const library = await VegetationLibrary.load(
        this.renderer,
        speciesForPalette(FESTIVAL_PALETTE, true, true),
      );
      if (!library.trees.length) {
        library.dispose();
        return false;
      }
      this.photoVegetation = library;
      installSeasonLibrary(library);
      this.dressing.usePhotoVegetation(library);
      // Trees never stand on roads: the natural ground alone (cheap per tile).
      this.vegetation.setPhotoLibrary(library, (x, z) => this.world.field.height(x, z));
      return true;
    } catch (error) {
      console.warn('Festival photographic vegetation unavailable:', error);
      return false;
    }
  }
  loadAuthoredDetails(): Promise<boolean> {
    if (this.details) return Promise.resolve(true);
    if (this.detailLoading) return this.detailLoading;
    this.detailLoading = SolvaneDetails.load(this.world, this.structures, () => this.disposed)
      .then((kit) => {
        this.details = kit;
        this.scene.add(kit.root);
        this.reflection.probeExclusions.push(kit.aero);
        this.guidance.useFlagTemplate(kit.flagTemplate(this.preset === 'low'));
        if (kit.stats.boats === this.dressing.stats.boats) this.dressing.useAuthoredBoats();
        return true;
      })
      .catch((error: unknown) => {
        if (!this.disposed) console.warn('Festival authored detail fallback:', error);
        return false;
      })
      .finally(() => {
        this.detailLoading = null;
      });
    return this.detailLoading;
  }
  loadStreetDetails(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.streetDetails) return Promise.resolve(true);
    if (this.streetLoading) return this.streetLoading;
    this.streetLoading = StreetDetails.load(this.world, this.structures, () => this.disposed)
      .then((kit) => {
        // Closing the session can race the microtask after the loader resolves.
        if (this.disposed) {
          kit.dispose();
          return false;
        }
        this.streetDetails = kit;
        this.scene.add(kit.root);
        return true;
      })
      .catch((error: unknown) => {
        if (!this.disposed) console.warn('Festival street detail fallback:', error);
        return false;
      })
      .finally(() => {
        this.streetLoading = null;
      });
    return this.streetLoading;
  }
  setQuality(preset: QualityPreset, options: GraphicsOptions = graphicsPreset(preset)) {
    const flagTierChanged = (preset === 'low') !== (this.preset === 'low');
    this.preset = preset;
    if (this.details && flagTierChanged)
      this.guidance.useFlagTemplate(this.details.flagTemplate(preset === 'low'));
    this.graphics = this.ultra.deviceGraphics(validateGraphics(options, preset));
    const g = this.graphics,
      tier = detailTier(preset);
    this.renderer.shadowMap.enabled = g.shadowSize > 0;
    if (g.shadowSize > 0 && this.sun.shadow.mapSize.x !== g.shadowSize) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(g.shadowSize, g.shadowSize);
    }
    this.sun.castShadow = g.shadowSize > 0;
    this.bloom.enabled = g.bloom;
    this.scenePass.setSamples(Math.min(g.msaa, this.renderer.capabilities.maxSamples));
    this.fxaa.enabled = g.antialias && this.scenePass.samples === 0;
    this.scenePass.ambientOcclusion = g.ambientOcclusion;
    this.scenePass.temporal.enabled = g.temporalAA;
    this.grade.enabled = g.filmGrade;
    this.effects.enabled = g.particleDensity > 0;
    this.effects.density = g.particleDensity;
    this.trails.enabled = preset !== 'low';
    this.smoke.setQuality(preset);
    const budget = TERRAIN_BUDGETS[tier];
    this.terrain.budget = { ...budget, trees: budget.trees * clamp(g.vegetationDensity, 0, 1) };
    this.environment.highDetail = g.reflections === 'local';
    this.photoSky.setQuality(preset);
    scannedGround.attach(this.renderer, preset);
    this.ultra.configure(preset, g);
    this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth,
      h = this.canvas.clientHeight || innerHeight;
    const size = bufferSize(
      w,
      h,
      Math.min(devicePixelRatio, 1.5) * this.graphics.resolutionScale,
      this.renderer.capabilities.maxTextureSize,
    );
    const ratio = Math.min(size.width / w, size.height / h);
    const current = this.renderer.getSize(new T.Vector2());
    if (current.x !== w || current.y !== h || this.renderer.getPixelRatio() !== ratio)
      this.renderer.setDrawingBufferSize(w, h, ratio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    const actual = this.renderer.getDrawingBufferSize(new T.Vector2());
    this.fxaa.uniforms.resolution.value.set(1 / actual.x, 1 / actual.y);
  }
  changeCamera(mode?: FestivalCamera) {
    this.mode = mode ?? CAMERAS[(CAMERAS.indexOf(this.mode) + 1) % CAMERAS.length];
    this.initialized = false;
    this.audioView.reset();
  }
  /** Pause is owned by FestivalSession. This only changes the presentation. */
  setPhoto(active: boolean) {
    this.photo = active;
    this.orbit.enabled = active;
    if (active) {
      this.orbit.target.copy(this.target).add(new T.Vector3(0, 0.6, 0));
      this.camera.fov = 45;
      this.camera.updateProjectionMatrix();
      this.orbit.update();
    } else {
      this.initialized = false;
      this.audioView.reset();
    }
  }
  photoAngle(angle: number) {
    if (!this.photo) return;
    const offset = this.camera.position.clone().sub(this.orbit.target);
    offset.applyAxisAngle(new T.Vector3(0, 1, 0), angle);
    this.camera.position.copy(this.orbit.target).add(offset);
    this.orbit.update();
  }
  /** Night amount of the current lighting (lamps, windows, headlights). */
  get night() {
    return this.lighting === 'night' ? 1 : this.lighting === 'sunset' ? 0.25 : 0;
  }
  /** Is the terrain under (x, z) and the coarse cover resident? */
  ready(x: number, z: number) {
    return this.terrain.readyAround(x, z);
  }
  /** Stream terrain only (loading screen), without drawing. */
  prestream(x: number, z: number) {
    this.camera.position.set(x, this.groundHeight(x, z) + 3, z);
    this.camera.updateMatrixWorld();
    this.terrain.update(this.camera);
    // Built once per tier, while the loading screen is up.
    this.distant.setQuality(this.preset);
  }
  draw(a: Float32Array, b: Float32Array, alpha: number, dt: number) {
    if (this.disposed) return;
    const start = performance.now();
    dt = clamp(dt, 1 / 300, 0.08);
    if (a.length !== b.length || a[H.CARS] !== b[H.CARS] || b[H.TIME] < a[H.TIME]) a = b;
    const presented = this.presented.sample(a, b, a === b ? 1 : clamp(alpha, 0, 1));
    const time = presented[H.TIME];
    const night = this.night;
    this.cars.update(
      a,
      b,
      presented,
      a === b ? 1 : alpha,
      dt,
      night,
      this.camera,
      this.mode === 'hood' && !this.photo,
      detailTier(this.preset),
    );
    const o = carBase(0),
      subject = this.cars.subject(0);
    const speed = presented[o + F.SPEED];
    this.target.set(presented[o + F.X], presented[o + F.Y], presented[o + F.Z]);
    // --- Camera ---------------------------------------------------------
    const vehicle = Math.round(presented[o + RACE_BASE + R.VEHICLE]);
    const elapsed = time - this.lastTime;
    // A camera change or a slow GPU is not a simulation discontinuity.
    // Reject physical jumps while allowing normal distance covered in a stall.
    const discontinuity =
      vehicle !== this.lastVehicle ||
      !(elapsed >= 0) ||
      this.lastSubject.distanceTo(this.target) >
        Math.max(24, Math.abs(speed) * Math.max(0, elapsed) * 1.8 + 10);
    const cut = !this.initialized || discontinuity || elapsed > 1;
    this.lastSubject.copy(this.target);
    this.lastVehicle = vehicle;
    this.lastTime = time;
    if (subject) this.forward.set(0, 0, 1).applyQuaternion(subject.quaternion);
    const bodyYaw = Math.atan2(this.forward.x, this.forward.z);
    const localLateral =
      presented[o + F.VX] * Math.cos(bodyYaw) - presented[o + F.VZ] * Math.sin(bodyYaw);
    const localForward =
      presented[o + F.VX] * Math.sin(bodyYaw) + presented[o + F.VZ] * Math.cos(bodyYaw);
    let grounded = false;
    for (let w = 0; w < 4; w++)
      grounded ||= presented[o + WHEEL_BASE + w * WHEEL_STRIDE + W.LOAD] > 40;
    this.driftCue = driftFeedback(localLateral, localForward, grounded);

    if (this.photo) {
      this.orbit.update();
      // This orbit stays attached to the subject. Raising the camera under
      // a bridge must not switch its clearance surface to the upper deck.
      this.camera.position.y = Math.max(
        this.camera.position.y,
        this.groundHeight(this.camera.position.x, this.camera.position.z, this.target.y) + 0.45,
      );
      this.gaze.copy(this.orbit.target);
    } else if (this.mode === 'hood' && subject) {
      this.desired.set(0, 1.18, 0.35).applyQuaternion(subject.quaternion).add(this.target);
      this.temp
        .set(Math.sin(this.lookX) * 30, 0.6, Math.cos(this.lookX) * 30)
        .applyQuaternion(subject.quaternion);
      this.gaze.copy(this.desired).add(this.temp);
      this.camera.position.copy(this.desired);
      this.camera.fov = 66;
      this.velocity.set(0, 0, 0);
    } else {
      const rig = RIGS[this.mode === 'far' ? 'far' : 'chase'];
      const pitch = Math.asin(clamp(this.forward.y, -0.4, 0.4));
      const motion = this.chaseDynamics.update(
        {
          speed,
          forward: localForward,
          lateral: localLateral,
          yawRate: presented[o + F.WY],
          longitudinalG: presented[o + F.G_LONG],
        },
        Math.max(0, Math.min(elapsed, dt)),
        cut,
      );
      const yaw = bodyYaw + motion.yaw;
      this.basis.setFromEuler(this.euler.set(-pitch, yaw + this.lookX, 0, 'YXZ'));
      this.desired
        .set(
          0,
          rig.height + Math.min(0.6, Math.abs(speed) * 0.005) + motion.height,
          -rig.distance - Math.abs(speed) * rig.perMs - motion.distance,
        )
        .applyQuaternion(this.basis)
        .add(this.target);
      this.cameraAnchor.copy(this.target);
      this.cameraAnchor.y += 0.9;
      // Never below the ground (hills behind the car).
      const ground = this.groundHeight(this.desired.x, this.desired.z, this.target.y) + 0.8;
      if (this.desired.y < ground) this.desired.y = ground;
      clearCameraBoom(this.cameraAnchor, this.desired, this.structures, this.desired);
      this.temp
        .set(Math.sin(motion.lookYaw), 0, Math.cos(motion.lookYaw))
        .applyQuaternion(this.basis);
      this.gaze.copy(this.target).addScaledVector(this.temp, rig.lookAhead + motion.lookAhead);
      this.gaze.y += rig.lift;
      const fov = rig.fov + motion.fov;
      this.camera.fov += (fov - this.camera.fov) * (cut ? 1 : 1 - Math.exp(-dt * 4));
      if (cut) {
        this.camera.position.copy(this.desired);
        this.velocity.set(0, 0, 0);
      } else {
        advanceChaseSpring(this.camera.position, this.velocity, this.desired, 9, dt);
      }
    }
    if (!this.photo && this.mode !== 'hood') {
      if (
        clearCameraBoom(
          this.cameraAnchor,
          this.camera.position,
          this.structures,
          this.camera.position,
        )
      )
        this.velocity.set(0, 0, 0);
    }
    this.initialized = true;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.gaze);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // --- World streaming and dressing -------------------------------------
    this.terrain.update(this.camera);
    this.buildings.update(this.camera, this.preset);
    if (this.terrain.treesChanged) {
      this.terrain.treesChanged = false;
      this.vegetation.sync(this.terrain.treeTiles);
    }
    this.vegetation.update(this.camera, this.preset);
    this.markers.update(time, this.discovered, this.activeEvent, this.gate, (x, z) =>
      this.groundHeight(x, z),
    );
    this.markers.root.visible = !this.photo;
    if (discontinuity) this.guidance.reset();
    this.guidance.update(
      this.activeEvent ? (this.events.get(this.activeEvent) ?? null) : null,
      this.gate,
      this.target,
      speed,
      this.heightAt,
      surfaceDampness(presented[H.RAIN], presented[H.WATER]),
    );
    if (this.photo) this.guidance.root.visible = false;
    if (discontinuity) {
      this.effectPlayback.reset();
      // Travel/recovery may keep time and the current car's material identity.
      // Capture the destination even if the player immediately pauses for a photo.
      this.reflection.invalidate();
    }
    this.effectPlayback.update(presented, true, true);
    this.effects.setSignalLights(presented, true);
    this.trails.update(presented, this.heightAt);
    this.smoke.update(presented, this.heightAt);
    this.roads.setNight(night);
    this.furniture.setNight(night);
    this.furniture.update(
      this.camera,
      this.preset,
      this.renderer.getDrawingBufferSize(this.temp2).y,
    );
    this.buildings.setNight(night);
    this.dressing.update(time, night, this.camera, this.preset);
    this.flora.update(this.camera, this.preset);
    this.distant.setQuality(this.preset);
    this.distant.update(this.lighting, SEASONS.indexOf(this.currentSeason));
    this.eventDressing.update(this.camera, night, this.preset, time);
    this.dragStrip.update(time, this.drag, this.camera);
    this.signage.update(time, night, this.camera, this.preset);
    this.details?.update(
      time,
      night,
      this.camera,
      this.preset,
      surfaceDampness(presented[H.RAIN], presented[H.WATER]),
    );
    this.streetDetails?.update(
      this.camera,
      this.preset,
      surfaceDampness(presented[H.RAIN], presented[H.WATER]),
    );
    this.contacts.update(presented, this.camera, this.preset, this.heightAt);
    this.streetLights.update(this.camera, night, this.preset, dt);
    if (this.details?.poseAero(presented, subject ?? null, dt, this.camera))
      this.cars.bodies.hideRearWing(0);
    // --- Lighting -----------------------------------------------------------
    const mode = this.lighting,
      daylight = circuitLightState(presented[H.CLOUD], presented[H.RAIN], mode);
    if (mode === 'night') {
      // Local town fixtures now illuminate the road. Keep a modest diffuse
      // floor for rural sections outside those bounded pools so the unlit
      // rear and roadside architecture retain shape without clipping lamps.
      daylight.sun = 0.28 * (1 - daylight.cover * 0.35);
      daylight.fill = 1.0 + daylight.cover * 0.15;
      daylight.environment = 0.2 + daylight.cover * 0.04;
      daylight.exposure = 1.12 - clamp(presented[H.RAIN], 0, 60) * 0.0005;
    }
    festivalLight(
      daylight,
      mode,
      this.festivalSky.capturedClouds,
      sunFacing(this.camera.getWorldDirection(this.temp), lightingDirection(mode)),
    );
    // The festival's own air (festival-atmosphere.ts): the art-bible horizon
    // as in-scatter, not the photographed dome's (its clear-day photo has a
    // brown desert horizon), and clean-air extinction per lighting.
    this.atmosphere.update(mode, daylight.cover, presented[H.RAIN]);
    applyCircuitLightPalette(this.sun, this.hemisphere, daylight.cover, mode);
    this.sun.intensity = daylight.sun;
    this.hemisphere.intensity = daylight.fill;
    this.scene.environmentIntensity = daylight.environment;
    // Festival may follow any circuit lighting state in the shared renderer.
    // Set its own sky energy every frame instead of inheriting that state.
    setIblEnergy(daylight.environment, mode);
    const saturation = this.photoSky.irradianceSaturation(
      daylight.cover,
      mode,
      iblUniforms.apexSkyIrradianceSaturation.value,
    );
    if (saturation !== null) iblUniforms.apexSkyIrradianceSaturation.value = saturation;
    this.renderer.toneMappingExposure = daylight.exposure;
    const fog = this.scene.fog as T.FogExp2;
    // FogExp2 only for materials without the festival air (see atmosphere).
    fog.density = this.atmosphere.fogDensity;
    fog.color.copy(this.atmosphere.inscatter);
    // Shaded side of the drift smoke: a neutral sky fill standing in for the
    // IBL the scene's opaque surfaces receive (rubber smoke reads white-grey,
    // not the colour of the horizon haze).
    const fill = 0.8 * daylight.environment;
    this.smoke.setFill(0.7 * fill, 0.74 * fill, 0.8 * fill);
    const uniforms = this.sky.material.uniforms;
    uniforms.cloudCover.value = daylight.cover;
    uniforms.skyRadiance.value = daylight.skyRadiance;
    uniforms.nightAmount.value = mode === 'night' ? 1 : 0;
    uniforms.sunsetAmount.value = mode === 'sunset' ? 1 : 0;
    uniforms.sunPosition.value.copy(lightingDirection(mode));
    bindSkyCelestial(this.sky.material, mode);
    this.festivalSky.horizon.copy(this.atmosphere.inscatter);
    this.festivalSky.bind(this.sky.material, daylight.cover, mode, false);
    uniforms.cloudDrift.value = (time * SKY_CLOUDS.driftPerSecond) % 1;
    shadowAnchor(
      this.target,
      this.sun.shadow.mapSize.x,
      this.sun.shadow.camera.right,
      this.sun.target.position,
      mode,
    );
    this.sun.position
      .copy(this.sun.target.position)
      .add(this.temp.copy(lightingDirection(mode)).normalize().multiplyScalar(400));
    this.sun.target.updateMatrixWorld();
    const wet = clamp(presented[H.WATER] / 0.8, 0, 1);
    this.roads.setWet(wet);
    this.buildings.setWet(wet);
    this.terrain.material.userData.ow.owWet.value = wet;
    studioUniforms.studioTime.value = time;
    // A light onshore breeze for the planting (no weather wind in free roam).
    studioUniforms.studioWind.value.set(2.6, 1.4, time, 0.5);
    // --- Render ---------------------------------------------------------------
    // Materials streamed or loaded since the last frame get the festival air
    // before they first draw (vehicles, effects and overlays keep FogExp2).
    this.atmosphere.install(this.scene, [
      this.cars.root,
      this.effects.group,
      this.guidance.root,
      this.trails.root,
      this.contacts.root,
      this.markers.root,
      this.distant.root,
      ...this.vehicleRoots,
    ]);
    this.renderer.info.reset();
    this.renderer.info.autoReset = false;
    this.environment.update(this.renderer, this.scene, daylight.cover, mode);
    // Cloud shadows follow the clouds the festival dome shows.
    setCloudShadow(
      this.clouds.fieldTexture,
      festivalCloudCover(daylight.cover, mode),
      mode,
      lightingDirection(mode),
      uniforms.cloudDrift.value as number,
    );
    if (
      this.reflectionVersion !== this.cars.paintVersion ||
      this.reflectedVehicleVersion !== this.vehiclePaintVersion
    ) {
      this.reflection.updateProbe(
        this.renderer,
        this.scene,
        subject ?? this.cars.root,
        this.reflectionMaterials,
        false,
      );
      this.reflection.invalidate();
      this.reflectionMaterials.length = 0;
      for (const material of this.cars.reflectivePaint)
        if (material instanceof T.MeshStandardMaterial) this.reflectionMaterials.push(material);
      this.reflectionMaterials.push(...this.vehiclePaint);
      for (const surface of ['asphalt', 'asphaltMajor', 'town'] as const) {
        const material = this.roads.materials[surface];
        if (material instanceof T.MeshStandardMaterial) this.reflectionMaterials.push(material);
      }
      this.reflectionVersion = this.cars.paintVersion;
      this.reflectedVehicleVersion = this.vehiclePaintVersion;
    }
    this.reflection.beginFrame(time, false);
    this.reflection.setSkyIntensity(
      this.reflectionMaterials,
      daylight.environment,
      iblUniforms.apexSpecularIBL.value,
    );
    if (subject)
      this.reflection.updateProbe(
        this.renderer,
        this.scene,
        subject,
        this.reflectionMaterials,
        this.graphics.reflections === 'local',
        wet > 0.15 ? 0.8 : 2,
        this.sky.material.uniforms.probeSkyIntensity,
      );
    this.audioView.update(this.camera, time, 0, this.mode === 'hood', 0);
    postLensFrame(
      this.grade,
      this.bloom,
      presented,
      mode,
      this.graphics.lensEffects,
      this.camera,
      this.mode === 'hood' ? 'cockpit' : 'chase',
      speed,
    );
    this.speedBlur.prepare(
      presented,
      this.camera,
      this.groundHeight(this.target.x, this.target.z, this.target.y),
      this.graphics.motionBlur,
      !this.photo,
      this.renderer.getDrawingBufferSize(this.bufferSize).x,
    );
    this.ultra.prepareFrame({
      presented,
      cars: [
        { reflectivePaint: this.cars.reflectivePaint },
        { reflectivePaint: this.vehiclePaint },
      ],
      subject: this.target,
      cameraMode: 'chase',
      lighting: mode,
      studio: false,
      menu: false,
      photo: this.photo,
      replay: false,
      otherDof: false,
      cut,
    });
    this.composer.render();
    this.ultra.afterFrame();
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.renderMs = this.stats.renderMs * 0.9 + (performance.now() - start) * 0.1;
  }
  /** Snapshot length check for the session controller. */
  static frameLength(cars: number) {
    return HEADER + cars * CAR_STRIDE;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    scannedGround.detach(this.renderer);
    this.terrain.dispose();
    this.roads.dispose();
    this.furniture.dispose();
    this.streetLights.dispose();
    this.buildings.dispose();
    this.dressing.dispose();
    this.distant.dispose();
    this.signage.dispose();
    this.details?.dispose();
    this.details = null;
    this.streetDetails?.dispose();
    this.streetDetails = null;
    this.contacts.dispose();
    this.vegetation.dispose();
    this.flora.dispose();
    this.photoVegetation?.dispose();
    this.photoVegetation = null;
    this.water.dispose();
    this.markers.dispose();
    this.cars.dispose();
    this.trails.dispose();
    this.smoke.dispose();
    this.eventDressing.dispose();
    this.dragStrip.dispose();
    this.speedBlur.dispose();
    this.guidance.dispose();
    this.orbit.dispose();
    this.reflection.dispose();
    this.vehiclePaint.length = 0;
    this.vehicleRoots.length = 0;
    this.environment.dispose();
    this.wet.dispose();
    this.farShadow.dispose();
    this.effectPlayback.reset();
    this.effects.group.traverse((node) => {
      if (node instanceof T.Mesh || node instanceof T.Points) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material])
          material.dispose();
      }
    });
    this.bloom.dispose();
    this.grade.dispose();
    this.fxaa.dispose();
    this.scenePass.dispose();
    this.ultra.dispose();
    this.photoSky.dispose();
    this.composer.dispose();
    this.scene.clear();
  }
}
