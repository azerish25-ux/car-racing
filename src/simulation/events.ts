import { CIRCUIT_IDS, type CircuitId } from './circuits.ts';
import type { Assist, Compound, SessionOptions, WeatherPreset } from './config.ts';
import { VEHICLES, type VehicleClass } from './vehicles.ts';
import { CATALOGUE_EVENTS } from './circuit-catalogue/events.ts';

/** Composable sporting rules (WP09 / F07, masterplan §6.3). A session format
 * (practice, qualifying, race...) is separate from its ruleset (tyre, service,
 * classification, scoring) and from the vehicles it admits, so a Formula
 * compound rule can no longer silently become a universal rule. */
export type SessionMode = SessionOptions['mode'];
export interface RulesetDefinition {
  id: string;
  version: number;
  name: string;
  sessions: readonly SessionMode[];
  allowedClasses: readonly VehicleClass[];
  tires: {
    /** Compounds an entrant may fit. */
    allowed: readonly Compound[];
    /** A dry race must use two different dry compounds (wet/inter satisfies it). */
    mandatoryCompoundChange: boolean;
    penaltySeconds: number;
  };
  service: { pitStops: boolean };
  /** 'laps': first car to complete N laps; 'timed': leader's first crossing
   * after the clock expires (masterplan §11.4), lapped cars on next crossing. */
  classification: 'laps' | 'timed';
  points: readonly number[];
  drs: boolean;
  assists: readonly Assist[];
}
const DRY: readonly Compound[] = Object.freeze(['soft', 'medium', 'hard']);
const ALL: readonly Compound[] = Object.freeze([...DRY, 'intermediate', 'wet']);
const POINTS = Object.freeze([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
const base = {
  version: 1,
  tires: Object.freeze({ allowed: ALL, mandatoryCompoundChange: false, penaltySeconds: 0 }),
  service: Object.freeze({ pitStops: true }),
  classification: 'laps' as const,
  points: POINTS,
  drs: true,
  assists: Object.freeze(['sport', 'raw'] as const),
};
export const RULESETS: Readonly<Record<string, RulesetDefinition>> = Object.freeze({
  'formula-grand-prix': Object.freeze({
    ...base,
    id: 'formula-grand-prix',
    name: 'FORMULA GRAND PRIX',
    sessions: Object.freeze(['race'] as const),
    allowedClasses: Object.freeze(['formula'] as const),
  }),
  'formula-endurance': Object.freeze({
    ...base,
    id: 'formula-endurance',
    name: 'FORMULA ENDURANCE',
    sessions: Object.freeze(['endurance'] as const),
    allowedClasses: Object.freeze(['formula'] as const),
    tires: Object.freeze({ allowed: ALL, mandatoryCompoundChange: true, penaltySeconds: 30 }),
  }),
  /** Timed endurance: a clock, not a lap count, ends the race. */
  'timed-endurance': Object.freeze({
    ...base,
    id: 'timed-endurance',
    name: 'TIMED ENDURANCE',
    sessions: Object.freeze(['endurance'] as const),
    allowedClasses: Object.freeze(['formula', 'touring'] as const),
    classification: 'timed' as const,
    drs: false,
  }),
  'touring-sprint': Object.freeze({
    ...base,
    id: 'touring-sprint',
    name: 'TOURING SPRINT',
    sessions: Object.freeze(['race'] as const),
    allowedClasses: Object.freeze(['touring'] as const),
    tires: Object.freeze({
      allowed: Object.freeze(['medium', 'wet'] as const),
      mandatoryCompoundChange: false,
      penaltySeconds: 0,
    }),
    drs: false,
  }),
  /** Mixed-class exhibition: classes race together without class scoring. */
  'open-exhibition': Object.freeze({
    ...base,
    id: 'open-exhibition',
    name: 'OPEN EXHIBITION',
    sessions: Object.freeze(['race', 'practice'] as const),
    allowedClasses: Object.freeze(['formula', 'touring'] as const),
    drs: false,
  }),
  'open-practice': Object.freeze({
    ...base,
    id: 'open-practice',
    name: 'PRACTICE',
    sessions: Object.freeze(['practice'] as const),
    allowedClasses: Object.freeze(['formula', 'touring'] as const),
    points: Object.freeze([]),
  }),
  qualifying: Object.freeze({
    ...base,
    id: 'qualifying',
    name: 'QUALIFYING',
    sessions: Object.freeze(['qualifying'] as const),
    allowedClasses: Object.freeze(['formula', 'touring'] as const),
    points: Object.freeze([]),
  }),
  'time-trial': Object.freeze({
    ...base,
    id: 'time-trial',
    name: 'TIME TRIAL',
    sessions: Object.freeze(['time-trial'] as const),
    allowedClasses: Object.freeze(['formula', 'touring'] as const),
    points: Object.freeze([]),
    service: Object.freeze({ pitStops: true }),
  }),
});
/** The ruleset each legacy mode always implied. */
export const DEFAULT_RULESET: Readonly<Record<SessionMode, string>> = Object.freeze({
  race: 'formula-grand-prix',
  endurance: 'formula-endurance',
  practice: 'open-practice',
  qualifying: 'qualifying',
  'time-trial': 'time-trial',
});
/** Duration bounds for timed sessions (s). */
export const TIMED_LIMITS = Object.freeze({ min: 120, max: 6 * 3600 });
export function rulesetFor(options: Pick<SessionOptions, 'mode' | 'ruleset'>): RulesetDefinition {
  const id = options.ruleset && Object.hasOwn(RULESETS, options.ruleset) ? options.ruleset : null;
  return RULESETS[id ?? DEFAULT_RULESET[options.mode]];
}
/** Every reason a session cannot be loaded; empty when it is compatible. */
export function sessionIncompatibilities(options: SessionOptions): string[] {
  const errors: string[] = [];
  if (options.ruleset && !Object.hasOwn(RULESETS, options.ruleset))
    errors.push(`Unknown ruleset ${options.ruleset}`);
  const rules = rulesetFor(options);
  if (!rules.sessions.includes(options.mode))
    errors.push(`${rules.name} does not run ${options.mode} sessions`);
  const vehicles = options.vehicles ?? [];
  vehicles.forEach((id, car) => {
    const def = VEHICLES[id];
    if (def && !rules.allowedClasses.includes(def.classId))
      errors.push(`Car ${car + 1} (${def.name}) is not eligible for ${rules.name}`);
  });
  if (!options.vehicles && !rules.allowedClasses.includes('formula'))
    errors.push(`${rules.name} needs eligible vehicles; the default Formula field is not`);
  if (!rules.tires.allowed.includes(options.compound))
    errors.push(`${options.compound} tyres are not permitted by ${rules.name}`);
  if (!rules.assists.includes(options.assist))
    errors.push(`${options.assist} assists are not permitted by ${rules.name}`);
  if (rules.classification === 'timed') {
    const d = options.durationSeconds;
    if (d === undefined || !(d >= TIMED_LIMITS.min && d <= TIMED_LIMITS.max))
      errors.push(`${rules.name} needs a duration of ${TIMED_LIMITS.min}-${TIMED_LIMITS.max} s`);
  }
  return errors;
}
/** A complete, versioned event (masterplan §6.3 EventDefinition). */
export interface EventDefinition {
  id: string;
  version: number;
  name: string;
  circuit: CircuitId;
  mode: SessionMode;
  ruleset: string;
  laps: number;
  durationSeconds?: number;
  opponents: number;
  weather: WeatherPreset;
  /** Vehicle id for every entrant (player first), or one id for the whole field. */
  vehicles: readonly string[] | string;
  compound: Compound;
  seed: number;
}
/** Resolve an event into the session the simulation loads, rejecting
 * incompatible combinations before anything is built. */
export function eventSession(event: EventDefinition, base: SessionOptions): SessionOptions {
  if (!CIRCUIT_IDS.includes(event.circuit)) throw new Error(`Unknown circuit ${event.circuit}`);
  const count = event.opponents + 1;
  const vehicles =
    typeof event.vehicles === 'string'
      ? Array.from({ length: count }, () => event.vehicles as string)
      : [...event.vehicles];
  if (vehicles.length !== count) throw new Error(`${event.name}: one vehicle per entrant`);
  for (const id of vehicles)
    if (!Object.hasOwn(VEHICLES, id)) throw new Error(`${event.name}: unknown vehicle ${id}`);
  const options: SessionOptions = {
    ...base,
    circuit: event.circuit,
    mode: event.mode,
    ruleset: event.ruleset,
    laps: event.laps,
    opponents: event.opponents,
    weather: event.weather,
    compound: event.compound,
    seed: event.seed,
    vehicles,
    ...(event.durationSeconds !== undefined ? { durationSeconds: event.durationSeconds } : {}),
  };
  const errors = sessionIncompatibilities(options);
  if (errors.length) throw new Error(`${event.name}: ${errors.join('; ')}`);
  return options;
}
/** Built-in events that exercise the non-Formula rules end to end. */
export const EVENTS: readonly EventDefinition[] = Object.freeze([
  Object.freeze({
    id: 'aurel-touring-sprint',
    version: 1,
    name: 'AUREL TOURING SPRINT',
    circuit: 'aurel' as const,
    mode: 'race' as const,
    ruleset: 'touring-sprint',
    laps: 4,
    opponents: 7,
    weather: 'clear' as const,
    vehicles: 'tc1',
    compound: 'medium' as const,
    seed: 4101,
  }),
  Object.freeze({
    id: 'vellamar-timed-endurance',
    version: 1,
    name: 'VELLAMAR 20-MINUTE ENDURANCE',
    circuit: 'vellamar' as const,
    mode: 'endurance' as const,
    ruleset: 'timed-endurance',
    laps: 30,
    durationSeconds: 1200,
    opponents: 7,
    weather: 'changeable' as const,
    vehicles: 'apx01',
    compound: 'medium' as const,
    seed: 5202,
  }),
  // Catalogue layouts (WP29-WP30).
  ...CATALOGUE_EVENTS,
]);
