import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  GHOST_FIELDS,
  GHOST_VERSION,
  ghostKey,
  ghostPose,
  validateGhost,
  type GhostLap,
} from '../src/core/ghost-lap.ts';
import { recordCategory, SIMULATION_VERSION } from '../src/core/session-identity.ts';
import { bikeOrientation } from '../src/simulation/bike-vehicle.ts';
import { chassisLean } from '../src/simulation/bike-definitions.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { Quat } from '../src/core/math.ts';
import { vehicleDefinition, vehicleIndex, VEHICLES } from '../src/simulation/vehicles.ts';
import {
  GHOST_LOOK,
  GhostCar,
  ghostRepresentation,
  writeGhostVehicle,
} from '../src/rendering/ghost-car.ts';
import { TimeTrialRecords } from '../src/session/time-trial-records.ts';
import { Track } from '../src/simulation/track.ts';

// Geometry/state-only tests. This no-op canvas is NOT rendered-image evidence.
function stubCanvas() {
  class Canvas {
    width = 300;
    height = 150;
    getContext() {
      const noop = () => {};
      return new Proxy(
        {
          canvas: this,
          measureText: () => ({ width: 40 }),
          createLinearGradient: () => ({ addColorStop: noop }),
          createRadialGradient: () => ({ addColorStop: noop }),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
          }),
        },
        { get: (target, key) => Reflect.get(target, key) ?? noop },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
}
afterEach(() => vi.unstubAllGlobals());

function lap(circuit: string, length: number, vehicle: string, lapTime: number): GhostLap {
  const n = 40,
    samples = new Float32Array(n * GHOST_FIELDS);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * lapTime;
    samples.set([t, (t / lapTime) * length, i, 0.6, 0, 0, 0, 0, 1, 0, 50], i * GHOST_FIELDS);
  }
  return {
    version: GHOST_VERSION,
    circuit,
    trackLength: length,
    lapTime,
    sectors: [lapTime / 3, lapTime / 3, lapTime / 3],
    assist: 'sport',
    compound: 'medium',
    weather: 'clear',
    recordedAt: '',
    samples,
    vehicle,
    physics: SIMULATION_VERSION,
  };
}

