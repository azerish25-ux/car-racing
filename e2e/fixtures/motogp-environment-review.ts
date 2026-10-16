import * as T from 'three';
import { CircuitScene } from '../../src/rendering/circuit.ts';
import { installCircuitFinish } from '../../src/rendering/circuit-finish.ts';
import { surfaceMaterial } from '../../src/rendering/surface-detail.ts';
import { installWetRoad } from '../../src/rendering/materials.ts';
import { installRoadDetail, surfaceGridFor } from '../../src/rendering/studio/road-detail.ts';
import { installWetDetail } from '../../src/rendering/studio/wet-detail.ts';
import {
  installKerbFinish,
  installRunoffFinish,
} from '../../src/rendering/studio/kerb-runoff-finish.ts';
import { installVergeFinish } from '../../src/rendering/studio/track-edge-wear.ts';
import {
  installScannedAsphalt,
  installScannedKerb,
  installScannedTurf,
} from '../../src/rendering/ground/scanned-ground.ts';
import { scannedGround, SCAN_LAYERS } from '../../src/rendering/ground/scan-store.ts';
import {
  loadPbrSet,
  disposeTextureLoaders,
  type PbrSet,
} from '../../src/rendering/assets/texture-loader.ts';
import { StaticTransformGroup } from '../../src/rendering/static-transform-group.ts';
import { TyreMarkPresentation } from '../../src/rendering/tyre-marks.ts';
import {
  WeatherPresentation,
  roadWeatherUniform,
} from '../../src/rendering/weather-presentation.ts';
import { Track, trackPoint, CELL_COLS, CELL_ROWS } from '../../src/simulation/track.ts';
import { kerbHeight } from '../../src/simulation/contact.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

/** Production surface components on bounded real Aurel ribbons. This isolates
 * their WebGL2 programs and visible material response; it is not a driven lap,
 * full-venue screenshot, frame-rate benchmark or art sign-off for the game. */
