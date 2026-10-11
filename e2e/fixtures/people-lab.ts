/** Close-up character inspection: the production crew skinning, kit, head
 * and glove materials on a lit studio floor. Used for art review captures;
 * it does not substitute for the full-application grid presentation. */
import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CrewPose, installCrewSkin } from '../../src/rendering/crew-pose.ts';
import { CREW_BONES } from '../../src/rendering/people-asset.ts';
import { CrewPerformanceSampler, type CrewAction } from '../../src/rendering/crew-performance.ts';
import {
  crewBodyGeometry,
  crewHandGeometry,
  humanHeadGeometry,
  installHumanHead,
  type HeadWear,
} from '../../src/rendering/human-kit.ts';
import { crewTeamColour } from '../../src/rendering/crew-geometry.ts';
import { CUFF } from '../../src/rendering/pit-crew.ts';
import { CrowdCluster } from '../../src/rendering/crowd.ts';
import { GridPresentationView } from '../../src/rendering/grid-presentation-view.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, carBase } from '../../src/simulation/protocol.ts';

export interface LabShot {
  name: string;
  eye: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export function peopleLab(
  shots: LabShot[],
  options: {
    kit?: 'polo' | 'suit';
    lod?: 0 | 1 | 2;
    action?: CrewAction;
    time?: number;
    count?: number;
    width?: number;
    height?: number;
    wears?: HeadWear[];
  } = {},
) {
  const width = options.width ?? 900,
    height = options.height ?? 900;
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  document.body.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0x8a9aa8);
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const sun = new T.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -3;
  sun.shadow.camera.right = sun.shadow.camera.top = 3;
  sun.shadow.bias = -0.0004;
  scene.add(sun, new T.HemisphereLight(0xc8dcff, 0x5a5048, 0.7));
  const floor = new T.Mesh(
    new T.PlaneGeometry(20, 20),
    new T.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const count = options.count ?? 3,
    kit = options.kit ?? 'polo',
    lod = options.lod ?? 0;
  const boneData = new Float32Array(count * CREW_BONES * 16);
  const bones = new T.DataTexture(boneData, 60, count, T.RGBAFormat, T.FloatType);
  bones.minFilter = bones.magFilter = T.NearestFilter;
  bones.needsUpdate = true;
  const body = crewBodyGeometry(kit, lod);
  const slots = new T.InstancedBufferAttribute(
    Float32Array.from({ length: count }, (_, i) => i),
    1,
  );
  body.setAttribute('crewSlot', slots);
  const kitMaterial = new T.MeshStandardMaterial({ vertexColors: true });
  installCrewSkin(kitMaterial, bones, count, true, kit);
  const bodies = new T.InstancedMesh(body, kitMaterial, count);
  const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
  installCrewSkin(depth, bones, count, false);
  bodies.customDepthMaterial = depth;
  const wears: HeadWear[] = options.wears ?? ['cap-headset', 'bare', 'headset', 'cap'];
  const heads = wears.map((wear) => {
    const g = humanHeadGeometry(wear, lod);
    g.setAttribute('headPerson', new T.InstancedBufferAttribute(new Float32Array(count), 1));
    const m = new T.InstancedMesh(g, installHumanHead(new T.MeshStandardMaterial(), wear), count);
    m.count = 0;
    return m;
  });
  const hands = [true, false].map(
    (left) =>
      new T.InstancedMesh(
        crewHandGeometry(lod === 0 ? 0 : 1, left),
        new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }),
        count,
      ),
  );
  for (const m of [bodies, ...heads, ...hands]) {
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
  }
  const pose = new CrewPose(),
    sampler = new CrewPerformanceSampler();
  const actor = new T.Object3D(),
    part = new T.Object3D(),
    matrix = new T.Matrix4();
  const gloveBind = [-1, 1].map((sign) =>
    new T.Quaternion()
      .setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI)
      .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (sign * Math.PI) / 2)),
  );
  const wrists = [new T.Vector3(), new T.Vector3()],
    feet = [new T.Vector3(), new T.Vector3()];
  for (let i = 0; i < count; i++) {
    sampler.sample(options.action ?? 'idle', (options.time ?? 0.5) + i * 0.37, true);
    actor.position.set((i - (count - 1) / 2) * 0.85, 0, 0);
    actor.rotation.set(0, (i - (count - 1) / 2) * -0.35, 0);
    actor.updateMatrix();
    for (let h = 0; h < 2; h++) {
      wrists[h].copy(sampler.joints[h ? 8 : 5]).applyMatrix4(actor.matrix);
      feet[h].copy(sampler.joints[h ? 14 : 11]).applyMatrix4(actor.matrix);
    }
    pose.set(actor.matrix, sampler.joints[0].y, 0, wrists, 0.15, feet, sampler.style);
    pose.write(boneData, i);
    bodies.setMatrixAt(i, actor.matrix);
    bodies.setColorAt(i, crewTeamColour(i));
    const head = heads[i % wears.length];
    part.position.copy(pose.joints[2]);
    part.quaternion.copy(pose.rotations[2]);
    part.updateMatrix();
    matrix.multiplyMatrices(actor.matrix, part.matrix);
    head.setMatrixAt(head.count, matrix);
    head.setColorAt(head.count, crewTeamColour(i));
    (head.geometry.getAttribute('headPerson') as T.BufferAttribute).setX(head.count, i);
    head.count++;
    for (let h = 0; h < 2; h++) {
      part.quaternion.copy(pose.rotations[h === 0 ? 4 : 7]).multiply(gloveBind[h]);
      part.position
        .copy(CUFF)
        .applyQuaternion(part.quaternion)
        .negate()
        .add(pose.joints[h === 0 ? 5 : 8]);
      part.updateMatrix();
      matrix.multiplyMatrices(actor.matrix, part.matrix);
      hands[h].setMatrixAt(i, matrix);
    }
  }
  const camera = new T.PerspectiveCamera(40, width / height, 0.02, 100);
  const images: Record<string, string> = {};
  for (const shot of shots) {
    camera.fov = shot.fov;
    camera.updateProjectionMatrix();
    camera.position.set(...shot.eye);
    camera.lookAt(...shot.target);
    renderer.render(scene, camera);
    images[shot.name] = renderer.domElement.toDataURL('image/png');
  }
  const info = { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
  renderer.dispose();
  renderer.domElement.remove();
  return { images, info };
}

