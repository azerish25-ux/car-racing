import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { circuitLightState, configureSky, SkyEnvironment } from '../../src/rendering/daylight.ts';
import { ReflectionSystem } from '../../src/rendering/reflections.ts';

/** Controlled GPU comparison of production reflection ownership. This fixture
 * does not claim to be a race or change any production scene/test workload. */
export function probeRadianceGPU() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(192, 192);
  renderer.setPixelRatio(1);
  renderer.toneMapping = T.NoToneMapping;
  renderer.outputColorSpace = T.SRGBColorSpace;
  document.body.append(renderer.domElement);
  const scene = new T.Scene(),
    sky = new Sky();
  configureSky(sky);
  sky.scale.setScalar(2000);
  scene.add(sky);
  const light = circuitLightState(1, 20, 'night');
  scene.environmentIntensity = light.environment;
  sky.material.uniforms.cloudCover.value = 1;
  sky.material.uniforms.nightAmount.value = 1;
  sky.material.uniforms.skyRadiance.value = light.skyRadiance;
  const environment = new SkyEnvironment(sky);
  environment.update(renderer, scene, 1, 'night');
  const camera = new T.PerspectiveCamera(36, 1, 0.1, 5000);
  camera.position.set(0, 0.4, 4);
  camera.lookAt(0, 0, 0);
  const material = new T.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.2 });
  const car = new T.Group();
  car.add(new T.Mesh(new T.SphereGeometry(0.8, 48, 32), material));
  scene.add(car);
  const roadMaterial = new T.MeshStandardMaterial({
    color: 0x535861,
    metalness: 0.2,
    roughness: 0.35,
  });
  const road = new T.Mesh(new T.PlaneGeometry(20, 20), roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.y = -0.9;
  scene.add(road);
  // Behind the inspection camera, visible in the reflected scene rather than
  // directly in the sampled sphere region. No light is silently added.
  const board = new T.Mesh(
    new T.PlaneGeometry(8, 5),
    new T.MeshBasicMaterial({
      color: new T.Color(0.9, 0.35, 0.09),
      side: T.DoubleSide,
    }),
  );
  board.position.set(0, 1, 6);
  board.rotation.y = Math.PI;
  scene.add(board);
  const reflection = new ReflectionSystem(),
    materials = [material, roadMaterial];
  const skyScale = sky.material.uniforms.probeSkyIntensity;
  const probeSky: number[] = [],
    mainSky: number[] = [];
  sky.onBeforeRender = (_renderer, _scene, view) => {
    (view.parent instanceof T.CubeCamera ? probeSky : mainSky).push(skyScale.value);
  };
  const update = (time: number, force = false) => {
    reflection.setSkyIntensity(materials, light.environment);
    reflection.beginFrame(time, false);
    if (force) reflection.invalidate();
    reflection.updateProbe(renderer, scene, car, materials, true, 0.55, skyScale);
  };
  const capture = (name: string) => {
    renderer.info.reset();
    renderer.render(scene, camera);
    const pixels = new Uint8Array(192 * 192 * 4);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, 192, 192, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261,
      luminance = 0;
    for (let y = 72; y < 120; y++)
      for (let x = 72; x < 120; x++) {
        const p = (y * 192 + x) * 4;
        for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ pixels[p + c], 16777619);
        luminance += pixels[p] * 0.2126 + pixels[p + 1] * 0.7152 + pixels[p + 2] * 0.0722;
      }
    return {
      name,
      hash: hash >>> 0,
      mean: luminance / (48 * 48),
      image: renderer.domElement.toDataURL('image/png'),
      gain: material.envMapIntensity,
      visibleSky: skyScale.value,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  };
  const resources = () => ({
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
  });
  try {
    update(10);
    capture('warm-first-target');
    update(11);
    capture('warm-second-target');
    const captures = [capture('night-local-radiance')];
    material.envMapIntensity = scene.environmentIntensity;
    captures.push(capture('double-attenuation-control'));
    update(11);
    captures.push(capture('held-radiance'));
    const updatesBefore = reflection.probeUpdates;
    update(11);
    captures.push(capture('held-again'));
    const updatesAfter = reflection.probeUpdates;
    const before = resources();
    for (let i = 0; i < 8; i++) {
      update(11, true);
      capture('repeat');
    }
    captures.push(capture('history-free-recapture'));
    board.position.x = 10;
    board.updateMatrixWorld(true);
    update(20);
    captures.push(capture('moved-lamp'));
    board.position.x = 0;
    board.updateMatrixWorld(true);
    update(11);
    captures.push(capture('rewound-lamp'));
    const after = resources();
    reflection.updateProbe(renderer, scene, car, materials, false);
    captures.push(capture('sky-only'));
    return {
      captures,
      before,
      after,
      updatesBefore,
      updatesAfter,
      probeSky,
      mainSky,
      expectedSkyGain: light.environment,
      restoredMaps: materials.every((m) => m.envMap === null),
      restoredGains: materials.map((m) => m.envMapIntensity),
      glError: renderer.getContext().getError(),
    };
  } finally {
    reflection.dispose();
    environment.dispose();
    scene.traverse((node) => {
      if (node instanceof T.Mesh) {
        node.geometry.dispose();
        for (const m of Array.isArray(node.material) ? node.material : [node.material]) m.dispose();
      }
    });
    renderer.dispose();
    renderer.domElement.remove();
  }
}
