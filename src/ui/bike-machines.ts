import type { SessionOptions } from '../simulation/config.ts';

/** MACHINE choices for the motorcycle discipline (WP36): an all-GP-prototype
 * grid, an all-superbike grid, or a mixed bike grid (both bike classes race
 * under the GP motorcycle ruleset). Cars and bikes never share a grid; that
 * is enforced by sessionIncompatibilities, not by this menu. */
export const BIKE_MACHINES = Object.freeze({
  gpr1: 'GP-R1 Prototype · motorcycle',
  sbk1000: 'SBK-1000 Superbike · motorcycle',
  bikes: 'Motorcycle grid · GP-R1 + SBK-1000',
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
  // Races run the GP motorcycle ruleset; practice, qualifying and time trial
  // admit bikes under their own rules. Endurance has no bike ruleset and is
  // rejected with a stated reason.
  const ruleset = options.mode === 'race' ? 'gp-motorcycle' : undefined;
  // Bike tyres are slicks or full wets.
  const compound =
    options.mode === 'race' && options.compound === 'intermediate' ? 'wet' : options.compound;
  return { vehicles, ...(ruleset ? { ruleset } : {}), compound };
}
