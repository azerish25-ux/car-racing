import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { AudioViewTracker } from '../../audio/spatial.ts';
import { clamp } from '../../core/math.ts';
import type { FestivalEvent } from '../../simulation/open-world/festival-events.ts';
import type { Structure } from '../../simulation/open-world/placement.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../../simulation/protocol.ts';
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
import { SKY_CLOUDS, SkyClouds } from '../studio/sky-clouds.ts';
import { studioUniforms } from '../studio/studio-frame.ts';
import { UltraPipeline } from '../ultra/pipeline.ts';
import { PhotoSky } from '../assets/photo-sky.ts';
import { scannedGround } from '../ground/scan-store.ts';
import { FESTIVAL_PALETTE } from '../assets/sky-catalogue.ts';
import { aerialFogColor } from '../studio/aerial-perspective.ts';
import { WetRoadReflection } from '../wet-reflection.ts';
import { Buildings } from './buildings.ts';
import { FestivalCars } from './festival-cars.ts';
import { EventMarkers } from './markers.ts';
import { RoadMeshes } from './roads.ts';
import { TERRAIN_BUDGETS, TerrainStreamer } from './terrain.ts';
import { Vegetation } from './vegetation.ts';
import { Water } from './water.ts';

export type FestivalCamera = 'chase' | 'far' | 'hood';
const CAMERAS: readonly FestivalCamera[] = ['chase', 'far', 'hood'];
/** Chase rigs (m): distance behind, height, look-ahead, look lift, fov. */
const RIGS = {
  chase: { distance: 6.4, height: 2.15, perMs: 0.022, lookAhead: 7, lift: 0.9, fov: 60 },
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
  readonly camera = new T.PerspectiveCamera(60, 1, 0.3, 26000);
  readonly terrain: TerrainStreamer;
  readonly roads: RoadMeshes;
  readonly buildings: Buildings;
  readonly vegetation = new Vegetation();
  readonly water: Water;
  readonly markers: EventMarkers;
  readonly cars = new FestivalCars();
  readonly audioView = new AudioViewTracker();
  readonly presented = new PresentedFrame();
  readonly sun = new T.DirectionalLight(0xfff0dc, 3.9);
  private readonly hemisphere = new T.HemisphereLight(0x8fb6ea, 0x4a4237, 0.14);
  private readonly sky = new Sky();
  private readonly environment: SkyEnvironment;
  /** Photographed CC0 sky of the region (assets/photo-sky.ts). */
  readonly photoSky = new PhotoSky(FESTIVAL_PALETTE, true);
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
  mode: FestivalCamera = 'chase';
  lookX = 0;
  private readonly target = new T.Vector3();
  private readonly desired = new T.Vector3();
  private readonly gaze = new T.Vector3();
  private readonly velocity = new T.Vector3();
  private readonly forward = new T.Vector3();
  private readonly temp = new T.Vector3();
  private readonly basis = new T.Quaternion();
  private readonly euler = new T.Euler();
  private initialized = false;
  private lastTime = NaN;
  private disposed = false;
  readonly discovered = new Set<string>();
  activeEvent: string | null = null;
  gate: { x: number; z: number } | null = null;
  stats = { drawCalls: 0, triangles: 0, renderMs: 0 };
  constructor(
    readonly renderer: T.WebGLRenderer,
    readonly canvas: HTMLCanvasElement,
    readonly world: OpenWorld,
    events: readonly FestivalEvent[],
    structures: readonly Structure[],
    tileWorker: Worker,
  ) {
    const scene = this.scene;
    scene.name = 'Festival region';
    this.sky.scale.setScalar(450000);
    this.sky.userData.excludeMotionBlur = true;
    configureSky(this.sky);
    const clouds = SkyClouds.forSky(this.sky.material, lightingDirection);
    this.photoSky.setQuality(this.preset);
    this.environment = new SkyEnvironment(this.sky, clouds, this.photoSky);
    scene.add(this.sky);
    scene.environmentIntensity = 0.7;
    scene.fog = new T.FogExp2(0xb9c7c1, 0.00012);
    scene.add(this.hemisphere, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 20, far: 900 });
    this.sun.shadow.bias = -0.00003;
    this.sun.shadow.normalBias = 0.02;
    this.terrain = new TerrainStreamer(tileWorker, TERRAIN_BUDGETS.medium);
    this.roads = new RoadMeshes(world.network, world.field);
    this.buildings = new Buildings(structures);
    this.water = new Water(world.field);
    this.markers = new EventMarkers(events, (x, z) => this.groundHeight(x, z));
    scene.add(
      this.terrain.root,
      this.roads.root,
      this.buildings.root,
      this.vegetation.root,
      this.water.root,
      this.markers.root,
      this.cars.root,
    );
    this.composer = new EffectComposer(renderer);
    this.scenePass = new SceneAmbientPass(scene, this.camera, this.graphics.msaa);
    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.fxaa);
    this.composer.addPass(this.grade);
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
  /** Road surface where there is a road, else natural ground (markers). */
  groundHeight(x: number, z: number) {
    const net = this.world.network,
      p = { s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, curvature: 0, width: 0, bank: 0, gradient: 0 };
    const l = net.nearest(x, z, p),
      e = net.edges[net.edgeOf[net.lastSegment]];
    if (Math.abs(l) < e.spec.halfWidth + e.spec.shoulder) return net.surfaceHeight(p, l, e.spec.halfWidth, e.spec.crown);
    return this.world.field.height(x, z);
  }
  setQuality(preset: QualityPreset, options: GraphicsOptions = graphicsPreset(preset)) {
    this.preset = preset;
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
    const size = bufferSize(w, h, Math.min(devicePixelRatio, 1.5) * this.graphics.resolutionScale, this.renderer.capabilities.maxTextureSize);
    const ratio = Math.min(size.width / w, size.height / h);
    const current = this.renderer.getSize(new T.Vector2());
    if (current.x !== w || current.y !== h || this.renderer.getPixelRatio() !== ratio) this.renderer.setDrawingBufferSize(w, h, ratio);
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
  }
  draw(a: Float32Array, b: Float32Array, alpha: number, dt: number) {
    if (this.disposed) return;
    const start = performance.now();
    dt = clamp(dt, 1 / 300, 0.08);
    if (a.length !== b.length || a[H.CARS] !== b[H.CARS] || b[H.TIME] < a[H.TIME]) a = b;
    const presented = this.presented.sample(a, b, a === b ? 1 : clamp(alpha, 0, 1));
    const time = presented[H.TIME];
    const night = this.night;
    this.cars.update(a, b, presented, a === b ? 1 : alpha, dt, night);
    const o = carBase(0),
      subject = this.cars.subject(0);
    const speed = presented[o + F.SPEED];
    this.target.set(presented[o + F.X], presented[o + F.Y], presented[o + F.Z]);
    // --- Camera ---------------------------------------------------------
    const cut = !this.initialized || !(time >= this.lastTime) || time - this.lastTime > 1;
    this.lastTime = time;
    if (subject) this.forward.set(0, 0, 1).applyQuaternion(subject.quaternion);
    if (this.mode === 'hood' && subject) {
      this.desired.set(0, 1.18, 0.35).applyQuaternion(subject.quaternion).add(this.target);
      this.temp.set(Math.sin(this.lookX) * 30, 0.6, Math.cos(this.lookX) * 30).applyQuaternion(subject.quaternion);
      this.gaze.copy(this.desired).add(this.temp);
      this.camera.position.copy(this.desired);
      this.camera.fov = 66;
      this.velocity.set(0, 0, 0);
    } else {
      const rig = RIGS[this.mode === 'far' ? 'far' : 'chase'];
      const pitch = Math.asin(clamp(this.forward.y, -0.4, 0.4));
      this.basis.setFromEuler(this.euler.set(-pitch, Math.atan2(this.forward.x, this.forward.z) + this.lookX, 0, 'YXZ'));
      this.desired
        .set(0, rig.height + speed * 0.012, -rig.distance - speed * rig.perMs)
        .applyQuaternion(this.basis)
        .add(this.target);
      // Never below the ground (hills behind the car).
      const ground = this.groundHeight(this.desired.x, this.desired.z) + 0.8;
      if (this.desired.y < ground) this.desired.y = ground;
      this.temp.set(0, 0, 1).applyQuaternion(this.basis);
      this.gaze.copy(this.target).addScaledVector(this.temp, rig.lookAhead);
      this.gaze.y += rig.lift;
      this.camera.fov = rig.fov + Math.min(10, speed * 0.06);
      if (cut) {
        this.camera.position.copy(this.desired);
        this.velocity.set(0, 0, 0);
      } else {
        const omega = 9,
          n = Math.max(1, Math.ceil(dt * 120)),
          h = dt / n;
        for (let k = 0; k < n; k++) {
          this.velocity.addScaledVector(this.temp.copy(this.desired).sub(this.camera.position), omega * omega * h);
          this.velocity.multiplyScalar(Math.exp(-2 * omega * h));
          this.camera.position.addScaledVector(this.velocity, h);
        }
      }
    }
    this.initialized = true;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.gaze);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // --- World streaming and dressing -------------------------------------
    this.terrain.update(this.camera);
    if (this.terrain.treesChanged) {
      this.terrain.treesChanged = false;
      this.vegetation.sync(this.terrain.treeTiles);
    }
    this.markers.update(time, this.discovered, this.activeEvent, this.gate, (x, z) => this.groundHeight(x, z));
    this.roads.setNight(night);
    this.buildings.setNight(night);
    // --- Lighting -----------------------------------------------------------
    const mode = this.lighting,
      daylight = circuitLightState(presented[H.CLOUD], presented[H.RAIN], mode);
    if (mode === 'night') {
      // Open country at night: moonlight, not a floodlit circuit.
      daylight.sun *= 0.16;
      daylight.fill *= 0.7;
      daylight.exposure *= 1.5;
    }
    const photoPalette = mode === 'night' ? null : this.photoSky.fogPalette(daylight.cover, mode);
    if (photoPalette)
      [daylight.fogRed, daylight.fogGreen, daylight.fogBlue] = aerialFogColor(daylight.cover, presented[H.RAIN], mode, photoPalette);
    applyCircuitLightPalette(this.sun, this.hemisphere, daylight.cover, mode);
    this.sun.intensity = daylight.sun;
    this.hemisphere.intensity = daylight.fill;
    this.scene.environmentIntensity = daylight.environment;
    this.renderer.toneMappingExposure = daylight.exposure;
    const fog = this.scene.fog as T.FogExp2;
    // The region is kilometres deep: the circuit haze, thinned.
    fog.density = daylight.fogDensity * 0.3;
    fog.color.setRGB(daylight.fogRed, daylight.fogGreen, daylight.fogBlue);
    const uniforms = this.sky.material.uniforms;
    uniforms.cloudCover.value = daylight.cover;
    uniforms.skyRadiance.value = daylight.skyRadiance;
    uniforms.nightAmount.value = mode === 'night' ? 1 : 0;
    uniforms.sunsetAmount.value = mode === 'sunset' ? 1 : 0;
    uniforms.sunPosition.value.copy(lightingDirection(mode));
    bindSkyCelestial(this.sky.material, mode);
    this.photoSky.bind(this.sky.material, daylight.cover, mode, false);
    uniforms.cloudDrift.value = (time * SKY_CLOUDS.driftPerSecond) % 1;
    shadowAnchor(this.target, this.sun.shadow.mapSize.x, this.sun.shadow.camera.right, this.sun.target.position, mode);
    this.sun.position.copy(this.sun.target.position).add(this.temp.copy(lightingDirection(mode)).normalize().multiplyScalar(400));
    this.sun.target.updateMatrixWorld();
    const wet = clamp(presented[H.WATER] / 0.8, 0, 1);
    this.terrain.material.userData.ow.owWet.value = wet;
    studioUniforms.studioTime.value = time;
    // --- Render ---------------------------------------------------------------
    this.environment.update(this.renderer, this.scene, daylight.cover, mode);
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
    this.ultra.prepareFrame({
      presented,
      cars: [{ reflectivePaint: this.cars.reflectivePaint }],
      subject: this.target,
      cameraMode: 'chase',
      lighting: mode,
      studio: false,
      menu: false,
      photo: false,
      replay: false,
      otherDof: false,
      cut,
    });
    this.renderer.info.reset();
    this.renderer.info.autoReset = false;
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
    this.buildings.dispose();
    this.vegetation.dispose();
    this.water.dispose();
    this.markers.dispose();
    this.cars.dispose();
    this.ultra.dispose();
    this.photoSky.dispose();
    this.composer.dispose();
    this.scene.clear();
  }
}
