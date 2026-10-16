import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { FestivalTrails } from '../src/rendering/open-world/festival-trails.ts';
import { HorizonGuidance } from '../src/rendering/open-world/horizon-guidance.ts';
import { Effects, PARTICLE_KIND } from '../src/rendering/effects.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { vehicleIndex, VEHICLES } from '../src/simulation/vehicles.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { resolveEvents } from '../src/simulation/open-world/festival-events.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { ROAD_CLASSES } from '../src/simulation/open-world/region-data.ts';

function slidingFrame(time: number, z: number, vehicle = 'tc1') {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.TIME] = time;
  frame[H.CARS] = 1;
  frame[o + F.QW] = 1;
  frame[o + F.Y] = 1;
  frame[o + F.Z] = z;
  frame[o + F.SPEED] = 25;
  frame[o + F.VZ] = 25;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[p + W.LOAD] = 2000;
    frame[p + W.SLIP] = 0.5;
    frame[p + W.SLIP_POWER] = 12000;
    frame[p + W.RADIUS] = 0.3;
    frame[p + W.LENGTH] = 0.3;
  }
  return frame;
}

describe('festival contact presentation', () => {
  it('breaks teleport ribbons, clears future marks on time reversal and keeps a bounded pool', () => {
    const trails = new FestivalTrails(),
      ground = () => 0;
    trails.update(slidingFrame(10, 0), ground);
    trails.update(slidingFrame(10.1, 1), ground);
    expect(trails.segments).toBe(4);
    trails.update(slidingFrame(10.2, 1000), ground);
    expect(trails.segments).toBe(4);
    const p = trails.root.geometry.getAttribute('position');
    expect(Math.max(...Array.from(p.array).slice(0, 48))).toBeLessThan(10);
    trails.update(slidingFrame(1, 0), ground);
    expect(trails.segments).toBe(0);
    expect(trails.root.geometry.drawRange.count).toBe(0);
    for (let i = 1; i <= 400; i++) trails.update(slidingFrame(1 + i * 0.1, i), ground);
    expect(trails.segments).toBe(trails.capacity);
    expect(trails.root.geometry.drawRange.count).toBe(trails.capacity * 6);
    trails.dispose();
  });
  it('leaves wet, loose and unloaded contacts unmarked and draws only two bike tracks', () => {
    const ground = () => 0;
    for (const [channel, value] of [
      [W.WATER, 0.6],
      [W.SURFACE, MATERIAL.DIRT],
      [W.LOAD, 0],
    ] as const) {
      const trails = new FestivalTrails();
      for (let i = 0; i < 3; i++) {
        const frame = slidingFrame(i * 0.1, i);
        for (let w = 0; w < 4; w++)
          frame[carBase(0) + WHEEL_BASE + w * WHEEL_STRIDE + channel] = value;
        trails.update(frame, ground);
      }
      expect(trails.segments).toBe(0);
      trails.dispose();
    }
    const bike = Object.values(VEHICLES).find((v) => v.dynamicsKind === 'bike')!;
    const trails = new FestivalTrails();
    trails.update(slidingFrame(1, 0, bike.id), ground);
    trails.update(slidingFrame(1.1, 1, bike.id), ground);
    expect(trails.segments).toBe(2);
    trails.dispose();
  });
  it('uses venue wheel contacts and loose-surface colours without duplicating bike telemetry', () => {
    const effects = new Effects(),
      samples: number[] = [];
    effects.contactEnabled = (_frame, _car, wheel) => wheel % 2 === 0;
    effects.contactOffset = (_frame, _car, wheel, _plume, target) => {
      samples.push(wheel);
      target.set(0, -0.6, wheel < 2 ? 1 : -1);
      return -0.6;
    };
    effects.looseColours = new Map([[MATERIAL.MUD, [0.2, 0.15, 0.1] as const]]);
    const frame = slidingFrame(1, 0);
    for (let w = 0; w < 4; w++)
      frame[carBase(0) + WHEEL_BASE + w * WHEEL_STRIDE + W.SURFACE] = MATERIAL.MUD;
    effects.update(frame, 0.1);
    expect(effects.diagnostics().spawned[PARTICLE_KIND.DUST]).toBeGreaterThan(0);
    expect(new Set(samples)).toEqual(new Set([0, 2]));
    expect(effects.diagnostics().spawned[PARTICLE_KIND.SMOKE]).toBe(0);
    effects.clear();
  });
});

describe('festival route guidance', () => {
  it('conforms its chevrons to grade/camber, keeps flags beyond shoulders and resets after travel', () => {
    const world = openWorld(),
      event = resolveEvents(world).find((e) => e.spec.id === 'coast-to-summit')!;
    const guidance = new HorizonGuidance(),
      point = pathPoint(),
      matrix = new T.Matrix4(),
      vertex = new T.Vector3();
    const ground = (x: number, z: number) => 20 + x * 0.06 + z * 0.09;
    event.path.at(30, point);
    guidance.update(
      event,
      { x: point.x, z: point.z },
      new T.Vector3(point.x, point.y, point.z),
      20,
      ground,
    );
    const arrows = guidance.root.getObjectByName(
      'Road-following route chevrons',
    ) as T.InstancedMesh;
    expect(arrows.count).toBeGreaterThan(0);
    const positions = arrows.geometry.getAttribute('position');
    for (let i = 0; i < arrows.count; i++) {
      arrows.getMatrixAt(i, matrix);
      for (let j = 0; j < positions.count; j++) {
        vertex.fromBufferAttribute(positions, j).applyMatrix4(matrix);
        expect(vertex.y - ground(vertex.x, vertex.z)).toBeCloseTo(0.045, 3);
      }
    }
    for (const name of ['Left checkpoint flag', 'Right checkpoint flag']) {
      const flag = guidance.root.getObjectByName(name)!;
      const safeWidth =
        point.halfWidth + ROAD_CLASSES[event.path.network.edges[point.edge].roadClass].shoulder;
      expect(Math.hypot(flag.position.x - point.x, flag.position.z - point.z)).toBeGreaterThan(
        safeWidth + 0.5,
      );
    }
    event.path.at(event.path.finishDistance * 0.8, point);
    guidance.reset();
    guidance.update(event, null, new T.Vector3(point.x, point.y, point.z), 20, ground);
    arrows.getMatrixAt(0, matrix);
    vertex.setFromMatrixPosition(matrix);
    expect(Math.hypot(vertex.x - point.x, vertex.z - point.z)).toBeLessThan(20);
    guidance.dispose();
  });
});
