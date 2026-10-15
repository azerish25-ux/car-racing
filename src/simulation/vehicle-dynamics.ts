import type { VehicleDefinition } from './vehicles.ts';
import {
  FAMILY_CARCASS,
  FORMULA_SLICK,
  TOURING_SLICK,
  type TyreConstruction,
} from './tyre-force.ts';
import { defaultSuspension, type SuspensionDefinition } from './suspension.ts';
import {
  LEGACY_ENGINE,
  LEGACY_GEARBOX,
  type EngineDefinition,
  type GearboxDefinition,
} from './powertrain.ts';
import { LEGACY_AXLE, type DifferentialDefinition } from './differential.ts';
import {
  FORMULA_AERO_DYNAMICS,
  NEUTRAL_AERO_DYNAMICS,
  TOURING_AERO_DYNAMICS,
  type AeroDynamics,
} from './aero.ts';

/** Physical parameter blocks of one vehicle beyond its VehicleSpec: tyre
 * construction, suspension geometry and hardware, engine/gearbox response,
 * driven-axle differential and aero platform behaviour. Resolution order:
 * the definition's own `dynamics` overrides, then the registered block for
 * its id, then a class default derived from its spec (so a newly added
 * definition is always complete). docs/production/PHYSICS_MODEL.md. */
export interface VehicleDynamics {
  readonly tyre: TyreConstruction;
  readonly suspension: SuspensionDefinition;
  readonly engine: EngineDefinition;
  readonly gearbox: GearboxDefinition;
  /** Driven-axle differential: a definition, or a model name another content
   * source may use ('open', 'locked', 'lsd', 'viscous', 'torsen'). */
  readonly differential: DifferentialDefinition | string;
  readonly aero: AeroDynamics;
}
export type VehicleDynamicsOverrides = Partial<VehicleDynamics>;

/** Formula: low roll centres (push/pull-rod double wishbones), mild anti-dive
 * and anti-squat. With the 0.26 m link-centre correction the effective
 * mass-centre height is ~0.26 m, so tanθ 0.012 is ≈25% anti-dive. */
function formula(): VehicleDynamics {
  return Object.freeze({
    tyre: FORMULA_SLICK,
    suspension: defaultSuspension({
      front: {
        camberGain: 0.3,
        progression: 0.15,
        rollCentreHeight: 0.03,
        rollCentreGain: -0.3,
        antiBrake: 0.012,
      },
      rear: {
        camberGain: 0.2,
        progression: 0.15,
        rollCentreHeight: 0.06,
        rollCentreGain: -0.3,
        antiBrake: 0.008,
        antiDrive: 0.022,
      },
    }),
    engine: Object.freeze({
      ...LEGACY_ENGINE,
      throttleRise: 0.02,
      throttleFall: 0.035,
      pumping: 0.01,
    }),
    gearbox: Object.freeze({ shiftTime: 0.06, shiftCut: 1 }),
    differential: LEGACY_AXLE,
    aero: FORMULA_AERO_DYNAMICS,
  });
}
/** Saloon: strut front (more camber gain, higher roll centre), anti-lift
 * of the driven front axle. */
function touring(): VehicleDynamics {
  return Object.freeze({
    tyre: TOURING_SLICK,
    suspension: defaultSuspension({
      front: {
        camberGain: 0.55,
        progression: 0.1,
        rollCentreHeight: 0.05,
        rollCentreGain: -0.5,
        antiBrake: 0.02,
        antiDrive: 0.015,
      },
      rear: {
        camberGain: 0.35,
        progression: 0.1,
        rollCentreHeight: 0.08,
        rollCentreGain: -0.5,
        antiBrake: 0.01,
      },
    }),
    engine: Object.freeze({
      ...LEGACY_ENGINE,
      inertia: 0.21,
      throttleRise: 0.045,
      throttleFall: 0.06,
      pumping: 0.03,
    }),
    gearbox: Object.freeze({ shiftTime: 0.11, shiftCut: 1 }),
    differential: LEGACY_AXLE,
    aero: TOURING_AERO_DYNAMICS,
  });
}
/** Catalogue cars (vehicle-catalogue/, which all name a tyre family) and the
 * motorcycle adapters keep the behaviour their sheets were fitted against:
 * the legacy-reproducing suspension geometry, legacy throttle response and
 * 0.09 s shifts, their own power unit and driveline blocks, and the former
 * aero platform and wake. They share the combined-slip tyre law, thermal
 * model, hub suspension and ground materials; per-car geometry and response
 * can be added through `VehicleDefinition.dynamics`. */
function catalogue(def: VehicleDefinition): VehicleDynamics {
  return Object.freeze({
    tyre: def.tireFamily === 'formula-slick' ? FORMULA_SLICK : FAMILY_CARCASS,
    suspension: defaultSuspension(),
    engine: LEGACY_ENGINE,
    gearbox: LEGACY_GEARBOX,
    differential: LEGACY_AXLE,
    aero: NEUTRAL_AERO_DYNAMICS,
  });
}
/** The former model's blocks, for regression comparisons. */
export function legacyDynamics(def: VehicleDefinition): VehicleDynamics {
  return Object.freeze({
    tyre: def.classId === 'formula' ? FORMULA_SLICK : TOURING_SLICK,
    suspension: defaultSuspension(),
    engine: LEGACY_ENGINE,
    gearbox: LEGACY_GEARBOX,
    differential: LEGACY_AXLE,
    aero: def.classId === 'formula' ? FORMULA_AERO_DYNAMICS : TOURING_AERO_DYNAMICS,
  });
}
const CACHE = new WeakMap<VehicleDefinition, VehicleDynamics>();
export function vehicleDynamics(def: VehicleDefinition): VehicleDynamics {
  let resolved = CACHE.get(def);
  if (resolved) return resolved;
  const base =
    def.tireFamily !== undefined || def.dynamicsKind === 'bike'
      ? catalogue(def)
      : def.classId === 'formula'
        ? formula()
        : touring();
  const own = def.dynamics;
  // Another content source may name the axle differential on the definition.
  const named = (def as VehicleDefinition & { differential?: unknown }).differential;
  resolved = Object.freeze({
    ...base,
    ...(typeof named === 'string' || (named && typeof named === 'object')
      ? { differential: named as DifferentialDefinition | string }
      : {}),
    ...own,
  });
  CACHE.set(def, resolved);
  return resolved;
}
