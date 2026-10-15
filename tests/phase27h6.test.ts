import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import { PitMachinery } from '../src/rendering/pit-machinery.ts';
import {
  PitPoseCache,
  PIT_SERVICE_CENTER,
  PIT_SERVICE_RADIUS,
  PIT_SERVICE_HALF_EXTENTS,
  pitServiceActive,
} from '../src/rendering/pit-presentation.ts';
import { RaceComposition } from '../src/rendering/race-composition.ts';
import { TracksideDirector } from '../src/rendering/trackside.ts';
import { CREW_BONES } from '../src/rendering/people-asset.ts';
import { installWetRoad } from '../src/rendering/materials.ts';
import {
  F,
  H,
  HEADER,
  CAR_STRIDE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

function frame(clock = 1.8, length = 0.3) {
  const f = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  f[H.CARS] = 1;
  f[H.PHASE] = 3;
  f[H.TIME] = 100;
  f[o + F.IN_PIT] = 1;
  f[o + F.QW] = 1;
  f[o + F.Y] = 0.6;
  f[o + F.PIT_CLOCK] = clock;
  f[o + F.PIT_PHASE] = clock < 0.8 ? 2 : clock < 2.2 ? 3 : clock < 3.5 ? 4 : 5;
  f[o + F.JACK_HEIGHT] = Math.min(0.19, Math.max(0, clock - 0.8) * 0.16);
  for (let w = 0; w < 4; w++) f[o + WHEEL_BASE + w * WHEEL_STRIDE + W.LENGTH] = length;
  return f;
}
function release(view: PitCrewView) {
  view.dispose();
  const geometry = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  view.root.traverse((o) => {
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
function shader(material: T.Material) {
  const source = T.ShaderLib.standard;
  const s = {
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    uniforms: T.UniformsUtils.clone(source.uniforms),
  } as Parameters<T.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(s, {} as T.WebGLRenderer);
  return s;
}
function versions(view: PitCrewView) {
  const bones = shader((view.root.children[0] as T.Mesh).material as T.Material).uniforms.crewBones
    .value as T.DataTexture;
  return [
    bones.version,
    ...view.root.children.flatMap((object) => {
      if (object instanceof PitMachinery) return [object.transforms.version];
      const mesh = object as T.InstancedMesh;
      return [
        mesh.instanceMatrix.version,
        mesh.instanceColor?.version ?? 0,
        (mesh.geometry.getAttribute('crewSlot') as T.InstancedBufferAttribute | undefined)
          ?.version ?? 0,
      ];
    }),
  ];
}

describe('27H.6 service composition and bounded pose reuse', () => {
  it('uses the actual service eligibility and rejects non-finite inputs', () => {
    expect(pitServiceActive(3, 1.8, 0)).toBe(true);
    for (const phase of [0, 1, 6]) expect(pitServiceActive(phase, 2, 0)).toBe(false);
    expect(pitServiceActive(3, 2, 1)).toBe(false);
    for (const bad of [NaN, Infinity]) expect(() => pitServiceActive(3, bad, 0)).toThrow();
  });
  it('does no pose/texture work for identical service snapshots or inactive racing', () => {
    const view = new PitCrewView(),
      f = frame(),
      camera = new T.Vector3(0, 3, 12);
    try {
      view.update(f, camera);
      const first = versions(view);
      const matrices = view.root.children.map((o) =>
        Array.from((o as T.InstancedMesh | PitMachinery).instanceMatrix.array),
      );
      for (let i = 0; i < 50; i++) {
        f[H.TIME] += 0.02;
        view.update(f, camera);
      }
      expect(versions(view)).toEqual(first);
      expect(
        view.root.children.map((o) =>
          Array.from((o as T.InstancedMesh | PitMachinery).instanceMatrix.array),
        ),
      ).toEqual(matrices);
      expect(view.summary().poseReuses).toBe(50);
      f[carBase(0) + F.PIT_CLOCK] += 0.01;
      view.update(f, camera);
      expect(versions(view)[0]).toBeGreaterThan(first[0]);
      view.update(f, camera, false);
      expect(view.root.visible).toBe(false);
      expect(view.activeActors).toBe(0);
      const hidden = versions(view);
      for (let i = 0; i < 50; i++) view.update(f, camera, false);
      expect(versions(view)).toEqual(hidden);
      view.update(f, camera);
      expect(view.activeActors).toBe(15);
      expect(view.root.visible).toBe(true);
      f[carBase(0) + F.PIT_PHASE] = 0;
      view.update(f, camera);
      const inactive = versions(view);
      for (let i = 0; i < 50; i++) {
        f[H.TIME]++;
        f[carBase(0) + F.X]++;
        view.update(f, camera);
      }
      expect(versions(view)).toEqual(inactive);
      expect(view.activeActors).toBe(0);
    } finally {
      release(view);
    }
  });
  it('invalidates exact pose inputs, view eligibility and detail, never just a tick label', () => {
    const cache = new PitPoseCache(),
      f = frame(),
      camera = new T.Vector3();
    expect(cache.prepare(f, camera, true)).toBe(true);
    cache.commit();
    expect(cache.prepare(f, camera, true)).toBe(false);
    const o = carBase(0);
    for (const field of [
      F.X,
      F.Y,
      F.Z,
      F.QX,
      F.JACK_HEIGHT,
      F.PIT_CLOCK,
      WHEEL_BASE + W.LENGTH,
      WHEEL_BASE + W.LOAD,
    ]) {
      f[o + field] += 0.001;
      expect(cache.prepare(f, camera, true), String(field)).toBe(true);
      cache.commit();
      expect(cache.prepare(f, camera, true)).toBe(false);
    }
    camera.set(0, 0, 50);
    expect(cache.prepare(f, camera, true)).toBe(true);
    cache.commit();
    expect(cache.levels[0]).toBe(1);
    camera.set(0, 0, 170);
    expect(cache.prepare(f, camera, true)).toBe(true);
    cache.commit();
    expect(cache.levels[0]).toBe(-1);
    camera.set(0, 0, 20);
    expect(cache.prepare(f, camera, true)).toBe(true);
    cache.commit();
    expect(cache.levels[0]).toBe(0);
    // No commit simulates a failed pose construction. Returning to a previously
    // cached state must rebuild, rather than reusing partially written buffers.
    f[o + F.PIT_CLOCK] += 1;
    expect(cache.prepare(f, camera, true)).toBe(true);
    f[o + F.PIT_CLOCK] -= 1;
    expect(cache.prepare(f, camera, true)).toBe(true);
    cache.commit();
    f[o + F.PIT_CLOCK] = NaN;
    expect(() => cache.prepare(f, camera, true)).toThrow();
  });
  it('limits instance upload ranges to active actors and preserves replay rebuilds', () => {
    const view = new PitCrewView(),
      f = frame(),
      camera = new T.Vector3();
    try {
      view.update(f, camera);
      const initial = view.root.children.map((o) =>
        Array.from((o as T.InstancedMesh | PitMachinery).instanceMatrix.array),
      );
      for (const object of view.root.children) {
        if (!(object instanceof T.InstancedMesh) || !object.count) continue;
        expect(object.instanceMatrix.updateRanges).toEqual([
          { start: 0, count: object.count * 16 },
        ]);
        if (object.instanceColor)
          expect(object.instanceColor.updateRanges).toEqual([
            { start: 0, count: object.count * 3 },
          ]);
      }
      view.update(frame(4.7), camera);
      view.update(f, camera);
      expect(
        view.root.children.map((o) =>
          Array.from((o as T.InstancedMesh | PitMachinery).instanceMatrix.array),
        ),
      ).toEqual(initial);
    } finally {
      release(view);
    }
  });
  it('contains actual skinned cloth, helmets, gloves, tyres and machinery over the complete service', () => {
    const view = new PitCrewView(),
      camera = new T.Vector3();
    const instance = new T.Matrix4(),
      bone = new T.Matrix4(),
      point = new T.Vector3(),
      posed = new T.Vector3(),
      extent = new T.Vector3();
    const observe = (point: T.Vector3, center: T.Vector3) => {
      extent.x = Math.max(extent.x, Math.abs(point.x - center.x));
      extent.y = Math.max(extent.y, Math.abs(point.y - center.y));
      extent.z = Math.max(extent.z, Math.abs(point.z - center.z));
    };
    try {
      for (const length of [0.14, 0.25, 0.34])
        for (const clock of [0, 0.8, 1.8, 2.2, 3.45, 3.5, 4.6, 5.19]) {
          const f = frame(clock, length);
          view.update(f, camera);
          const center = PIT_SERVICE_CENTER.clone().add(new T.Vector3(0, f[carBase(0) + F.Y], 0));
          for (const object of view.root.children) {
            const mesh = object as T.InstancedMesh | PitMachinery,
              g = mesh.geometry,
              position = g.getAttribute('position');
            if (!mesh.count) continue;
            if (mesh instanceof PitMachinery) {
              const slots = g.getAttribute('machineSlot');
              for (let vertex = 0; vertex < position.count; vertex++) {
                if (slots.getX(vertex) >= mesh.count) continue;
                instance.fromArray(mesh.instanceMatrix.array, slots.getX(vertex) * 16);
                point.fromBufferAttribute(position, vertex).applyMatrix4(instance);
                observe(point, center);
                expect(point.distanceTo(center), `machine ${clock}/${vertex}`).toBeLessThanOrEqual(
                  PIT_SERVICE_RADIUS,
                );
              }
              continue;
            }
            const slots = g.getAttribute('crewSlot');
            const data = slots
              ? ((shader(mesh.material as T.Material).uniforms.crewBones.value as T.DataTexture)
                  .image.data as Float32Array)
              : null;
            for (let actor = 0; actor < mesh.count; actor++) {
              mesh.getMatrixAt(actor, instance);
              for (let vertex = 0; vertex < position.count; vertex++) {
                if (data) {
                  const joints = g.getAttribute('crewJoint'),
                    weights = g.getAttribute('crewWeight');
                  posed.set(0, 0, 0);
                  for (let influence = 0; influence < 2; influence++) {
                    const joint = influence ? joints.getY(vertex) : joints.getX(vertex),
                      weight = influence ? weights.getY(vertex) : weights.getX(vertex);
                    bone.fromArray(data, (slots.getX(actor) * CREW_BONES + joint) * 16);
                    point.fromBufferAttribute(position, vertex).applyMatrix4(bone);
                    posed.addScaledVector(point, weight);
                  }
                  point.copy(posed);
                } else point.fromBufferAttribute(position, vertex);
                point.applyMatrix4(instance);
                observe(point, center);
                expect(point.distanceTo(center), `${clock}/${actor}/${vertex}`).toBeLessThanOrEqual(
                  PIT_SERVICE_RADIUS,
                );
              }
            }
          }
        }
      // The corner sightline probes additionally require an actual box bound,
      // not merely a sphere containing vertices outside one of its box faces.
      expect(extent.x).toBeLessThanOrEqual(PIT_SERVICE_HALF_EXTENTS.x);
      expect(extent.y).toBeLessThanOrEqual(PIT_SERVICE_HALF_EXTENTS.y);
      expect(extent.z).toBeLessThanOrEqual(PIT_SERVICE_HALF_EXTENTS.z);
    } finally {
      release(view);
    }
  });
  it('retains the complete service envelope in all twelve real pit bays without culling its crew', () => {
    const track = new Track(),
      p = trackPoint(),
      c = new RaceComposition();
    const camera = new T.PerspectiveCamera(),
      projected = new T.Vector3();
    for (let bay = 0; bay < 12; bay++) {
      const s = 102 + bay * 7,
        f = frame(),
        o = carBase(0);
      track.at(s, p);
      f[o + F.S] = s;
      f[o + F.X] = p.x + p.nx * 24.1;
      f[o + F.Y] = p.y + 0.6;
      f[o + F.Z] = p.z + p.nz * 24.1;
      const rotation = new T.Quaternion().setFromAxisAngle(
        new T.Vector3(0, 1, 0),
        Math.atan2(p.tx, p.tz),
      );
      f[o + F.QY] = rotation.y;
      f[o + F.QW] = rotation.w;
      c.update(f, 0);
      for (const aspect of [16 / 9, 1, 9 / 16, 21 / 9]) {
        const director = new TracksideDirector(track);
        director.update(s, c.target, c.velocity, 0, aspect, c.radius, true, c.visibility);
        expect(director.framingFits, `${bay}/${aspect}`).toBe(true);
        expect(director.subjectWithinRange).toBe(true);
        expect(director.position.distanceTo(c.visibility!.anchor)).toBeLessThanOrEqual(
          c.visibility!.maxDistance,
        );
        camera.position.copy(director.position);
        camera.lookAt(director.gaze);
        camera.aspect = aspect;
        camera.fov = director.fov;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        for (const point of c.visibility!.points) {
          projected.copy(point).project(camera);
          expect(Math.abs(projected.x), `${bay}/${aspect}: x`).toBeLessThan(1);
          expect(Math.abs(projected.y), `${bay}/${aspect}: y`).toBeLessThan(1);
        }
      }
    }
  });
  it('frames the complete service from physical rigs, including portrait views, with reversible approach/release', () => {
    const track = new Track(),
      p = trackPoint(),
      f = frame(),
      o = carBase(0),
      c = new RaceComposition();
    track.at(70, p);
    f[o + F.S] = 70;
    f[o + F.X] = p.x + p.nx * track.pitOffset(70);
    f[o + F.Y] = p.y + 0.6;
    f[o + F.Z] = p.z + p.nz * track.pitOffset(70);
    const rotation = new T.Quaternion().setFromAxisAngle(
      new T.Vector3(0, 1, 0),
      Math.atan2(p.tx, p.tz),
    );
    f[o + F.QY] = rotation.y;
    f[o + F.QW] = rotation.w;
    const before = f.slice();
    c.update(f, 0);
    const stationary = c.diagnostics();
    expect(c.kind).toBe('pit');
    expect(c.radius).toBe(PIT_SERVICE_RADIUS);
    expect(c.participants).toEqual([0]);
    expect(f).toEqual(before);
    for (const aspect of [16 / 9, 1, 9 / 16]) {
      const director = new TracksideDirector(track);
      director.update(70, c.target, c.velocity, 0, aspect, c.radius, true, c.visibility);
      expect(director.subjectWithinRange).toBe(true);
      expect(director.subjectSampleCount).toBe(9);
      expect(director.framingFits).toBe(true);
      expect(director.subjectRadius).toBe(PIT_SERVICE_RADIUS);
    }
    f[o + F.PIT_PHASE] = 6;
    f[o + F.SPEED] = 8;
    c.update(f, 0);
    expect(c.radius).toBe(3.1);
    f.set(before);
    c.update(f, 0);
    expect(c.diagnostics()).toEqual(stationary);
  });
});

describe('27H.6 conforming wet road film', () => {
  it('preserves real water/deposits and stable normal hooks while separating damp aggregate from puddles', () => {
    const m = new T.MeshPhysicalMaterial({ clearcoat: 1 }),
      texture = new T.DataTexture(new Uint8Array(16), 2, 2);
    try {
      installWetRoad(m, texture, true);
      const s = {
        uniforms: {},
        vertexShader: T.ShaderLib.physical.vertexShader,
        fragmentShader: T.ShaderLib.physical.fragmentShader,
      } as Parameters<T.Material['onBeforeCompile']>[0];
      m.onBeforeCompile(s, {} as T.WebGLRenderer);
      expect(s.uniforms.trackState.value).toBe(texture);
      expect(s.uniforms.surfaceDeposits.value).toBe(1);
      expect(s.fragmentShader).toContain('wet * mix(0.35, 0.9, puddle)');
      // TEST-UPDATE (photoreal pass): water depth drives a continuous sheet
      // (roadSheet = max(puddle, depth)); damp aggregate stays separated.
      expect(s.fragmentShader).toContain(
        'clearcoatNormal = normalize(mix(roadFilmNormal, clearcoatNormal, roadSheet))',
      );
      expect(s.fragmentShader).toContain('mix(0.22, 0.065, roadSheet)');
      expect(s.fragmentShader).toContain('roadRippleGain = roadSheet * min(1.,roadWeather.x/18.)');
      expect(s.fragmentShader).toContain('surfaceDeposits');
      expect(m.customProgramCacheKey()).toContain('v6-water-sheet');
    } finally {
      m.dispose();
      texture.dispose();
    }
  });
});

it('reuses bounded service witnesses without leaking inactive roles or mutable diagnostics', () => {
  const view = new PitCrewView(),
    other = new PitCrewView(),
    camera = new T.Vector3();
  // Structural allocation contract: the pool is private and per view; external
  // inspection must still return detached snapshots, not these reusable slots.
  type Pool = { records: { root: number[]; reachable: boolean[] }[] };
  const slots = (view as unknown as Pool).records.slice();
  const second = (other as unknown as Pool).records;
  try {
    expect(slots).toHaveLength(12 * 15);
    expect(slots[0]).not.toBe(second[0]);
    const f = frame(1.8);
    view.update(f, camera);
    other.update(f, camera);
    const report = view.diagnostics(),
      original = JSON.stringify(report);
    for (const clock of [0, 0.8, 1.8, 2.2, 3.45, 3.5, 4.6, 5.19, 1.8]) {
      view.update(frame(clock), camera);
      const records = (view as unknown as Pool).records;
      records.forEach((r, i) => {
        expect(r).toBe(slots[i]);
        expect(r.root).toBe(slots[i].root);
      });
      expect(view.diagnostics().roles).toHaveLength(15);
      expect(JSON.stringify(report)).toBe(original);
    }
    report.roles[0].root[0] = 12345;
    report.roles[0].reachable[0] = false;
    expect(view.diagnostics().roles[0].root[0]).not.toBe(12345);
    expect(other.diagnostics().roles).toEqual(view.diagnostics().roles);
    view.update(f, camera, false);
    expect(view.actorCountFor(0)).toBe(0);
    expect(view.diagnostics().roles).toEqual([]);
    expect(view.summary().unreachableArms).toBe(0);
    view.update(f, camera);
    expect(view.actorCountFor(0)).toBe(15);
    expect(view.diagnostics().roles).toEqual(other.diagnostics().roles);
  } finally {
    release(view);
    release(other);
  }
});

it('prepares both cloth colour variants before service without changing visibility or buffer ownership', () => {
  const view = new PitCrewView(),
    camera = new T.Vector3(0, 3, 70);
  const cloth = view.root.children.slice(0, 2) as T.InstancedMesh[];
  const colours = cloth.map((mesh) => mesh.instanceColor!);
  try {
    for (const [i, mesh] of cloth.entries()) {
      expect(mesh.count).toBe(0);
      expect(colours[i]).toBeInstanceOf(T.InstancedBufferAttribute);
      expect(colours[i].count).toBe(180);
      expect(colours[i].itemSize).toBe(3);
      expect(colours[i].usage).toBe(T.DynamicDrawUsage);
      expect(Array.from(colours[i].array).every((v) => v === 1)).toBe(true);
    }
    expect(colours[0]).not.toBe(colours[1]);
    expect(view.activeActors).toBe(0);
    for (const lens of [58, 20, 58, 20]) {
      for (const clock of [0.04, 1.8, 2.8, 4.6, 1.8]) {
        const f = frame(clock),
          original = f.slice();
        view.update(f, camera, true, lens);
        expect(view.activeActors).toBe(15);
        expect(cloth.reduce((n, mesh) => n + mesh.count, 0)).toBe(15);
        cloth.forEach((mesh, i) => expect(mesh.instanceColor).toBe(colours[i]));
        expect(f).toEqual(original);
      }
    }
    view.update(frame(), camera, false);
    expect(view.activeActors).toBe(0);
    cloth.forEach((mesh, i) => expect(mesh.instanceColor).toBe(colours[i]));
  } finally {
    release(view);
  }
});
