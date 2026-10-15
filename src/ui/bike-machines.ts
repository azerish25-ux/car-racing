import type { SessionOptions } from '../simulation/config.ts';
import { classInfo, vehiclesByClass } from '../simulation/vehicle-classes.ts';
import { VEHICLES } from '../simulation/vehicles.ts';

/** MACHINE choices for the motorcycle discipline (WP36), data-driven from the
 * registry: every motorcycle in class order (a single-machine grid under its
 * class's race ruleset), then a mixed GP + superbike grid (both classes race
 * under the GP motorcycle ruleset). Cars and bikes never share a grid; that
 * is enforced by sessionIncompatibilities, not by this menu. */
const MIXED_BIKES = Object.freeze({ bikes: 'Motorcycle grid · GP-R1 + SBK-1000' });
/** "SS-600 SUPERSPORT" → "SS-600 Supersport · motorcycle". */
function label(name: string) {
  const [code, ...rest] = name.split(' ');
  const title = (word: string) => word.charAt(0) + word.slice(1).toLowerCase();
  return `${code} ${rest.map(title).join(' ')} · motorcycle`;
}
export const BIKE_MACHINES: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    vehiclesByClass(Object.values(VEHICLES).filter((v) => v.dynamicsKind === 'bike'))
      .flatMap((g) => g.vehicles)
      .map((v) => [v.id, label(v.name)]),
  ),
  ...MIXED_BIKES,
});
export const BIKE_MACHINE_OPTIONS = Object.entries(BIKE_MACHINES)
  .map(([value, label]) => `<option value="${value}">${label}</option>`)
  .join('');
/** Per-entry vehicles, ruleset and tyre for a bike MACHINE choice; null for cars. */
export function bikeMachineOptions(
  options: SessionOptions,
  machine: string,
): Pick<SessionOptions, 'vehicles' | 'ruleset' | 'compound'> | null {
  if (!Object.hasOwn(BIKE_MACHINES, machine)) return null;
  const count = options.opponents + 1;
  const vehicles = Array.from({ length: count }, (_, i) =>
    machine === 'bikes' ? (i % 2 ? 'sbk1000' : 'gpr1') : machine,
  );
  // Races run the class's ruleset (the GP motorcycle sprint for the mixed
  // grid); practice, qualifying and time trial admit bikes under their own
  // rules. Endurance has no bike ruleset, and a road-only class has no race:
  // both are rejected with a stated reason.
  const ruleset =
    options.mode === 'race'
      ? machine === 'bikes'
        ? 'gp-motorcycle'
        : classInfo(VEHICLES[machine].classId).raceRuleset
      : undefined;
  // Bike tyres are slicks or full wets.
  const compound =
    options.mode === 'race' && options.compound === 'intermediate' ? 'wet' : options.compound;
  return { vehicles, ...(ruleset ? { ruleset } : {}), compound };
}
