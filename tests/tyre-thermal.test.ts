import { describe, expect, it } from 'vitest';
import {
  advanceTyreTemperatures,
  ATMOSPHERE_KPA,
  hotPressure,
  TYRE_THERMAL,
  type ThermalInputs,
  type TyreThermalParameters,
} from '../src/simulation/tyre-thermal.ts';
import { makeTire, solveTire } from '../src/simulation/tire.ts';
import { surfaceSample } from '../src/simulation/track.ts';

const input = (patch: Partial<ThermalInputs> = {}): ThermalInputs => ({
  slipPower: 0,
  load: 3000,
  speed: 50,
  airTemp: 24,
  trackTemp: 36,
  waterMm: 0,
  discTemp: 24,
  wear: 0,
  ...patch,
});
const temps = (value = 60) => ({ surfaceTemp: value, carcassTemp: value, coreTemp: value });

describe('three-node tyre thermal model', () => {
  it('conserves heat exactly when every loss path is closed', () => {
    const closed: TyreThermalParameters = {
      ...TYRE_THERMAL,
      airBase: 0,
      airSpeed: 0,
      trackContact: 0,
      sidewallBase: 0,
      sidewallSpeed: 0,
      rimBase: 0,
      rimSpeed: 0,
      discToCore: 0,
    };
    const t = temps(40),
      dt = 1 / 240,
      power = 20000 + TYRE_THERMAL.hysteresis * 3000 * 50;
    let heat = 0;
    for (let i = 0; i < 2400; i++) {
      advanceTyreTemperatures(t, input({ slipPower: 20000 / TYRE_THERMAL.slipShare }), dt, closed);
      heat += power * dt;
    }
    const stored =
      closed.surfaceCapacity * (t.surfaceTemp - 40) +
      closed.carcassCapacity * (t.carcassTemp - 40) +
      closed.coreCapacity * (t.coreTemp - 40);
    expect(stored / heat).toBeCloseTo(1, 9);
  });
  it('is unconditionally stable and never overshoots its bounding temperatures', () => {
    for (const dt of [1 / 240, 1 / 60, 1, 100, 1e5]) {
      const t = temps(110);
      advanceTyreTemperatures(t, input({ waterMm: 4, speed: 80 }), dt);
      for (const value of Object.values(t)) {
        expect(value).toBeLessThanOrEqual(110 + 1e-9);
        expect(value).toBeGreaterThanOrEqual(24 - 1e-9);
      }
    }
    // A huge step lands on the steady state of the network.
    const a = temps(30),
      b = temps(30);
    advanceTyreTemperatures(a, input({ slipPower: 8000 }), 1e13);
    for (let i = 0; i < 20000; i++) advanceTyreTemperatures(b, input({ slipPower: 8000 }), 10);
    expect(a.surfaceTemp).toBeCloseTo(b.surfaceTemp, 6);
    expect(a.coreTemp).toBeCloseTo(b.coreTemp, 6);
    expect(a.surfaceTemp).toBeGreaterThan(a.carcassTemp);
    expect(a.carcassTemp).toBeGreaterThan(a.coreTemp);
  });
  it('heats the surface from sliding first, the carcass from rolling, the core last', () => {
    const sliding = temps(60);
    advanceTyreTemperatures(sliding, input({ slipPower: 40000, speed: 0, load: 0 }), 0.5);
    expect(sliding.surfaceTemp - 60).toBeGreaterThan(5 * (sliding.carcassTemp - 60));
    expect(sliding.carcassTemp).toBeGreaterThan(sliding.coreTemp - 1e-12);
    const rolling = temps(60);
    advanceTyreTemperatures(
      rolling,
      input({ load: 8000, speed: 80, airTemp: 60, trackTemp: 60 }),
      1,
    );
    expect(rolling.carcassTemp).toBeGreaterThan(60);
  });
  it('cools faster in standing water and in the airflow of speed', () => {
    const dry = temps(95),
      wet = temps(95),
      slow = temps(95);
    advanceTyreTemperatures(dry, input({ speed: 60 }), 5);
    advanceTyreTemperatures(wet, input({ speed: 60, waterMm: 2 }), 5);
    advanceTyreTemperatures(slow, input({ speed: 5 }), 5);
    expect(wet.surfaceTemp).toBeLessThan(dry.surfaceTemp - 5);
    expect(slow.surfaceTemp).toBeGreaterThan(dry.surfaceTemp);
  });
  it('carries brake heat through the rim into the gas and the hot pressure', () => {
    const cold = temps(80),
      braked = temps(80);
    for (let i = 0; i < 600; i++) {
      advanceTyreTemperatures(cold, input({ discTemp: 80, airTemp: 80, trackTemp: 80 }), 1);
      advanceTyreTemperatures(braked, input({ discTemp: 700, airTemp: 80, trackTemp: 80 }), 1);
    }
    expect(braked.coreTemp).toBeGreaterThan(cold.coreTemp + 5);
    expect(hotPressure(155, braked.coreTemp, 87)).toBeGreaterThan(
      hotPressure(155, cold.coreTemp, 87),
    );
  });
  it('uses the ideal-gas law on absolute pressure', () => {
    expect(hotPressure(155, 87, 87)).toBeCloseTo(155, 10);
    const hot = hotPressure(155, 117, 87);
    expect(hot).toBeCloseTo(((155 + ATMOSPHERE_KPA) * 390.15) / 360.15 - ATMOSPHERE_KPA, 10);
    // Gauge-only scaling would understate the rise.
    expect(hot - 155).toBeGreaterThan(155 * (30 / 360.15));
  });
  it('heats a thinner (worn) tread faster for the same sliding power', () => {
    const fresh = temps(80),
      worn = temps(80);
    advanceTyreTemperatures(fresh, input({ slipPower: 30000 }), 1);
    advanceTyreTemperatures(worn, input({ slipPower: 30000, wear: 0.8 }), 1);
    expect(worn.surfaceTemp - 80).toBeGreaterThan((fresh.surfaceTemp - 80) * 1.3);
  });
  it('heats a sliding production tyre through its surface', () => {
    const t = makeTire('medium'),
      s = surfaceSample();
    t.omega = 40 / t.radius;
    for (let i = 0; i < 240; i++) solveTire(t, 40, 5, 3000, 0, 0, s, 0, 1 / 240);
    expect(t.surfaceTemp).toBeGreaterThan(t.carcassTemp);
    expect(t.carcassTemp).toBeGreaterThan(t.coreTemp);
    expect(Number.isFinite(t.coreTemp + t.pressure)).toBe(true);
  });
});
