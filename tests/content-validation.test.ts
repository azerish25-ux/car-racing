import { describe, expect, it } from 'vitest';
import {
  validateCircuitDefinition,
  validateContent,
  validateVehicleDefinition,
} from '../src/simulation/content-validation.ts';
import { AUREL, STANDARD_PIT } from '../src/simulation/circuits.ts';
import { FIGURE_EIGHT_OVERPASS, KESTREL_LEFT_PIT } from '../src/simulation/test-venues.ts';
import { TOURING_TC1 } from '../src/simulation/vehicles.ts';

describe('WP14 content validation', () => {
  it('accepts every registered and development definition', () => {
    expect(validateContent()).toEqual([]);
    expect(validateCircuitDefinition(KESTREL_LEFT_PIT)).toEqual([]);
    expect(validateCircuitDefinition(FIGURE_EIGHT_OVERPASS)).toEqual([]);
  });
  it('names the field and reason for invalid vehicles', () => {
    const broken = {
      ...TOURING_TC1,
      id: 'Bad Id',
      spec: { ...TOURING_TC1.spec, dryMass: -5, gearRatios: [-3, 0, 2, 2.5], motorPowerW: 5 },
      wheelPositions: [TOURING_TC1.wheelPositions[2], ...TOURING_TC1.wheelPositions.slice(1)],
      tireGrip: Number.NaN,
    };
    const errors = validateVehicleDefinition(broken).join('\n');
    expect(errors).toMatch(/id must be/);
    expect(errors).toMatch(/dryMass -5 kg/);
    expect(errors).toMatch(/forward gear 2 must be shorter/);
    expect(errors).toMatch(/non-hybrid has no motor/);
    expect(errors).toMatch(/front wheels must be ahead/);
    expect(errors).toMatch(/tireGrip/);
  });
  it('names inconsistent pit geometry', () => {
    const errors = validateCircuitDefinition({
      ...AUREL,
      pit: { ...STANDARD_PIT, entry: 400, boxSpacing: 40 },
    }).join('\n');
    expect(errors).toMatch(/pit entry line/);
    expect(errors).toMatch(/twelve garage boxes/);
  });
});
