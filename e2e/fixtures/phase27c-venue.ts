import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CircuitScene } from '../../src/rendering/circuit.ts';
import { FormulaCar } from '../../src/rendering/car.ts';
import { Effects } from '../../src/rendering/effects.ts';
import { EffectPlayback } from '../../src/rendering/effect-playback.ts';
import { VenueLighting } from '../../src/rendering/venue-lighting.ts';
import { TracksideDirector } from '../../src/rendering/trackside.ts';
import {
  configureSky,
  circuitLightState,
  shadowAnchor,
  SkyEnvironment,
  SUN_OFFSET,
} from '../../src/rendering/daylight.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

interface Sample {
  id: number;
  frame: Float32Array;
  history: Float32Array[];
  water: Float32Array;
  rubber: Float32Array;
  marbles: Float32Array;
}
interface VenueOptions {
  weather: 'clear' | 'rain';
  night: boolean;
}

/** An isolated direct-scene survey of production assets, not the complete
 * renderer/post-processing/UI or a human-driven Section-146 certification.
 * Each car pose and surface field comes from an actual uninterrupted AI lap. */
class VenueSurvey {
  canvas = document.createElement('canvas');
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(42, 1280 / 720, 0.1, 1600);
  simulation: Simulation;
  circuit: CircuitScene;
  car = new FormulaCar(0);
  sky = new Sky();
  environment: SkyEnvironment;
  sun = new T.DirectionalLight(0xffeddc);
  fill = new T.HemisphereLight(0xd7e7f5, 0x665f4e);
  venue: VenueLighting;
  effects = new Effects();
  playback = new EffectPlayback(this.effects);
  director: TracksideDirector;
  samples: Sample[] = [];
  savedTrack: Float32Array;
  surfaceBytesBefore: Uint8Array;
  constructor(readonly options: VenueOptions) {
    this.simulation = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      weather: options.weather,
      compound: options.weather === 'rain' ? 'wet' : 'medium',
      seed: 1887,
    });
    this.simulation.autoPlayer = true;
    const recent: Float32Array[] = [],
      chosen = new Map<number, Sample>();
    const length = this.simulation.track.length,
      spacing = length / 20,
      base = carBase(0);
    for (let i = 0; i < 120 * 180 && chosen.size < 20; i++) {
      this.simulation.step(1 / 120);
      if (i % 4 !== 0) continue;
      const frame = this.simulation.makeFrame();
      recent.push(frame);
      if (recent.length > 46) recent.shift();
      const s = frame[base + F.S],
        id = Math.round(s / spacing) % 20;
      const distance = Math.abs(((s - id * spacing + length * 1.5) % length) - length / 2);
      if (recent.length >= 40 && frame[base + F.SPEED] > 5 && distance < 3 && !chosen.has(id))
        chosen.set(id, {
          id,
          frame,
          history: recent.slice(),
          water: this.simulation.track.water.slice(),
          rubber: this.simulation.track.rubber.slice(),
          marbles: this.simulation.track.marbles.slice(),
        });
    }
    this.samples = [...chosen.values()].sort((a, b) => a.id - b.id);
    if (this.samples.length !== 20)
      throw new Error(`Incomplete real-lap survey: ${this.samples.length}/20 cameras`);
    this.savedTrack = this.simulation.track.water.slice();
    document.body.append(this.canvas);
    this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(1280, 720);
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -65,
      right: 65,
      top: 65,
      bottom: -65,
      near: 1,
      far: 600,
    });
    this.sun.shadow.bias = -0.0001;
    this.sun.shadow.normalBias = 0.035;
    configureSky(this.sky);
    this.sky.scale.setScalar(10000);
    this.environment = new SkyEnvironment(this.sky);
    this.circuit = new CircuitScene(this.simulation.track);
    this.surfaceBytesBefore = this.circuit.stateBytes.slice();
    this.venue = new VenueLighting(this.simulation.track);
    this.director = new TracksideDirector(this.simulation.track, (a, b) =>
      this.circuit.sightlines.blocked(a, b),
    );
    this.scene.add(
      this.circuit.group,
      this.car.root,
      this.sky,
      this.sun,
      this.sun.target,
      this.fill,
      this.venue.root,
      this.effects.group,
    );
    this.scene.fog = new T.FogExp2(0x8aa6c2, 0.00025);
  }
  capture(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= 27)
      throw new Error('Invalid venue survey view');
    const sample = this.samples[index < 20 ? index : 4];
    const frame = sample.frame,
      before = frame.slice(),
      base = carBase(0);
    this.car.update(frame, frame, base, 1, 0, frame[H.TIME], false);
    this.circuit.updateSurface(sample.water, sample.rubber, sample.marbles);
    this.circuit.update(frame);
    this.playback.reset();
    sample.history.forEach((state) => this.playback.update(state));
    const light = circuitLightState(frame[H.CLOUD], frame[H.RAIN], this.options.night);
    this.sun.intensity = light.sun;
    this.fill.intensity = light.fill;
    this.scene.environmentIntensity = light.environment;
    this.renderer.toneMappingExposure = light.exposure;
    this.sky.material.uniforms.cloudCover.value = light.cover;
    this.sky.material.uniforms.skyRadiance.value = light.skyRadiance;
    this.sky.visible = true;
    this.sky.material.uniforms.nightAmount.value = this.options.night ? 1 : 0;
    this.scene.background = this.options.night ? this.venue.nightBackground : null;
    (this.scene.fog as T.FogExp2).color.setRGB(light.fogRed, light.fogGreen, light.fogBlue);
    (this.scene.fog as T.FogExp2).density = light.fogDensity;
    this.director.reset();
    this.director.update(
      frame[base + F.S],
      this.car.root.position,
      new T.Vector3(frame[base + F.VX], frame[base + F.VY], frame[base + F.VZ]),
      0,
      this.camera.aspect,
    );
    this.camera.position.copy(this.director.position);
    this.camera.lookAt(this.director.gaze);
    this.camera.fov = this.director.fov;
    let name = `camera-${String(sample.id).padStart(2, '0')}`;
    const anchor = this.car.root.position.clone();
    if (index >= 20 && index < 26) {
      const site = this.circuit.serviceSites[index - 20];
      name = `service-${index - 20}-${site.kind}`;
      anchor.set(site.x, site.y + 1, site.z);
      this.camera.position
        .copy(anchor)
        .add(new T.Vector3(10, 8, 16).applyAxisAngle(new T.Vector3(0, 1, 0), site.yaw));
      this.camera.lookAt(anchor);
      this.camera.fov = 50;
    } else if (index === 26) {
      name = 'occupied-grandstand';
      anchor.copy(this.circuit.at(780, 22, 4));
      this.camera.position.copy(this.circuit.at(785, 4, 3));
      this.camera.lookAt(anchor);
      this.camera.fov = 58;
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    for (const cluster of this.circuit.crowdClusters)
      cluster.update(frame[H.TIME], this.camera.position, frame[H.RAIN], frame);
    this.venue.update(this.options.night, anchor);
    shadowAnchor(anchor, 2048, 65, this.sun.target.position);
    this.sun.position.copy(this.sun.target.position).add(SUN_OFFSET);
    this.sun.target.updateMatrixWorld();
    this.environment.update(this.renderer, this.scene, light.cover, this.options.night);
    this.scene.updateMatrixWorld(true);
    const rendered = () => {
      this.renderer.info.reset();
      this.renderer.render(this.scene, this.camera);
      // Readback forces completion; duration is software-render diagnostic only.
      return this.canvas.toDataURL('image/png');
    };
    const start = performance.now(),
      image = rendered(),
      elapsedMs = performance.now() - start;
    const memory = { ...this.renderer.info.memory };
    const waterUnchanged = this.savedTrack.every((v, i) => v === this.simulation.track.water[i]);
    return {
      view: name,
      image,
      elapsedMs,
      memory,
      draws: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      tick: frame[H.TICK],
      time: frame[H.TIME],
      speedKmh: frame[base + F.SPEED] * 3.6,
      activeCamera: this.director.activeId,
      sourceUnchanged: frame.every((v, i) => v === before[i]),
      waterUnchanged,
      glError: this.renderer.getContext().getError(),
      crowds: this.circuit.crowdClusters.reduce(
        (counts, c) => {
          counts[c.level]++;
          return counts;
        },
        [0, 0, 0, 0],
      ),
      effects: this.effects.diagnostics(),
    };
  }
  dispose() {
    disposePhase27Scene(this.scene);
    this.environment.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
let current: VenueSurvey | null = null;
export function beginPhase27Venue(options: VenueOptions) {
  if (current) throw new Error('A venue survey is already open');
  current = new VenueSurvey(options);
  return {
    views: 27,
    cameras: current.samples.map((s) => s.id),
    serviceAreas: current.circuit.serviceSites.length,
    realSimulationTicks: current.simulation.tick,
    crowdClusters: current.circuit.crowdClusters.length,
  };
}
export function capturePhase27VenueView(index: number) {
  if (!current) throw new Error('No venue survey');
  return current.capture(index);
}
export function endPhase27Venue() {
  current?.dispose();
  current = null;
}
