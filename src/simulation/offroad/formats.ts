import type { Compound } from '../config.ts';
import type { EventDefinition, RulesetDefinition } from '../events.ts';
import type { VehicleClass } from '../vehicles.ts';

/** Off-road session formats (WP41/WP42, GAME_DESIGN §2 off-road row): data
 * on a ruleset, read by OffroadSession. Motocross motos start from a
 * synchronised gate (D049) with jump-start detection and a holeshot line;
 * rallycross heats start from lights and require exactly one joker lap;
 * rally stages run against the clock with staggered starts and splits. */
export interface OffroadFormat {
  kind: 'moto' | 'rallycross' | 'stage';
  start: 'gate' | 'lights' | 'staggered';
  /** Time added for a jump start (s). */
  jumpStartPenalty: number;
  /** Rallycross: joker laps required and the time per missing/extra one. */
  joker?: { required: number; penaltySeconds: number };
  /** Stage: seconds between starters, and the time limit after which a
   * starter who has not finished is classified DNF. */
  stage?: { interval: number; maxSeconds: number };
  /** Motocross: points per moto position and motos per meeting. */
  motoPoints?: readonly number[];
  motos?: number;
}
/** Points per moto (positions 1-20). */
export const MOTO_POINTS = Object.freeze([
  25, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
]);
export const OFFROAD_CLASSES = Object.freeze({
  bikes: Object.freeze(['motocross', 'supermoto'] as const),
  // Historic rally cars run on gravel tyres and take the stages too.
  cars: Object.freeze(['rallycross', 'rally', 'offroad', 'historic-rally'] as const),
});
const TYRES: readonly Compound[] = Object.freeze(['medium', 'wet']);
const ruleset = (
  id: string,
  name: string,
  allowedClasses: readonly VehicleClass[],
  format: OffroadFormat,
  extra: Partial<RulesetDefinition> = {},
): RulesetDefinition =>
  Object.freeze({
    id,
    version: 1,
    name,
    sessions: Object.freeze(['race'] as const),
    allowedClasses: Object.freeze([...allowedClasses]),
    tires: Object.freeze({ allowed: TYRES, mandatoryCompoundChange: false, penaltySeconds: 0 }),
    service: Object.freeze({ pitStops: false }),
    classification: 'laps' as const,
    points: format.motoPoints ?? Object.freeze([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]),
    drs: false,
    assists: Object.freeze(['sport', 'raw'] as const),
    singleClass: true,
    format: Object.freeze(format),
    ...extra,
  });
