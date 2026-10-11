import { PitMachinery } from '../src/rendering/pit-machinery.ts';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as T from 'three';
import {
  CREW_BONES,
  CREW_REST,
  PEOPLE_ASSET,
  peopleGeometry,
  leftCrewGloveGeometry,
} from '../src/rendering/people-asset.ts';
import manifest from '../src/rendering/aurel-people.manifest.json' with { type: 'json' };
import { CrewPose, CREW_UPPER_ARM, CREW_FOREARM } from '../src/rendering/crew-pose.ts';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import { CrowdCluster, SPECTATOR_HEAD_SCALE, spectatorVariation } from '../src/rendering/crowd.ts';
import {
  HEAD_MIDFACE_LIFT as SCULPT_MIDFACE_LIFT,
  SPECTATOR_HEAD_SCALE as SCULPT_HEAD_SCALE,
} from '../scripts/lib/human-sculpt.ts';
import { HEAD_MIDFACE_LIFT } from '../src/rendering/human-kit.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import {
  H,
  F,
  W,
  HEADER,
  CAR_STRIDE,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';

function release(root: T.Object3D) {
  const geometry = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometry.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    if (o.customDepthMaterial) materials.add(o.customDepthMaterial);
    if (o.customDistanceMaterial) materials.add(o.customDistanceMaterial);
    if (o instanceof T.InstancedMesh) o.dispose();
  });
  geometry.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
function shaderFor(material: T.Material, kind: 'standard' | 'depth' | 'distanceRGBA') {
  const source = T.ShaderLib[kind];
  const shader = {
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    uniforms: T.UniformsUtils.clone(source.uniforms),
  } as Parameters<T.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}
function serviceFrame(clock: number, length = 0.3, cars = 1) {
  const frame = new Float32Array(HEADER + cars * CAR_STRIDE);
  frame[H.CARS] = cars;
  frame[H.TIME] = 100 + clock;
  for (let i = 0; i < cars; i++) {
    const o = carBase(i);
    frame[o + F.QW] = 1;
    frame[o + F.Y] = 0.6;
    frame[o + F.X] = i * 7;
    frame[o + F.PIT_PHASE] =
      clock < 0.8 ? 2 : clock < 2.2 ? 3 : clock < 3.5 ? 4 : clock < 5.2 ? 5 : 6;
    frame[o + F.PIT_CLOCK] = clock;
    frame[o + F.JACK_HEIGHT] = Math.min(0.19, Math.max(0, clock - 0.8) * 0.16);
    for (let w = 0; w < 4; w++) frame[o + WHEEL_BASE + w * WHEEL_STRIDE + W.LENGTH] = length;
  }
  return frame;
}
function atlas(view: PitCrewView) {
  const mesh = view.root.children[0] as T.InstancedMesh;
  const shader = shaderFor(mesh.material as T.Material, 'standard');
  return shader.uniforms.crewBones.value as T.DataTexture;
}

