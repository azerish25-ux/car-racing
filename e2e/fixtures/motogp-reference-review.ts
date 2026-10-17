import * as T from 'three';
import { inspectBikeCockpit } from './bike-cockpit-contract.ts';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BikeMaterials, BikeModel, BikeShells, staticSag } from '../../src/rendering/bike.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { tcamFov } from '../../src/rendering/cockpit-framing.ts';
import { H } from '../../src/simulation/protocol.ts';
import { VEHICLES } from '../../src/simulation/vehicles.ts';

/** Isolated production BikeModel, not a replacement game or promotional render. */
export function captureBikeSequence(
  view = 'three-quarter',
  detail: 'high' | 'mid' | 'far' = 'high',
  id = 'gpr1',
  samples: readonly { wet: boolean; time: number }[] = [{ wet: false, time: 2 }],
) {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1280, 800);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color('#aab9c6');
  const pmrem = new T.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.06);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.55;
  const sun = new T.DirectionalLight(0xfff0d9, 3.1);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 15 });
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.012;
  scene.add(sun, new T.HemisphereLight(0xc9e4ff, 0x514737, 1.3));
  const def = VEHICLES[id],
    materials = new BikeMaterials(0);
  const bike = new BikeModel(def, 0, detail, materials, true);
  const sag = staticSag(def);
  bike.pose({
    fork: sag.fork,
    shock: sag.shock,
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: view === 'corner' ? 0.88 : 0,
    riderOffset: view === 'corner' ? 0.18 : 0,
    tuck: 0.75,
    brake: 0.05,
    rearBrake: 0,
    discTemp: 280,
    compoundColour: 0xffffff,
    riding: true,
    speed: 42,
    gear: 4,
    rpm: 12200,
  });
  bike.root.position.y = def.bike!.cgHeight;
  if (view === 'corner') {
    bike.root.rotation.z = -0.88;
    bike.root.position.y *= Math.cos(0.88);
  }
  const weather = new WeatherPresentation();
  weather.install(bike.root);
  const weatherFrame = new Float32Array(128);
  scene.add(bike.root);
  if (view === 'bodywork') bike.rider.root.visible = false;
  const floor = new T.Mesh(
    new T.PlaneGeometry(200, 200),
    new T.MeshStandardMaterial({ color: 0x45494d, roughness: 0.91 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new T.PerspectiveCamera(38, 1280 / 800, 0.03, 80);
  if (view === 'side') camera.position.set(3.7, 1.35, 0.1);
  else if (view === 'front') camera.position.set(0.18, 1.1, 3.7);
  else if (view === 'rear') camera.position.set(-2.5, 1.8, -3.0);
  else camera.position.set(-2.8, 1.65, 3.35);
  camera.lookAt(0, 0.68, 0);
  if (view === 'onboard') {
    bike.rider.setFirstPerson(true);
    const direction = new T.Vector3();
    new BikeShells().onboard(bike.root, camera.position, direction);
    camera.fov = tcamFov(42);
    camera.lookAt(camera.position.clone().add(direction));
    camera.updateProjectionMatrix();
  }
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const cockpit = view === 'onboard' ? inspectBikeCockpit(bike.root, camera) : null;
  // Instancing shares storage, not triangle submission. Count every link,
  // keeping the existing model budget meaningful after procedural instancing.
  let triangles = 0;
  bike.root.traverse((o) => {
    if (o instanceof T.Mesh)
      triangles +=
        ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) *
        (o instanceof T.InstancedMesh ? o.count : 1);
  });
  const resources = () => ({
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
  });
  try {
    // Match production shader preparation before observing resource stability.
    // compile() renders no extra frames and changes no source snapshots.
    renderer.compile(scene, camera);
    // Production prepares real scene draws before presenting a race. In this
    // isolated fixture, measure that preparation with the exact same dry pose
    // and uniforms three times; do not attribute a cold second-draw program to
    // weather. Keep the first transition visible in the attached diagnostics.
    weatherFrame[H.TIME] = 2;
    const preparationSource = weatherFrame.slice();
    weather.update(weatherFrame);
    let previousPrograms = new Set<number>();
    const preparation = Array.from({ length: 3 }, (_, i) => {
      renderer.render(scene, camera);
      const programs = renderer.info.programs ?? [];
      const addedPrograms =
        i === 0
          ? []
          : programs
              .filter((program) => !previousPrograms.has(program.id))
              .map(({ name, cacheKey }) => ({ name, cacheKey }));
      previousPrograms = new Set(programs.map((program) => program.id));
      return {
        wet: false,
        time: 2,
        sourceFrameUnchanged: weatherFrame.every((value, j) => value === preparationSource[j]),
        resources: resources(),
        addedPrograms,
      };
    });
    return samples.map((sample) => {
      weatherFrame[H.TIME] = sample.time;
      weatherFrame[H.RAIN] = sample.wet ? 20 : 0;
      weatherFrame[H.WATER] = sample.wet ? 0.6 : 0;
      const source = weatherFrame.slice();
      weather.update(weatherFrame);
      renderer.render(scene, camera);
      const image = renderer.domElement.toDataURL('image/png');
      const pixels = new Uint8Array(1280 * 800 * 4);
      renderer
        .getContext()
        .readPixels(
          0,
          0,
          1280,
          800,
          renderer.getContext().RGBA,
          renderer.getContext().UNSIGNED_BYTE,
          pixels,
        );
      let hash = 2166136261;
      for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      const result = {
        image,
        instance: bike.root.uuid,
        sourceFrameUnchanged: weatherFrame.every((value, i) => value === source[i]),
        resources: resources(),
        preparation,
        hash,
        cockpit,
        weather: weather.diagnostics(),
        triangles,
        submittedTriangles: renderer.info.render.triangles,
        calls: renderer.info.render.calls,
        glError: renderer.getContext().getError(),
        bounds: new T.Box3().setFromObject(bike.root),
      };
      return result;
    });
  } finally {
    bike.dispose();
    materials.dispose();
    floor.geometry.dispose();
    (floor.material as T.Material).dispose();
    weather.dispose();
    env.dispose();
    room.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** Compatibility wrapper; sequence tests deliberately retain the same instance. */
export function captureBike(
  view = 'three-quarter',
  detail: 'high' | 'mid' | 'far' = 'high',
  id = 'gpr1',
  wet = false,
) {
  return captureBikeSequence(view, detail, id, [{ wet, time: 2 }])[0];
}
