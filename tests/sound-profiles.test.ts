import { describe, it, expect } from 'vitest';
import { CAR_STRIDE, F, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { POWER_UNIT, newPowerUnitMix, powerUnitMix } from '../src/audio/power-unit.ts';
import {
  SOUND_PROFILES,
  engineCharacter,
  frameCharacter,
  soundFamilyFor,
} from '../src/audio/sound-profiles.ts';
import {
  FORMULA_APX01,
  TOURING_TC1,
  VEHICLES,
  vehicleDefinition,
  vehicleIndex,
} from '../src/simulation/vehicles.ts';

const o = carBase(0);
function frame(vehicle: string, rpm: number, torque: number, throttle: number, speed: number) {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[o + F.RPM] = rpm;
  f[o + F.ENGINE_TORQUE] = torque;
  f[o + F.THROTTLE] = throttle;
  f[o + F.SPEED] = speed;
  f[o + F.GEAR] = 4;
  f[o + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
  return f;
}

describe('powertrain sound families (WP26)', () => {
  it('keeps the APX-01 voice identical to the original constants', () => {
    const c = engineCharacter(FORMULA_APX01);
    expect(c.profile.family).toBe('v6-turbo-hybrid');
    expect(c.loadTorque).toBe(POWER_UNIT.maxTorqueNm);
    expect(c.profile.bandCentres[0] * c.limiterRPM).toBeCloseTo(4500, 6);
    expect(c.profile.crackleFraction * c.limiterRPM).toBeCloseTo(POWER_UNIT.crackleRpm, 6);
    const m = powerUnitMix(frame('apx01', 12000, 640, 1, 80), 0, 4, newPowerUnitMix());
    const load = 640 / 650,
      boost = load * ((12000 - 4000) / 8000);
    expect(m.turbo).toBeCloseTo(POWER_UNIT.turboGain * boost, 9);
    expect(m.motor).toBe(0);
  });
  it('gives the touring car its own four-cylinder turbo character', () => {
    expect(soundFamilyFor(TOURING_TC1)).toBe('i4-turbo');
    const f = frame('tc1', 5000, 340, 1, 40);
    expect(frameCharacter(f, 0).profile.family).toBe('i4-turbo');
    const touring = powerUnitMix(f, 0, 4, newPowerUnitMix());
    // Boost arrives far below the Formula engine's 4,000 rpm threshold.
    expect(
      powerUnitMix(frame('tc1', 3000, 300, 1, 30), 0, 4, newPowerUnitMix()).turbo,
    ).toBeGreaterThan(0);
    expect(touring.whine).toBeLessThan(
      powerUnitMix(frame('apx01', 5000, 340, 1, 40), 0, 4, newPowerUnitMix()).whine,
    );
  });
  it('separates naturally aspirated, electric and combustion families', () => {
    expect(SOUND_PROFILES['v10-na'].turbo).toBeNull();
    expect(SOUND_PROFILES['v10-na'].firingsPerRev).toBe(5);
    expect(SOUND_PROFILES.electric.firingsPerRev).toBe(0);
    expect(SOUND_PROFILES.electric.motorGain).toBeGreaterThan(0);
    for (const profile of Object.values(SOUND_PROFILES)) {
      expect(profile.bandCentres.every((c) => c > 0 && c < 1)).toBe(true);
      expect(Number.isFinite(profile.crackleFraction) || profile.crackleMaxRate === 0).toBe(true);
    }
  });
  it('gives motorcycles their own engine families', () => {
    expect(soundFamilyFor(vehicleDefinition('gpr1'))).toBe('v4-bike');
    expect(soundFamilyFor(vehicleDefinition('sbk1000'))).toBe('i4-bike');
    expect(frameCharacter(frame('gpr1', 14000, 100, 1, 60), 0).limiterRPM).toBe(
      vehicleDefinition('gpr1').spec.limiterRPM,
    );
  });
  it('gives every registered machine an explicit family', () => {
    for (const definition of Object.values(VEHICLES))
      expect(SOUND_PROFILES[soundFamilyFor(definition)].family).toBe(soundFamilyFor(definition));
    expect(soundFamilyFor(vehicleDefinition('gt10m'))).toBe('v10-na');
    expect(soundFamilyFor(vehicleDefinition('eh3'))).toBe('electric');
    expect(soundFamilyFor(vehicleDefinition('sk125'))).toBe('two-stroke-kart');
  });
});