describe('27H.3 retained Blender people assets', () => {
  it('binds runtime and GLB bytes to their retained authored manifest', () => {
    const runtime = readFileSync('src/rendering/aurel-people.geometry.json');
    const packed = readFileSync('src/rendering/aurel-people.glb.gz'),
      glb = gunzipSync(packed);
    expect(createHash('sha256').update(runtime).digest('hex')).toBe(manifest.runtimeSha256);
    expect(createHash('sha256').update(glb).digest('hex')).toBe(manifest.exchangeSha256);
    expect(runtime.length).toBe(manifest.runtimeBytes);
    expect(packed.length).toBe(manifest.exchangeCompressedBytes);
    expect(glb.toString('ascii', 0, 4)).toBe('glTF');
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    expect(readFileSync('scripts/aurel-people.blend').length).toBeGreaterThan(10000);
    expect(PEOPLE_ASSET.finalArtApproved).toBe(false);
  });
  it('uses owned finite geometry, normalized skin weights and explicit near/mid/far budgets', () => {
    for (const [role, triangles] of Object.entries(manifest.triangles)) {
      const a = peopleGeometry(role as keyof typeof manifest.triangles),
        b = peopleGeometry(role as keyof typeof manifest.triangles);
      try {
        expect(a.index!.count / 3).toBe(triangles);
        expect(a.getAttribute('position').array).not.toBe(b.getAttribute('position').array);
        expect(a.boundingSphere!.radius).toBeGreaterThan(0);
        if (role.startsWith('spectator_')) {
          const packed = a.getAttribute('crowdPerson');
          expect(packed.itemSize).toBe(3);
          for (let i = 0; i < packed.count; i++) {
            expect(packed.getX(i)).toBe(a.getAttribute('crowdJoint').getX(i));
            expect(packed.getY(i)).toBe(a.getAttribute('skinMask').getX(i));
            expect(packed.getZ(i)).toBe(a.getAttribute('crowdAccessory').getX(i));
          }
        }
        if (role.startsWith('crew_')) {
          const weights = a.getAttribute('crewWeight');
          for (let i = 0; i < weights.count; i++)
            expect(weights.getX(i) + weights.getY(i)).toBeCloseTo(1, 5);
        }
        for (const attribute of Object.values(a.attributes))
          expect([...attribute.array].every(Number.isFinite)).toBe(true);
      } finally {
        a.dispose();
        b.dispose();
      }
    }
    expect(manifest.triangles.spectator_0).toBeLessThan(2500);
    expect(manifest.triangles.spectator_1).toBeLessThan(manifest.triangles.spectator_0 * 0.6);
    expect(manifest.triangles.spectator_2).toBeLessThan(manifest.triangles.spectator_1 * 0.5);
  });
  it('reflects left-hand topology without negative instance scales or inside-out faces', () => {
    const right = peopleGeometry('glove'),
      left = leftCrewGloveGeometry();
    try {
      for (let i = 0; i < right.index!.count; i += 3) {
        expect(left.index!.getX(i)).toBe(right.index!.getX(i));
        expect(left.index!.getX(i + 1)).toBe(right.index!.getX(i + 2));
      }
      const a = left.getAttribute('position'),
        b = right.getAttribute('position');
      for (let i = 0; i < a.count; i++) {
        expect(a.getX(i) + b.getX(i)).toBe(0);
        expect(a.getY(i)).toBe(b.getY(i));
      }
    } finally {
      left.dispose();
      right.dispose();
    }
  });
});

