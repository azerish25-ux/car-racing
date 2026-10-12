import * as T from 'three';
import { CrowdCluster } from '../../src/rendering/crowd.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

/** Real production colour AND shadow shaders. Pixel identities prove that
 * pause/rewind restores the same pose; geometry counts alone cannot do that. */
export function capturePhase27Crowd() {
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(1280, 720); renderer.setPixelRatio(1);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(); scene.background = new T.Color(0x45525c);
  const sun = new T.DirectionalLight(0xffe9d2, 3);
  sun.position.set(-4, 7, 3); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.1, far: 20 });
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.normalBias = 0.005;
  scene.add(sun, sun.target, new T.HemisphereLight(0xd4e6f7, 0x43403a, 1));
  const concrete = new T.MeshStandardMaterial({ color: 0x94948d, roughness: 1 });
  const person = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const matrices: T.Matrix4[] = [], colors: T.Color[] = [];
  for (let row = 0; row < 3; row++) {
    const step = new T.Mesh(new T.BoxGeometry(0.95, 0.49 * (row + 1), 3), concrete);
    step.position.set(row * 0.98, 0.245 * (row + 1) - 0.49, 0); step.receiveShadow = true; scene.add(step);
    for (let seat = 0; seat < 4; seat++) {
      matrices.push(new T.Matrix4().makeTranslation(row * 0.98, row * 0.49 + 0.30, (seat - 1.5) * 0.65));
      colors.push(new T.Color([0xab4030, 0x3f665a, 0xc7b69b, 0x323f51][seat]));
    }
  }
  const crowd = new CrowdCluster(matrices, colors, 127, person); scene.add(crowd.root);
  const camera = new T.PerspectiveCamera(40, 1280 / 720, 0.05, 1000);
  camera.position.set(-4, 2.9, 3.4); camera.lookAt(0.7, 1.1, 0);
  const captures: { view: string; image: string; triangles: number; draws: number }[] = [];
  const capture = (name: string, time: number) => {
    crowd.update(time, camera.position, 0); renderer.info.reset(); renderer.render(scene, camera);
    const image = canvas.toDataURL('image/png');
    captures.push({ view: name, image, triangles: renderer.info.render.triangles, draws: renderer.info.render.calls });
    return image;
  };
  try {
    const first = capture('crowd-time-0', 0);
    const pause = capture('crowd-paused', 0);
    const moved = capture('crowd-time-2', 2);
    const rewind = capture('crowd-rewind', 0);
    const memoryBefore = { ...renderer.info.memory };
    capture('crowd-repeat', 0);
    const memoryAfter = { ...renderer.info.memory };
    // Exercise the real shader masks at the same close-up camera. The supplied
    // LOD camera is a controlled test input, not a claimed full-race screenshot.
    const handoff = (distance: number) => {
      crowd.update(2, new T.Vector3(0.98 + distance, 0.79, 0), 0);
      renderer.info.reset(); renderer.render(scene, camera);
      const image = canvas.toDataURL('image/png');
      captures.push({ view: `crowd-handoff-${distance}`, image,
        triangles: renderer.info.render.triangles, draws: renderer.info.render.calls });
      return { distance, image, activeLevels: crowd.levels.filter((m) => m.visible).length,
        ranges: crowd.lodRanges.map((range) => range.toArray()) };
    };
    // The close-sculpt handoff moved to 46–58 visual metres. Observe its actual
    // overlap at the centre of that band, not 100m where only mid LOD is active.
    const blend = handoff(52), far = handoff(300), returnBlend = handoff(52);
    return { captures, handoff: { activeLevels: blend.activeLevels, farLevels: far.activeLevels,
      rewindExact: blend.image === returnBlend.image, ranges: blend.ranges }, glError: renderer.getContext().getError(), pauseExact: first === pause,
      rewindExact: first === rewind, visibleMovement: first !== moved, memoryBefore, memoryAfter,
      nearTriangles: crowd.levels[0].geometry.getIndex()!.count / 3,
      midTriangles: crowd.levels[1].geometry.getIndex()!.count / 3,
      farTriangles: crowd.levels[2].geometry.getIndex()!.count / 3 };
  } finally { disposePhase27Scene(scene); person.dispose(); renderer.dispose(); canvas.remove(); }
}