describe('Time Trial ghost by recorded vehicle', () => {
  it('draws each family with the field representation it races as', () => {
    expect(ghostRepresentation(vehicleDefinition('apx01'))).toBe('formula');
    expect(ghostRepresentation(vehicleDefinition('tc1'))).toBe('body');
    expect(ghostRepresentation(vehicleDefinition('gpr1'))).toBe('bike');
    expect(ghostRepresentation(vehicleDefinition('mx450'))).toBe('bike');
    for (const v of Object.values(VEHICLES))
      expect(['formula', 'body', 'bike']).toContain(ghostRepresentation(v));
  });
  it('writes the recorded vehicle index, wheel radii and a bike lean recovered from the pose', () => {
    const frame = new Float32Array(HEADER + CAR_STRIDE),
      gpr1 = vehicleDefinition('gpr1'),
      bike = gpr1.bike!,
      o = carBase(0);
    const pose = ghostPose();
    const lean = 0.7,
      q = bikeOrientation(new Quat(), 1.1, 0.02, chassisLean(lean, bike));
    Object.assign(pose, { qx: q.x, qy: q.y, qz: q.z, qw: q.w, steer: 0.05, speed: 40, s: 12 });
    writeGhostVehicle(frame, pose, gpr1);
    expect(frame[o + RACE_BASE + R.VEHICLE]).toBe(vehicleIndex('gpr1'));
    expect(frame[o + BIKE_BASE + B.LEAN]).toBeCloseTo(lean, 4);
    expect(frame[o + BIKE_BASE + B.STEER]).toBeCloseTo(0.05, 6);
    expect(frame[o + BIKE_BASE + B.FORK]).toBeGreaterThan(0);
    expect(frame[o + WHEEL_BASE + W.RADIUS]).toBeCloseTo(bike.frontWheelRadius, 6);
    expect(frame[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.RADIUS]).toBeCloseTo(
      bike.rearWheelRadius,
      6,
    );
    // A car leaves the bike block empty and steers its own front wheels.
    const tc1 = vehicleDefinition('tc1');
    writeGhostVehicle(frame, pose, tc1);
    expect(frame[o + RACE_BASE + R.VEHICLE]).toBe(vehicleIndex('tc1'));
    expect(frame[o + BIKE_BASE + B.LEAN]).toBe(0);
    expect(frame[o + WHEEL_BASE + W.STEER]).toBeCloseTo(0.05 * tc1.spec.maxSteer, 6);
  });
  it('replaces the Formula car with the recorded bike or body, all in the ghost material', () => {
    stubCanvas();
    const ghost = new GhostCar();
    const camera = new T.PerspectiveCamera(58, 16 / 9, 0.1, 1000);
    camera.position.set(0, 2, -20);
    try {
      const pose = ghostPose();
      pose.y = 0.6;
      for (const [vehicle, kind] of [
        ['gpr1', 'bike'],
        ['tc1', 'body'],
        ['apx01', 'formula'],
        [undefined, 'formula'],
      ] as const) {
        pose.vehicle = vehicle;
        ghost.update(pose, camera, 'high', 1, 1 / 60);
        expect(ghost.visible).toBe(true);
        expect(ghost.representation).toBe(kind);
        expect(ghost.car.root.visible).toBe(kind === 'formula');
        const shown = ghost.root.children.filter((c) => c.visible).map((c) => c.name);
        expect(shown).toHaveLength(1);
        let meshes = 0;
        ghost.root.traverseVisible((object) => {
          const mesh = object as T.Mesh;
          if (!mesh.isMesh) return;
          meshes++;
          expect(mesh.material).toBe(ghost.material);
          expect(mesh.castShadow).toBe(false);
        });
        expect(meshes).toBeGreaterThan(5);
        expect(ghost.material.color.getHex()).toBe(GHOST_LOOK.color);
      }
      ghost.update(null, camera, 'high', 1, 1 / 60);
      expect(ghost.visible).toBe(false);
      expect(ghost.root.visible).toBe(false);
    } finally {
      ghost.dispose();
    }
  });
  it('keys personal bests by vehicle: a bike lap never loads as a car ghost', async () => {
    const options = { ...DEFAULT_OPTIONS, mode: 'time-trial' as const, opponents: 0 };
    const track = new Track();
    const circuit = track.circuit.id,
      length = track.length;
    expect(ghostKey(circuit, 'gpr1')).not.toBe(ghostKey(circuit));
    const stored = new Map<string, unknown>([
      [ghostKey(circuit, 'gpr1'), lap(circuit, length, 'gpr1', 70)],
      [ghostKey(circuit), lap(circuit, length, 'apx01', 80)],
    ]);
    const records = new TimeTrialRecords({
      store: {
        read: async (key) => stored.get(key),
        write: async (key, value) => void stored.set(key, value),
      },
      toast: () => undefined,
      playerName: () => 'Driver',
    });
    await records.prepare({ ...options, vehicles: ['gpr1'] }, track, () => true);
    expect(records.player?.lap.vehicle).toBe('gpr1');
    expect(records.player?.lap.lapTime).toBe(70);
    await records.prepare(options, track, () => true);
    expect(records.player?.lap.vehicle).toBe('apx01');
    expect(records.player?.lap.lapTime).toBe(80);
    // A bike lap filed under the car's key is rejected by its category.
    expect(
      validateGhost(lap(circuit, length, 'gpr1', 70), circuit, length, recordCategory(options)),
    ).toBeNull();
    // The pose handed to the renderer names the recorded machine.
    await records.prepare({ ...options, vehicles: ['gpr1'] }, track, () => true);
    const a = new Float32Array(HEADER + CAR_STRIDE),
      b = a.slice();
    a[carBase(0) + F.LAP_TIME] = b[carBase(0) + F.LAP_TIME] = 20;
    expect(records.ghostAt(a, b, 0.5)?.vehicle).toBe('gpr1');
  });
});