describe('27H.3 real service-state rig and prop contacts', () => {
  it('keeps every task reachable across jack motion, suspension lengths and both sides', () => {
    const view = new PitCrewView();
    try {
      for (const length of [0.14, 0.2, 0.25, 0.3, 0.34])
        for (let step = 0; step <= 60; step++) {
          const frame = serviceFrame((step * 5.19) / 60, length),
            original = frame.slice();
          view.update(frame, new T.Vector3());
          const result = view.diagnostics();
          expect(frame).toEqual(original);
          expect(result.actors).toBe(15);
          expect(result.roles.filter((r) => r.role === 'gun')).toHaveLength(4);
          expect(result.roles.filter((r) => r.role === 'remove')).toHaveLength(4);
          expect(result.roles.filter((r) => r.role === 'install')).toHaveLength(4);
          for (const role of result.roles) {
            expect(role.reachable, `${length}/${step}/${role.role}/${role.wheel}`).toEqual([
              true,
              true,
            ]);
            expect(role.wristError).toBeLessThan(1e-5);
            expect(role.gripError).toBeLessThan(1e-5);
          }
        }
    } finally {
      view.dispose();
      release(view.root);
    }
  });
  it('keeps task helmets separated and rejects corrupt service state before uploading a pose', () => {
    const view = new PitCrewView(),
      matrix = new T.Matrix4(),
      point = new T.Vector3();
    const centers = Array.from({ length: 15 }, () => new T.Vector3());
    try {
      for (const length of [0.14, 0.2, 0.25, 0.3, 0.34]) {
        for (let step = 0; step <= 120; step++) {
          view.update(serviceFrame((step * 5.19) / 120, length), point);
          const helmets = view.root.children[2] as T.InstancedMesh;
          for (let i = 0; i < helmets.count; i++) {
            helmets.getMatrixAt(i, matrix);
            centers[i].setFromMatrixPosition(matrix);
            for (let j = 0; j < i; j++)
              expect(
                centers[i].distanceTo(centers[j]),
                `${length}/${step}/${i}/${j}`,
              ).toBeGreaterThan(0.28);
          }
        }
      }
      for (const channel of [F.PIT_PHASE, F.PIT_CLOCK, F.SPEED, WHEEL_BASE + W.LENGTH]) {
        const frame = serviceFrame(1.8);
        frame[carBase(0) + channel] = NaN;
        expect(() => view.update(frame, point)).toThrow();
      }
    } finally {
      view.dispose();
      release(view.root);
    }
  });
  it('matches actual uploaded forearm matrices to the actual glove cuffs; boots stay above the pit floor', () => {
    const view = new PitCrewView(),
      instance = new T.Matrix4(),
      bone = new T.Matrix4(),
      glove = new T.Matrix4();
    const p = new T.Vector3(),
      q = new T.Vector3(),
      posed = new T.Vector3();
    try {
      for (const clock of [0, 0.8, 1.2, 2.2, 3.5, 4.6]) {
        const frame = serviceFrame(clock);
        view.update(frame, new T.Vector3());
        const mesh = view.root.children[0] as T.InstancedMesh,
          g = mesh.geometry;
        const data = atlas(view).image.data as Float32Array,
          slots = g.getAttribute('crewSlot');
        for (let actor = 0; actor < mesh.count; actor++) {
          mesh.getMatrixAt(actor, instance);
          for (let hand = 0; hand < 2; hand++) {
            const fore = hand === 0 ? 4 : 7;
            bone.fromArray(data, (slots.getX(actor) * CREW_BONES + fore) * 16);
            p.copy(CREW_REST[fore + 1])
              .applyMatrix4(bone)
              .applyMatrix4(instance);
            (view.root.children[3 + hand] as T.InstancedMesh).getMatrixAt(actor, glove);
            q.set(0, -0.067, -0.008).applyMatrix4(glove);
            expect(p.distanceTo(q)).toBeLessThan(1e-5);
          }
          const pos = g.getAttribute('position'),
            joints = g.getAttribute('crewJoint'),
            weights = g.getAttribute('crewWeight');
          for (let vertex = 0; vertex < pos.count; vertex++) {
            posed.set(0, 0, 0);
            for (let influence = 0; influence < 4; influence++) {
              bone.fromArray(
                data,
                (slots.getX(actor) * CREW_BONES + joints.getComponent(vertex, influence)) * 16,
              );
              p.fromBufferAttribute(pos, vertex).applyMatrix4(bone);
              posed.addScaledVector(p, weights.getComponent(vertex, influence));
            }
            posed.applyMatrix4(instance);
            expect(posed.y).toBeGreaterThanOrEqual(
              frame[carBase(0) + F.Y] - 0.43 - frame[carBase(0) + F.JACK_HEIGHT] - 0.002,
            );
          }
        }
      }
    } finally {
      view.dispose();
      release(view.root);
    }
  });
  it('packs machinery into one draw without moving the actual gun grips or changing material roles', () => {
    const view = new PitCrewView(),
      a = new T.Vector3(),
      b = new T.Vector3(),
      matrix = new T.Matrix4(),
      glove = new T.Matrix4();
    try {
      const packed = view.root.children.find((o) => o instanceof PitMachinery) as PitMachinery;
      expect(packed.piecesPerCrew).toBe(14);
      expect(packed.transforms.image.width).toBe(4);
      expect(packed.transforms.image.height).toBe(168);
      expect(packed.instanceMatrix.array.byteLength).toBe(10752);
      for (const clock of [0.8, 1.35, 2.1, 2.2, 3.5, 4.5]) {
        view.update(serviceFrame(clock), new T.Vector3());
        expect(view.summary().activeDrawBatches).toBe(6);
        expect(packed.geometry.drawRange.count).toBe(packed.indicesPerCrew);
        expect(packed.count).toBe(14);
        for (let wheel = 0; wheel < 4; wheel++) {
          matrix.fromArray(packed.transforms.image.data as Float32Array, wheel * 16);
          for (let side = 0; side < 2; side++) {
            (view.root.children[3 + side] as T.InstancedMesh).getMatrixAt(wheel * 3, glove);
            a.set(0, side ? 0 : -0.083, side ? -0.1 : -0.203).applyMatrix4(matrix);
            b.set(0, 0.034, 0.041).applyMatrix4(glove);
            expect(a.distanceTo(b)).toBeLessThan(1e-5);
          }
        }
      }
      for (const [m, k] of [
        [packed.material, 'standard'],
        [packed.customDepthMaterial, 'depth'],
        [packed.customDistanceMaterial, 'distanceRGBA'],
      ] as const) {
        const shader = shaderFor(m as T.Material, k);
        expect(shader.uniforms.machineTransforms.value).toBe(packed.transforms);
        expect(shader.vertexShader).toContain('objectNormal/=vec3(dot(machineBasis[0]');
      }
      view.update(serviceFrame(5.2), new T.Vector3());
      expect(packed.geometry.drawRange.count).toBe(0);
      expect(packed.count).toBe(0);
    } finally {
      view.dispose();
      release(view.root);
    }
  });
  it('retains rigid limb lengths and rejects malformed pose and atlas addresses', () => {
    const pose = new CrewPose().set(new T.Matrix4(), 0.4, 0.6, [
      new T.Vector3(-0.3, 0.4, 0.4),
      new T.Vector3(0.3, 0.4, 0.4),
    ]);
    for (const arm of [3, 6]) {
      expect(pose.joints[arm].distanceTo(pose.joints[arm + 1])).toBeCloseTo(CREW_UPPER_ARM, 8);
      expect(pose.joints[arm + 1].distanceTo(pose.joints[arm + 2])).toBeCloseTo(CREW_FOREARM, 8);
    }
    expect(() => pose.set(new T.Matrix4(), NaN, 0, [])).toThrow();
    expect(() =>
      pose.set(new T.Matrix4(), 0.4, 0.6, [new T.Vector3(NaN, 0, 0), new T.Vector3()]),
    ).toThrow();
    expect(() =>
      pose.set(new T.Matrix4().makeScale(0, 1, 1), 0.4, 0.6, [new T.Vector3(), new T.Vector3()]),
    ).toThrow();
    expect(() => pose.write(new Float32Array(16), 0)).toThrow();
    expect(() => pose.write(new Float32Array(240), -1)).toThrow();
  });
  it('reconstructs bone/prop data exactly on pause, replay rewind, LOD return and maximum simultaneous crews', () => {
    const view = new PitCrewView(),
      camera = new T.Vector3();
    const read = () => ({
      bones: Array.from(atlas(view).image.data),
      batches: view.root.children.map((o) => {
        const m = o as T.InstancedMesh;
        return {
          count: m.count,
          matrices: Array.from(m.instanceMatrix.array.slice(0, m.count * 16)),
        };
      }),
    });
    try {
      const original = serviceFrame(1.8, 0.3, 12);
      view.update(original, camera);
      const first = read();
      expect(view.activeActors).toBe(180);
      // A33 adds one submitted wheel LOD when near and mid crews coexist.
      expect(view.summary().activeDrawBatches).toBeLessThanOrEqual(8);
      expect(view.summary().boneTextureBytes).toBe(172800);
      expect(atlas(view).image.width).toBe(60);
      expect(atlas(view).image.height).toBe(180);
      view.update(original, camera);
      expect(read()).toEqual(first);
      view.update(serviceFrame(4.5, 0.3, 12), camera);
      expect(read()).not.toEqual(first);
      view.update(original, new T.Vector3(120, 0, 0));
      view.update(original, camera);
      expect(read()).toEqual(first);
      view.update(original, new T.Vector3(10000, 0, 0));
      expect(view.activeActors).toBe(0);
      view.update(serviceFrame(5.2, 0.3, 12), camera);
      expect(view.activeActors).toBe(0);
      view.update(original, camera, false);
      expect(view.activeActors).toBe(0);
    } finally {
      view.dispose();
      release(view.root);
    }
  });
  it('consumes an unmodified production simulation pit stop through service and release', () => {
    const simulation = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
    simulation.autoPlayer = true;
    simulation.cars[0].pitRequested = true;
    const crew = new PitCrewView(),
      seen = new Set<number>();
    try {
      for (let tick = 0; tick < 220 * 120; tick++) {
        simulation.step(1 / 120);
        const car = simulation.cars[0];
        if (car.pitPhase < 2 || tick % 12 !== 0) continue;
        const frame = simulation.makeFrame(),
          original = frame.slice();
        crew.update(
          frame,
          new T.Vector3(
            frame[carBase(0) + F.X] + 5,
            frame[carBase(0) + F.Y] + 2,
            frame[carBase(0) + F.Z],
          ),
        );
        seen.add(car.pitPhase);
        expect(frame).toEqual(original);
        const summary = crew.summary();
        expect(summary.unreachableArms).toBe(0);
        expect(summary.maxWristError).toBeLessThan(1e-5);
        if (car.pitPhase === 6) {
          expect(summary.actors).toBe(0);
          break;
        }
        expect(summary.actors).toBe(15);
      }
      expect([...seen]).toEqual([2, 3, 4, 5, 6]);
    } finally {
      crew.dispose();
      release(crew.root);
    }
  });
  it('installs the same bone atlas before normal use in colour, depth and distance shaders', () => {
    const crew = new PitCrewView();
    try {
      for (const o of crew.root.children.slice(0, 2)) {
        const m = o as T.InstancedMesh;
        for (const [material, kind] of [
          [m.material, 'standard'],
          [m.customDepthMaterial, 'depth'],
          [m.customDistanceMaterial, 'distanceRGBA'],
        ] as const) {
          const shader = shaderFor(material as T.Material, kind);
          const declaration = shader.vertexShader.indexOf('mat4 crewTransform =');
          expect(declaration).toBeGreaterThan(0);
          expect(declaration).toBeLessThan(
            shader.vertexShader.indexOf('objectNormal = mat3(crewTransform)'),
          );
          expect(shader.uniforms.crewBones.value).toBe(atlas(crew));
          expect(shader.uniforms.crewRows.value).toBe(180);
        }
      }
    } finally {
      crew.dispose();
      release(crew.root);
    }
  });
});

