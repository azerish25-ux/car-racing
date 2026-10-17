import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DEFAULT_OPTIONS, validateOptions } from '../../src/simulation/config.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { trackPoint } from '../../src/simulation/track.ts';
import { BikeShells } from '../../src/rendering/bike.ts';
import { BuildQueue } from '../../src/rendering/build-queue.ts';
import { materials } from '../../src/rendering/materials/index.ts';
import { disposeTextureLoaders } from '../../src/rendering/assets/texture-loader.ts';
import { scannedGround } from '../../src/rendering/ground/scan-store.ts';
import { OffroadScene } from '../../src/rendering/offroad/index.ts';
import { lightPoolUniforms } from '../../src/rendering/studio/light-pools.ts';
import { chainShaderHook, studioHookKeys } from '../../src/rendering/studio/shader-hooks.ts';

/** Production terrain, gate, stadium, dressing, roost and bike rigs, driven
 * by an actual eight-rider simulation snapshot. This isolated component scene
 * deliberately does not stand in for the full application's lighting or FPS. */
export async function captureMotocrossWorld(
  circuit: 'valley-ridge-mx' | 'arena-nord-sx',
  view: 'riding' | 'venue' = 'riding',
) {
  const simulation = new Simulation(
    validateOptions({
      ...DEFAULT_OPTIONS,
      circuit,
      mode: 'race',
      opponents: 7,
      ruleset: 'motocross-moto',
      vehicles: Array(8).fill('mx450'),
      seed: 51007,
    }),
  );
  simulation.autoPlayer = true;
  const queue = new BuildQueue();
  const world = new OffroadScene(simulation.track, queue);
  queue.runSynchronously();
  for (let step = 0; step < 120 * 10; step++) {
    simulation.step(1 / 120);
    if (step % 4 === 0) world.update(simulation.makeFrame());
  }
  const frame = simulation.makeFrame();
  world.update(frame);
  const delta = simulation.offroad!.terrain.renderDelta(true);
  world.record(delta, frame[H.TIME], true);
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1280, 800);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  const night = circuit === 'arena-nord-sx';
  scene.background = new T.Color(night ? 0x111a29 : 0xb2c8d6);
  scene.fog = new T.Fog(scene.background, 150, 1100);
  const pmrem = new T.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04);
  scene.environment = env.texture;
  scene.environmentIntensity = night ? 0.35 : 0.65;
  const key = new T.DirectionalLight(night ? 0xe3edff : 0xffefd5, night ? 1.8 : 3.1);
  const o = carBase(0);
  const point = simulation.track.at(frame[o + F.S], trackPoint());
  key.position.set(point.x - 35, point.y + 60, point.z + 30);
  key.target.position.set(point.x, point.y, point.z);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -45,
    right: 45,
    top: 45,
    bottom: -45,
    near: 0.1,
    far: 200,
  });
  key.shadow.normalBias = 0.025;
  scene.add(
    key,
    key.target,
    new T.HemisphereLight(night ? 0xb8c9e6 : 0xc8e6ff, 0x66513d, night ? 1.1 : 1.3),
    world.group,
  );
  const bounds = new T.Box3().setFromObject(world.terrain!.group);
  const floor = new T.Mesh(
    new T.PlaneGeometry(2600, 2600),
    new T.MeshStandardMaterial({ color: night ? 0x504b42 : 0x69714b, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = bounds.min.y - 0.2;
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new T.PerspectiveCamera(view === 'venue' ? 47 : 52, 1.6, 0.1, 1600);
  if (view === 'venue') {
    const centre = bounds.getCenter(new T.Vector3()),
      size = bounds.getSize(new T.Vector3());
    if (night) {
      // An indoor survey stays below the roof, inside the seating bowl.
      // The old aerial position saw only the roof's exterior, so changing
      // the hidden floor's moisture correctly could not alter its pixels.
      camera.fov = 68;
      camera.updateProjectionMatrix();
      camera.position.set(centre.x + size.x * 0.45, bounds.min.y + 25.5, centre.z + size.z * 0.41);
      camera.lookAt(centre.x, centre.y + 1, centre.z);
    } else {
      camera.position.set(
        centre.x + size.x * 0.65,
        centre.y + Math.max(55, size.z * 0.55),
        centre.z + size.z * 0.55,
      );
      camera.lookAt(centre.x, centre.y, centre.z);
    }
  } else {
    camera.position.set(
      point.x - point.tx * 13 + point.nx * 6,
      frame[o + F.Y] + 5.8,
      point.z - point.tz * 13 + point.nz * 6,
    );
    camera.lookAt(point.x + point.tx * 10, frame[o + F.Y] + 0.5, point.z + point.tz * 10);
  }
  const shells = new BikeShells();
  const cars = simulation.cars.map((_, id) => {
    const k = carBase(id),
      root = new T.Object3D();
    root.position.set(frame[k + F.X], frame[k + F.Y], frame[k + F.Z]);
    root.quaternion.set(frame[k + F.QX], frame[k + F.QY], frame[k + F.QZ], frame[k + F.QW]);
    return { root };
  });
  scene.add(shells.root);
  shells.update(frame, frame, 1, cars, camera, 'high', 0);
  const strength = lightPoolUniforms.lightPoolStrength.value;
  const share = lightPoolUniforms.lightPoolKeyShare.value;
  lightPoolUniforms.lightPoolStrength.value = night ? 1 : 0;
  lightPoolUniforms.lightPoolKeyShare.value = night ? 0.3 : 1;
  const source = frame.slice(),
    terrainHash = simulation.offroad!.terrain.hash();
  const soilMaterial = world.terrain!.material as T.MeshPhysicalMaterial & {
    defines?: Record<string, string>;
  };
  let compiledMacroSampler: string | null = null;
  // Observe the actual compiled production hook after resident scans switch
  // APEX_SCAN on, instead of inferring its sampler from a fixture-only label.
  chainShaderHook(world.terrain!.material, 'mx-world-review-observe-v1', (shader) => {
    compiledMacroSampler =
      shader.fragmentShader.match(/vec3 apexMacro = apexScanMacro\(\s*(\w+),/)?.[1] ?? null;
  });
  const capture = (label: string) => {
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const gl = renderer.getContext(),
      pixels = new Uint8Array(1280 * 800 * 4);
    gl.readPixels(0, 0, 1280, 800, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return {
      label,
      image: renderer.domElement.toDataURL('image/png'),
      hash,
      glError: gl.getError(),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      bikes: shells.count,
      particles: world.roost.active,
      contactShadows: world.roost.contactShadows?.count ?? 0,
      terrainCells: simulation.offroad!.terrain.stats().cells,
      sourceUnchanged:
        frame.every((value, i) => value === source[i]) &&
        simulation.offroad!.terrain.hash() === terrainHash,
      resources: {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
      },
      soilHooks: studioHookKeys(world.terrain!.material),
      soilScans: {
        active: 'APEX_SCAN' in (soilMaterial.defines ?? {}),
        slots: world.terrain!.soilSlots,
        macro: world.terrain!.soilMacro,
        compiledMacroSampler,
        store: scannedGround.diagnostics(),
      },
      groups: world.group.children.map((child) => child.name),
    };
  };
  try {
    // Production prepares its shared procedural maps before rendering.
    // Identity-white placeholders have no grain and double soil albedo.
    materials.prepare(renderer);
    // Exercise the actual photographed-soil path used by the production
    // renderer. Previously this component only prepared procedural maps and
    // missed the meadow macro that tinted the full-app dirt pink.
    scannedGround.attach(renderer, 'high');
    if (!(await scannedGround.ready(60000)))
      throw new Error(
        `Photographed soil was not ready: ${JSON.stringify(scannedGround.diagnostics())}`,
      );
    if (!('APEX_SCAN' in (soilMaterial.defines ?? {})))
      throw new Error('The production terrain did not enter its loaded-scan material path');
    // Let Three finish its first shadow/environment material variants before
    // comparing resources; no wet state has been applied during warmup.
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    const samples = [capture('prepared-soil')];
    // Retain exactly the same scene and source snapshot. Only the exported
    // surface presentation is wet, held and rewound, as a replay would be.
    world.record({ ...delta, wetness: 0.72 }, frame[H.TIME] + 8, true);
    samples.push(capture('wet-soil'));
    samples.push(capture('held-wet-soil'));
    world.showAt(frame[H.TIME]);
    samples.push(capture('rewound-soil'));
    return samples;
  } finally {
    lightPoolUniforms.lightPoolStrength.value = strength;
    lightPoolUniforms.lightPoolKeyShare.value = share;
    scannedGround.detach(renderer);
    shells.disposeAll();
    world.dispose();
    floor.geometry.dispose();
    floor.material.dispose();
    env.dispose();
    room.dispose();
    pmrem.dispose();
    await disposeTextureLoaders(renderer);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
