import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BikeMaterials, BikeShells, bikeOnboardFov, staticSag } from '../../src/rendering/bike.ts';
import { DirtBikeModel } from '../../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../../src/simulation/vehicles.ts';
import type { RiderDetail } from '../../src/rendering/rider.ts';
import { inspectMotocrossCockpit } from './motocross-cockpit-contract.ts';

export interface MotocrossPoseSample {
  standing?: number;
  dab?: number;
  body?: number;
  lean?: number;
  steer?: number;
  mud?: number;
  wet?: number;
  brake?: number;
  forkOffset?: number;
  shockOffset?: number;
  speed?: number;
}

/** Actual production DirtBikeModel in a controlled inspection scene. The
 * production geometry, materials, suspension and rider IK are unmodified. */
export function captureMotocrossBike(
  id = 'mx450',
  detail: RiderDetail = 'high',
  view = 'three-quarter',
  samples: readonly MotocrossPoseSample[] = [{}],
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
  scene.background = new T.Color(0xbac7cf);
  const pmrem = new T.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.08);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.7;
  const sun = new T.DirectionalLight(0xffedce, 3.1);
  sun.position.set(-3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 15 });
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.008;
  scene.add(sun, new T.HemisphereLight(0xc4def3, 0x635345, 1.1));
  const ground = new T.Mesh(
    new T.PlaneGeometry(150, 150),
    new T.MeshStandardMaterial({ color: 0x76604a, roughness: 0.97 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const def = VEHICLES[id],
    materials = new BikeMaterials(0),
    mud = mudUniforms();
  const model = new DirtBikeModel(def, 0, detail, materials, mud),
    sag = staticSag(def);
  scene.add(model.root);
  const camera = new T.PerspectiveCamera(36, 1280 / 800, 0.03, 80);
  if (view === 'side') camera.position.set(3.9, 1.43, 0.06);
  else if (view === 'front') camera.position.set(0.38, 1.5, 4.1);
  else if (view === 'rear') camera.position.set(-2.85, 1.9, -3.5);
  else if (view === 'helmet') camera.position.set(0.75, 1.75, 1.2);
  else camera.position.set(-3.05, 1.72, 3.6);
  camera.lookAt(0, view === 'helmet' ? 1.59 : 0.93, 0);
  if (view === 'bodywork') model.rider.root.visible = false;
  let triangles = 0,
    finiteGeometry = true;
  const materialsUsed = new Set<string>();
  model.root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3;
    for (const attribute of Object.values(o.geometry.attributes) as T.BufferAttribute[]) {
      for (const value of attribute.array) if (!Number.isFinite(value)) finiteGeometry = false;
    }
    for (const material of Array.isArray(o.material) ? o.material : [o.material])
      materialsUsed.add(material.name);
  });
  try {
    return samples.map((sample) => {
      model.pose({
        fork: sag.fork + (sample.forkOffset ?? 0),
        shock: sag.shock + (sample.shockOffset ?? 0),
        steer: sample.steer ?? 0,
        frontRotation: 0,
        rearRotation: 0,
        chassisLean: sample.lean ?? 0,
        riderOffset: 0,
        tuck: 0,
        brake: sample.brake ?? 0,
        rearBrake: 0,
        discTemp: 0,
        compoundColour: 0xffffff,
        riding: true,
        standing: sample.standing ?? 0,
        dab: sample.dab ?? 0,
        body: sample.body ?? 0,
        mud: sample.mud ?? 0,
        mudWet: sample.wet ?? 0,
      });
      model.root.rotation.z = -(sample.lean ?? 0);
      model.root.position.y =
        def.bike!.cgHeight * Math.cos(sample.lean ?? 0) +
        0.045 * Math.sin(Math.abs(sample.lean ?? 0));
      model.rider.setFirstPerson(view === 'onboard', true);
      if (view === 'onboard') {
        const direction = new T.Vector3();
        new BikeShells().onboard(model.root, camera.position, direction, false, def);
        camera.fov = bikeOnboardFov(sample.speed ?? 0, def);
        camera.up.set(0, 1, 0).applyQuaternion(model.root.quaternion);
        camera.lookAt(camera.position.clone().add(direction));
        camera.updateProjectionMatrix();
      }
      scene.updateMatrixWorld(true);
      const cockpit = view === 'onboard' ? inspectMotocrossCockpit(model, camera) : null;
      const contacts = [0, 1].map((i) => {
        const label = i === 0 ? 'left' : 'right',
          side = i === 0 ? 1 : -1;
        const hand = model.rider.root.getObjectByName(`Motocross ${label} hand`)!;
        const boot = model.rider.root.getObjectByName(`Motocross ${label} boot`)!;
        const grip = model.rider.grips[i].clone().applyMatrix4(model.sprung.matrixWorld);
        const target = model.rider.pegs[i].clone();
        const dab = Math.max(0, side * (sample.dab ?? 0));
        target.add(new T.Vector3(side * 0.2, -0.015, 0.32).multiplyScalar(dab));
        target.applyMatrix4(model.sprung.matrixWorld);
        return {
          handError: hand.getWorldPosition(new T.Vector3()).distanceTo(grip),
          ankleError: boot.getWorldPosition(new T.Vector3()).distanceTo(target),
        };
      });
      renderer.render(scene, camera);
      const gl = renderer.getContext(),
        pixels = new Uint8Array(1280 * 800 * 4);
      gl.readPixels(0, 0, 1280, 800, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let hash = 2166136261;
      for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      return {
        image: renderer.domElement.toDataURL('image/png'),
        instance: model.root.uuid,
        hash,
        triangles,
        finiteGeometry,
        contacts,
        cockpit,
        calls: renderer.info.render.calls,
        glError: gl.getError(),
        // A raked wheel's transformed local AABB overstates its radius. Inspect
        // actual transformed vertices, including tread and rider extremities.
        bounds: new T.Box3().setFromObject(model.root, true),
        resources: {
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          programs: renderer.info.programs?.length ?? 0,
        },
        mud: mud.offroadMud.value,
        wetness: mud.offroadMudWet.value,
        materials: [...materialsUsed],
      };
    });
  } finally {
    model.dispose();
    materials.dispose();
    ground.geometry.dispose();
    (ground.material as T.Material).dispose();
    env.dispose();
    room.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
