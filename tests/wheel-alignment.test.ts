import {
  H,
  K,
  R,
  RACE_BASE,
  RACE_STRIDE,
  SKID_BASE,
  SKID_STRIDE,
} from '../src/simulation/protocol.ts';
import { expect, it } from 'vitest';
import { DEFAULT_OPTIONS, DEFAULT_SETUP, VEHICLE } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { WHEEL_POSITIONS } from '../src/simulation/vehicle.ts';
import { kinematicCamber } from '../src/simulation/suspension.ts';
import {
  F,
  W,
  CAR_STRIDE,
  HEADER,
  WHEEL_BASE,
  WHEEL_STRIDE,
  DEBRIS_BASE,
  DEBRIS_STRIDE,
  PROTOCOL_VERSION,
  carBase,
} from '../src/simulation/protocol.ts';
import { CHANNELS, packTelemetry } from '../src/storage/telemetry-schema.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';

it('records the exact Ackermann, toe and camber angles used by each physical tire', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 1 });
  const car = sim.cars[0];
  car.input.steer = 0.65;
  car.input.throttle = 0.3;
  for (let tick = 0; tick < 120; tick++) sim.step(1 / 120);
  const frame = sim.makeFrame();
  for (let id = 0; id < sim.cars.length; id++) {
    const vehicle = sim.cars[id];
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1,
        p = carBase(id) + WHEEL_BASE + i * WHEEL_STRIDE,
        ackermann =
          i < 2
            ? Math.atan(
                VEHICLE.wheelbase /
                  (VEHICLE.wheelbase / Math.tan(vehicle.steer) - WHEEL_POSITIONS[i][0]),
              )
            : 0,
        toe = side * (i < 2 ? vehicle.setup.frontToe : vehicle.setup.rearToe),
        // Static camber plus the suspension's camber gain at the actual hub travel.
        axle = i < 2 ? vehicle.dynamics.suspension.front : vehicle.dynamics.suspension.rear,
        camber = kinematicCamber(
          i < 2 ? vehicle.setup.frontCamber : vehicle.setup.rearCamber,
          axle.camberGain,
          vehicle.hub.travel[i],
          side,
        );
      expect(frame[p + W.STEER]).toBeCloseTo(
        ackermann + toe + vehicle.cornerDamage[i] * 0.07 * side,
        7,
      );
      expect(frame[p + W.CAMBER]).toBeCloseTo(camber, 7);
      expect(vehicle.wheelSteering[i]).toBeCloseTo(frame[p + W.STEER], 7);
      expect(vehicle.wheelCamber[i]).toBeCloseTo(frame[p + W.CAMBER], 7);
    }
  }
  expect(car.wheelSteering[0]).not.toBeCloseTo(car.wheelSteering[1], 3);
  expect(car.wheelSteering[2]).toBeCloseTo(-DEFAULT_SETUP.rearToe);
  expect(car.wheelSteering[3]).toBeCloseTo(DEFAULT_SETUP.rearToe);
});
it('initial garage snapshots contain alignment and protocol regions never overlap', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 11 });
  const frame = sim.makeFrame();
  expect(PROTOCOL_VERSION).toBe(11);
  expect(frame.length).toBe(HEADER + CAR_STRIDE * 12);
  expect(new Set(Object.values(W)).size).toBe(Object.keys(W).length);
  expect(Math.max(...Object.values(F))).toBeLessThan(WHEEL_BASE);
  expect(Math.max(...Object.values(W))).toBeLessThan(WHEEL_STRIDE);
  expect(WHEEL_BASE + 4 * WHEEL_STRIDE).toBe(DEBRIS_BASE);
  expect(DEBRIS_BASE + 4 * DEBRIS_STRIDE).toBe(SKID_BASE);
  expect(Math.max(...Object.values(K))).toBeLessThan(SKID_STRIDE);
  expect(SKID_BASE + SKID_STRIDE).toBe(RACE_BASE);
  expect(Math.max(...Object.values(R))).toBeLessThan(RACE_STRIDE);
  expect(SKID_BASE + SKID_STRIDE + RACE_STRIDE).toBe(CAR_STRIDE);
  expect(Math.max(...Object.values(H))).toBeLessThan(HEADER);
  for (let id = 0; id < 12; id++)
    for (let i = 0; i < 4; i++) {
      const p = carBase(id) + WHEEL_BASE + i * WHEEL_STRIDE;
      expect(frame[p + W.STEER]).toBeCloseTo(sim.cars[id].wheelSteering[i], 7);
      expect(frame[p + W.CAMBER]).toBeCloseTo(sim.cars[id].wheelCamber[i], 7);
    }
});
it('CSV and both replay presentation paths preserve actual per-wheel alignment', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  const a = sim.makeFrame();
  sim.cars[0].input.steer = -0.8;
  for (let i = 0; i < 16; i++) sim.step(1 / 120);
  const b = sim.makeFrame(),
    preserved = [a.slice(), b.slice()],
    recorder = new ReplayRecorder(1, 2);
  recorder.append(a);
  recorder.append(b);
  const ra = recorder.makeFrame(),
    rb = recorder.makeFrame();
  recorder.sample(recorder.duration / 2, ra, rb);
  const presented = new PresentedFrame().sample(a, b, 0.5),
    csv = new Float32Array(CHANNELS.length);
  packTelemetry(b, csv, 0);
  expect(CHANNELS.length).toBe(228);
  for (let i = 0; i < 4; i++) {
    const p = carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE;
    for (const field of [W.STEER, W.CAMBER]) {
      expect(ra[p + field]).toBe(a[p + field]);
      expect(rb[p + field]).toBe(b[p + field]);
      expect(presented[p + field]).toBeCloseTo((a[p + field] + b[p + field]) / 2, 7);
    }
  }
  expect(csv[CHANNELS.indexOf('FL_steer_rad')]).toBe(
    b[carBase(0) + WHEEL_BASE + WHEEL_STRIDE + W.STEER],
  );
  expect(csv[CHANNELS.indexOf('RR_camber_rad')]).toBe(
    b[carBase(0) + WHEEL_BASE + 2 * WHEEL_STRIDE + W.CAMBER],
  );
  expect(a).toEqual(preserved[0]);
  expect(b).toEqual(preserved[1]);
});
