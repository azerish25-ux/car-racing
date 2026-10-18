import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  buildMxTracksideModel,
  type MxTracksideModel,
  type MxTracksideDetail,
} from '../../src/rendering/offroad/mx-trackside-models.ts';

/** Actual runtime model buffers under a controlled, original studio rig.
 * This is an asset inspection, not a screenshot of a running race. */
export function captureMxTracksideModel(
  kind: MxTracksideModel,
  detail: MxTracksideDetail = 'near',
  reverse = false,
) {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1100, 900);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color(0xb6b6aa);
  const room = new RoomEnvironment(),
    pmrem = new T.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.55;
  const root = buildMxTracksideModel(kind, detail);
  scene.add(root);
  const bounds = new T.Box3().setFromObject(root),
    center = bounds.getCenter(new T.Vector3());
  const radius = bounds.getSize(new T.Vector3()).length() * 0.5;
  const floor = new T.Mesh(
    new T.PlaneGeometry(radius * 14, radius * 14),
    new T.MeshStandardMaterial({ color: 0x99998a, roughness: 0.94 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.012;
  floor.receiveShadow = true;
  scene.add(floor);
  const key = new T.DirectionalLight(0xfff4df, 3.1);
  key.position.set(-radius * 2, radius * 4, radius * 3);
  key.target.position.copy(center);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -radius * 2;
  key.shadow.camera.right = key.shadow.camera.top = radius * 2;
  key.shadow.camera.near = 0.05;
  key.shadow.camera.far = radius * 12;
  key.shadow.normalBias = 0.012;
  scene.add(key, key.target);
  scene.add(new T.HemisphereLight(0xe3e9ed, 0x716349, 0.65));
  const camera = new T.PerspectiveCamera(36, 1100 / 900, 0.02, 200);
  const direction = new T.Vector3(reverse ? -1.1 : 1.15, 0.73, reverse ? -1.45 : 1.6).normalize();
  camera.position
    .copy(center)
    .addScaledVector(direction, (radius / Math.sin((18 * Math.PI) / 180)) * 1.03);
  camera.lookAt(center);
  renderer.render(scene, camera);
  const gl = renderer.getContext(),
    extension = gl.getExtension('WEBGL_debug_renderer_info');
  const result = {
    kind,
    detail,
    image: renderer.domElement.toDataURL('image/png'),
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    parts: root.userData.partNames.length,
    modelDraws: root.children.length,
    glError: gl.getError(),
    gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown',
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  };
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  scene.traverse((o) => {
    if (o instanceof T.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  key.shadow.map?.dispose();
  environment.dispose();
  pmrem.dispose();
  room.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return result;
}