export const OFFROAD_RULESETS: Readonly<Record<string, RulesetDefinition>> = Object.freeze({
  'motocross-moto': ruleset('motocross-moto', 'MOTOCROSS MOTO', ['motocross'], {
    kind: 'moto',
    start: 'gate',
    jumpStartPenalty: 10,
    motoPoints: MOTO_POINTS,
    motos: 2,
  }),
  'supermoto-moto': ruleset('supermoto-moto', 'SUPERMOTO MOTO', ['supermoto'], {
    kind: 'moto',
    start: 'gate',
    jumpStartPenalty: 10,
    motoPoints: MOTO_POINTS,
    motos: 2,
  }),
  'rallycross-joker': ruleset('rallycross-joker', 'RALLYCROSS HEAT · JOKER', OFFROAD_CLASSES.cars, {
    kind: 'rallycross',
    start: 'lights',
    jumpStartPenalty: 5,
    joker: { required: 1, penaltySeconds: 30 },
  }),
  'rally-stage': ruleset(
    'rally-stage',
    'RALLY SPECIAL STAGE',
    ['rally', 'rallycross', 'offroad', 'historic-rally'],
    {
      kind: 'stage',
      start: 'staggered',
      jumpStartPenalty: 10,
      stage: { interval: 20, maxSeconds: 600 },
    },
  ),
});
const event = (e: EventDefinition): EventDefinition => Object.freeze({ ...e });
export const OFFROAD_EVENTS: readonly EventDefinition[] = Object.freeze([
  event({
    id: 'valley-ridge-mx-moto-1',
    version: 1,
    name: 'VALLEY RIDGE MOTOCROSS · MOTO 1',
    circuit: 'valley-ridge-mx',
    mode: 'race',
    ruleset: 'motocross-moto',
    laps: 4,
    opponents: 9,
    weather: 'clear',
    vehicles: Object.freeze([
      'mx450',
      'mx450',
      'mx250',
      'mx450',
      'mx250',
      'mx450',
      'mx250',
      'mx450',
      'mx250',
      'mx450',
    ]),
    compound: 'medium',
    seed: 41001,
  }),
  event({
    id: 'valley-ridge-mx-moto-2',
    version: 1,
    name: 'VALLEY RIDGE MOTOCROSS · MOTO 2',
    circuit: 'valley-ridge-mx',
    mode: 'race',
    ruleset: 'motocross-moto',
    laps: 4,
    opponents: 9,
    weather: 'changeable',
    vehicles: Object.freeze([
      'mx450',
      'mx450',
      'mx250',
      'mx450',
      'mx250',
      'mx450',
      'mx250',
      'mx450',
      'mx250',
      'mx450',
    ]),
    compound: 'medium',
    seed: 41002,
  }),
  event({
    id: 'arena-nord-supercross',
    version: 1,
    name: 'ARENA NORD SUPERCROSS · MAIN EVENT',
    circuit: 'arena-nord-sx',
    mode: 'race',
    ruleset: 'motocross-moto',
    laps: 6,
    opponents: 9,
    weather: 'clear',
    vehicles: 'mx450',
    compound: 'medium',
    seed: 41003,
  }),
  event({
    id: 'valley-ridge-supermoto',
    version: 1,
    name: 'VALLEY RIDGE SUPERMOTO SPRINT',
    circuit: 'valley-ridge-mx',
    mode: 'race',
    ruleset: 'supermoto-moto',
    laps: 3,
    opponents: 7,
    weather: 'clear',
    vehicles: 'sm450',
    compound: 'medium',
    seed: 41004,
  }),
  event({
    id: 'kestrel-rallycross-heat',
    version: 1,
    name: 'KESTREL RALLYCROSS · HEAT 1',
    circuit: 'kestrel-rx',
    mode: 'race',
    ruleset: 'rallycross-joker',
    laps: 4,
    opponents: 4,
    weather: 'clear',
    vehicles: 'rcx6',
    compound: 'medium',
    seed: 41005,
  }),
  event({
    id: 'pinewood-special-stage',
    version: 1,
    name: 'PINEWOOD SPECIAL STAGE',
    circuit: 'pinewood-stage',
    mode: 'race',
    ruleset: 'rally-stage',
    laps: 1,
    opponents: 5,
    weather: 'clear',
    vehicles: 'rl2',
    compound: 'medium',
    seed: 41006,
  }),
]);
/** Combined meeting classification from per-moto finishing orders (car ids,
 * winner first): points per moto, overall by total points, ties broken by
 * the better result in the last moto (the usual motocross rule). Riders who
 * did not finish a moto score nothing in it. */
export function combineMotos(
  motos: readonly { order: readonly number[]; finished: ReadonlySet<number> | readonly number[] }[],
  points: readonly number[] = MOTO_POINTS,
) {
  const riders = new Set<number>();
  for (const m of motos) for (const id of m.order) riders.add(id);
  const rows = [...riders].map((id) => {
    const results = motos.map((m) => {
      const finished = Array.isArray(m.finished)
        ? (m.finished as readonly number[]).includes(id)
        : (m.finished as ReadonlySet<number>).has(id);
      const position = m.order.indexOf(id) + 1;
      return {
        position: finished && position > 0 ? position : 0,
        points: finished ? (points[position - 1] ?? 0) : 0,
      };
    });
    return { id, results, total: results.reduce((a, r) => a + r.points, 0) };
  });
  const last = motos.length - 1;
  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    const pa = a.results[last]?.position || 999,
      pb = b.results[last]?.position || 999;
    return pa - pb || a.id - b.id;
  });
  return rows.map((r, i) => ({ ...r, overall: i + 1 }));
}
/** Gate pick (D049): riders choose slots in qualifying order; each takes the
 * most preferred free slot. `preference` lists slot indices best first.
 * Returns the slot index for every rider id. */
export function pickGates(order: readonly number[], preference: readonly number[]) {
  const taken = new Set<number>(),
    slots = new Map<number, number>();
  for (const id of order) {
    const slot = preference.find((s) => !taken.has(s));
    if (slot === undefined) throw new Error('More riders than gate slots');
    taken.add(slot);
    slots.set(id, slot);
  }
  return slots;
}
