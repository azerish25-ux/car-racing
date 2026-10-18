/** Isolated component lighting, not a substitute for full-world acceptance. */
import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { openWorld } from '../../src/simulation/open-world/world.ts';
import { regionStructures } from '../../src/simulation/open-world/placement.ts';
import { Buildings } from '../../src/rendering/open-world/buildings.ts';
const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const gl = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
gl.setSize(1200, 800);
gl.setPixelRatio(1);
gl.shadowMap.enabled = true;
gl.shadowMap.type = T.PCFSoftShadowMap;
gl.outputColorSpace = T.SRGBColorSpace;
gl.toneMapping = T.ACESFilmicToneMapping;
gl.toneMappingExposure = 0.95;
const scene = new T.Scene();
scene.background = new T.Color(0xb9c6d1);
const world = openWorld();
const all = regionStructures(world);
const finish = (globalThis as unknown as { facadeFinish?: string }).facadeFinish ?? 'plaster';
const selected = all
  .filter((s) => s.kind === 'shop' || s.kind === 'house')
  .filter((s) => {
    const index = (s.style >>> 7) % 8;
    return finish === 'brick'
      ? index === 4
      : finish === 'stone'
        ? index === 6
        : ![4, 6].includes(index);
  })
  .sort((a, b) => Math.hypot(a.x - 570, a.z + 2590) - Math.hypot(b.x - 570, b.z + 2590))[0];
const structures = [selected];
const buildings = new Buildings(structures);
scene.add(buildings.root);
const pmrem = new T.PMREMGenerator(gl),
  room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture;
room.dispose();
pmrem.dispose();
const sun = new T.DirectionalLight(0xfff2dd, 3.2);
sun.position.set(selected.x - 35, selected.base + 45, selected.z - 20);
sun.target.position.set(selected.x, selected.base + 2, selected.z);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -28;
sun.shadow.normalBias = 0.025;
const hemisphere = new T.HemisphereLight(0xcbd9ee, 0x4b4840, 1.2);
scene.add(sun, sun.target, hemisphere);
const ground = new T.Mesh(
  new T.PlaneGeometry(180, 180),
  new T.MeshStandardMaterial({ color: 0x777975, roughness: 0.96 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(selected.x, selected.base + 0.5, selected.z);
ground.receiveShadow = true;
scene.add(ground);
const camera = new T.PerspectiveCamera(47, 1.5, 0.1, 2000);
const c = Math.cos(selected.heading),
  n = Math.sin(selected.heading);
const local = (x: number, y: number, z: number) =>
  new T.Vector3(selected.x + c * x - n * z, selected.base + y, selected.z + n * x + c * z);
function draw(night = false, close = false) {
  camera.position.copy(
    local(selected.hx + (close ? 2 : 7), close ? 3.5 : 7, -selected.hz - (close ? 5 : 19)),
  );
  camera.lookAt(local(close ? selected.hx * 0.6 : 0, close ? 2.8 : 4, -selected.hz));
  camera.updateMatrixWorld();
  buildings.setNight(night ? 1 : 0);
  sun.intensity = night ? 0.12 : 3.2;
  hemisphere.intensity = night ? 0.08 : 1.2;
  scene.environmentIntensity = night ? 0.06 : 1;
  gl.toneMappingExposure = night ? 0.7 : 0.95;
  scene.background = new T.Color(night ? 0x0b1425 : 0xb9c6d1);
  const dynamic = buildings as Buildings & {
    joinery?: { update: (c: T.Camera, q: 'medium') => void; stats: unknown };
  };
  dynamic.joinery?.update(camera, 'medium');
  gl.render(scene, camera);
  return {
    finish,
    building: selected,
    stats: buildings.stats,
    joinery: dynamic.joinery?.stats ?? null,
    draws: gl.info.render.calls,
    triangles: gl.info.render.triangles,
  };
}
Object.assign(window, {
  facadeReview: {
    draw,
    structures: all.length,
    image: () => canvas.toDataURL('image/png'),
    ready: true,
  },
});
draw();
