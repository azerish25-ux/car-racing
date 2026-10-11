import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { CrowdCluster, crowdDetail, crowdLodRanges } from '../src/rendering/crowd.ts';
import { crowdResponse } from '../src/rendering/crowd-response.ts';
import { circuitLightState, daylightState } from '../src/rendering/daylight.ts';
import { SprayClouds } from '../src/rendering/spray-clouds.ts';
import {
  VenueLighting,
  venueLightWeight,
  VENUE_LIGHT_INTENSITY,
} from '../src/rendering/venue-lighting.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';
import humanKit from '../src/rendering/human-kit.json' with { type: 'json' };

function snapshot(cars = 2) {
  const frame = new Float32Array(HEADER + cars * CAR_STRIDE);
  frame[H.CARS] = cars;
  for (let i = 0; i < cars; i++) {
    const b = carBase(i);
    frame[b + F.X] = i * 4;
    frame[b + F.SPEED] = 45;
  }
  return frame;
}
function dispose(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    if (object instanceof T.InstancedMesh) object.dispose();
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      materials.add(material);
    if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

describe('Presentation continuation: bounded spray storage', () => {
  it('renders the existing contact storage without creating another particle simulation', () => {
    const positions = new Float32Array(21),
      sizes = new Float32Array(7),
      alpha = new Float32Array(7);
    const velocities = new Float32Array(21),
      kind = new Uint8Array(7);
    const spray = new SprayClouds(positions, velocities, sizes, alpha, kind);
    try {
      for (const [name, array] of [
        ['center', positions],
        ['size', sizes],
        ['opacity', alpha],
        ['velocity', velocities],
        ['kind', kind],
      ] as const)
        expect(spray.geometry.getAttribute(name).array, name).toBe(array);
      expect(spray.geometry.getAttribute('position').count).toBe(4);
      expect(spray.geometry.index!.count).toBe(6);
      expect(spray.geometry.instanceCount).toBe(7);
      expect(spray.material.lights).toBe(true);
      expect(spray.material.fog).toBe(true);
      expect(spray.material.depthWrite).toBe(false);
      positions[0] = 123;
      alpha[0] = 0.5;
      sizes[0] = 2;
      const before = (spray.geometry.getAttribute('center') as T.InstancedBufferAttribute).version;
      spray.upload();
      expect(spray.geometry.getAttribute('center').getX(0)).toBe(123);
      expect((spray.geometry.getAttribute('center') as T.InstancedBufferAttribute).version).toBe(
        before + 1,
      );
      expect(spray.geometry.getAttribute('variation').array.every((v) => v >= 0 && v < 1)).toBe(
        true,
      );
      alpha.fill(0);
      spray.clear();
      expect(spray.geometry.getAttribute('opacity').array.every((v) => v === 0)).toBe(true);
    } finally {
      dispose(spray.mesh);
    }
  });
  it('rejects inconsistent pool views rather than reading unrelated rain or out-of-range storage', () => {
    expect(
      () =>
        new SprayClouds(
          new Float32Array(),
          new Float32Array(),
          new Float32Array(),
          new Float32Array(),
          new Uint8Array(),
        ),
    ).toThrow();
    expect(
      () =>
        new SprayClouds(
          new Float32Array(3),
          new Float32Array(1),
          new Float32Array(2),
          new Float32Array(3),
          new Uint8Array(1),
        ),
    ).toThrow();
  });
});

describe('Presentation continuation: distant spectators', () => {
  it('shares instance ownership through all four levels and reduces only the final representation to two triangles', () => {
    const material = new T.MeshStandardMaterial();
    const crowd = new CrowdCluster(
      [new T.Matrix4(), new T.Matrix4().makeTranslation(0, 0, 1)],
      [new T.Color(0x7a3826), new T.Color(0x345671)],
      27,
      material,
    );
    try {
      // Procedural spectators: near/mid/far sculpt budgets, then a two-triangle card.
      const budgets = crowd.levels.map((m) => m.geometry.index!.count / 3);
      expect(budgets).toEqual([
        humanKit.meshes.spectator_a_0.triangles,
        humanKit.meshes.spectator_a_1.triangles,
        humanKit.meshes.spectator_a_2.triangles,
        2,
      ]);
      expect(budgets[0]).toBeLessThan(2600);
      expect(budgets[1]).toBeLessThan(budgets[0] * 0.6);
      expect(budgets[2]).toBeLessThan(budgets[1] * 0.5);
      for (const mesh of crowd.levels) {
        expect(mesh.instanceMatrix).toBe(crowd.levels[0].instanceMatrix);
        expect(mesh.instanceColor).toBe(crowd.levels[0].instanceColor);
        for (const attribute of ['spectatorPhase', 'spectatorSkin'])
          expect(mesh.geometry.getAttribute(attribute)).toBe(
            crowd.levels[0].geometry.getAttribute(attribute),
          );
        expect(mesh.boundingBox).not.toBeNull();
        expect(mesh.boundingSphere).not.toBeNull();
      }
      expect(crowd.levels.slice(0, 3).every((m) => m.castShadow && !!m.customDepthMaterial)).toBe(
        true,
      );
      expect(crowd.levels[3].castShadow).toBe(false);
      expect(crowd.levels[3].customDepthMaterial).toBeUndefined();
      crowd.update(1, new T.Vector3(600, 0, 0.5), 0);
      expect(crowd.levels.map((m) => m.visible)).toEqual([false, false, false, true]);
      expect(crowd.level).toBe(3);
      expect(crowdDetail(440, 3)).toBe(3);
      expect(crowdDetail(419, 3)).toBe(2);
      expect(crowdDetail(479, 2)).toBe(2);
      expect(crowdDetail(481, 2)).toBe(3);
    } finally {
      dispose(crowd.root);
      material.dispose();
    }
  });
  it('partitions every transition into exactly one visible representation per spectator', () => {
    const ranges = Array.from({ length: 4 }, () => new T.Vector2());
    for (const distance of [
      0, 91, 92, 96, 100, 104, 108, 218, 222, 230, 238, 242, 419, 420, 430, 450, 470, 480, 1000,
    ]) {
      crowdLodRanges(distance, ranges);
      expect(ranges.filter((r) => r.x < r.y).length).toBeLessThanOrEqual(2);
      for (let i = 0; i < 512; i++) {
        const rank = i / 512;
        expect(ranges.filter((r) => rank >= r.x && rank < r.y)).toHaveLength(1);
      }
    }
    crowdLodRanges(456.7, ranges);
    const held = ranges.map((r) => r.toArray());
    crowdLodRanges(23, ranges);
    crowdLodRanges(456.7, ranges);
    expect(ranges.map((r) => r.toArray())).toEqual(held);
  });
});

describe('Presentation continuation: snapshot-derived crowd reactions', () => {
  it('distinguishes nearby moving traffic, a close battle and a physical impact without modifying a frame', () => {
    const frame = snapshot(),
      original = frame.slice(),
      centre = new T.Vector3(),
      response = new T.Vector2();
    const battle = crowdResponse(frame, centre, response).x;
    expect(battle).toBeGreaterThan(0.5);
    expect(response.y).toBe(0);
    expect(frame).toEqual(original);
    frame[carBase(1) + F.X] = 500;
    const passing = crowdResponse(frame, centre, response).x;
    expect(passing).toBeGreaterThan(0);
    expect(passing).toBeLessThan(battle);
    frame[carBase(0) + F.IMPACT] = 1;
    crowdResponse(frame, centre, response);
    expect(response.toArray()).toEqual([0, 1]);
    frame[carBase(0) + F.IMPACT] = 0;
    frame[carBase(0) + F.SPEED] = 0;
    expect(crowdResponse(frame, centre, response).toArray()).toEqual([0, 0]);
    frame[carBase(0) + F.SPEED] = 45;
    frame[carBase(0) + F.PIT_PHASE] = 3;
    expect(crowdResponse(frame, centre, response).toArray()).toEqual([0, 0]);
    frame[carBase(0) + F.PIT_PHASE] = 0;
    frame[carBase(0) + F.RETIRED] = 1;
    expect(crowdResponse(frame, centre, response).toArray()).toEqual([0, 0]);
    expect(crowdResponse(original, new T.Vector3(1000, 0, 1000), response).toArray()).toEqual([
      0, 0,
    ]);
  });
  it('reproduces held and rewound reactions and quiets wet and distant spectators', () => {
    const material = new T.MeshStandardMaterial(),
      crowd = new CrowdCluster([new T.Matrix4()], [new T.Color()], 17, material);
    const frame = snapshot(),
      camera = new T.Vector3(10, 0, 0);
    const read = () => ({
      reaction: crowd.uniforms.crowdReaction.value.toArray(),
      clock: crowd.uniforms.crowdClock.value.toArray(),
    });
    try {
      crowd.update(22, camera, 0, frame);
      const first = read();
      crowd.update(22, camera, 0, frame);
      expect(read()).toEqual(first);
      frame[carBase(0) + F.IMPACT] = 1;
      crowd.update(30, camera, 0, frame);
      expect(read()).not.toEqual(first);
      frame[carBase(0) + F.IMPACT] = 0;
      crowd.update(22, camera, 0, frame);
      expect(read()).toEqual(first);
      crowd.update(22, camera, 60, frame);
      expect(crowd.uniforms.crowdReaction.value.x).toBeLessThan(first.reaction[0]);
      crowd.update(22, new T.Vector3(200, 0, 0), 0, frame);
      expect(crowd.uniforms.crowdReaction.value.length()).toBe(0);
      crowd.update(22, camera, 0);
      expect(crowd.uniforms.crowdReaction.value.length()).toBe(0);
    } finally {
      dispose(crowd.root);
      material.dispose();
    }
  });
  it('rejects invalid frames before returning a corrupt animation state', () => {
    const response = new T.Vector2(),
      centre = new T.Vector3();
    expect(() => crowdResponse(new Float32Array(1), centre, response)).toThrow();
    expect(() => crowdResponse(snapshot(), new T.Vector3(Infinity, 0, 0), response)).toThrow();
    const frame = snapshot();
    frame[carBase(0) + F.X] = NaN;
    expect(() => crowdResponse(frame, centre, response)).toThrow();
    frame[H.CARS] = 13;
    expect(() => crowdResponse(frame, centre, response)).toThrow();
  });
});

describe('Presentation continuation: bounded night illumination', () => {
  it('leaves daytime exposure unchanged and uses a finite reversible night profile', () => {
    for (const cloud of [0, 0.5, 1])
      for (const rain of [0, 20, 60]) {
        expect(circuitLightState(cloud, rain, false)).toEqual(daylightState(cloud, rain));
        const night = circuitLightState(cloud, rain, true);
        expect(Object.values(night).every(Number.isFinite)).toBe(true);
        expect(night.exposure).toBeLessThan(1.2);
        expect(night.environment).toBeLessThan(0.1);
        expect(night.fogDensity).toBe(daylightState(cloud, rain).fogDensity * 0.75);
        expect(circuitLightState(cloud, rain, false)).toEqual(daylightState(cloud, rain));
      }
  });
  it('reaches zero smoothly at the spatial support boundary without negative or unbounded weights', () => {
    expect(venueLightWeight(0, 100)).toBe(1);
    expect(venueLightWeight(100, 100)).toBe(0);
    let previous = 1;
    for (let distance = 0; distance <= 150; distance += 0.1) {
      const weight = venueLightWeight(distance, 100);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(previous + 1e-12);
      previous = weight;
    }
    expect(venueLightWeight(99.99, 100)).toBeLessThan(1e-6);
    for (const values of [
      [NaN, 1],
      [-1, 1],
      [1, 0],
      [1, Infinity],
    ])
      expect(venueLightWeight(values[0], values[1])).toBe(0);
  });
  it('uses four fixed physical sources and remains continuous across selection changes over the complete track', () => {
    const track = new Track('clear'),
      venue = new VenueLighting(track),
      p = trackPoint();
    const anchor = new T.Vector3();
    let changedSources = 0;
    const state = (s: number) => {
      track.at(s, p);
      anchor.set(p.x, p.y + 0.5, p.z);
      venue.update(true, anchor);
      return new Map(
        venue.lights.map((light) => [light.position.toArray().join(','), light.intensity]),
      );
    };
    try {
      expect(venue.lights).toHaveLength(4);
      for (let s = 0; s < track.length; s += 2) {
        const start = state(s),
          end = state(s + 2);
        if (Array.from(start.keys()).every((key) => end.has(key))) continue;
        changedSources++;
        // Locate this actual source-set boundary; both entering and leaving
        // sources approach zero, independent of shader slot ordering.
        let lo = s,
          hi = s + 2;
        for (let i = 0; i < 28; i++) {
          const mid = (lo + hi) / 2,
            middle = state(mid);
          if (Array.from(start.keys()).every((key) => middle.has(key))) lo = mid;
          else hi = mid;
        }
        const left = state(lo),
          right = state(hi);
        for (const key of new Set([...left.keys(), ...right.keys()]))
          expect(Math.abs((left.get(key) ?? 0) - (right.get(key) ?? 0))).toBeLessThan(0.001);
      }
      expect(changedSources).toBeGreaterThan(10);
      const first = Array.from(state(15));
      state(1000);
      expect(Array.from(state(15))).toEqual(first);
      for (const light of venue.lights) {
        expect(light.intensity).toBeGreaterThanOrEqual(0);
        expect(light.intensity).toBeLessThanOrEqual(VENUE_LIGHT_INTENSITY);
        expect(
          venue.sites.some(
            (site) =>
              site.x === light.position.x &&
              site.z === light.position.z &&
              site.topY - 2 === light.position.y,
          ),
        ).toBe(true);
      }
      venue.update(false, anchor);
      expect(venue.lights.every((light) => light.intensity === 0 && !light.visible)).toBe(true);
    } finally {
      dispose(venue.root);
    }
  });
});
