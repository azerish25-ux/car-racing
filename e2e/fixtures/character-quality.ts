/** Controlled production-renderer inspections. These are not a human race or
 * substitute for the unchanged full-application driver/pit/weather journeys. */
import * as T from 'three';
import { FormulaCar } from '../../src/rendering/car.ts';
import { DriverAsset } from '../../src/rendering/driver-asset.ts';
import { HeroShells } from '../../src/rendering/hero-shells.ts';
import { PitCrewView } from '../../src/rendering/pit-crew.ts';
import { peopleGeometry } from '../../src/rendering/people-asset.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

function studio(width = 960, height = 600) {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  document.body.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0x12191e);
  const camera = new T.PerspectiveCamera(55, width / height, 0.02, 500);
  const pixels = new Uint8Array(width * height * 4);
  const capture = (name: string) => {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
    return {
      name,
      hash: hash >>> 0,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      image: renderer.domElement.toDataURL('image/png'),
    };
  };
  const dispose = () => {
    scene.traverse((o) => {
      if (o instanceof T.SkinnedMesh) o.skeleton.dispose();
    });
    disposePhase27Scene(scene);
    renderer.dispose();
    renderer.domElement.remove();
  };
  return { renderer, scene, camera, capture, pixels, dispose };
}

export async function driverGPU(heroBytes: number[], driverBytes: number[]) {
  const hero = await HeroShells.decode(new Uint8Array(heroBytes));
  const asset = await DriverAsset.decode(new Uint8Array(driverBytes));
  const identity = asset.diagnostics();
  const car = new FormulaCar(0, hero, asset);
  hero.dispose();
  asset.dispose();
  const { renderer, scene, camera, capture, dispose } = studio();
  const simulation = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 });
  const frame = simulation.makeFrame(),
    o = carBase(0);
  // Deliberate component pose sweep, not forged race/replay evidence. The
  // presentation is the actual complete FormulaCar with its authored driver.
  frame[H.TIME] = 10;
  const key = new T.DirectionalLight(0xffefd9, 3);
  scene.add(car.root, new T.HemisphereLight(0xd6e9ff, 0x615446, 2), key);
  key.target = car.root;
  car.setLod(0, 'high', true);
  const captures = [];
  const pose = (steer: number, time: number, name: string) => {
    frame[o + F.STEER] = steer;
    frame[H.TIME] = time;
    const untouched = frame.slice();
    car.update(frame, frame, o, 1, 0, time, true);
    car.root.updateMatrixWorld(true);
    camera.position.copy(car.root.localToWorld(new T.Vector3(0, 0.41, -0.48)));
    camera.up.copy(new T.Vector3(0, 1, 0).applyQuaternion(car.root.quaternion));
    camera.lookAt(car.root.localToWorld(new T.Vector3(0, 0.025, 0.24)));
    key.position.copy(car.root.localToWorld(new T.Vector3(-1, 2, -2)));
    if (!untouched.every((v, i) => Object.is(v, frame[i]))) throw new Error('Frame mutated');
    return { ...capture(name), steer, arms: car.driver.diagnostics() };
  };
  try {
    captures.push(pose(0, 10, 'driver-neutral'));
    captures.push(pose(0, 10, 'driver-held'));
    captures.push(pose(-0.38, 11, 'driver-right-lock'));
    captures.push(pose(0.38, 12, 'driver-left-lock'));
    captures.push(pose(0, 10, 'driver-rewound'));
    const before = { ...renderer.info.memory };
    for (let i = 0; i < 12; i++) pose(i % 2 ? 0.38 : -0.38, 20 + i, 'warm-sweep');
    return {
      captures,
      identity,
      before,
      after: { ...renderer.info.memory },
      glError: renderer.getContext().getError(),
      scope: 'controlled complete-car GPU poses',
    };
  } finally {
    dispose();
  }
}

export function helmetGPU() {
  const { renderer, scene, camera, capture, pixels, dispose } = studio(512, 512);
  // Use the real head material, including its existing production skin hooks;
  // extracting it avoids copying the new shader implementation into the oracle.
  const crew = new PitCrewView();
  const heads = crew.root.children.find(
    (o) =>
      o instanceof T.InstancedMesh &&
      (o.material as T.MeshStandardMaterial).userData.authoredHelmetFinish === true,
  );
  if (!(heads instanceof T.InstancedMesh)) throw new Error('Actual head batch missing');
  const actual = heads.material as T.MeshStandardMaterial;
  const material = actual.clone();
  const hook = actual.onBeforeCompile,
    key = actual.customProgramCacheKey();
  // The head batch is rigid instancing, not the cloth's custom bone shader.
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = () => key;
  const helmet = new T.Mesh(peopleGeometry('helmet'), material);
  scene.add(helmet, new T.HemisphereLight(0xddecff, 0x343c44, 2));
  const light = new T.DirectionalLight(0xffffff, 4);
  light.position.set(-0.3, 0.25, 0.8);
  scene.add(light);
  // Crew within 1.2 m of the lens dissolve (CREW_NEAR_FADE), so hold the same
  // close-up framing (0.49 m at 55 degrees) from 1.3 m with a longer lens.
  const near = new T.Vector3(0.12, 0.015, 0.48),
    distance = 1.3;
  camera.position.copy(near).setLength(distance);
  camera.fov =
    (2 *
      Math.atan((Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * near.length()) / distance) *
      180) /
    Math.PI;
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0, 0);
  const captures = [];
  const setFinish = (enabled: boolean, witness = false) => {
    material.onBeforeCompile = (s, r) => {
      hook.call(material, s, r);
      if (!s.fragmentShader.includes('clamp(vCrewLens,0.,1.)'))
        throw new Error('Lens hook missing');
      if (!enabled)
        s.fragmentShader = s.fragmentShader.replace(
          'roughnessFactor=mix(roughnessFactor,.17,clamp(vCrewLens,0.,1.));',
          'roughnessFactor=roughnessFactor;',
        );
      if (witness)
        s.fragmentShader = s.fragmentShader.replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\ngl_FragColor=vec4(vec3(roughnessFactor),1.);',
        );
    };
    material.customProgramCacheKey = () => `${key}|finish-${enabled}|witness-${witness}`;
    material.needsUpdate = true;
  };
  try {
    setFinish(false);
    captures.push(capture('helmet-uncoated-control'));
    setFinish(true);
    captures.push(capture('helmet-authored-lens'));
    captures.push(capture('helmet-held'));
    setFinish(true, true);
    captures.push(capture('helmet-roughness-witness'));
    let lensPixels = 0,
      shellPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - 0.17 * 255) < 2 && pixels[i] === pixels[i + 1]) lensPixels++;
      if (Math.abs(pixels[i] - actual.roughness * 255) < 2 && pixels[i] === pixels[i + 1])
        shellPixels++;
    }
    setFinish(true);
    capture('warm');
    const before = { ...renderer.info.memory };
    for (let i = 0; i < 12; i++) renderer.render(scene, camera);
    return {
      captures,
      lensPixels,
      shellPixels,
      before,
      after: { ...renderer.info.memory },
      glError: renderer.getContext().getError(),
      scope: 'controlled production-helmet GPU comparison',
    };
  } finally {
    crew.dispose();
    dispose();
  }
}
