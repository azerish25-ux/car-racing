import { expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  CREW_PERFORMANCE,
  crewPerformanceGeometry,
  CrewPerformanceSampler,
} from '../src/rendering/crew-performance.ts';
import source from '../src/rendering/crew-performance.geometry.json' with { type: 'json' };
import { CREW_REST } from '../src/rendering/people-asset.ts';
import { CrewPose, CREW_FOREARM, CREW_UPPER_ARM } from '../src/rendering/crew-pose.ts';
import humanKit from '../src/rendering/human-kit.json' with { type: 'json' };
import { GridPresentationView } from '../src/rendering/grid-presentation-view.ts';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { carBase } from '../src/simulation/protocol.ts';

const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

it('binds the shared kit and all fourteen editable actions to the source and exchange hashes', () => {
  expect(hash(readFileSync('scripts/author-crew-performance.py'))).toBe(
    CREW_PERFORMANCE.sourceSHA256,
  );
  expect(hash(readFileSync('scripts/author-people.py'))).toBe(CREW_PERFORMANCE.basePatternSHA256);
  expect(hash(readFileSync('src/rendering/crew-performance.geometry.json'))).toBe(
    CREW_PERFORMANCE.runtimeSHA256,
  );
  const packed = readFileSync('src/rendering/crew-performance.glb.gz');
  expect(hash(packed)).toBe(CREW_PERFORMANCE.compressedSHA256);
  const glb = gunzipSync(packed);
  expect(hash(glb)).toBe(CREW_PERFORMANCE.exchangeSHA256);
  const model = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  expect(model.animations.map((a: { name: string }) => a.name).sort()).toEqual(
    CREW_PERFORMANCE.actions,
  );
  expect(model.animations).toHaveLength(14);
  expect(model.skins[0].joints).toHaveLength(15);
  expect(readFileSync('scripts/crew-performance.blend').length).toBeGreaterThan(100000);
  // The authored hips, legs and head are kept; the arms use the
  // human-proportioned shoulder and segment lengths of the procedural bodies.
  for (const i of [0, 1, 2, 9, 10, 11, 12, 13, 14])
    expect(source.rest[i]).toEqual(CREW_REST[i].toArray());
  for (const i of [3, 4, 5, 6, 7, 8]) expect(Math.abs(CREW_REST[i].x)).toBeCloseTo(0.21, 6);
  expect(CREW_REST[3].y - CREW_REST[4].y).toBeCloseTo(CREW_UPPER_ARM, 6);
  expect(CREW_REST[4].y - CREW_REST[5].y).toBeCloseTo(CREW_FOREARM, 6);
  expect(CREW_PERFORMANCE.finalArtApproved).toBe(false);
});

it('uses the evaluated Blender action poses, matching actual GLB playback rather than another procedural animation', async () => {
  const bytes = gunzipSync(readFileSync('src/rendering/crew-performance.glb.gz'));
  const gltf = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  const skinned: T.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => {
    if (o instanceof T.SkinnedMesh) skinned.push(o);
  });
  expect(skinned).toHaveLength(2);
  const skeleton = skinned[0].skeleton;
  const sampler = new CrewPerformanceSampler(),
    mixer = new T.AnimationMixer(gltf.scene);
  const matrix = new T.Matrix4(),
    point = new T.Vector3(),
    rotation = new T.Quaternion();
  for (const name of CREW_PERFORMANCE.actions) {
    const clip = gltf.animations.find((c) => c.name === name)!;
    const key = name as keyof typeof source.clips;
    expect(clip.duration).toBeCloseTo(source.clips[key].duration, 5);
    for (const time of [0, source.clips[key].duration * 0.3, source.clips[key].duration * 0.7]) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).reset().setLoop(T.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      // Compare on authored sample frames; interpolation between frames is slerp.
      const t = Math.round(time * 30) / 30;
      mixer.setTime(t);
      gltf.scene.updateMatrixWorld(true);
      sampler.sample(key, t);
      for (let i = 0; i < 15; i++) {
        const index = skeleton.bones.findIndex((b) => b.name === source.bones[i]);
        expect(index).toBeGreaterThanOrEqual(0);
        matrix.multiplyMatrices(skeleton.bones[index].matrixWorld, skeleton.boneInverses[index]);
        point.fromArray(source.rest[i]).applyMatrix4(matrix);
        rotation.setFromRotationMatrix(matrix).normalize();
        expect(point.distanceTo(sampler.joints[i]), `${name}/${t}/${i}`).toBeLessThan(0.00008);
        expect(rotation.angleTo(sampler.rotations[i]), `${name}/${t}/${i}`).toBeLessThan(0.0002);
      }
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
  for (const mesh of skinned) {
    mesh.geometry.dispose();
    (mesh.material as T.Material).dispose();
  }
});

