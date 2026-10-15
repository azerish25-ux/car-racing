import { SETUP_EFFECTS } from '../career/economy.ts';
import {
  DEFAULT_SETUP,
  SETUP_LIMITS,
  type SessionOptions,
  type Setup,
} from '../simulation/config.ts';
import {
  DEFAULT_VEHICLE_ID,
  setupFor,
  VEHICLES,
  type VehicleDefinition,
} from '../simulation/vehicles.ts';
import { machineOptions } from './machine-options.ts';

/** Per-car setup screen (cars loose ends 4). GARAGE & SETTINGS shows only
 * the parameters the active machine exposes (VehicleDefinition.setupKeys),
 * within that machine's own limits, starting from the values it would
 * actually run (setupFor: its own baseline where the player kept the shared
 * default), each with the career garage's plain-language effect of moving it
 * (SETUP_EFFECTS). Saving writes back only the parameters the player moved,
 * so a GT's spring baseline never leaks into the Formula car's setup. */
export const SETUP_LABELS: Readonly<Record<keyof Setup, string>> = Object.freeze({
  frontWing: 'Front wing',
  rearWing: 'Rear wing',
  brakeBias: 'Front brake bias',
  diffPower: 'Differential · power',
  diffCoast: 'Differential · coast',
  frontSpring: 'Front spring · N/m',
  rearSpring: 'Rear spring · N/m',
  frontARB: 'Front anti-roll · N/m',
  rearARB: 'Rear anti-roll · N/m',
  frontRide: 'Front ride height · m',
  rearRide: 'Rear ride height · m',
  frontPressure: 'Front pressure · kPa',
  rearPressure: 'Rear pressure · kPa',
  frontCamber: 'Front camber · rad',
  rearCamber: 'Rear camber · rad',
  frontToe: 'Front toe · rad',
  rearToe: 'Rear toe · rad',
});
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** The machine the screen edits: an explicit vehicle id, else the player's
 * entry for a MACHINE menu choice (a mixed grid's first entry), else the
 * Formula car. */
export function setupMachine(
  vehicle: string | null | undefined,
  menuChoice?: string | null,
  options?: SessionOptions,
): VehicleDefinition {
  if (vehicle && Object.hasOwn(VEHICLES, vehicle)) return VEHICLES[vehicle];
  if (menuChoice) {
    if (Object.hasOwn(VEHICLES, menuChoice)) return VEHICLES[menuChoice];
    if (options) {
      const first = machineOptions(options, menuChoice).vehicles?.[0];
      if (first && Object.hasOwn(VEHICLES, first)) return VEHICLES[first];
    }
  }
  return VEHICLES[DEFAULT_VEHICLE_ID];
}
/** The keys the machine exposes, in the shared setup order. */
export function setupScreenKeys(def: VehicleDefinition) {
  return (Object.keys(DEFAULT_SETUP) as (keyof Setup)[]).filter((k) => def.setupKeys.includes(k));
}
/** Slider range: the machine's own limits for the key, else the shared ones. */
export function setupRange(def: VehicleDefinition, key: keyof Setup): readonly [number, number] {
  const own = def.setupLimits?.[key],
    shared = SETUP_LIMITS[key];
  return own ? [Math.max(shared[0], own[0]), Math.min(shared[1], own[1])] : shared;
}
/** Slider increment that keeps a researched/imported value exactly reachable. */
export function setupStep(def: VehicleDefinition, key: keyof Setup, value: number) {
  const [min, max] = setupRange(def, key);
  const preferred = max > 1000 ? 500 : max > 100 ? 1 : max <= 0.01 ? 0.0005 : 0.001;
  const steps = (value - min) / preferred;
  return Math.abs(steps - Math.round(steps)) < 1e-9 ? preferred : 'any';
}
/** Plain-language effect of moving a parameter (the career garage's text). */
export function setupHint(key: keyof Setup) {
  const e = SETUP_EFFECTS[key];
  return { up: e.up, down: e.down, text: `Higher: ${e.up}. Lower: ${e.down}.` };
}
/** Values shown: what the machine would run with the saved setup. */
export function setupScreenValues(def: VehicleDefinition, setup: Setup) {
  return setupFor(def, setup, DEFAULT_SETUP);
}
/** The setup section's HTML: a note naming the machine and one slider per
 * exposed parameter with its hint. */
export function setupSectionHtml(def: VehicleDefinition, setup: Setup) {
  const keys = setupScreenKeys(def),
    shown = setupScreenValues(def, setup),
    total = Object.keys(DEFAULT_SETUP).length;
  const rows = keys
    .map((key) => {
      const [min, max] = setupRange(def, key),
        value = shown[key],
        hint = setupHint(key);
      return `<label class="range-row setup-row" title="${escapeHtml(hint.text)}">${escapeHtml(SETUP_LABELS[key])}<output>${value}</output><input name="${key}" data-setup type="range" min="${min}" max="${max}" step="${setupStep(def, key, value)}" value="${value}" aria-describedby="hint-${key}"><small class="setup-hint" id="hint-${key}">▲ ${escapeHtml(hint.up)} · ▼ ${escapeHtml(hint.down)}</small></label>`;
    })
    .join('');
  const fixed = total - keys.length;
  return `<p class="small-note" data-setup-machine="${escapeHtml(def.id)}">${escapeHtml(def.name)}: ${keys.length} of ${total} parameters exposed${fixed ? `; the other ${fixed} are fixed by the machine` : ''}. Physical setup changes take effect at the next session start. Rendering and audio changes apply immediately.</p>${rows}`;
}
/** Merge the screen back into the saved setup: only exposed parameters the
 * player moved away from the value shown are written (clamped to the shared
 * limits); everything else is kept exactly. */
export function applySetupScreen(
  def: VehicleDefinition,
  setup: Setup,
  read: (key: keyof Setup) => number,
): Setup {
  const shown = setupScreenValues(def, setup),
    next = { ...setup };
  for (const key of setupScreenKeys(def)) {
    const value = read(key);
    // A slider can return the shown value with float noise from its step grid.
    if (
      !Number.isFinite(value) ||
      Math.abs(value - shown[key]) <= 1e-7 * Math.max(1, Math.abs(shown[key]))
    )
      continue;
    const [min, max] = SETUP_LIMITS[key];
    next[key] = Math.max(min, Math.min(max, value));
  }
  return next;
}
