import { describe, expect, it } from 'vitest';
import { clamp } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  CLUTCH_LSD,
  differential,
  drivelineTorques,
  differentialOutput,
  differentialTorques,
  LEGACY_AXLE,
  LOCKED,
  lockingCapacity,
  lsd,
  OPEN,
  SPOOL,
  OPEN_AXLE,
  resolveDifferential,
  TORSEN,
} from '../src/simulation/differential.ts';

const out = differentialOutput();
describe('differential models', () => {
  it('reproduces the former viscous axle coupling exactly', () => {
    const def = resolveDifferential(LEGACY_AXLE, DEFAULT_SETUP);
    for (const [input, a, b, power] of [
      [2000, 80, 83, true],
      [-600, 50, 41, false],
      [3000, 10, 60, true],
    ] as const) {
      differentialTorques(def, input, power, a, b, 1.8, 1.8, 1 / 240, out);
      const setting = power ? DEFAULT_SETUP.diffPower : DEFAULT_SETUP.diffCoast,
        locking = clamp((b - a) * setting * 55, -1050, 1050);
      expect(out.first).toBeCloseTo(input * 0.5 + locking, 12);
      expect(out.second).toBeCloseTo(input * 0.5 - locking, 12);
    }
  });
  it('conserves torque and moves it toward the slower output for every model', () => {
    for (const def of [OPEN_AXLE, SPOOL, CLUTCH_LSD, TORSEN, LEGACY_AXLE]) {
      differentialTorques(def, 1500, true, 100, 110, 1.8, 1.8, 1 / 240, out);
      expect(out.first + out.second).toBeCloseTo(1500, 9);
      expect(out.first).toBeGreaterThanOrEqual(out.second - 1e-9);
    }
    differentialTorques(OPEN_AXLE, 1500, true, 100, 300, 1.8, 1.8, 1 / 240, out);
    expect(out.first).toBe(750);
  });
  it('limits a clutch pack to preload plus ramp locking, with separate power and coast ramps', () => {
    const lsd = differential({ ...CLUTCH_LSD, setupScaled: false });
    differentialTorques(lsd, 2000, true, 0, 1000, 1.8, 1.8, 1 / 240, out);
    expect(out.locking).toBeCloseTo(lsd.preload + lsd.powerLock * 2000, 9);
    differentialTorques(lsd, -2000, false, 0, 1000, 1.8, 1.8, 1 / 240, out);
    expect(out.locking).toBeCloseTo(lsd.preload + lsd.coastLock * 2000, 9);
    // Below its capacity the pack sticks: locking only what cancels slip.
    differentialTorques(lsd, 2000, true, 100, 100.01, 1.8, 1.8, 1 / 240, out);
    expect(Math.abs(out.locking)).toBeLessThan(lsd.preload);
    // Setup settings scale the ramps around the definition's values.
    const firm = resolveDifferential(CLUTCH_LSD, { diffPower: 1, diffCoast: 0.5 });
    expect(firm.powerLock).toBeCloseTo(CLUTCH_LSD.powerLock * 2, 12);
    expect(firm.coastLock).toBeCloseTo(CLUTCH_LSD.coastLock * 2, 12);
  });
  it('bounds a Torsen by its torque bias ratio', () => {
    differentialTorques(TORSEN, 1000, true, 0, 500, 1.8, 1.8, 1 / 240, out);
    expect(out.first / out.second).toBeCloseTo(TORSEN.biasRatio, 9);
  });
  it('keeps a locked axle synchronized against unequal tyre torques at 60-240 Hz', () => {
    for (const dt of [1 / 240, 1 / 120, 1 / 60]) {
      let a = 50,
        b = 50;
      const inertia = 1.8;
      for (let i = 0; i < Math.round(2 / dt); i++) {
        differentialTorques(SPOOL, 800, true, a, b, inertia, inertia, dt, out, -900, -300);
        // Unequal road reactions (split friction) on the two wheels.
        a += ((out.first - 900) * dt) / inertia;
        b += ((out.second - 300) * dt) / inertia;
        expect(Number.isFinite(a + b)).toBe(true);
      }
      expect(Math.abs(b - a)).toBeLessThan(0.01);
    }
  });
  it('resolves model names another content source may declare', () => {
    expect(resolveDifferential('open', DEFAULT_SETUP).kind).toBe('open');
    expect(resolveDifferential('spool', DEFAULT_SETUP).kind).toBe('locked');
    expect(resolveDifferential('clutch-lsd', DEFAULT_SETUP).kind).toBe('clutch');
    expect(resolveDifferential('torsen', DEFAULT_SETUP).kind).toBe('torsen');
    expect(resolveDifferential('unknown', DEFAULT_SETUP).kind).toBe('viscous');
    expect(resolveDifferential({ kind: 'clutch', preload: 90 }, DEFAULT_SETUP).preload).toBe(90);
    expect(() => differentialTorques(OPEN_AXLE, NaN, true, 0, 0, 1, 1, 1 / 240, out)).toThrow();
  });
  it('evaluates a catalogue DifferentialSpec with the same locking capacity', () => {
    const setup = { ...DEFAULT_SETUP, diffPower: 0.7, diffCoast: 0.15 };
    const spec = lsd(80, 0.4, 0.3),
      def = resolveDifferential(spec, setup);
    expect(def.kind).toBe('clutch');
    for (const input of [900, -600]) {
      // A large speed difference saturates the stick torque at the capacity.
      differentialTorques(def, input, input > 0, 0, 400, 1.2, 1.2, 1 / 240, out);
      expect(Math.abs(out.locking)).toBeCloseTo(
        lockingCapacity(spec, input, setup.diffPower, setup.diffCoast),
        9,
      );
    }
    expect(resolveDifferential(OPEN, setup).kind).toBe('open');
    expect(resolveDifferential(LOCKED, setup)).toMatchObject({ kind: 'locked', maxLocking: 30000 });
  });
  it('splits a centre differential by its front share', () => {
    const centre = differential({ kind: 'open', split: 0.4 });
    differentialTorques(centre, 1000, true, 30, 30, 4, 4, 1 / 240, out);
    expect(out.first).toBeCloseTo(400, 12);
    expect(out.second).toBeCloseTo(600, 12);
  });
  it('composes centre and axle differentials for rwd, fwd and awd layouts', () => {
    const wheels = new Float64Array(4),
      omega = [50, 52, 50, 52],
      inertia = [1.8, 1.8, 1.8, 1.8],
      reaction = [0, 0, 0, 0];
    const line = (layout: 'rwd' | 'fwd' | 'awd') => ({
      layout,
      front: OPEN_AXLE,
      rear: OPEN_AXLE,
      centre: differential({ kind: 'open', split: 0.4 }),
    });
    drivelineTorques(line('rwd'), 1000, true, omega, inertia, reaction, 1 / 240, wheels);
    expect([...wheels]).toEqual([0, 0, 500, 500]);
    drivelineTorques(line('fwd'), 1000, true, omega, inertia, reaction, 1 / 240, wheels);
    expect([...wheels]).toEqual([500, 500, 0, 0]);
    drivelineTorques(line('awd'), 1000, true, omega, inertia, reaction, 1 / 240, wheels);
    expect(wheels[0] + wheels[1]).toBeCloseTo(400, 9);
    expect(wheels[2] + wheels[3]).toBeCloseTo(600, 9);
    // A locked centre ties the axle speeds, moving torque to the slower axle.
    drivelineTorques(
      { ...line('awd'), centre: SPOOL },
      1000,
      true,
      [40, 40, 60, 60],
      inertia,
      reaction,
      1 / 240,
      wheels,
    );
    expect(wheels[0] + wheels[1]).toBeGreaterThan(wheels[2] + wheels[3]);
    expect(wheels.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 9);
  });
});
