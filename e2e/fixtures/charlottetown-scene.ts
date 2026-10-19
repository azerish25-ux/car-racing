import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  CHARLOTTETOWN,
  CHARLOTTETOWN_ROUTE,
} from '../../src/simulation/open-world/charlottetown/region.ts';
import { openWorld } from '../../src/simulation/open-world/world.ts';
import { SurveyCity } from '../../src/rendering/open-world/charlottetown/city.ts';
import { RoadMeshes } from '../../src/rendering/open-world/roads.ts';
import { Vegetation } from '../../src/rendering/open-world/vegetation.ts';
import {
  regionStructures,
  treesForTile,
  StructureGrid,
} from '../../src/simulation/open-world/placement.ts';
import { trackPoint } from '../../src/simulation/track.ts';

/** Offline visual fixture; this renders the actual city and road classes,
 * not a substitute model. Full application/worker coverage is a separate test. */
export function mountCharlottetownScene() {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1440, 900);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.style.margin = '0';
  document.body.appendChild(renderer.domElement);
  const world = openWorld(CHARLOTTETOWN),
    scene = new T.Scene(),
    camera = new T.PerspectiveCamera(64, 1440 / 900, 0.2, 5000);
  scene.background = new T.Color(0xa6bfce);
  scene.fog = new T.FogExp2(0xa6bfce, 0.0003);
  const sky = new Sky();
  sky.scale.setScalar(20000);
  sky.material.uniforms.turbidity.value = 3.6;
  sky.material.uniforms.rayleigh.value = 1.8;
  sky.material.uniforms.mieCoefficient.value = 0.004;
  const direction = new T.Vector3(-0.55, 0.7, 0.38).normalize();
  sky.material.uniforms.sunPosition.value.copy(direction);
  scene.add(sky);
  const pmrem = new T.PMREMGenerator(renderer),
    environmentScene = new T.Scene();
  environmentScene.add(sky.clone());
  const env = pmrem.fromScene(environmentScene, 0.04);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.7;
  const sun = new T.DirectionalLight(0xffebd2, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -110,
    right: 110,
    top: 110,
    bottom: -110,
    near: 1,
    far: 400,
  });
  sun.shadow.bias = -0.00008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target, new T.HemisphereLight(0xabc9dc, 0x5b5342, 0.55));
  const ground = new T.PlaneGeometry(2304, 2304, 180, 180);
  ground.rotateX(-Math.PI / 2);
  const p = ground.getAttribute('position');
  const terrain = world.tileCache(128);
  for (let i = 0; i < p.count; i++) p.setY(i, terrain.height(p.getX(i), p.getZ(i)) - 0.018);
  ground.computeVertexNormals();
  const groundMesh = new T.Mesh(
    ground,
    new T.MeshStandardMaterial({ color: 0x777968, roughness: 1 }),
  );
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  const city = new SurveyCity(world),
    roads = new RoadMeshes(world.network, world.field);
  scene.add(city.root, roads.root);
  // The same procedural fallback tree renderer consumes geographic positions.
  const vegetation = new Vegetation(),
    structures = regionStructures(world),
    tiles = new Map();
  for (let x = -4; x <= 4; x++)
    for (let z = -4; z <= 4; z++) {
      const source = treesForTile(world, x, z, new StructureGrid(structures));
      const trees = new Float32Array((source.length / 6) * 7);
      for (let i = 0; i < source.length / 6; i++) {
        trees.set(source.subarray(i * 6, i * 6 + 6), i * 7);
        trees[i * 7 + 6] = terrain.height(source[i * 6], source[i * 6 + 1]);
      }
      if (trees.length) tiles.set((x + 4) * 9 + z + 4, { data: { trees }, level: 0, ix: x, iz: z });
    }
  vegetation.sync(tiles);
  scene.add(vegetation.root);
  function view(index = 0, side = 0, high = false) {
    const a = CHARLOTTETOWN_ROUTE[index],
      b = CHARLOTTETOWN_ROUTE[Math.min(index + 1, CHARLOTTETOWN_ROUTE.length - 1)];
    const heading = Math.atan2(b[0] - a[0], b[1] - a[1]) + side;
    const point = trackPoint();
    world.network.nearest(a[0], a[1], point);
    camera.position.set(a[0], point.y + (high ? 27 : 1.85), a[1]);
    camera.lookAt(
      a[0] + Math.sin(heading) * 25,
      point.y + (high ? 0 : 1.8),
      a[1] + Math.cos(heading) * 25,
    );
    sun.position.copy(camera.position).addScaledVector(direction, 160);
    sun.target.position.copy(camera.position);
    city.update(camera, 'high', 0, 0);
    vegetation.update(camera, 'high');
    renderer.render(scene, camera);
    return { city: city.stats, renderer: renderer.info.render, geographicStation: index };
  }
  return {
    view,
    dispose() {
      city.dispose();
      roads.dispose();
      vegetation.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
