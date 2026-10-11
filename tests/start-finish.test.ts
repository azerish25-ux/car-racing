import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  START_FINISH_ASSET,
  venueGeometry,
  audienceAtlas,
  marshalAction,
} from '../src/rendering/start-finish-assets.ts';
import source from '../src/rendering/start-finish.geometry.json' with { type: 'json' };
import {
  StartFinishVenue,
  raceBoardRows,
  venueDetail,
} from '../src/rendering/start-finish-venue.ts';
import { buildGrandstand, standFrame } from '../src/rendering/grandstand.ts';
import { AUREL_VENUE, VELLAMAR_VENUE } from '../src/rendering/venue-plan.ts';
import { buildBarrierChunk, barrierMaterials } from '../src/rendering/circuit-barriers.ts';
import { TextureBudget } from '../src/rendering/texture-budget.ts';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { CrowdCluster } from '../src/rendering/crowd.ts';
import { MarshalStaffView } from '../src/rendering/marshal-staff.ts';
import { trackInfrastructurePlan } from '../src/rendering/track-infrastructure.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';

function dispose(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      for (const m of [o.material].flat()) m.dispose();
      if (o instanceof T.InstancedMesh) o.dispose();
    }
  });
}
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
describe('Original Aurel start/finish kit', () => {
  it('retains native/exchange/runtime identity and finite owned geometry for every tier', () => {
    expect(hash(readFileSync('scripts/author-start-finish.py'))).toBe(
      START_FINISH_ASSET.sourceSHA256,
    );
    expect(hash(readFileSync('src/rendering/start-finish.geometry.json'))).toBe(
      START_FINISH_ASSET.runtimeSHA256,
    );
    expect(hash(gunzipSync(readFileSync('src/rendering/start-finish.glb.gz')))).toBe(
      START_FINISH_ASSET.exchangeSHA256,
    );
    expect(START_FINISH_ASSET.finalArtApproved).toBe(false);
    for (const name of Object.keys(source.meshes) as (keyof typeof source.meshes)[]) {
      const a = venueGeometry(name),
        b = venueGeometry(name),
        mirror = venueGeometry(name, true);
      expect(a.getAttribute('position').array).not.toBe(b.getAttribute('position').array);
      expect(a.index!.count / 3).toBe(START_FINISH_ASSET.triangles[name]);
      expect(a.boundingBox!.isEmpty()).toBe(false);
      expect(mirror.boundingBox!.min.x).toBeCloseTo(-a.boundingBox!.max.x, 5);
      expect(a.getAttribute('uv').count).toBe(a.getAttribute('position').count);
      for (const g of [a, b, mirror]) g.dispose();
    }
    for (const name of ['bay', 'seat', 'stairs', 'screen'] as const) {
      const count = (tier: string) =>
        Object.entries(START_FINISH_ASSET.triangles)
          .filter(([n]) => n.startsWith(name + '_' + tier))
          .reduce((s, [, n]) => s + n, 0);
      expect(count('far')).toBeLessThan(count('near'));
    }
  });
  it('exports real audience and marshal actions, with samples matching GLB rotation playback', async () => {
    const bytes = gunzipSync(readFileSync('src/rendering/start-finish.glb.gz'));
    const gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
    expect(gltf.animations.map((a) => a.name).sort()).toEqual(
      [...START_FINISH_ASSET.actions].sort(),
    );
    gltf.scene.updateMatrixWorld(true);
    const bones = Array.from({ length: 4 }, (_, i) => gltf.scene.getObjectByName('joint_' + i)!);
    expect(bones.every(Boolean)).toBe(true);
    const binds = bones.map((b) => b.matrixWorld.clone().invert());
    const mixer = new T.AnimationMixer(gltf.scene),
      q = new T.Quaternion();
    for (const [name, clip] of Object.entries(source.clips)) {
      mixer.stopAllAction();
      mixer
        .clipAction(gltf.animations.find((a) => a.name === name)!)
        .reset()
        .play();
      for (const time of [0, 0.5, 1.2, 2, 3.5]) {
        mixer.setTime(time);
        gltf.scene.updateMatrixWorld(true);
        for (let bone = 0; bone < 4; bone++) {
          q.setFromRotationMatrix(bones[bone].matrixWorld.clone().multiply(binds[bone]));
          const expected = new T.Quaternion().fromArray(
            clip.frames[Math.round(time * 30)],
            bone * 4,
          );
          expect(Math.abs(q.dot(expected))).toBeCloseTo(1, 4);
        }
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
    dispose(gltf.scene);
  });
  it('constructs both start stands with unchanged seat transforms and unobstructed aisle centres', () => {
    const track = new Track('clear'),
      complex = new StartFinishVenue(track),
      props = new T.Group(),
      crowd = new T.Group(),
      clusters: CrowdCluster[] = [];
    const m = {
      concrete: new T.MeshStandardMaterial(),
      steel: new T.MeshStandardMaterial(),
      roof: new T.MeshStandardMaterial(),
      underside: new T.MeshStandardMaterial(),
      seats: new T.MeshStandardMaterial(),
      people: new T.MeshStandardMaterial(),
      sign: new T.MeshStandardMaterial(),
    };
    // A label uses Canvas only; provide the established test shim for geometry inspection.
    const previous = globalThis.document;
    const context = {
      fillRect() {},
      fillText() {},
      measureText() {
        return { width: 10 };
      },
    };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => ({ getContext: () => context, width: 0, height: 0 }) },
    });
    try {
      for (const site of AUREL_VENUE.grandstands.slice(0, 2)) {
        const root = buildGrandstand(track, props, crowd, site, m, clusters, undefined, complex);
        expect(root.userData.startFinish.bays).toBe(site.length / 8);
        expect(root.userData.corridorClearance).toBeGreaterThan(2.5);
        const near = root.getObjectByName('seat_near') as T.InstancedMesh;
        const matrix = new T.Matrix4();
        for (let i = 0; i < near.count; i++) {
          near.getMatrixAt(i, matrix);
          const z = matrix.elements[14];
          expect(Math.abs(z - site.length * 0.25)).toBeGreaterThanOrEqual(0.7);
          expect(Math.abs(z + site.length * 0.25)).toBeGreaterThanOrEqual(0.7);
          expect(matrix.determinant()).toBeCloseTo(1, 6);
        }
        // Roof bounds stay behind the same road corridor as the original stand.
        const f = standFrame(track, site),
          p = trackPoint();
        for (const z of [-site.length / 2, site.length / 2]) {
          const x = site.side * -1.9,
            wx = f.x + Math.cos(f.yaw) * x + Math.sin(f.yaw) * z,
            wz = f.z - Math.sin(f.yaw) * x + Math.cos(f.yaw) * z;
          const lateral = track.nearest(wx, wz, p);
          expect(Math.abs(lateral) - track.boundary(p.s, lateral < 0 ? -1 : 1)).toBeGreaterThan(
            2.5,
          );
        }
      }
      expect(complex.diagnostics().stands).toBe(2);
      expect(clusters.length).toBeGreaterThan(10);
      const mat = clusters[0].levels[0].material as T.Material;
      expect(mat.customProgramCacheKey()).toContain('audience-authored-v2');
      expect(
        new StartFinishVenue(
          new Simulation({ ...DEFAULT_OPTIONS, circuit: 'vellamar' }).track,
        ).accepts(VELLAMAR_VENUE.grandstands[0]),
      ).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previous });
      dispose(props);
      dispose(crowd);
    }
  });
  it('reads real rank/lap/speed without writing snapshots; restores paused and rewind animation values', () => {
    const frame = new Simulation({ ...DEFAULT_OPTIONS, opponents: 3 }).makeFrame(),
      before = frame.slice();
    const rows = raceBoardRows(frame);
    expect(rows).toHaveLength(4);
    expect(frame).toEqual(before);
    const group = new CrowdCluster(
      [new T.Matrix4()],
      [new T.Color('white')],
      53,
      new T.MeshStandardMaterial(),
      2,
    );
    group.update(1.3, new T.Vector3(10, 1, 0), 0, frame);
    const pose = group.audienceTime.value;
    group.update(3.8, new T.Vector3(10, 1, 0), 0, frame);
    group.update(1.3, new T.Vector3(10, 1, 0), 0, frame);
    expect(group.audienceTime.value).toBe(pose);
    expect(frame).toEqual(before);
    expect(venueDetail(30)).toBe(0);
    expect(venueDetail(200)).toBe(1);
    expect(venueDetail(500)).toBe(2);
    expect(() => venueDetail(NaN)).toThrow();
    const atlas = audienceAtlas();
    expect(atlas.image.width).toBe(4);
    expect(atlas.image.height).toBe(484);
    atlas.dispose();
    dispose(group.root);
  });
  it('keeps marshal gloves on the pole and every arm reachable through all real flag types and seeks', () => {
    const track = new Track('clear'),
      posts = trackInfrastructurePlan(track).marshalPosts;
    const view = new MarshalStaffView(posts),
      frame = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 }).makeFrame(),
      base = carBase(0),
      camera = new T.Vector3(posts[0].x, posts[0].y, posts[0].z);
    frame[base + F.S] = posts[0].s;
    for (const signal of [FLAG.GREEN, FLAG.YELLOW, FLAG.BLUE, FLAG.DOUBLE_YELLOW]) {
      frame[base + F.LOCAL_FLAG] = signal;
      for (let i = 0; i < 80; i++) {
        frame[H.TIME] = i * 0.05;
        const before = frame.slice();
        view.update(frame, camera);
        expect(view.active).toBeGreaterThan(0);
        expect(view.unreachable, `${signal}/${i}`).toBe(0);
        expect(view.maxGripError).toBeLessThan(0.00001);
        expect(frame).toEqual(before);
        expect(view.poles.count).toBe(view.flags.count);
      }
    }
    frame[H.TIME] = 1.25;
    view.update(frame, camera);
    const held = Array.from(view.flags.instanceMatrix.array);
    frame[H.TIME] = 3.25;
    view.update(frame, camera);
    frame[H.TIME] = 1.25;
    view.update(frame, camera);
    expect(Array.from(view.flags.instanceMatrix.array)).toEqual(held);
    const a = marshalAction(1.5, true, new T.Vector2()),
      b = marshalAction(1.5, false, new T.Vector2());
    expect(a).not.toEqual(b);
    dispose(view.root);
  });
  it('refreshes recorded board data after rewind and session reset, without replaying a stale grid', () => {
    const old = globalThis.document,
      calls: string[] = [];
    const context = {
      fillRect() {},
      fillText(text: string) {
        calls.push(text);
      },
    };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => ({ getContext: () => context, width: 0, height: 0 }) },
    });
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 2 }),
      scene = new T.Group(),
      venue = new StartFinishVenue(sim.track);
    try {
      venue.buildScreen(scene, new BroadcastSightlines());
      const frame = sim.makeFrame(),
        before = frame.slice();
      venue.update(frame);
      const count = venue.diagnostics().boardUpdates;
      venue.update(frame);
      expect(venue.diagnostics().boardUpdates).toBe(count);
      for (let i = 0; i < 60; i++) sim.step(1 / 120);
      venue.update(sim.makeFrame());
      expect(venue.diagnostics().boardUpdates).toBeGreaterThan(count);
      venue.update(frame);
      const rewind = calls.at(-1);
      venue.reset();
      venue.update(frame);
      expect(calls.at(-1)).toBe(rewind);
      expect(frame).toEqual(before);
      expect(calls.some((t) => t.includes('POS'))).toBe(true);
      frame[H.TIME] = NaN;
      expect(() => venue.update(frame)).toThrow();
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: old });
      dispose(scene);
    }
  });
  it('repaints the race board only while a view can show it', () => {
    const old = globalThis.document;
    const context = { fillRect() {}, fillText() {} };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => ({ getContext: () => context, width: 0, height: 0 }) },
    });
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 2 }),
      scene = new T.Group(),
      venue = new StartFinishVenue(sim.track);
    try {
      venue.buildScreen(scene, new BroadcastSightlines());
      scene.updateMatrixWorld(true);
      const face = scene.getObjectByName('A18 live race-information face')!;
      const board = face.getWorldPosition(new T.Vector3());
      const camera = new T.PerspectiveCamera(50, 16 / 9, 0.1, 2000);
      const frame = sim.makeFrame();
      // Far away and looking away: no view shows the face, so no repaint.
      camera.position.copy(board).add(new T.Vector3(900, 30, 0));
      camera.lookAt(camera.position.clone().add(new T.Vector3(1, 0, 0)));
      venue.update(frame, camera);
      const count = venue.diagnostics().boardUpdates;
      frame[H.TIME] += 1;
      venue.update(frame, camera);
      expect(venue.diagnostics().boardUpdates).toBe(count);
      // A telephoto view of it from the same distance repaints at once.
      camera.lookAt(board);
      venue.update(frame, camera);
      expect(venue.diagnostics().boardUpdates).toBe(count + 1);
      // Mirror/probe range around the camera always repaints.
      camera.position.copy(board).add(new T.Vector3(0, 0, 150));
      camera.lookAt(camera.position.clone().add(new T.Vector3(0, 0, 1)));
      frame[H.TIME] += 1;
      venue.update(frame, camera);
      expect(venue.diagnostics().boardUpdates).toBe(count + 2);
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: old });
      dispose(scene);
    }
  });
  it('retains the live board canvas through texture-budget registration and quality changes', () => {
    const oldDocument = globalThis.document,
      oldCanvas = globalThis.HTMLCanvasElement;
    class Canvas {
      width = 0;
      height = 0;
      getContext() {
        return { fillRect() {}, fillText() {}, drawImage() {}, clearRect() {} };
      }
    }
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => new Canvas() },
    });
    Object.defineProperty(globalThis, 'HTMLCanvasElement', { configurable: true, value: Canvas });
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 }),
      scene = new T.Group();
    const venue = new StartFinishVenue(sim.track),
      budget = new TextureBudget();
    try {
      venue.buildScreen(scene, new BroadcastSightlines());
      const face = scene.getObjectByName('A18 live race-information face') as T.Mesh<
        T.PlaneGeometry,
        T.MeshStandardMaterial
      >;
      const texture = face.material.map!,
        paintedCanvas = texture.image;
      expect(texture.userData.dynamic).toBe(true);
      budget.register(scene);
      for (const limit of [128, 256, 512, 1024, 2048]) {
        budget.configure(limit, 4);
        expect(texture.image).toBe(paintedCanvas);
        expect([texture.image.width, texture.image.height]).toEqual([1024, 512]);
      }
      const version = texture.version;
      venue.update(sim.makeFrame());
      expect(texture.version).toBeGreaterThan(version);
      expect(texture.image).toBe(paintedCanvas);
    } finally {
      budget.dispose();
      dispose(scene);
      Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument });
      Object.defineProperty(globalThis, 'HTMLCanvasElement', {
        configurable: true,
        value: oldCanvas,
      });
    }
  });
  it('keeps fence mounting detail in the existing three batches without editing track data', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 }),
      scene = new T.Group(),
      materials = barrierMaterials();
    const before = sim.makeFrame(),
      water = sim.track.water.slice();
    buildBarrierChunk(sim.track, scene, 0, 80, materials);
    expect(scene.children).toHaveLength(3);
    expect(sim.makeFrame()).toEqual(before);
    expect(sim.track.water).toEqual(water);
    const steel = scene.children.find((o) => o.name.includes('steel')) as T.Mesh;
    expect(steel.geometry.index!.count).toBeGreaterThan(0);
    expect(steel.material).toBe(materials.steel);
    dispose(scene);
  });
});