it('keeps geometry owned, UV-complete, four-weight normalized, and properly mirrored at the glove', () => {
  for (const name of Object.keys(source.meshes) as (keyof typeof source.meshes)[]) {
    const a = crewPerformanceGeometry(name),
      b = crewPerformanceGeometry(name);
    // Bodies and gloves are the procedural human kit; the helmet is authored.
    const procedural = {
      suit_near: 'body_suit_0',
      suit_mid: 'body_suit_1',
      glove: 'hand_0',
    } as const;
    expect(a.index!.count / 3).toBe(
      name === 'helmet'
        ? CREW_PERFORMANCE.triangles[name]
        : humanKit.meshes[procedural[name]].triangles,
    );
    expect(a.attributes.position.array).not.toBe(b.attributes.position.array);
    expect(a.attributes.uv.count).toBe(a.attributes.position.count);
    const weight = a.attributes.crewWeight;
    if (name === 'glove' || name === 'helmet') expect(weight === undefined).toBe(name === 'glove');
    for (let i = 0; weight && i < weight.count; i++) {
      let sum = 0;
      for (let j = 0; j < 4; j++) sum += weight.getComponent(i, j);
      expect(sum).toBeCloseTo(1, 5);
      // Procedural normals are stored as normalised 8-bit components.
      expect(
        Math.abs(new T.Vector3().fromBufferAttribute(a.attributes.normal, i).length() - 1),
      ).toBeLessThan(name === 'helmet' ? 1e-4 : 0.012);
    }
    a.dispose();
    b.dispose();
  }
  const near = crewPerformanceGeometry('suit_near').attributes.crewWeight;
  expect(Array.from({ length: near.count }, (_, i) => near.getZ(i)).some((v) => v > 0)).toBe(true);
  const right = crewPerformanceGeometry('glove'),
    left = crewPerformanceGeometry('glove', true);
  for (let i = 0; i < right.index!.count; i += 3) {
    expect(left.index!.getX(i + 1)).toBe(right.index!.getX(i + 2));
    expect(left.index!.getX(i + 2)).toBe(right.index!.getX(i + 1));
  }
  for (let i = 0; i < right.attributes.position.count; i++)
    expect(right.attributes.position.getX(i) + left.attributes.position.getX(i)).toBe(0);
  right.dispose();
  left.dispose();
});

it('samples repeatably at arbitrary times and rejects invalid inputs without an animation clock', () => {
  const p = new CrewPerformanceSampler();
  for (const clip of Object.keys(source.clips) as (keyof typeof source.clips)[]) {
    p.sample(clip, 0.73);
    const before = p.joints.map((v) => v.toArray());
    const rotations = p.rotations.map((v) => v.toArray());
    p.sample('walk', 0.13);
    p.sample(clip, 0.73);
    expect(p.joints.map((v) => v.toArray())).toEqual(before);
    expect(p.rotations.map((v) => v.toArray())).toEqual(rotations);
  }
  expect(() => p.sample('walk', NaN)).toThrow();
  expect(() => p.grid(Infinity, 0)).toThrow();
  p.sample('walk', 0.35, true);
  const before = p.joints.map((v) => v.toArray());
  p.sample('walk', 0.35 + 1.2, true);
  p.joints.forEach((v, i) => expect(v.distanceTo(new T.Vector3(...before[i]))).toBeLessThan(1e-8));
});

it('retargets authored shoulder and pelvis motion to the same hands, feet and rigid bone lengths', () => {
  const p = new CrewPerformanceSampler(),
    rig = new CrewPose();
  const hands = [new T.Vector3(-0.22, 0.68, 0.43), new T.Vector3(0.22, 0.68, 0.43)];
  const feet = [new T.Vector3(-0.14, 0.055, 0.18), new T.Vector3(0.14, 0.055, 0.03)];
  for (let time = 9; time < 17; time += 0.025) {
    p.grid(time, 0);
    const hip = Math.min(0.8, p.joints[0].y);
    hands[0].y = hands[1].y = hip + 0.2;
    rig.set(new T.Matrix4(), hip, 0.2, hands, 0.15, feet, p.style);
    expect(rig.reachable).toEqual([true, true]);
    expect(rig.endpoint(4, CREW_REST[5]).distanceTo(hands[0])).toBeLessThan(1e-8);
    expect(rig.endpoint(7, CREW_REST[8]).distanceTo(hands[1])).toBeLessThan(1e-8);
    expect(rig.endpoint(11, CREW_REST[11]).distanceTo(feet[0])).toBeLessThan(1e-8);
    expect(rig.endpoint(14, CREW_REST[14]).distanceTo(feet[1])).toBeLessThan(1e-8);
    expect(rig.joints[4].distanceTo(rig.joints[3])).toBeCloseTo(CREW_UPPER_ARM, 7);
    expect(rig.joints[5].distanceTo(rig.joints[4])).toBeCloseTo(CREW_FOREARM, 7);
  }
});

it('uses the same procedural human kit and skeleton in grid preparation and live pit service', () => {
  const grid = new GridPresentationView(),
    pit = new PitCrewView();
  // Grid crews wear the polo cut with real heads; pit crews the overall and
  // helmet. Both are the same baked kit on the same skeleton and bone atlas.
  for (let i = 0; i < 2; i++) {
    const a = grid.root.children[i] as T.InstancedMesh,
      b = pit.root.children[i] as T.InstancedMesh;
    expect(a.geometry.userData.sourceSha256).toBe(humanKit.sha256);
    expect(b.geometry.userData.sourceSha256).toBe(humanKit.sha256);
    expect(a.geometry.userData.authoredRole).toBe(`body_polo_${i}`);
    expect(b.geometry.userData.authoredRole).toBe(i === 0 ? 'suit_near' : 'suit_mid');
    expect(a.geometry.attributes.crewJoint.count).toBe(a.geometry.attributes.position.count);
  }
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 11 });
  const frame = sim.makeFrame(),
    original = frame.slice(),
    camera = new T.Vector3().fromArray(frame, carBase(0));
  for (const time of [0, 5, 8, 10, 14, 16.6, 18, 21, 24, 30, 38]) {
    grid.update(frame, camera, time);
    const result = grid.diagnostics();
    expect(result.actors).toBe(48);
    expect(result.asset).toBe(CREW_PERFORMANCE.runtimeSHA256);
    expect(result.contacts.every((c) => c.arms && c.feet && c.gripError < 0.001)).toBe(true);
    expect(frame).toEqual(original);
  }
  grid.dispose();
  pit.dispose();
});
