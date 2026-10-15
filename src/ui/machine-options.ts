import type { CircuitId } from '../simulation/circuits.ts';
import { DEFAULT_OPTIONS, validateOptions, type SessionOptions } from '../simulation/config.ts';
import { gridDrs } from '../simulation/drs.ts';
import {
  RULESETS,
  TIMED_LIMITS,
  rulesetFor,
  sessionIncompatibilities,
} from '../simulation/events.ts';
import { classInfo, vehiclesByClass } from '../simulation/vehicle-classes.ts';
import { DEFAULT_VEHICLE_ID, VEHICLES } from '../simulation/vehicles.ts';
import { BIKE_MACHINES, bikeMachineOptions } from './bike-machines.ts';

/** MACHINE choice (WP22, WP30): data-driven from the vehicle registry,
 * grouped by class. A single machine fills the grid with its own class under
 * the class's default ruleset; mixing classes is an explicit choice of a
 * ruleset that allows it (open exhibition, multi-class endurance). */
export const MIXED_MACHINES = Object.freeze({
  mixed: 'Mixed exhibition · Formula + Touring',
  multiclass: 'Multi-class endurance · Hypercar + Prototype + GT',
});
/** Multi-class field order, repeated over the grid (class leaders first). */
export const MULTICLASS_FIELD = Object.freeze(['hy9', 'pr2', 'gt8f', 'gt10m', 'gs4']);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Menu label from the definition name: "GT-8F FRONT-ENGINE GT" becomes
 * "GT-8F Front-Engine GT · RWD" (short tokens stay capitalized). */
function label(name: string, drivetrain: string) {
  const [code, ...rest] = name.split(' ');
  const title = (word: string) =>
    word.length <= 2
      ? word
      : word
          .split('-')
          .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
          .join('-');
  return `${code} ${rest.map(title).join(' ')} · ${drivetrain.toUpperCase()}`;
}
export interface MachineGroup {
  label: string;
  options: { value: string; label: string }[];
}
/** Menu groups in class order, then the mixed-class choices. */
export function machineChoices(): MachineGroup[] {
  const groups: MachineGroup[] = vehiclesByClass(Object.values(VEHICLES))
    .filter((g) => g.vehicles.every((v) => v.dynamicsKind === 'four-wheel'))
    .map((g) => ({
      label: g.info.name,
      options: g.vehicles.map((v) => ({ value: v.id, label: label(v.name, v.drivetrain) })),
    }));
  groups.push({
    label: 'Motorcycles',
    options: Object.entries(BIKE_MACHINES).map(([value, text]) => ({ value, label: text })),
  });
  groups.push({
    label: 'Mixed classes',
    options: Object.entries(MIXED_MACHINES).map(([value, text]) => ({ value, label: text })),
  });
  return groups;
}
export function machineSelectOptions(selected: string = DEFAULT_VEHICLE_ID) {
  return machineChoices()
    .map(
      (g) =>
        `<optgroup label="${escapeHtml(g.label)}">${g.options
          .map(
            (o) =>
              `<option value="${escapeHtml(o.value)}"${o.value === selected ? ' selected' : ''}>${escapeHtml(o.label)}</option>`,
          )
          .join('')}</optgroup>`,
    )
    .join('');
}
/** Timed sessions from the menu's distance: about 90 s per lap. */
const timedDuration = (laps: number) =>
  Math.max(TIMED_LIMITS.min, Math.min(TIMED_LIMITS.max, Math.round(laps * 90)));
/** A dry compound outside the ruleset becomes its spec slick; wet stays wet. */
function compoundFor(ruleset: string | undefined, compound: SessionOptions['compound']) {
  if (!ruleset) return compound;
  const allowed = RULESETS[ruleset].tires.allowed;
  return allowed.includes(compound) || compound === 'wet' ? compound : 'medium';
}
/** Per-entry vehicles, ruleset (and clock for timed rulesets) a MACHINE choice
 * implies. Unsupported combinations are left for sessionIncompatibilities to
 * explain rather than silently changed. */
export function machineOptions(
  options: SessionOptions,
  machine: string,
): Pick<SessionOptions, 'vehicles' | 'ruleset' | 'compound' | 'durationSeconds'> {
  const bikes = bikeMachineOptions(options, machine);
  if (bikes) return bikes;
  const count = options.opponents + 1;
  if (machine === 'mixed') {
    const vehicles = Array.from({ length: count }, (_, i) => (i % 2 ? 'apx01' : 'tc1'));
    const ruleset =
      options.mode === 'race' || options.mode === 'practice' ? 'open-exhibition' : undefined;
    return { vehicles, ...(ruleset ? { ruleset } : {}), compound: options.compound };
  }
  if (machine === 'multiclass') {
    const vehicles = Array.from(
      { length: count },
      (_, i) => MULTICLASS_FIELD[i % MULTICLASS_FIELD.length],
    );
    const timed = options.mode === 'race' || options.mode === 'endurance';
    return {
      vehicles,
      ...(timed
        ? { ruleset: 'multi-class-endurance', durationSeconds: timedDuration(options.laps) }
        : {}),
      compound: options.compound,
    };
  }
  const def = Object.hasOwn(VEHICLES, machine) ? VEHICLES[machine] : null;
  if (!def || machine === DEFAULT_VEHICLE_ID) return { compound: options.compound };
  const vehicles = Array.from({ length: count }, () => machine);
  let ruleset: string | undefined;
  let durationSeconds: number | undefined;
  if (options.mode === 'race') ruleset = classInfo(def.classId).raceRuleset;
  else if (
    options.mode === 'endurance' &&
    RULESETS['multi-class-endurance'].allowedClasses.includes(def.classId)
  ) {
    ruleset = 'multi-class-endurance';
    durationSeconds = timedDuration(options.laps);
  }
  return {
    vehicles,
    ...(ruleset ? { ruleset } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    compound: compoundFor(ruleset, options.compound),
  };
}
/** The session menu fields the rules preview reads. */
export interface SessionRulesFields {
  mode: SessionOptions['mode'];
  opponents: number;
  compound: SessionOptions['compound'];
  vehicle: string;
  circuit: CircuitId;
}
/** Menu ids whose change re-runs the rules preview: every field it reads
 * (the circuit too, since the motorcycle rulesets need a bike-safe one). */
export const SESSION_RULES_FIELDS = Object.freeze([
  'mode',
  'vehicle',
  'compound',
  'opponents',
  'circuit',
] as const satisfies readonly (keyof SessionRulesFields)[]);
/** The rules line under the session menu: the resolved ruleset's summary, or
 * why the selection cannot start (the same check the START button runs). */
export function sessionRulesSummary(fields: SessionRulesFields) {
  const options = validateOptions({
    ...DEFAULT_OPTIONS,
    mode: fields.mode,
    opponents: fields.opponents,
    compound: fields.compound,
    circuit: fields.circuit,
  });
  const resolved = { ...options, ...machineOptions(options, fields.vehicle) };
  const rules = rulesetFor(resolved),
    problems = sessionIncompatibilities(validateOptions(resolved)),
    grid = (resolved.vehicles ?? [DEFAULT_VEHICLE_ID]).map((id) => VEHICLES[id]),
    drs = gridDrs(rules.drs, grid);
  return problems.length
    ? `Unavailable: ${problems.join('; ')}.`
    : `${rules.name}: ${rules.tires.mandatoryCompoundChange ? 'two dry compounds required' : 'no mandatory stop'} · DRS ${drs ? 'on' : 'off'} · ${rules.points.length ? 'points scored' : 'no points'}.`;
}
