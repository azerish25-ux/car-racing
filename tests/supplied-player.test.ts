import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as T from 'three';
import {
  validateSuppliedPlayerDocument,
  steeringSample,
  loadSuppliedPlayer,
  SuppliedPlayerAsset,
  SuppliedPlayer,
  restoreSuppliedHeightMap,
  PLAYER_SUSPENSION_DATUM,
} from '../src/rendering/supplied-player.ts';
import manifest from '../src/rendering/supplied-player.manifest.json' with { type: 'json' };
import {
  carBase,
  F,
  H,
  CAR_STRIDE,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
} from '../src/simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../src/simulation/vehicle.ts';

const compressed = readFileSync(
  new URL('../public/models/supplied-player.glb.gz', import.meta.url),
);
const raw = gunzipSync(compressed);
const document = () => JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)).toString());

describe('supplied player source and runtime contract', () => {
  it('ships the real binary with exact hashes and budgets, not an LFS pointer or placeholder', () => {
    expect(raw.toString('ascii', 0, 4)).toBe('glTF');
    expect(compressed.length).toBe(manifest.compressedBytes);
    expect(raw.length).toBe(manifest.bytes);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(manifest.sha256);
    expect(createHash('sha256').update(compressed).digest('hex')).toBe(manifest.compressedSHA256);
    expect(manifest.triangles).toBeGreaterThan(100000);
    expect(manifest.triangles).toBeLessThan(1500000);
    expect(manifest.joints).toBeGreaterThanOrEqual(50);
    expect(() => validateSuppliedPlayerDocument(document())).not.toThrow();
  });
  it('keeps external dependencies, missing anchors, duplicate nodes and malformed topology out', () => {
    for (const mutate of [
      (d: ReturnType<typeof document>) => {
        d.buffers[0].uri = 'https://invalid.example/mesh.bin';
      },
      (d: ReturnType<typeof document>) => {
        d.images[0].uri = 'file:///private.png';
      },
      (d: ReturnType<typeof document>) => {
        d.nodes.find((n: { name: string }) => n.name === 'PLAYER_SOCKET_EYE').name = 'missing';
      },
      (d: ReturnType<typeof document>) => {
        d.nodes[d.scenes[0].nodes[0]].children = [d.scenes[0].nodes[0]];
      },
      (d: ReturnType<typeof document>) => {
        d.skins[0].joints[0] = -1;
      },
      (d: ReturnType<typeof document>) => {
        d.bufferViews[0].byteOffset = manifest.maxRawBytes;
      },
      (d: ReturnType<typeof document>) => {
        d.accessors[d.meshes[0].primitives[0].indices].count = 1;
      },
    ]) {
      const d = document();
      mutate(d);
      expect(() => validateSuppliedPlayerDocument(d)).toThrow('Invalid supplied player');
    }
  });
  it('fits the GLB wheel hubs to the existing simulation without changing physics', () => {
    const d = document();
    const nodes = d.nodes.map(
      (n: {
        name?: string;
        matrix?: number[];
        translation?: number[];
        rotation?: number[];
        scale?: number[];
      }) => {
        const o = new T.Object3D();
        o.name = n.name ?? '';
        if (n.matrix)
          new T.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
        else {
          if (n.translation) o.position.fromArray(n.translation);
          if (n.rotation) o.quaternion.fromArray(n.rotation);
          if (n.scale) o.scale.fromArray(n.scale);
        }
        return o;
      },
    );
    d.nodes.forEach((n: { children?: number[] }, i: number) =>
      n.children?.forEach((c) => nodes[i].add(nodes[c])),
    );
    const root = new T.Group();
    d.scenes[0].nodes.forEach((i: number) => root.add(nodes[i]));
    root.updateMatrixWorld(true);
    WHEEL_POSITIONS.forEach((expected, i) => {
      const actual = root.getObjectByName(`PLAYER_WHEEL_${i}`)!.getWorldPosition(new T.Vector3());
      expected.forEach((v, j) => expect(actual.getComponent(j)).toBeCloseTo(v, 5));
    });
    for (const [key, expected] of Object.entries(manifest.sockets)) {
      const actual = root
        .getObjectByName(`PLAYER_SOCKET_${key.toUpperCase()}`)!
        .getWorldPosition(new T.Vector3());
      expected.forEach((v: number, j: number) => expect(actual.getComponent(j)).toBeCloseTo(v, 5));
    }
    expect(manifest.sockets.eye[1]).toBeGreaterThan(manifest.sockets.steering[1]);
    expect(manifest.sockets.eye[2]).toBeLessThan(manifest.sockets.steering[2]);
    expect(manifest.sockets.pod[1]).toBeGreaterThan(manifest.sockets.eye[1]);
  });
  it('maps neutral and both locks to a deterministic, bounded authored IK pose', () => {
    expect(steeringSample(0, 2)).toBe(1);
    // Positive (left) steering samples the left-lock end of the clip.
    expect(steeringSample(10, 2)).toBe(2);
    expect(steeringSample(-10, 2)).toBe(0);
    expect(steeringSample(0.1, 2)).toBeGreaterThan(1);
    expect(steeringSample(-0.1, 2)).toBeLessThan(1);
    expect(() => steeringSample(NaN, 2)).toThrow();
    expect(() => steeringSample(0, 0)).toThrow();
  });
  it('rejects corruption before allocating GPU/image resources', async () => {
    await expect(SuppliedPlayerAsset.decode(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      'integrity',
    );
    const signal = AbortSignal.abort();
    await expect(SuppliedPlayerAsset.decode(new Uint8Array(), signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('cancels before fetch and rejects missing or oversized downloads', async () => {
    const fetcher = vi.fn();
    await expect(loadSuppliedPlayer(() => true, fetcher)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      loadSuppliedPlayer(
        () => false,
        vi.fn(async () => new Response('', { status: 404 })),
        'https://example.test/models/player.glb.gz',
      ),
    ).rejects.toThrow('(404)');
    await expect(
      loadSuppliedPlayer(
        () => false,
        vi.fn(async () => new Response(new Uint8Array(manifest.bytes + 1))),
        'https://example.test/models/player.glb.gz',
      ),
    ).rejects.toThrow('byte budget');
  });
});

function fixture() {
  const root = new T.Group();
  const add = (name: string, parent = root) => {
    const n = new T.Group();
    n.name = name;
    parent.add(n);
    return n;
  };
  const surface = (name: string) => {
    const m = new T.Mesh(new T.PlaneGeometry(0.1, 0.1), new T.MeshStandardMaterial());
    m.name = name;
    root.add(m);
    return m;
  };
  for (let i = 0; i < 4; i++) {
    const w = add(`PLAYER_WHEEL_${i}`);
    w.position.fromArray(WHEEL_POSITIONS[i]);
    add(`PLAYER_SPIN_${i}`, w);
  }
  add('PLAYER_FRONT_WING');
  add('PLAYER_REAR_WING');
  add('PLAYER_HEAD');
  surface('PLAYER_LCD');
  surface('RB19_MIRROR_0');
  surface('RB19_MIRROR_1');
  const steering = add('steering');
  const clips = [
    new T.AnimationClip(manifest.steeringClip, 2, [
      // Like the authored clip: right lock first (left side raised), then left lock.
      new T.NumberKeyframeTrack('steering.rotation[z]', [0, 2], [0.6, -0.6]),
    ]),
  ];
  const player = new SuppliedPlayer(root, clips, new T.CanvasTexture({} as HTMLCanvasElement));
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = 1;
  for (let i = 0; i < 4; i++) {
    const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    frame[p + W.RADIUS] = 0.335;
    frame[p + W.LOAD] = 2000;
  }
  return { player, frame, o, steering };
}

describe('supplied player presentation', () => {
  it('restores only the known scalar height textures, preserving real R06 normals and UVs', () => {
    for (const name of ['carbon_twill_height', 'tyre_scrub_height_16bit']) {
      const texture = new T.Texture();
      texture.name = name;
      texture.repeat.set(7, 11);
      const material = new T.MeshStandardMaterial({ normalMap: texture });
      expect(restoreSuppliedHeightMap(material)).toBe(true);
      expect(material.normalMap).toBeNull();
      expect(material.bumpMap).toBe(texture);
      expect(material.bumpScale).toBeGreaterThan(0);
      expect(material.bumpScale).toBeLessThan(0.001);
      expect(texture.repeat.toArray()).toEqual([7, 11]);
      expect(texture.colorSpace).toBe(T.NoColorSpace);
      expect(restoreSuppliedHeightMap(material)).toBe(false);
    }
    const genuine = new T.Texture();
    genuine.name = 'Suit_Normal_2K';
    const material = new T.MeshStandardMaterial({ normalMap: genuine });
    expect(restoreSuppliedHeightMap(material)).toBe(false);
    expect(material.normalMap).toBe(genuine);
    expect(material.bumpMap).toBeNull();
  });
  it('converts the body datum without shifting any physics wheel hub or double-offsetting cameras', () => {
    const { player, frame, o } = fixture();
    const before = frame.slice();
    for (let i = 0; i < 4; i++)
      frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.LENGTH] = 0.21 + i * 0.015;
    const lengths = frame.slice();
    player.update(frame, frame, o, 1, true);
    expect(player.root.position.y).toBe(-PLAYER_SUSPENSION_DATUM);
    player.wheels.forEach((wheel, i) => {
      expect(wheel.getWorldPosition(new T.Vector3()).y).toBeCloseTo(
        0.05 - frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.LENGTH],
        6,
      );
    });
    expect(player.eye.y).toBeCloseTo(manifest.sockets.eye[1] - PLAYER_SUSPENSION_DATUM, 6);
    expect(player.pod.y).toBeCloseTo(manifest.sockets.pod[1] - PLAYER_SUSPENSION_DATUM, 6);
    expect(player.steering.y).toBeCloseTo(
      manifest.sockets.steering[1] - PLAYER_SUSPENSION_DATUM,
      6,
    );
    expect(frame).toEqual(lengths);
    frame.set(before);
    player.disposeAnimation();
  });
  it('moves real wheel anchors and hides only the head in POV', () => {
    const { player, frame, o, steering } = fixture();
    frame[o + F.STEER] = 0.2;
    frame[H.TIME] = 1;
    frame[o + WHEEL_BASE + W.STEER] = 0.12;
    player.update(frame, frame, o, 1, true);
    expect(player.wheels[0].rotation.y).toBeCloseTo(0.12);
    expect(steering.rotation.z).toBeLessThan(0);
    expect(player.heads.every((h) => !h.visible)).toBe(true);
    expect(player.root.visible).toBe(true);
    player.update(frame, frame, o, 1, false);
    expect(player.heads.every((h) => h.visible)).toBe(true);
  });
  it('returns to the identical skeleton pose after opposite lock and replay seek', () => {
    const { player, frame, o, steering } = fixture();
    frame[o + F.STEER] = 0.1;
    player.update(frame, frame, o, 1, true);
    const first = steering.quaternion.toArray(),
      time = player.diagnostics().steeringTime;
    frame[o + F.STEER] = -0.2;
    frame[H.TIME] = 10;
    player.update(frame, frame, o, 1, true);
    frame[o + F.STEER] = 0.1;
    frame[H.TIME] = 0;
    player.update(frame, frame, o, 1, true);
    expect(steering.quaternion.toArray()).toEqual(first);
    expect(player.diagnostics().steeringTime).toBe(time);
    player.disposeAnimation();
    expect(player.diagnostics().loaded).toBe(false);
  });
});
