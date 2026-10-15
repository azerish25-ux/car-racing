import { describe, expect, it } from 'vitest';
import {
  combustionTorque,
  curveTorque,
  EngineState,
  frictionTorque,
  LEGACY_ENGINE,
  type EngineDefinition,
} from '../src/simulation/powertrain.ts';
import { engineTorque, Vehicle } from '../src/simulation/vehicle.ts';
import { FORMULA_APX01, TOURING_TC1 } from '../src/simulation/vehicles.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

const spec = FORMULA_APX01.spec;
describe('engine and gearbox models', () => {
  it('reproduces the former instant, linear torque with the legacy engine', () => {
    const state = new EngineState();
    for (const [rpm, pedal] of [
      [5000, 0.3],
      [11000, 1],
      [13000, 0.62],
    ]) {
      state.advance(LEGACY_ENGINE, pedal, rpm, 1 / 240);
      expect(combustionTorque(LEGACY_ENGINE, spec, state, rpm, 1000)).toBeCloseTo(
        engineTorque(rpm, spec) * pedal,
        12,
      );
    }
    expect(curveTorque(9000, spec)).toBe(510);
    expect(frictionTorque(LEGACY_ENGINE, 1000)).toBeCloseTo(12 + 0.04 * 1000, 12);
  });
  it('lags the pedal through intake filling exactly, without overshoot', () => {
    const engine: EngineDefinition = { ...LEGACY_ENGINE, throttleRise: 0.05, throttleFall: 0.1 };
    const state = new EngineState();
    state.advance(engine, 1, 9000, 0.05);
    expect(state.throttle).toBeCloseTo(1 - Math.exp(-1), 12);
    for (const dt of [1 / 240, 1 / 30, 5]) {
      const s = new EngineState();
      for (let i = 0; i < 20; i++) {
        s.advance(engine, 1, 9000, dt);
        expect(s.throttle).toBeLessThanOrEqual(1);
      }
    }
    state.throttle = 1;
    state.advance(engine, 0, 9000, 0.1);
    expect(state.throttle).toBeCloseTo(Math.exp(-1), 12);
  });
  it('builds turbo boost with rpm and time, and dumps it faster than it spools', () => {
    const engine: EngineDefinition = {
      ...LEGACY_ENGINE,
      turbo: { boostShare: 0.4, spoolTime: 0.8, dumpFraction: 0.25, spoolRPM: [2500, 4500] },
    };
    const low = new EngineState(),
      high = new EngineState();
    low.boost = high.boost = 0;
    for (let i = 0; i < 60; i++) {
      low.advance(engine, 1, 2000, 1 / 60);
      high.advance(engine, 1, 5000, 1 / 60);
    }
    expect(low.boost).toBeLessThan(0.05);
    expect(high.boost).toBeGreaterThan(0.6);
    expect(high.boost).toBeLessThan(0.8);
    const torque = combustionTorque(engine, TOURING_TC1.spec, high, 5000, 500);
    expect(torque).toBeGreaterThan(curveTorque(5000, TOURING_TC1.spec) * 0.6);
    expect(torque).toBeLessThan(curveTorque(5000, TOURING_TC1.spec));
    const boosted = high.boost;
    high.advance(engine, 0, 5000, 0.2);
    expect(high.boost).toBeCloseTo(boosted * Math.exp(-1), 9);
  });
  it('interpolates an explicit rpm × throttle torque table', () => {
    const engine: EngineDefinition = {
      ...LEGACY_ENGINE,
      table: {
        rpm: [1000, 5000],
        throttle: [0, 1],
        torque: [
          [-20, -40],
          [200, 400],
        ],
      },
    };
    const state = new EngineState();
    state.advance(engine, 0.5, 3000, 1 / 240);
    expect(combustionTorque(engine, spec, state, 3000, 300)).toBeCloseTo(135, 9);
  });
  it('adds closed-throttle pumping loss as engine braking', () => {
    const engine: EngineDefinition = { ...LEGACY_ENGINE, pumping: 0.02 };
    const state = new EngineState();
    state.advance(engine, 0, 10000, 1 / 240);
    expect(combustionTorque(engine, spec, state, 10000, 1047)).toBeCloseTo(-0.02 * 1047, 9);
  });
  it('interrupts drive for the definition shift time; a seamless box keeps pulling', () => {
    const run = (cut: number) => {
      const track = new DynamicsTrack();
      const definition = Object.freeze({
        ...FORMULA_APX01,
        dynamics: { gearbox: { shiftTime: 0.06, shiftCut: cut } },
      });
      const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition);
      car.place(track, 0);
      car.input.throttle = 1;
      for (let i = 0; i < 240 * 4; i++) car.step(1 / 240, track);
      return car.speed;
    };
    expect(run(0)).toBeGreaterThan(run(1));
  }, 30000);
});