describe('27H.3 authored crowd cohorts', () => {
  it('preserves seat anchors and front-row clearance while varying bodies and accessories across every LOD', () => {
    const matrices = Array.from({ length: 128 }, (_, i) =>
      new T.Matrix4().makeTranslation(
        Math.floor(i / 16),
        Math.floor(i / 16) * 0.49,
        (i % 16) * 0.65,
      ),
    );
    const material = new T.MeshStandardMaterial(),
      cluster = new CrowdCluster(
        matrices,
        matrices.map(() => new T.Color()),
        917,
        material,
      );
    try {
      const style = cluster.levels[0].geometry.getAttribute('spectatorStyle');
      expect(
        new Set(Array.from({ length: style.count }, (_, i) => style.getX(i))).size,
      ).toBeGreaterThan(100);
      expect(Array.from({ length: 16 }, (_, i) => style.getZ(i))).toEqual(Array(16).fill(0));
      expect(
        Array.from({ length: style.count }, (_, i) => style.getZ(i)).some((s) => s === 1),
      ).toBe(true);
      expect(cluster.levels[3].geometry.index!.count).toBe(6);
      for (const level of cluster.levels) {
        expect(level.geometry.getAttribute('spectatorStyle')).toBe(style);
        expect(level.instanceMatrix).toBe(cluster.levels[0].instanceMatrix);
      }
      for (let i = 0; i < 128; i++) {
        const actual = new T.Matrix4();
        cluster.levels[0].getMatrixAt(i, actual);
        actual.elements.forEach((n, j) => expect(n).toBeCloseTo(matrices[i].elements[j], 5));
        expect(spectatorVariation(i, 917, true)).toEqual(spectatorVariation(i, 917, true));
      }
    } finally {
      release(cluster.root);
      material.dispose();
    }
  });
  it('shares clothing, standing deformation and accessory coverage across colour and both shadow types', () => {
    const material = new T.MeshStandardMaterial(),
      c = new CrowdCluster([new T.Matrix4()], [new T.Color()], 17, material);
    try {
      for (const level of c.levels.slice(0, 3)) {
        for (const [m, k] of [
          [level.material, 'standard'],
          [level.customDepthMaterial, 'depth'],
          [level.customDistanceMaterial, 'distanceRGBA'],
        ] as const) {
          const shader = shaderFor(m as T.Material, k);
          expect(shader.vertexShader).toContain('attribute vec3 crowdPerson');
          expect(shader.vertexShader).not.toContain('attribute float crowdJoint');
          expect(shader.vertexShader).not.toContain('attribute float skinMask');
          expect(shader.vertexShader).not.toContain('attribute float crowdAccessory');
          expect(shader.vertexShader).toContain('mix(position,standingPosition,spectatorStyle.z)');
          expect(shader.fragmentShader).toContain('vCrowdAccessory < .5');
          expect(shader.fragmentShader).toContain('vCrowdRank >= crowdLodRange.y');
        }
      }
      expect(c.levels[3].castShadow).toBe(false);
    } finally {
      release(c.root);
      material.dispose();
    }
  });
  it('paints spectator faces, hairlines, folds and contact shading analytically', () => {
    const material = new T.MeshStandardMaterial(),
      c = new CrowdCluster([new T.Matrix4()], [new T.Color()], 17, material);
    try {
      for (const level of c.levels.slice(0, 3)) {
        const shader = shaderFor(level.material as T.Material, 'standard');
        // The crew head's analytic face at the sculpt's head scale.
        expect(SPECTATOR_HEAD_SCALE).toBe(SCULPT_HEAD_SCALE);
        // Shortened mid-face shared by sculpt and shader; per-person face shape.
        expect(HEAD_MIDFACE_LIFT).toBe(SCULPT_MIDFACE_LIFT);
        expect(shader.fragmentShader).toContain(`hp.y -= ${HEAD_MIDFACE_LIFT} *`);
        expect(shader.vertexShader).toContain('humanHeadVariation(vec3(position.z');
        expect(shader.fragmentShader).toContain('HumanFace face = humanFace(hp');
        expect(shader.fragmentShader).toContain(`/ ${SPECTATOR_HEAD_SCALE.toFixed(2)}`);
        // No hair edge from a per-vertex tag (those step along triangles).
        expect(shader.fragmentShader).not.toContain('step(1.5, vCrowdTags.x)');
        // Fabric folds / skin relief perturb the normal; baked AO is applied.
        expect(shader.fragmentShader).toContain(
          'humanBumpNormal(-vViewPosition, normal, crowdBump',
        );
        expect(shader.fragmentShader).toContain('reflectedLight.indirectDiffuse *= crowdAo');
        expect(shader.vertexShader).toContain('attribute vec3 crowdSurface');
        expect(level.geometry.getAttribute('crowdSurface')).toBeDefined();
      }
    } finally {
      release(c.root);
      material.dispose();
    }
  });
});