export async function captureCircuitSurfaces(assets: Record<string, string>) {
  T.DefaultLoadingManager.setURLModifier(
    (url) => assets[url.replace(/^\.\//, '').replace(/^\//, '')] ?? url,
  );
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(800, 500);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  document.body.style.margin = '0';
  document.body.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0xbdced6);
  scene.fog = new T.Fog(0xbdced6, 90, 210);
  scene.add(new T.HemisphereLight(0xe2edff, 0x837466, 1.25));
  const sun = new T.DirectionalLight(0xfff1dc, 3.15);
  sun.position.set(-200, 340, -140);
  scene.add(sun);
  const camera = new T.PerspectiveCamera(48, 1.6, 0.08, 350);
  const track = new Track('clear');
  const stateBytes = new Uint8Array(CELL_ROWS * CELL_COLS * 4);
  const state = new T.DataTexture(stateBytes, CELL_COLS, CELL_ROWS, T.RGBAFormat);
  state.magFilter = state.minFilter = T.LinearFilter;
  const motorcycleSurface = { value: 0 };
  const tyreRubber = new TyreMarkPresentation(track, state);
  const surfaces = new StaticTransformGroup();
  scene.add(surfaces);
  // Retain the actual public mode switch and production ribbon builder while
  // excluding unrelated buildings, vegetation, crowds and reflection passes.
  const circuit = Object.assign(Object.create(CircuitScene.prototype), {
    track,
    surfaces,
    motorcycleSurface,
    tyreRubber,
  }) as CircuitScene;
  const road = surfaceMaterial('asphalt', undefined, true);
  installWetRoad(road, state, true);
  installRoadDetail(road, track.length, motorcycleSurface, surfaceGridFor(track));
  installWetDetail(road);
  installScannedAsphalt(road);
  const runoff = surfaceMaterial('asphalt', 'paint');
  installRunoffFinish(runoff, track.length);
  installScannedAsphalt(runoff);
  const grass = surfaceMaterial('grass');
  installScannedTurf(grass);
  installVergeFinish(grass);
  const kerb = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  installCircuitFinish(kerb, 'kerb');
  installKerbFinish(kerb, track.length);
  installScannedKerb(kerb);
  const white = new T.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55 });
  installCircuitFinish(white, 'paint');
  // The original generated maps are retained by the scan store for Low; retain
  // them here too so the isolated fixture can dispose every owned resource.
  const originalTextures = new Set<T.Texture>();
  for (const material of [road, runoff, grass, kerb, white])
    for (const value of Object.values(material))
      if (value instanceof T.Texture) originalTextures.add(value);
  const p = trackPoint();
  for (const [start, end] of [
    [490, 690],
    [track.length - 95, track.length + 50],
  ]) {
    circuit.ribbon(grass, {
      start,
      end,
      columns: 20,
      offset: (s, t) => (t * 2 - 1) * (track.at(s, p).width + 24),
      height: () => -0.032,
    });
    circuit.ribbon(runoff, {
      start,
      end,
      columns: 4,
      runoff: true,
      offset: (s, t) => (t * 2 - 1) * (track.at(s, p).width + 4),
      height: () => -0.008,
    });
    circuit.ribbon(road, {
      start,
      end,
      columns: 14,
      road: true,
      step: 1.8,
      offset: (s, t) => (t * 2 - 1) * track.at(s, p).width,
    });
    for (const side of [-1, 1]) {
      circuit.ribbon(kerb, {
        start,
        end,
        columns: 6,
        stripes: true,
        step: 0.16,
        offset: (s, t) => side * (track.at(s, p).width + t * 1.1),
        height: (s, _l, t) => kerbHeight(s, t * 1.1),
      });
      circuit.ribbon(white, {
        start,
        end,
        offset: (s, t) => side * (track.at(s, p).width - 0.17 + t * 0.14),
        height: () => 0.004,
      });
    }
  }
  tyreRubber.build(surfaces);
  surfaces.sealTransforms();
  const weather = new WeatherPresentation();
  weather.install(surfaces);
  const sets: PbrSet[] = [];
  const captures: {
    name: string;
    image: string;
    hash: number;
    nonzero: number;
    calls: number;
    triangles: number;
    resources: ReturnType<typeof resources>;
    rubber: ReturnType<TyreMarkPresentation['diagnostics']>;
  }[] = [];
  function resources() {
    return { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 };
  }
  function setWater(wet: boolean) {
    for (let row = 0; row < CELL_ROWS; row++)
      for (let col = 0; col < CELL_COLS; col++) {
        const i = (row * CELL_COLS + col) * 4;
        const edge = Math.abs((col / (CELL_COLS - 1)) * 2 - 1);
        stateBytes[i] = wet ? Math.round(90 + edge * 60) : 0;
        stateBytes[i + 1] = 105;
        stateBytes[i + 2] = 0;
        stateBytes[i + 3] = 255;
      }
    state.needsUpdate = true;
    roadWeatherUniform(road).value.set(wet ? 12 : 0, wet ? 8 : 2, 0, 0);
    weather.surface.value.set(wet ? 1 : 0, 0, 0, 0);
  }
  function point(s: number, lateral: number, height: number) {
    const at = track.at(s, trackPoint());
    return new T.Vector3(
      at.x + at.nx * lateral,
      at.y + at.bank * lateral + height,
      at.z + at.nz * lateral,
    );
  }
  function view(kind: 'apex' | 'edge' | 'launch') {
    if (kind === 'apex') {
      camera.position.copy(point(565, track.at(565, p).width - 3.4, 1.6));
      camera.lookAt(point(594, track.at(594, p).width - 3.2, 0.5));
    } else if (kind === 'edge') {
      camera.position.copy(point(588, track.at(588, p).width + 5.8, 2.2));
      camera.lookAt(point(596, track.at(596, p).width + 0.2, 0.05));
    } else {
      camera.position.copy(point(track.length - 37, 7.8, 7));
      camera.lookAt(point(track.length - 26, 1.2, 0));
    }
    camera.updateMatrixWorld();
  }
  function draw(name: string) {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const pixels = new Uint8Array(800 * 500 * 4);
    gl.readPixels(0, 0, 800, 500, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261,
      nonzero = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 3) nonzero++;
      for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ pixels[i + c], 16777619);
    }
    captures.push({
      name,
      image: renderer.domElement.toDataURL('image/png'),
      hash: hash >>> 0,
      nonzero,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      resources: resources(),
      rubber: tyreRubber.diagnostics(),
    });
  }
  try {
    // Real shipped WebP bytes, through the production PBR loader. They reach
    // the same APEX_SCAN_HEX high-preset programs without a network dependency.
    for (const layer of ['asphalt', 'concrete', 'lawn', 'meadow'] as const) {
      const set = await loadPbrSet(renderer, SCAN_LAYERS[layer], { prefer: 'webp', anisotropy: 8 });
      sets.push(set);
      scannedGround.adopt(layer, set);
    }
    setWater(false);
    view('apex');
    // Compile/upload both bounded cached mark layers before resource checks.
    circuit.setMotorcyclePresentation(false);
    renderer.render(scene, camera);
    circuit.setMotorcyclePresentation(true);
    renderer.render(scene, camera);
    const before = resources();
    draw('apex-bike-dry');
    circuit.setMotorcyclePresentation(false);
    draw('apex-car-dry');
    for (let i = 0; i < 30; i++) circuit.setMotorcyclePresentation(i % 2 === 0);
    circuit.setMotorcyclePresentation(true);
    draw('apex-bike-held');
    setWater(true);
    draw('apex-bike-wet');
    draw('apex-bike-wet-held');
    setWater(false);
    draw('apex-bike-rewound');
    view('edge');
    draw('kerb-runoff-verge');
    view('launch');
    circuit.setMotorcyclePresentation(false);
    renderer.render(scene, camera);
    circuit.setMotorcyclePresentation(true);
    renderer.render(scene, camera);
    draw('launch-bike');
    circuit.setMotorcyclePresentation(false);
    draw('launch-car');
    circuit.setMotorcyclePresentation(true);
    draw('launch-bike-restored');
    return {
      scope:
        'Production circuit surface components, two bounded Aurel segments, high scanned materials; not a full race',
      captures,
      before,
      after: resources(),
      scanned: scannedGround.diagnostics(),
      glError: renderer.getContext().getError(),
    };
  } finally {
    disposePhase27Scene(scene);
    originalTextures.forEach((texture) => texture.dispose());
    for (const set of sets) set.dispose();
    state.dispose();
    disposeTextureLoaders(renderer);
    renderer.dispose();
    renderer.domElement.remove();
    T.DefaultLoadingManager.setURLModifier((url) => url);
  }
}
