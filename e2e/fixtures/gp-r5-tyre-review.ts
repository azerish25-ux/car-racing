import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BikeMaterials, tyreGeometry } from '../../src/rendering/bike.ts';
import { type GpTyreAppearance } from '../../src/rendering/gp-tyre-finish.ts';

/** Actual production tyre mesh and material, isolated to inspect tread response.
 * These are material-state observations, not a gameplay or frame-rate benchmark. */
export function captureGpTyreConditions() {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(800, 600);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const scene = new T.Scene();
  scene.background = new T.Color(0.12, 0.14, 0.17);
  const pmrem = new T.PMREMGenerator(renderer),
    room = new RoomEnvironment(),
    env = pmrem.fromScene(room, 0.06);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.8;
  const sun = new T.DirectionalLight(0xfff1df, 3.1);
  sun.position.set(2, 3, 2);
  scene.add(sun, new T.HemisphereLight(0xc4dcff, 0x565249, 0.7));
  const materials = new BikeMaterials(0),
    geometry = tyreGeometry(0.33, 0.1, 0.125, 0.2199, 64);
  const tyre = new T.Mesh(geometry, materials.rubber);
  scene.add(tyre);
  const camera = new T.PerspectiveCamera(35, 4 / 3, 0.03, 20);
  camera.position.set(0.83, 0.38, 1.18);
  camera.lookAt(0, 0, 0);
  const observations: { name: string; state: GpTyreAppearance }[] = [
    {
      name: 'slick-cold',
      state: { compound: 1, rearWear: 0, rearSurfaceTemp: 35, rearWater: 0, speed: 38 },
    },
    {
      name: 'slick-hot-used',
      state: { compound: 1, rearWear: 0.65, rearSurfaceTemp: 98, rearWater: 0, speed: 38 },
    },
    {
      name: 'intermediate',
      state: { compound: 3, rearWear: 0.12, rearSurfaceTemp: 74, rearWater: 0.22, speed: 38 },
    },
    {
      name: 'wet',
      state: { compound: 4, rearWear: 0.15, rearSurfaceTemp: 65, rearWater: 0.8, speed: 38 },
    },
    {
      name: 'wet-held',
      state: { compound: 4, rearWear: 0.15, rearSurfaceTemp: 65, rearWater: 0.8, speed: 38 },
    },
    {
      name: 'cold-restored',
      state: { compound: 1, rearWear: 0, rearSurfaceTemp: 35, rearWater: 0, speed: 38 },
    },
  ];
  const resources = () => ({
    ...renderer.info.memory,
    programs: renderer.info.programs?.length ?? 0,
  });
  const positions = Array.from(geometry.getAttribute('position').array);
  try {
    materials.tyreFinish.update(observations[0].state);
    renderer.compile(scene, camera);
    for (let i = 0; i < 3; i++) renderer.render(scene, camera);
    const prepared = resources();
    return {
      prepared,
      captures: observations.map(({ name, state }) => {
        materials.tyreFinish.update(state);
        renderer.render(scene, camera);
        const gl = renderer.getContext(),
          pixels = new Uint8Array(800 * 600 * 4);
        gl.readPixels(0, 0, 800, 600, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let hash = 2166136261;
        for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
        return {
          name,
          hash,
          image: renderer.domElement.toDataURL('image/png'),
          glError: gl.getError(),
          resources: resources(),
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometryUnchanged: positions.every(
            (v, i) => v === geometry.getAttribute('position').array[i],
          ),
          condition: materials.tyreFinish.rear.value.toArray(),
          drainage: materials.tyreFinish.style.value.x,
        };
      }),
    };
  } finally {
    geometry.dispose();
    materials.dispose();
    env.dispose();
    room.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