/** Seated/standing spectators in a small stand, through the production
 * crowd cluster (shader deformation, LOD selection, actions). */
export function crowdLab(
  shots: LabShot[],
  options: { time?: number; reaction?: number; family?: number } = {},
) {
  const width = 1000,
    height = 700;
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  document.body.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0x8a9aa8);
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  const sun = new T.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(-4, 7, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -6;
  sun.shadow.camera.right = sun.shadow.camera.top = 6;
  scene.add(sun, new T.HemisphereLight(0xc8dcff, 0x5a5048, 0.7));
  const matrices: T.Matrix4[] = [],
    colors: T.Color[] = [];
  const palette = [0xc0282d, 0x1b2a5e, 0xf2f2f2, 0x2e7d4f, 0xe08a1e, 0x222222, 0x5b8fd6, 0xd8c84a];
  const dummy = new T.Object3D();
  const seatMaterial = new T.MeshStandardMaterial({ color: 0x6a2b28, roughness: 0.46 });
  const concrete = new T.MeshStandardMaterial({ color: 0x8c8b86, roughness: 0.95 });
  for (let row = 0; row < 4; row++) {
    const step = new T.Mesh(new T.BoxGeometry(0.98, 0.49, 6.5), concrete);
    step.position.set(1.55 + row * 0.98, row * 0.49 - 0.245 + 0.02, 0);
    step.receiveShadow = true;
    scene.add(step);
    for (let col = 0; col < 9; col++) {
      dummy.position.set(1.55 + row * 0.98, row * 0.49 + 0.5, (col - 4) * 0.65);
      dummy.updateMatrix();
      const seat = new T.Mesh(new T.BoxGeometry(0.4, 0.06, 0.39), seatMaterial);
      seat.position.copy(dummy.position);
      const back = new T.Mesh(new T.BoxGeometry(0.055, 0.4, 0.4), seatMaterial);
      back.position.copy(dummy.position).add(new T.Vector3(0.185, 0.2, 0));
      seat.castShadow = back.castShadow = true;
      scene.add(seat, back);
      matrices.push(dummy.matrix.clone());
      colors.push(new T.Color(palette[(row * 9 + col * 5) % palette.length]));
    }
  }
  const material = new T.MeshStandardMaterial({ roughness: 0.85 });
  const cluster = new CrowdCluster(matrices, colors, 911, material, options.family);
  scene.add(cluster.root);
  const camera = new T.PerspectiveCamera(40, width / height, 0.05, 200);
  const images: Record<string, string> = {};
  for (const shot of shots) {
    camera.fov = shot.fov;
    camera.updateProjectionMatrix();
    camera.position.set(...shot.eye);
    camera.lookAt(...shot.target);
    cluster.update(options.time ?? 3, camera.position, 0, undefined, shot.fov, width / height);
    cluster.uniforms.crowdReaction.value.set(options.reaction ?? 0, 0);
    renderer.render(scene, camera);
    images[shot.name] = renderer.domElement.toDataURL('image/png');
  }
  const info = { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
  renderer.dispose();
  renderer.domElement.remove();
  return { images, info };
}

/** The production pre-race cast (mechanics, umbrella holder, engineer) at a
 * presentation time, around the player's grid slot (car body not drawn). */
export function castLab(shots: LabShot[], options: { time?: number } = {}) {
  const width = 1000,
    height = 700;
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  document.body.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0x8a9aa8);
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 });
  const frame = sim.makeFrame();
  const o = carBase(0);
  const car = new T.Object3D();
  car.position.fromArray(frame, o + F.X);
  car.quaternion.fromArray(frame, o + F.QX);
  car.updateMatrixWorld();
  const sun = new T.DirectionalLight(0xfff1dc, 2.4);
  sun.position.copy(car.position).add(new T.Vector3(-4, 8, 3));
  sun.target.position.copy(car.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
  sun.shadow.camera.right = sun.shadow.camera.top = 8;
  scene.add(sun, sun.target, new T.HemisphereLight(0xc8dcff, 0x5a5048, 0.7));
  const floor = new T.Mesh(
    new T.PlaneGeometry(60, 60),
    new T.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(car.localToWorld(new T.Vector3(0, -0.52, 0)));
  floor.receiveShadow = true;
  scene.add(floor);
  const proxy = new T.Mesh(
    new T.BoxGeometry(1.9, 0.6, 5.4),
    new T.MeshStandardMaterial({ color: 0x14203a, roughness: 0.4 }),
  );
  proxy.position.copy(car.localToWorld(new T.Vector3(0, -0.1, 0.1)));
  proxy.quaternion.copy(car.quaternion);
  scene.add(proxy);
  const view = new GridPresentationView();
  scene.add(view.root);
  view.update(frame, car.position, options.time ?? 5);
  const camera = new T.PerspectiveCamera(40, width / height, 0.05, 300);
  const images: Record<string, string> = {};
  for (const shot of shots) {
    camera.fov = shot.fov;
    camera.updateProjectionMatrix();
    camera.position.copy(car.localToWorld(new T.Vector3(...shot.eye)));
    camera.lookAt(car.localToWorld(new T.Vector3(...shot.target)));
    renderer.render(scene, camera);
    images[shot.name] = renderer.domElement.toDataURL('image/png');
  }
  const info = { ...view.diagnostics(), contacts: undefined };
  renderer.dispose();
  renderer.domElement.remove();
  return { images, info };
}
