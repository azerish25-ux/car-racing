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
import { SETUP_LABELS, setupStep as clickerStep } from './setup-page.ts';

/** Per-car setup screen (cars loose ends 4). GARAGE & SETTINGS shows only
 * the parameters the active machine exposes (VehicleDefinition.setupKeys),
 * within that machine's own limits, starting from the values it would
 * actually run (setupFor: its own baseline where the player kept the shared
 * default), each with the career garage's plain-language effect of moving it
 * (SETUP_EFFECTS). Saving writes back only the parameters the player moved,
 * so a GT's spring baseline never leaks into the Formula car's setup. A career
 * session that races a garage preset shows the preset it runs, read-only. */
// Labels (motorcycle parameters included) and slider increments come from
// the garage page model shared with the career garage.
export { SETUP_LABELS };
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
/** What GARAGE & SETTINGS edits. In a session, `machine` is the player's
 * entry (a Formula-only session has no vehicle list: the Formula car) and
 * `preset` the career garage preset the session races, if any; outside a
 * session both are null and the MACHINE menu choice decides. */
export interface SetupContext {
  machine: string | null;
  preset: Setup | null;
}
export function setupContext(
  inSession: boolean,
  vehicles: readonly string[] | undefined,
  preset: Setup | null,
): SetupContext {
  return inSession
    ? { machine: vehicles?.[0] ?? DEFAULT_VEHICLE_ID, preset }
    : { machine: null, preset: null };
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
/** Slider increment that keeps a researched/imported value exactly reachable
 * (motorcycle clickers, sprockets and maps step in their own units). */
export function setupStep(def: VehicleDefinition, key: keyof Setup, value: number) {
  return clickerStep(key, value, setupRange(def, key));
}
/** The machine's preferred increment for a key (the step from its minimum). */
function preferredStep(def: VehicleDefinition, key: keyof Setup) {
  const range = setupRange(def, key);
  return clickerStep(key, range[0], range) as number;
}
const sameValue = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(b));
/** setupFor reads a saved value equal to the shared default as "run this
 * machine's own baseline", so on a machine whose baseline for `key` differs,
 * that one value cannot be stored for it (null: every value can). */
export function setupReservedValue(def: VehicleDefinition, key: keyof Setup) {
  const own = def.setupDefaults?.[key];
  return def.setupKeys.includes(key) && own !== undefined && own !== DEFAULT_SETUP[key]
    ? DEFAULT_SETUP[key]
    : null;
}
/** The value saved for a slider position: the position itself, except the
 * reserved value, which saving would silently turn back into the baseline;
 * it saves as the next step past it in the direction the player moved
 * (`shown` is where the slider started), or the step before it at the end of
 * the range. */
export function setupSavedValue(
  def: VehicleDefinition,
  key: keyof Setup,
  value: number,
  shown: number,
) {
  const reserved = setupReservedValue(def, key);
  if (reserved === null || !sameValue(value, reserved)) return value;
  const [min, max] = setupRange(def, key),
    step = preferredStep(def, key),
    direction = value >= shown ? 1 : -1;
  let next = reserved + direction * step;
  if (next > max || next < min) next = reserved - direction * step;
  return Number(Math.max(min, Math.min(max, next)).toPrecision(12));
}
/** The row note for a slider position: why the reserved value saves as its
 * neighbour (empty for every other position). */
export function setupSaveNote(
  def: VehicleDefinition,
  key: keyof Setup,
  value: number,
  shown: number,
) {
  const reserved = setupReservedValue(def, key);
  if (reserved === null || !sameValue(value, reserved)) return '';
  return `${reserved} is the shared default, which ${def.name} reads as its own ${def.setupDefaults![key]}: it saves as ${setupSavedValue(def, key, value, shown)}.`;
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
 * exposed parameter, each followed by its hint and a save note (outside the
 * label, so the hint is the slider's description, not part of its name). With
 * a career `preset` the sliders show the preset's values, read-only. */
export function setupSectionHtml(def: VehicleDefinition, setup: Setup, preset?: Setup | null) {
  const keys = setupScreenKeys(def),
    shown = setupScreenValues(def, preset ?? setup),
    total = Object.keys(DEFAULT_SETUP).length;
  const rows = keys
    .map((key) => {
      const [min, max] = setupRange(def, key),
        value = shown[key],
        hint = setupHint(key);
      // The label names the slider (`for`: an <output> is labelable too, and
      // would otherwise take the label); the output repeats the slider's own
      // value, so it is hidden from assistive technology.
      return `<div class="setup-row"><label class="range-row" for="setup-${key}"><span id="setup-name-${key}">${escapeHtml(SETUP_LABELS[key])}</span><output aria-hidden="true">${value}</output><input name="${key}" data-setup type="range" min="${min}" max="${max}" step="${setupStep(def, key, value)}" value="${value}" data-shown="${value}"${preset ? ' disabled' : ''} id="setup-${key}" aria-labelledby="setup-name-${key}" aria-describedby="hint-${key} note-${key}"></label><small class="setup-hint" id="hint-${key}"><span aria-hidden="true">▲</span><span class="visually-hidden">Higher:</span> ${escapeHtml(hint.up)} · <span aria-hidden="true">▼</span><span class="visually-hidden">Lower:</span> ${escapeHtml(hint.down)}</small><small class="setup-note" id="note-${key}" aria-live="polite"></small></div>`;
    })
    .join('');
  const fixed = total - keys.length;
  const exposed = `${escapeHtml(def.name)}: ${keys.length} of ${total} parameters exposed${fixed ? `; the other ${fixed} are fixed by the machine` : ''}.`;
  const timing = preset
    ? ' This career session races the garage preset selected for this machine: the values below are the ones it runs, read-only here. Choose or save presets in the career garage; the GARAGE &amp; SETTINGS setup applies to sessions without one. Rendering and audio changes apply immediately.'
    : ' Physical setup changes take effect at the next session start. Rendering and audio changes apply immediately.';
  return `<p class="small-note" data-setup-machine="${escapeHtml(def.id)}"${preset ? ' data-setup-preset' : ''}>${exposed}${timing}</p>${rows}`;
}
/** Merge the screen back into the saved setup: only exposed parameters the
 * player moved away from the value shown are written (the reserved value as
 * its neighbour, see setupSavedValue; clamped to the shared limits);
 * everything else is kept exactly. A career preset session's read-only
 * section writes nothing. */
export function applySetupScreen(
  def: VehicleDefinition,
  setup: Setup,
  read: (key: keyof Setup) => number,
  preset?: Setup | null,
): Setup {
  if (preset) return { ...setup };
  const shown = setupScreenValues(def, setup),
    next = { ...setup };
  for (const key of setupScreenKeys(def)) {
    const value = read(key);
    // A slider can return the shown value with float noise from its step grid.
    if (!Number.isFinite(value) || sameValue(value, shown[key])) continue;
    const [min, max] = SETUP_LIMITS[key];
    next[key] = Math.max(min, Math.min(max, setupSavedValue(def, key, value, shown[key])));
  }
  return next;
}
