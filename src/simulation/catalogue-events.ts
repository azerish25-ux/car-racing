import type { Compound } from './config.ts';
import type { EventDefinition, RulesetDefinition } from './events.ts';
import type { VehicleClass } from './vehicles.ts';

/** Rulesets and events for the destination catalogue (WP30, masterplan §10.1,
 * §11). Each racing class has a single-class sprint by default; mixing classes
 * on one grid needs a ruleset that says so (multi-class endurance, open
 * exhibition). Loaded by events.ts; type-only imports keep the module graph
 * acyclic. */
const DRY: readonly Compound[] = Object.freeze(['soft', 'medium', 'hard']);
const ALL: readonly Compound[] = Object.freeze([...DRY, 'intermediate', 'wet']);
/** One construction plus a wet: spec-tyre classes (touring, GT, club, kart). */
const SPEC: readonly Compound[] = Object.freeze(['medium', 'wet']);
const POINTS = Object.freeze([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
/** Classes with a circuit racing programme (road cars are open-world only). */
export const RACING_CLASSES: readonly VehicleClass[] = Object.freeze([
  'formula',
  'formula-junior',
  'historic',
  'hypercar',
  'prototype',
  'gt',
  'gt-sport',
  'touring',
  'club',
  'rally',
  'rallycross',
  'offroad',
  'kart',
]);
export const ALL_CLASSES: readonly VehicleClass[] = Object.freeze([...RACING_CLASSES, 'road']);
const sprint = (
  id: string,
  name: string,
  allowedClasses: readonly VehicleClass[],
  tires: readonly Compound[],
  extra: Partial<RulesetDefinition> = {},
): RulesetDefinition =>
  Object.freeze({
    version: 1,
    id,
    name,
    sessions: Object.freeze(['race'] as const),
    allowedClasses: Object.freeze([...allowedClasses]),
    tires: Object.freeze({ allowed: tires, mandatoryCompoundChange: false, penaltySeconds: 0 }),
    service: Object.freeze({ pitStops: true }),
    classification: 'laps' as const,
    points: POINTS,
    drs: false,
    assists: Object.freeze(['sport', 'raw'] as const),
    singleClass: true,
    ...extra,
  });
export const CATALOGUE_RULESETS: Readonly<Record<string, RulesetDefinition>> = Object.freeze({
  'junior-formula-sprint': sprint(
    'junior-formula-sprint',
    'JUNIOR FORMULA SPRINT',
    ['formula-junior'],
    ALL,
    {
      drs: true,
    },
  ),
  'historic-formula': sprint('historic-formula', 'HISTORIC FORMULA', ['historic'], SPEC),
  'prototype-sprint': sprint(
    'prototype-sprint',
    'PROTOTYPE SPRINT',
    ['hypercar', 'prototype'],
    ALL,
  ),
  'gt-sprint': sprint('gt-sprint', 'GT SPRINT', ['gt', 'gt-sport'], SPEC),
  'club-sprint': sprint('club-sprint', 'CLUB SPRINT', ['club'], SPEC),
  /** Short heats; rally cars and trucks run their own heats under it. */
  'rallycross-heat': sprint(
    'rallycross-heat',
    'RALLYCROSS HEAT',
    ['rallycross', 'rally', 'offroad'],
    SPEC,
    { service: Object.freeze({ pitStops: false }) },
  ),
  'kart-sprint': sprint('kart-sprint', 'KART SPRINT', ['kart'], SPEC, {
    service: Object.freeze({ pitStops: false }),
  }),
  /** Several classes share the road and are classified within their class. */
  'multi-class-endurance': Object.freeze({
    ...sprint(
      'multi-class-endurance',
      'MULTI-CLASS ENDURANCE',
      ['hypercar', 'prototype', 'gt', 'gt-sport'],
      ALL,
    ),
    sessions: Object.freeze(['endurance', 'race'] as const),
    classification: 'timed' as const,
    singleClass: false,
    classScoring: 'per-class' as const,
  }),
});
const event = (e: EventDefinition): EventDefinition => Object.freeze({ ...e });
export const CATALOGUE_EVENTS: readonly EventDefinition[] = Object.freeze([
  event({
    id: 'vellamar-gt-sprint',
    version: 1,
    name: 'VELLAMAR GT SPRINT',
    circuit: 'vellamar',
    mode: 'race',
    ruleset: 'gt-sprint',
    laps: 4,
    opponents: 7,
    weather: 'clear',
    vehicles: Object.freeze(['gt8f', 'gt10m', 'gt8f', 'gt10m', 'gt8f', 'gt10m', 'gt8f', 'gt10m']),
    compound: 'medium',
    seed: 6301,
  }),
  event({
    id: 'aurel-multi-class-endurance',
    version: 1,
    name: 'AUREL 30-MINUTE MULTI-CLASS',
    circuit: 'aurel',
    mode: 'endurance',
    ruleset: 'multi-class-endurance',
    laps: 30,
    durationSeconds: 1800,
    opponents: 9,
    weather: 'changeable',
    vehicles: Object.freeze([
      'hy9',
      'hy9',
      'pr2',
      'pr2',
      'pr2',
      'gt8f',
      'gt10m',
      'gt8f',
      'gt10m',
      'gs4',
    ]),
    compound: 'medium',
    seed: 6402,
  }),
  event({
    id: 'aurel-hypercar-sprint',
    version: 1,
    name: 'AUREL HYPERCAR SPRINT',
    circuit: 'aurel',
    mode: 'race',
    ruleset: 'prototype-sprint',
    laps: 5,
    opponents: 5,
    weather: 'clear',
    vehicles: 'hy9',
    compound: 'medium',
    seed: 6503,
  }),
  event({
    id: 'vellamar-touring-mixed-drive',
    version: 1,
    name: 'VELLAMAR TOURING · FRONT VS REAR DRIVE',
    circuit: 'vellamar',
    mode: 'race',
    ruleset: 'touring-sprint',
    laps: 4,
    opponents: 7,
    weather: 'clear',
    vehicles: Object.freeze(['tc2', 'tc1', 'tc2', 'tc1', 'tc2', 'tc1', 'tc2', 'tc1']),
    compound: 'medium',
    seed: 6604,
  }),
  event({
    id: 'aurel-kart-sprint',
    version: 1,
    name: 'AUREL SHIFTER KART SPRINT',
    circuit: 'aurel',
    mode: 'race',
    ruleset: 'kart-sprint',
    laps: 3,
    opponents: 7,
    weather: 'clear',
    vehicles: 'sk125',
    compound: 'medium',
    seed: 6705,
  }),
  event({
    id: 'aurel-rallycross-heat',
    version: 1,
    name: 'AUREL RALLYCROSS HEAT',
    circuit: 'aurel',
    mode: 'race',
    ruleset: 'rallycross-heat',
    laps: 3,
    opponents: 5,
    weather: 'clear',
    vehicles: 'rcx6',
    compound: 'medium',
    seed: 6806,
  }),
]);
